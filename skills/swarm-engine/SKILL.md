---
name: swarm-engine
description: |
  Autonomous multi-agent swarm orchestration engine with live visual terminal dashboard,
  isolated git worktrees, atomic file locking, and zero-conflict git merges.
  Use when:
    1. Parallelizing complex coding tasks across multiple specialized subagents.
    2. Refactoring or generating code across multiple files without merge conflicts.
    3. Running concurrent background tasks where each agent needs an isolated git worktree.
    4. Viewing real-time live terminal telemetry with tool diffs, token speeds, and agent status.
license: MIT
metadata:
  version: 1.0.0
  author: PRIYAGDEV
---

# Swarm Engine — Autonomous Multi-Agent Orchestration Skill

Use this skill whenever you need to coordinate, parallelize, or execute complex coding missions across multiple autonomous subagents with zero git merge conflicts.

Swarm Engine provisions dedicated `git worktree` sandboxes for each subagent, prevents file write collisions using atomic directory-based locks, schedules tasks via a Directed Acyclic Graph (DAG), coordinates shared memory via a real-time blackboard, and streams live visual cards and diffs to your terminal.

---

## ⚡ When to Use This Skill

Activate Swarm Engine when:
- **Multi-File Tasks**: Tasks that span 3+ files or multiple modules that can be worked on in parallel.
- **Merge Safety**: You want multiple agents modifying code simultaneously without conflicting or stomping on each other's changes.
- **Isolated Testing**: Running test suites, builds, or refactorings in clean, throwaway branches (`swarm/<agentId>`).
- **Live Visual Observability**: You want real-time visibility into what each worker is doing, with live red/green diffs, line counts, and token speeds.

---

## 🚀 Autonomous Agent Workflow (CLI-First)

You do **not** need to configure complex MCP servers. You can drive Swarm Engine directly from your terminal using simple, powerful CLI commands.

### Step 1: Initialize Swarm in the Project

Run `swarm-engine init` inside the project root to provision `.swarm/`, create `AGENTS.md`, and protect git history:

```bash
swarm-engine init "Refactor architecture and implement user authentication" --concurrency 4
```

### Step 2: Launch Autonomous Swarm Execution

Launch the swarm mission. Swarm Engine automatically detects your active model (e.g. `claude-3-7-sonnet`, `gpt-4o`, `qwen2.5-coder`) and launches the live interactive card dashboard:

```bash
swarm-engine run "Refactor architecture and implement user authentication"
```

*Tip: You can optionally override models if desired:*
```bash
swarm-engine run "Refactor architecture" --leader-model "claude-3-7-sonnet" --model "gpt-4o"
```

### Step 3: Inspect Swarm Telemetry & Status

To inspect the real-time status, active file locks, and running workers:

```bash
# Render visual status once:
swarm-engine status

# Output plain table (great for CI or fast parsing):
swarm-engine status --table

# Output structured JSON:
swarm-engine status --json

# Open live auto-refreshing watch dashboard:
swarm-engine watch
```

### Step 4: Finalize & Complete an Agent Task

When an agent finishes its work in its isolated worktree:

```bash
swarm-engine complete worker-1 "Implemented JWT authentication and verified test suite"
```
This automatically:
1. Deletes `AGENT_TASK.md` so prompts never pollute git history.
2. Commits all changes with `--allow-empty`.
3. Merges the worktree branch into the main project branch cleanly (`--no-ff`).
4. Prunes the worktree directory and temporary git branch.
5. Releases all active file locks and immediately unblocks dependent agents.

### Step 5: Clean Reset

To clean up all active worktrees, temporary branches, and reset swarm state:

```bash
swarm-engine reset --hard
```

---

## 🛡️ Key Architectural Guarantees

1. **Automatic Model Detection**: Swarm Engine automatically inspects your active editor settings (VS Code, Kilo Code, Cursor, Sleepy Code), project `.env`, and local Ollama daemon to match your exact models.
2. **Zero Git Collisions**: Each agent operates in `.swarm/worktrees/<agentId>` on a dedicated branch. Merges only occur sequentially via atomic locks.
3. **Task Prompt Hygiene**: Task assignment instructions (`AGENT_TASK.md`) are automatically stripped before commits, keeping your git history pristine.
4. **Non-Git Fallback**: Works safely even in unborn repositories or non-git folders by falling back to directory-level copies.
