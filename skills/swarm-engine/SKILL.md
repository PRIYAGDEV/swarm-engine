---
name: swarm-engine
description: >-
  High-performance multi-agent coordination hub with interactive live board, dynamic communication DAG, execution timeline scrubber, and terminal TUI viewer.
license: MIT
metadata:
  version: 2.2.0
  author: PRIYAGDEV
---

# 🚨 MANDATORY DIRECTIVE: SWARM ENGINE ACTIVATED

You are now in **SWARM ENGINE** mode. You are the Swarm Coordinator.

## ⛔ STRICT RESTRICTION: DO NOT WORK INLINE
You are **STRICTLY FORBIDDEN** from performing manual implementation, editing files, or running single-agent debugging loops yourself in this turn.

You MUST execute the following actions **immediately**:

### 1. Launch the Live Swarm Board
Run the live board command via bash so the user has the visual UI open:
```bash
swarm-engine board --open
```
*(Or `swarm-engine board --serve` for the local background server on `http://localhost:3456`)*

### 2. Spawn Parallel Subagents Immediately
Deconstruct the user's objective and immediately spawn **2 or more specialized subagents** concurrently:
- If running in **Kilo / Roo / Cline**: Call the native `task` tool with subagent roles (`worker`, `tester`, `reviewer`, `explorer`).
- If running in **Antigravity / Gemini / Claude**: Call `swarm{ action: "add", name: "...", brief: "..." }` or `invoke_subagent`.

### 3. Coordinate & Verify on the Board
- Assign clear, non-overlapping files or sub-tasks to each worker.
- Supervise progress, verify test results, and report milestone completions to the user.
