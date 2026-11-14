# Swarm Engine — Architecture & Internal Mechanics

This document provides a deep technical dive into the architecture, execution engine, concurrency model, and safety mechanisms of Swarm Engine.

---

## 1. Direct Workspace Execution & Teamwork Parity (Zero Worktrees)

Swarm Engine matches Antigravity's native `/teamwork` and `/swarm` architecture by operating directly in the project repository (`workspace: "inherit"` by default) with **zero worktree overhead**. There are **no git worktrees created**, **no `.swarm/worktrees` directory**, and **no branch switching overhead**.

```
                    ┌────────────────────────┐
                    │   Shared Project CWD   │
                    │   (Direct Workspace)   │
                    └───────────┬────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        ▼                       ▼                       ▼
 ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
 │   Worker 1   │        │   Worker 2   │        │   Worker N   │
 │ src/schema.ts│        │src/routes.ts │        │test/user.ts  │
 └──────────────┘        └──────────────┘        └──────────────┘
```

### 1.1 In-Place Collision-Free Execution
1. **Design-Out Conflicts**:
   Two workers editing the same file is the failure mode to design out, not to manage. The coordinator deconstructs the mission into distinct non-overlapping files or modules (`targetFiles`) before work begins (*"One worker per file, say who owns what before anyone starts"*).
2. **Direct In-Place Editing**:
   Workers read, inspect, and modify their assigned files directly in the repository root.
3. **Atomic File Locks**:
   File targets are locked in `.swarm/state.lock` so agents cannot reserve overlapping files concurrently.
4. **Instant Completion**:
   When an agent in direct workspace mode finishes (`complete_agent_task`), its file locks are released and downstream agents are triggered immediately—with zero git commit, merge, or branch operations required.

### 1.2 Optional Git Worktree Sandboxing (`workspace: "share"`)
For users or testing environments that explicitly request isolated git branch experiments, Swarm Engine provides an optional worktree mode via `workspace: "share"`:
- Creates a dedicated worktree at `.swarm/worktrees/<agentId>` on branch `swarm/<agentId>`.
- Deletes `AGENT_TASK.md` before staging files to keep git history clean.
- Merges into the parent branch with `--no-ff` and prunes the worktree directory upon completion.
*(Direct workspace execution with zero worktrees remains the standard default).*

---

## 2. Atomic Directory Locking & State Management

Swarm Engine coordinates multi-process concurrency using directory-level atomic mutexes on the local filesystem, avoiding database requirements or external daemon dependencies.

```
                  ┌───────────────────────────────┐
                  │ .swarm/state.lock (mkdir)    │
                  ├───────────────────────────────┤
                  │ owner: PID + timestamp        │
                  │ liveness: process.kill(pid, 0)│
                  │ stale timeout: > 30 seconds   │
                  └───────────────┬───────────────┘
                                  │
                                  ▼
                  ┌───────────────────────────────┐
                  │      .swarm/state.json        │
                  ├───────────────────────────────┤
                  │ - mission                     │
                  │ - maxConcurrency (0 = inf)    │
                  │ - agents { ... }              │
                  │ - lockedFiles [ ... ]         │
                  │ - blackboard { ... }          │
                  └───────────────────────────────┘
```

### 2.1 Directory Mutex (`.swarm/state.lock`)
Atomic locking is implemented using `fs.mkdirSync`:
- In all POSIX and Windows filesystems, `mkdir` is an atomic system call. If the directory already exists, `mkdir` fails immediately with `EEXIST`.
- The acquiring process writes an `owner.json` file inside `.swarm/state.lock/` containing:
  ```json
  {
    "pid": 12345,
    "timestamp": 1730371200000,
    "agentId": "leader"
  }
  ```

