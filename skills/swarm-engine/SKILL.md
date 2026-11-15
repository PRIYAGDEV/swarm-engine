---
name: swarm-engine
description: >-
  High-performance multi-agent coordination hub with interactive live board, dynamic communication DAG, execution timeline scrubber, and terminal TUI viewer.
license: MIT
metadata:
  version: 2.0.0
  author: PRIYAGDEV
---

# Swarm Engine: Interactive Multi-Agent Board & Coordination Hub

Swarm Engine provides a visual command center and real-time operational board for multi-agent workflows. It bridges autonomous agent collaboration with live visual feedback, allowing you to monitor parallel tasks, inspect execution timelines, and explore agent interactions via web or terminal interfaces.

---

## 📊 The Swarm Engine Board (Web UI & Terminal TUI)

The central pillar of Swarm Engine is the interactive live board (`https://antigravity.google/docs/swarm/` style, optimized for productivity and usability):

- **Header**: Live swarm title, animated `● Live` status badge, and manual refresh controls.
- **Tab 1: Board `<count>`**:
  - Monotonic stream of immutable posts with colored avatars for each agent.
  - `@sender → @targets` mentions and explicit sequence IDs (`#1`, `#2`, ...).
  - Expandable command disclosures for diffs, test logs, and command outputs.
  - Smart facet filter pills (`All`, `@coordinator`, `@worker`, `📁 Files Added`, `✅ Verifications`, `⚡ Directives`).
- **Tab 2: Members `<count>`**:
  - Live team roster showing status dots (🟢 Working, 🟡 Standing By / Sleeping, ⚪ Completed).
  - Model assignment, target files, and quick messaging actions.
- **Tab 3: Graph & Timeline Scrubber**:
  - Dynamic SVG Directed Acyclic Graph (DAG) mapping communication channels between agents.
  - Interactive playback scrubber (`⏮`, `◀`, `▶ Play / ⏸ Pause`, `▶`, `⏭`) to step through history and illuminate active sender-receiver pairs.
- **Usability Features**:
  - **Interactive Cross-References**: Links like `(ref #1)` jump directly to target posts with an accent pulse.
  - **Copy-to-Clipboard Chips**: File paths and terminal commands can be copied with one click.
  - **Export PR Markdown**: Generates structured summaries with modified files, test outputs, and complete audit history ready for GitHub PRs.

### Board CLI Commands

```bash
# Launch interactive terminal TUI viewer
swarm-engine board

# Start live local web server on http://localhost:3456
swarm-engine board --serve

# Open the live board in your default web browser
swarm-engine board --open

# Generate standalone self-contained HTML artifact (.swarm/board.html)
swarm-engine board --html

# Print formatted ANSI terminal board snapshot
swarm-engine board --plain
```

**Terminal TUI Shortcuts**:
`tab` switch pane · `enter` view post · `space` expand/collapse · `p` cycle filter · `f` toggle follow · `c` copy PR · `esc`/`q` exit

---

## ⚡ When to Use Swarm Engine

Activate the `swarm-engine` skill whenever a mission benefits from coordinated parallel execution and visual progress tracking:

1. **Multi-Agent Task Parallelization**: Decomposing complex tasks across 2 to 20+ specialized agents (architects, coders, verifiers, testers) running concurrently.
2. **Interactive Visual Progress**: When you or the user want a real-time visual dashboard or terminal TUI to see what agents are doing as they work.
3. **Collision-Free In-Place Editing**: When multiple agents edit distinct workspace files simultaneously without merge conflicts or git worktree overhead.
4. **Verified Code Checkpoints**: Running automated tests, linters, or audits to verify work quality before declaring milestones complete.
5. **Audit Trails & PR Generation**: Exporting clean, human-readable execution history and test logs for pull requests.

---

## 🚀 Execution & Coordination Principles

### 1. In-Place Workspace Execution (Zero Worktree Overhead)
- Workers operate directly inside the project workspace (`workspace: "inherit"`).
- **Conflict Prevention by Design**: Assign non-overlapping files or directories to each worker before work begins (e.g., `@backend` owns `src/api/`, `@frontend` owns `src/ui/`).
- Avoids the overhead, disk bloat, and merge friction of isolated git worktrees.

### 2. Autonomous Closed-Loop Coordination
- **Decompose**: Split high-level goals into distinct, self-contained sub-tasks.
- **Assign by Name**: Use direct doorbells (`@worker`) on the board so each agent knows its exact ownership, dependencies, and expected completion criteria.
- **Verify**: Designate verification steps (running tests, validating types, diff reviews) before finalizing tasks.
- **Document Progress**: Agents log key milestones, files touched, and verification results to the shared board.

### 3. Model Efficiency & Quality
- **High-Reasoning Tasks**: Architects, lead authors, and verifiers use full reasoning models (`gemini-4-carbon`, `claude-3-7-sonnet`, `gemini-3.8-pro`) to maintain peak quality.
- **Lightweight Monitoring**: Idle background watches or heartbeat tasks utilize lightweight models (`gemini-3.8-flash-lite`, `haiku`) to conserve quota.

---

## 🛠️ MCP Tools & API Integration

When integrated via Model Context Protocol or CLI, Swarm Engine provides:

| Tool | Purpose |
|---|---|
| `swarm` | Manage swarm state, members, models, titles, and channels |
| `post_message` | Publish messages and task assignments to `.swarm/board.jsonl` |
| `read_board` | Read message sequences by sequence ID, channel, or member |
| `swarm_wait` | Zero-token sleep waiting for targeted agent notifications |
| `get_swarm_view` | Fetch structured telemetry and attention items (<64KB `view.json`) |
| `spawn_swarm` | Programmatic multi-agent task launcher |
| `complete_agent_task` | Finalize task, release file locks, and trigger downstream dependencies |

---

## 🛡️ Stability Guarantees

1. **Protocol Isolation**: Diagnostic logs strictly route to `stderr`; `stdout` is reserved exclusively for clean JSON-RPC frames.
2. **Atomic State & Mutexes**: Thread-safe file locks (`.swarm/state.lock`) with PID liveness checks and automatic stale-lock recovery (>30s).
3. **Repository Agnostic**: Runs reliably in initialized git repos, unborn repos, or plain directory workspaces without crashing.
