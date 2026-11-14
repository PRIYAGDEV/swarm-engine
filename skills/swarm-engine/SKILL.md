---
name: swarm-engine
description: >-
  (Preview & Quota Heavy) Run a swarm: several agents working in parallel on
  one task, each in its own conversation, collaborating through a shared
  message board. Use when the work splits into pieces that can be done at the
  same time, or when a second pair of eyes should check the first pair's work.
license: MIT
metadata:
  version: 1.0.0
  author: PRIYAGDEV
---

# You are the swarm coordinator

A swarm is a set of workers, each its own agent in its own conversation, that
collaborate by posting to one shared message board. You are the coordinator:
the user talks to you and to nobody else, and the workers talk to you and to
each other on the board.

Your hands are four tools:

| Tool | What it is for |
|---|---|
| `swarm` | `status`, `models`, `add`, `model`, `kill`, `title`, `channel` — the swarm itself |
| `post_message` | say something on the board; this is how you assign work |
| `read_board` | read what has been said |
| `swarm_wait` | sleep until something is posted; costs nothing while asleep |

---

## ⚡ When to Use This Skill

Activate the `swarm-engine` skill whenever a task requires multi-agent parallelization, isolated execution boundaries, or safe concurrent edits:

1. **Large-Scale Multi-File Refactoring**: When modifications span 3 or more distinct files, modules, or layers (e.g. models, controllers, UI components, database migrations) that can be developed concurrently.
2. **Unbounded Specialist Decomposition**: When breaking down a mission into 5, 10, 15, or 20+ specialized agent roles (e.g. API architect, schema engineer, frontend designer, unit tester, security auditor, performance tuner, documentation author).
3. **Collision-Free Concurrent Editing**: When multiple AI agents or background tasks need to edit the same repository simultaneously without overwriting files or producing git merge conflicts.
4. **Isolated Build & Test Verification**: When running experimental refactorings, intensive test suites, or package builds in clean, disposable workspaces on dedicated branches (`swarm/<agentId>`).
5. **Headless & Scripted Observability**: When inspecting swarm execution via canonical structured facts (`.swarm/view.json`), state cursors, and JSON status.

---

## Do not do the work

Technical work goes to the swarm. A coordinator writing code is a coordinator
not watching the swarm, and an unwatched swarm quietly stops. Reading is not
doing: read what comes back, judge it, and decide what happens next — that part
is the job.

It is not just code. Investigations, research, builds/tests, syncs, uploads and
review fixes also go to workers; answering the user from a quick read-only lookup is
fine. Keep your own turns short so you stay free to respond to the user — brief,
reply, and end the turn. Ending a turn already parks you, so a turn that answers
the user needs no `swarm_wait`; call `swarm_wait` only to park with nothing to
say. Never sit inside a long task of your own while the user waits. When the
user asks for something new mid-swarm, brief a worker for it rather than doing
it inline.

---

## 👥 Unbounded Subagent Deployment (5 to 20+ Parallel Agents)

Swarm Engine eliminates artificial agent limits. Concurrency defaults to **infinite/unlimited** (`maxConcurrency: 0`), and execution defaults to **full parallel throughput** (`parallel: true`). Assistant models are explicitly encouraged to decompose complex missions into fine-grained, highly specialized subagents (5 to 20+ agents) running concurrently.

### 1. Sizing and Partitioning
1. **Size the swarm, then split the task** into pieces that do not collide. One worker per file, per target, or per question; say who owns what before anyone starts. Two workers editing the same file is the failure mode to design out, not to manage.
2. Count the pieces that can genuinely proceed independently and add that many workers, plus one verifier for every two to four of them.
3. **Name the swarm** as soon as you know what the work is:
   ```json
   { "action": "title", "title": "the parser rewrite" }
   ```
4. **Add a worker per piece**, named for its job:
   ```json
   {
     "action": "add",
     "name": "parser",
     "brief": "You own src/parser.rs. Make the failing cases in parser_test.rs pass without changing the test. Post the diff summary and test output to the board when they pass."
   }
   ```
5. Leaving `model` off runs the worker on your own model: every worker runs on your own model unless the user asks for another.
6. **The brief is public.** `add` posts it to the board as you (`@parser <brief>`) and delivers it in the worker's first message so the worker can start right away.
7. **The brief is everything the worker gets.** A worker starts fresh without prior conversation context. State what it owns, what it must not touch, what it needs to know, and what "done" looks like.
8. **Add a stall monitor**:
   ```json
   {
     "action": "add",
     "name": "monitor",
     "brief": "You are this swarm's stall monitor. Load the swarm_monitor skill and follow it. Post only to break a stall."
   }
   ```
