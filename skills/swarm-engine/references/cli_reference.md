# Swarm Engine — CLI Reference Manual

Swarm Engine provides a robust command-line interface (CLI) to manage, run, inspect, and reset multi-agent swarms without requiring manual MCP configuration.

```bash
swarm-engine <subcommand> [options]
```

---

## 1. Subcommands Overview

| Subcommand | Description |
|---|---|
| `init` | Provisions `.swarm/`, configures `.gitignore`, and generates `AGENTS.md`. |
| `run` / `start` | Launches autonomous multi-agent swarm execution with live Fable TUI. |
| `status` | Renders swarm status as a visual dashboard, ASCII table, or JSON. |
| `watch` | Auto-refreshing live terminal dashboard (aliases: `dashboard`, `tui`). |
| `worker` | Runs an agent worker autonomously inside its isolated worktree. |
| `complete` | Merges an agent's worktree to the main branch and releases file locks. |
| `reset` | Prunes worktrees, removes `swarm/*` branches, and cleans locks/state. |
| `mcp` | Starts the stdio Model Context Protocol (MCP) server. |

---

## 2. Command Details & Flags

### 2.1 `init`
Initializes Swarm Engine in the current working directory.

```bash
swarm-engine init [mission] [options]
```

- **Arguments**:
  - `[mission]`: Optional string describing the overall swarm objective (default: `"Default Swarm Mission"`).
- **Options**:
  - `--concurrency <num>`: Maximum concurrent running agents. Set to `0` for **infinite/unlimited concurrency** (default: `0`).
  - `--worker <command>`: Shell command to execute background workers in their worktrees.
  - `--leader-model, -lm <model>`: Model identifier for the orchestrator (auto-detected if omitted).
  - `--force, -f`: Overwrite existing `.swarm/state.json` if already initialized.
- **Side Effects**:
  - Creates `.swarm/` and `.swarm/worktrees/`.
  - Safely appends `.swarm/` and `AGENT_TASK.md` to `.gitignore`.
  - Generates `AGENTS.md` containing operational guidance for AI agents.

---

### 2.2 `run` (alias: `start`)
Launches the swarm mission, schedules workers, and streams the live visual dashboard.

```bash
swarm-engine run [mission] [options]
```

- **Arguments**:
  - `[mission]`: Mission statement for the swarm.
- **Options**:
  - `--concurrency <num>`: Maximum concurrent running workers. Set to `0` for infinite concurrency (default: `0`).
  - `--workers, -w <num>`: Number of initial workers to spawn. Supports arbitrary counts (e.g. 5, 10, 15, 20+; default: `3`).
  - `--model, -m <model>`: Model identifier for worker agents (auto-detected if omitted).
  - `--leader-model, -lm <model>`: Model identifier for the leader/orchestrator agent.
  - `--force, -f`: Re-initializes state if already present.

---

### 2.3 `status`
Inspects the current state of the swarm, including running workers, file locks, and shared memory.

```bash
swarm-engine status [options]
```

- **Options**:
  - *(no flags)*: Renders a static snapshot of the visual Fable card dashboard.
  - `--table`, `--plain`: Outputs an aligned, plain ASCII table (ideal for logs, grep, or CI pipelines).
  - `--json`: Outputs raw structured `SwarmState` JSON to standard output.
- **Exit Codes**:
  - `0`: Swarm is initialized and status was retrieved.
  - `1`: Swarm state is uninitialized (run `swarm-engine init` first).

---

### 2.4 `watch` (aliases: `dashboard`, `tui`)
Opens an interactive, auto-refreshing terminal dashboard streaming live agent telemetry.

```bash
swarm-engine watch [options]
```

- **Options**:
  - `--interval <ms>`: Refresh interval in milliseconds (default: `2000`).
  - `--once`: Renders the dashboard once and immediately exits.
  - `--plain`, `--table`: Renders the auto-refreshing view as an ASCII table instead of visual cards.
- **Interactive Controls**:
  - Press `q` or `Ctrl+C`: Exit watch mode cleanly and restore terminal cursor.
  - Press `r`: Immediately trigger a manual screen re-render.

---

### 2.5 `complete`
Finalizes an agent's assigned task, cleanly merging changes into the parent branch.

```bash
swarm-engine complete <agentId> [summary]
```

- **Arguments**:
  - `<agentId>` (required): The unique identifier of the agent (e.g. `worker-1`).
  - `[summary]`: Optional text describing accomplishments, changes made, and test results.
- **Execution Lifecycle**:
  1. Deletes `AGENT_TASK.md` so prompts never pollute git history.
  2. Commits worktree changes using `--allow-empty`.
  3. Merges the worktree branch into the base branch using `--no-ff`.
  4. Prunes the `.swarm/worktrees/<agentId>` directory and deletes the branch `swarm/<agentId>`.
  5. Releases all held file locks in `.swarm/state.json`.
  6. Advances dependent agents from `pending` to `running`.

---

### 2.6 `reset`
Resets the swarm environment, cleaning up all worktrees, temporary branches, and lockfiles.

```bash
swarm-engine reset [options]
```

- **Options**:
  - `--hard, -f`: Forces reset without confirmation prompts.
  - `--keep-blackboard`: Preserves shared memory keys on the blackboard while resetting agents and locks.
- **Execution Actions**:
  - Invokes `git worktree prune` and force-deletes all `swarm/*` Git branches.
  - Recursively removes `.swarm/worktrees/`.
  - Removes `.swarm/state.lock`.
  - Re-initializes `.swarm/state.json` to an idle, clean baseline.

---

### 2.7 `worker`
Executes an agent's task autonomously inside its assigned worktree.

```bash
swarm-engine worker <agentId>
```

- **Arguments**:
  - `<agentId>` (required): ID of the agent to execute.
- **Behavior**:
  - Reads task instructions from `.swarm/worktrees/<agentId>/AGENT_TASK.md`.
  - Executes tool actions, file inspections, and edits.
  - Calls `complete_agent_task` upon finish.

---

### 2.8 `mcp`
Starts the stdio Model Context Protocol (MCP) server for integration with IDEs and AI clients.

```bash
swarm-engine mcp
```

- **Guarantees (Safeguard 1)**:
  - All logging is strictly directed to `stderr`.
  - `stdout` carries only valid JSON-RPC 2.0 messages.

---

## 3. Global Options

- `--help, -h`: Displays the comprehensive CLI usage manual.
- `--version, -v`: Displays the current version of Swarm Engine (`swarm-engine 1.0.0`).