### 2.2 Stale Lock Recovery & Dead PID Eviction
To prevent deadlocks if a worker crashes or is terminated (`SIGKILL`):
1. **PID Liveness Check**: When encountering an existing lock, Swarm Engine reads `owner.json` and checks if the holding process is still alive using `process.kill(pid, 0)`.
2. **Immediate Eviction on Dead PID**: If `process.kill(pid, 0)` throws `ESRCH`, the process is dead. The stale lock is reclaimed immediately without waiting.
3. **Timeout Fallback**: If the PID is valid or corrupted, but the lock age exceeds 30 seconds (`Date.now() - timestamp > 30_000`), the lock is treated as abandoned and evicted.

### 2.3 Normalized File Path Locking (Safeguard 4)
To ensure concurrent agents never collide on the same file due to platform path discrepancies:
- All target paths are normalized using `normalizePath()`:
  - Windows backslashes (`\`) are converted to forward slashes (`/`).
  - Leading `./` or `/` are stripped.
  - Path casing is normalized to lower case on Windows.
- Before transitioning an agent from `pending` to `running`, the DAG scheduler verifies that none of its declared `targetFiles` overlap with already active entries in `state.lockedFiles`.

---

## 3. DAG Scheduler & Concurrency Model

Task scheduling is driven by a Directed Acyclic Graph (DAG) with full dependency resolution and unbounded parallel scaling.

### 3.1 Cycle Detection (3-Color DFS)
Before initializing or dynamically adding agents, Swarm Engine validates the dependency graph:
- White (0): Unvisited node.
- Gray (1): Currently in recursion stack.
- Black (2): Fully visited.
If an edge traverses to a Gray node, a cycle is detected and the operation is rejected before any state or worktrees are created.

### 3.2 Infinite Concurrency (`maxConcurrency: 0`)
- Standard orchestrators artificially throttle execution to 2, 4, or 8 workers.
- Swarm Engine sets `maxConcurrency: 0` by default, representing **infinite concurrency**.
- In every scheduler tick:
  ```typescript
  const isUnlimited = state.maxConcurrency === 0;
  const availableSlots = isUnlimited ? Infinity : state.maxConcurrency - runningCount;
  ```
  All pending agents whose prerequisites have succeeded (`dependsOn.every(d => agents[d].status === 'completed')`) and whose `targetFiles` do not conflict with running agents are scheduled immediately and simultaneously.

### 3.3 Dynamic On-The-Fly Injection (`add_dynamic_agent`)
Agents can be injected mid-flight into a live swarm:
- The dynamic agent is added to `state.agents`.
- Cycle and missing dependency checks execute instantly.
- The scheduler triggers immediately. If files are available and prerequisites are satisfied, the dynamic agent begins executing in its own isolated worktree with zero queuing.

---

## 4. Fable Terminal Dashboard (TUI) & Model Detection

Swarm Engine provides real-time terminal observability through its Fable visual subsystem.

### 4.1 Card-Based Telemetry
The TUI renders ASCII cards for every agent in the swarm:
- **Status indicators**: `[RUNNING]`, `[COMPLETED]`, `[PENDING]`, `[FAILED]`.
- **Poetic action verbs**: Dynamic verbs describing active cognitive work (`Pruning...`, `Simmering...`, `Synthesizing...`, `Distilling...`, `Forging...`).
- **Real-Time Diff Viewer**: Shows the last 3 code modifications with line numbers (+ green for additions, - red for deletions).
- **Token Velocity**: Displays accumulated tokens and throughput rate in tokens per second (`tok/s`).

### 4.2 Automatic Client Model Detection
Swarm Engine eliminates hardcoded model dependencies. When initializing or running, `detectActiveModels()` inspects:
1. `~/.config/kilo/kilo.jsonc` — reads active Kilo CLI models.
2. `claude_desktop_config.json` / Claude Code global settings.
3. `.cursor/` or VS Code active workspace configurations.
4. Local workspace `.env` (e.g. `ANTHROPIC_MODEL`, `OPENAI_MODEL`, `MODEL`).
5. Local Ollama daemon endpoint (`http://localhost:11434/api/tags`) for locally running LLMs.

The discovered models are assigned to `leaderModel` and worker defaults automatically.