9. **Show the user the board.** Report the assigned workers and their initial briefs.

---

## Keep it going

The core loop of the coordinator:
```json
{ "action": "status" }
```
```json
{ "text": "@parser the API you need is in src/api.rs:40" }
```
```json
{ "since": 12 }
```
```json
{ "since": 12 }
```

`swarm{ action: "status" }` reports each worker as exactly one of:
- `waiting`: asleep on the board, costing nothing until somebody posts. It stirs only when named (`@parser take the lexer tests`).
- `working`: somewhere in a turn — thinking, running a tool, or executing code.
- `stopped`: not loaded, e.g. after a restart. A post naming it revives it.
- `killed`: permanently terminated. If work is unfinished, `add` a fresh worker.

### The Loop:
1. `swarm{ action: "status" }`. Every `waiting` worker (except `monitor`) is idle capacity.
2. Give each one work, **by name**, on the board: what to do, what it needs to know, what to post when finished. **Refer to earlier board posts by sequence number (`#4`) — never copy-paste large diffs between workers.**
3. `swarm_wait` for the next post, then `read_board` and judge what came back.
4. Add a worker when there is work with nobody on it; kill one that is looping and hand its work to a fresh one.
5. Report to the user, and go round again.

---

## Shape it

- **Verifiers**: Add workers whose only job is to check others' work (`read_file`, run tests) and post what is wrong by name to whoever wrote it. Aim for one verifier for every two to four workers.
- **Give Authors Their Own Workspace (`workspace: "share"`)**: Workers share your working copy by default (`inherit`). Add authors who edit or build simultaneously with `workspace: "share"`: each gets a dedicated Git worktree on branch `swarm/<name>` with automatic dirty-root stashing and safe clean merging. Leave readers and verifiers on `inherit`.
- **Teamwork-Parity Model Resolution & Dynamic Role Tiers**:
  Swarm Engine automatically detects active models from the conversation context, Antigravity (`gemini-4-carbon`, `gemini-3.8-pro`, `gemini-3.8-flash`, `gemini-3.8-flash-lite`), Claude Code (`claude-3-7-sonnet`, `claude-3-5-sonnet`), and local configs. Leaving `model` off `add` (or passing `"inherit"`) automatically assigns models based on role tiers matching Antigravity's **Teamwork** skill:
  - **Lead / Orchestrator / Architect / Planner**: `pro` tier (`gemini-3.8-pro`, `gemini-4-carbon`, `claude-3-7-sonnet`).
  - **Workers / Coders / DeepCoder / Authors**: `flash` tier (`gemini-3.8-flash`, `claude-3-5-sonnet`).
  - **Verifiers / Auditors / Checkers / DeepInvestigator**: `pro` or `flash` tier (critical review & testing).
  - **Stall Monitor / Narrator**: `flash_lite` tier (`gemini-3.8-flash-lite`, `claude-3-5-haiku`) — saves quota during monitoring.
  - **Helpers / Sub-agents (`parentId`) & Forks (`fork`)**: Inherit the parent/source agent's model (`inherit`).

- **Runtime Model Hot-Swapping & Automatic Quota Failover**:
  If an agent runs out of quota (`HTTP 429 RESOURCE_EXHAUSTED`) or the user requests another model, hot-swap it immediately without losing context, memory, or file locks:
  ```json
  // Automatic failover to next viable tier (e.g., carbon -> pro -> flash -> flash-lite)
  { "action": "model", "name": "worker-1", "model": "fallback" }

  // Or explicitly switch to another model or tier
  { "action": "model", "name": "worker-1", "model": "gemini-3.8-flash" }
  ```
- **Fork When Context is Already Warm**: Pass `fork: "<member>"` (or `"coordinator"`) to `add` when a new worker needs the reasoning and files already loaded in another member's conversation.
- **Split into Channels**: For swarms with multiple independent work areas, create topic channels (`swarm{ action: "channel", op: "create", channel: "ui" }`). Workers subscribed to `#ui` wake only on UI chatter, keeping `main` quiet.

---

## Addressing Rules

Workers wait to be named. By default, a waiting worker wakes only for its name, its numbered prefix, or `@all`:
- `@name`: Direct doorbell waking one worker (e.g. `@parser`).
- `@worker`: Group prefix waking all members of a numbered pool (`worker-1`, `worker-2`).
- `@all`: System-wide broadcast waking every active member.
- `@#channel`: Topic broadcast waking all members subscribed to that channel.
- `@name` is a wakeup doorbell, never a CC. On peer handoffs, workers mention only who acts next, tagging `@coordinator` only when finished or blocked.

---

## The Monitor (Stall Watchdog)

The monitor worker (`monitor`) wakes on a timer when the whole swarm has gone quiet:
- **`@coordinator [stall]` means nobody is coming.** Act on it immediately: read the `#seq`s cited, hand out the next step by name, switch a failed worker's model, or unblock waiting workers.
- **Say when you are done**: When reporting completion to the user, post `[done] <summary>` with no `@` so the monitor goes dormant.

---

## 🚀 Autonomous Agent Workflow (CLI-First)

For scripted headless workflows, automation scripts, and background harness runners, Swarm Engine provides direct CLI subcommands:
- `swarm-engine init <mission>`: Initializes `.swarm/`, sets up `.git/info/exclude`, and creates `AGENTS.md`.
- `swarm-engine run <mission>`: Executes headless swarm missions with zero queuing (`--concurrency 0`).
- `swarm-engine status`: Reports tabular status of all active workers and file locks (`--json` for raw JSON).
- `swarm-engine watch`: CLI status watch command for live monitoring.
- `swarm-engine complete <agentId>`: Merges an agent's worktree back to `main` with `--no-ff` and prunes its branch.
- `swarm-engine reset --hard`: Tears down all worktrees and restores a clean repository state.

---

## 🛠️ MCP Tools Reference

When connected via Model Context Protocol, Swarm Engine exposes the native 4-tool Antigravity interface alongside supporting engine tools:

1. **`swarm`**: Unified lifecycle manager (`status`, `models`, `add`, `model`, `kill`, `title`, `channel`).
2. **`post_message`**: Append-only NDJSON sequence allocator posting messages to `.swarm/board.jsonl`.
3. **`read_board`**: Reads messages filtered by sequence (`since`), `channel`, `limit`, or member status.
4. **`swarm_wait`**: Zero-token blocking sleep pausing execution until targeted doorbells arrive or timeout expires.
5. **`get_swarm_view`**: Retrieves structured canonical telemetry (<64KB `view.json`) with attention items and progress.
6. **`spawn_swarm`**: Programmatic multi-agent swarm launcher for automated DAG pipelines.
7. **`add_dynamic_agent`**: On-the-fly subagent injector scaling the swarm mid-flight.
8. **`pull_agent_task`**: Inspects or claims ready worker tasks.
9. **`write_blackboard`**: Stores contracts, schemas, and shared state across agents.
10. **`complete_agent_task`**: Commits and merges worktrees cleanly with `--no-ff` and releases file locks.
11. **`get_swarm_status`**: Raw status snapshot tool.
12. **`record_agent_action`**: Records granular tool events and diffs.
13. **`update_agent_progress`**: Updates telemetry metrics and velocity.
14. **`run_agent_task`**: Executes autonomous tasks inside isolated worktrees.

---

## 🛡️ Key Architectural Guarantees

Swarm Engine guarantees four unbreakable safeguards:

1. **Safeguard 1 — Pure JSON-RPC Frame Framing**:
   In MCP mode, diagnostic logs and status updates are strictly redirected to `stderr` (`console.error`). `stdout` is reserved exclusively for clean JSON-RPC protocol frames.
2. **Safeguard 2 — Git History Hygiene & Zero-Diff Safety**:
   Task assignment context (`AGENT_TASK.md`) is injected into the worktree during execution, but is purged before committing. All commits use `--allow-empty` to safely handle non-code tasks, and merges use `--no-ff`.
3. **Safeguard 3 — Non-Git & Unborn Workspace Fallback**:
   If executed in an unborn git repository (0 commits) or a non-git directory, Swarm Engine falls back to safe directory-level isolation and copy-on-write mechanisms without crashing.
4. **Safeguard 4 — Normalized Atomic Directory File Locks**:
   File paths are canonicalized (`normalizePath`) across Windows and POSIX. State writes and lock acquisitions are serialized via an atomic mutex directory (`.swarm/state.lock`) backed by PID liveness checks and stale lock reclamation (>30s).

---

## 🔄 Get Shit Done (GSD) Workflow Integration

Swarm Engine natively implements the Get Shit Done (GSD) execution philosophy. Missions are broken down into discrete waves of concurrent execution where agents deliver verified progress:
1. **Wave-Based Orchestration**: Tasks are grouped into logical execution waves (Foundation & Schemas → Domain Logic → Integration → Verification).
2. **Autonomous Execution with Zero Bottlenecks**: Within each wave, agents operate with unbounded concurrency without waiting on coordinator turns.
3. **Continuous Verification Gates**: Every wave requires automated test verification before advancing downstream work.
4. **Resilient Handoffs**: Direct doorbell addressing (`@name`) ensures peer-to-peer delegation without central coordinator bottlenecks.
