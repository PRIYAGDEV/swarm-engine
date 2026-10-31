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

Swarm Engine is a high-performance orchestration engine designed to empower AI models and human developers to execute complex coding missions by deploying arbitrary numbers of parallel specialized subagents (5 to 20+ agents) with infinite concurrency, zero queuing, and guaranteed zero git merge conflicts.

Each agent operates within an isolated sandbox (Git worktree at `.swarm/worktrees/<agentId>` or non-git directory fallback), acquires atomic directory-level file locks on designated targets, coordinates shared state and interfaces over an in-memory blackboard bus, and merges completed tasks cleanly back to the main branch using `--no-ff` without polluting git history with task prompt files.

---

## ⚡ When to Use This Skill

Activate the `swarm-engine` skill whenever a task requires multi-agent parallelization, isolated execution boundaries, or safe concurrent edits:

1. **Large-Scale Multi-File Refactoring**: When modifications span 3 or more distinct files, modules, or layers (e.g. models, controllers, UI components, database migrations) that can be developed concurrently.
2. **Unbounded Specialist Decomposition**: When breaking down a mission into 5, 10, 15, or 20+ specialized agent roles (e.g. API architect, schema engineer, frontend designer, unit tester, security auditor, performance tuner, documentation author).
3. **Collision-Free Concurrent Editing**: When multiple AI agents or background tasks need to edit the same repository simultaneously without overwriting files or producing git merge conflicts.
4. **Isolated Build & Test Verification**: When running experimental refactorings, intensive test suites, or package builds in clean, disposable workspaces on dedicated branches (`swarm/<agentId>`).
5. **Get Shit Done (GSD) Phase & Wave Acceleration**: When executing GSD project plans (`.planning/phases/`), mapping execution waves and individual plans directly into parallel subagent swarms.
6. **Live Observability & Telemetry**: When real-time visual monitoring of agent actions (reads, edits, bash commands, diffs, poetic verbs, tok/s, token counts) is needed in the terminal via the Fable TUI dashboard.

---

## 👥 Unbounded Subagent Deployment (5 to 20+ Parallel Agents)

Swarm Engine eliminates artificial agent limits. Concurrency defaults to **infinite/unlimited** (`maxConcurrency: 0`), and execution defaults to **full parallel throughput** (`parallel: true`). Assistant models are explicitly encouraged to decompose complex missions into fine-grained, highly specialized subagents running concurrently.

### Prompt Decomposition Guidelines
When planning a swarm mission:
1. **Divide by Architectural Boundary**: Assign each subagent a single responsibility and a non-overlapping set of target files.
2. **Define Non-Overlapping `targetFiles`**: Normalizing file targets prevents file lock contention. If two agents must touch the same file, chain them with `dependsOn` or have an upstream agent establish a contract on the blackboard.
3. **Decompose Liberally (5 to 20+ Agents)**: Do not condense multi-step work into a single generalist agent. Spawn discrete specialists for schema design, endpoint routing, data validation, client components, state stores, unit tests, integration tests, adversarial security audits, and documentation.
4. **Leverage Dynamic Scaling via `add_dynamic_agent`**: If a running worker discovers a new edge case, a missing migration, or an unhandled regression, inject an on-the-fly specialist agent directly into the running swarm with zero queuing.

### Role Specialization Archetypes (5–20+ Subagents)

| Specialist Role | Scope & Deliverables | Typical Target Files |
| :--- | :--- | :--- |
| **`system_architect`** | Defines base interfaces, types, and blackboard contracts | `src/types/index.ts`, `src/interfaces/**` |
| **`db_schema_engineer`** | Creates database schemas, migrations, and ORM models | `src/db/schema.ts`, `migrations/**` |
| **`api_route_builder`** | Implements HTTP/REST endpoints and request routing | `src/api/routes/**`, `src/controllers/**` |
| **`auth_security_guard`** | Implements JWT/OAuth, auth middleware, and permissions | `src/auth/**`, `src/middleware/auth.ts` |
| **`business_logic_dev`** | Core domain logic, service layers, and state machines | `src/services/**`, `src/core/**` |
| **`frontend_ui_builder`** | Visual components, layout structures, and styling | `src/components/**`, `src/ui/**` |
| **`state_manager`** | Reactive store, state slices, and event dispatchers | `src/store/**`, `src/context/**` |
| **`api_client_engineer`** | Frontend API client SDK and data fetching hooks | `src/api/client.ts`, `src/hooks/**` |
| **`cache_layer_expert`** | Redis/memory caching, invalidation logic, and memoization | `src/cache/**`, `src/utils/cache.ts` |
| **`queue_worker_dev`** | Background job processors, event consumers, and queues | `src/workers/**`, `src/queues/**` |
| **`unit_test_writer`** | Unit tests for domain services and utilities | `test/unit/**`, `src/**/*.spec.ts` |
| **`integration_tester`** | API endpoint and component integration test suites | `test/integration/**`, `test/api/**` |
| **`e2e_playwright_qa`** | End-to-end user journey tests and visual regressions | `test/e2e/**`, `e2e/**` |
| **`security_auditor`** | Vulnerability scanning, injection checks, secret safety | `audit/security.md`, `src/guards/**` |
| **`perf_optimizer`** | Hot path profiling, query tuning, and bundle reduction | `src/bench/**`, `src/utils/perf.ts` |
| **`linter_formatter`** | Style conformance, lint rule fixes, and formatting | `.eslintrc.json`, `src/**/*.ts` |
| **`docs_technical_writer`**| Comprehensive API documentation, OpenAPI specs, README | `docs/**`, `README.md`, `openapi.yaml` |
| **`release_engineer`** | CI/CD pipelines, Docker containerization, build scripts | `Dockerfile`, `.github/workflows/**` |
| **`chaos_tester`** | Failure injection, network timeout simulations, error recovery| `test/chaos/**` |
| **`telemetry_engineer`** | Structured logging, metrics instrumentation, tracing | `src/telemetry/**`, `src/logger.ts` |

---

## 🚀 Autonomous Agent Workflow (CLI-First)

AI agents and developers can interact with Swarm Engine without manual MCP setup using the CLI. The engine automatically detects active models from your environment (`.config/kilo/kilo.jsonc`, Claude Code, Cursor, `.env`, Ollama) with zero hardcoded model names.

### 1. Initialize Swarm (`init`)
Creates `.swarm/`, sets up `.gitignore` (protecting `.swarm/` and `AGENT_TASK.md`), and generates the workspace `AGENTS.md`:
```bash
swarm-engine init "Complete full-stack authentication and microservice refactoring" --concurrency 0
```
- Flags:
  - `--concurrency <num>`: Max running agents (0 = unlimited / infinite, default: 0).
  - `--worker <command>`: Shell command to execute background workers in worktrees.
  - `--force, -f`: Overwrite existing initialization state.

### 2. Launch Swarm Execution (`run` / `start`)
Spawns parallel workers and launches the live interactive card dashboard:
```bash
swarm-engine run "Mission description" --workers 12 --concurrency 0
```
- Flags:
  - `--workers, -w <num>`: Number of initial workers to spawn (arbitrary count, e.g. 5 to 20+).
  - `--concurrency <num>`: Max concurrent running workers (0 = unlimited).
  - `--model, -m <model>`: Model identifier for worker agents (auto-detected if omitted).
  - `--leader-model, -lm <model>`: Model identifier for orchestrator agent.

### 3. Real-Time Status & Observability (`status`, `watch`)
Inspect real-time swarm execution, running workers, file locks, and blackboard keys:
```bash
# Render visual Fable card dashboard snapshot:
swarm-engine status

# Output parseable aligned ASCII table (ideal for logs/CI):
swarm-engine status --table

# Output structured JSON:
swarm-engine status --json

# Open interactive auto-refreshing terminal dashboard (2-second interval):
swarm-engine watch
# (Aliases: swarm-engine dashboard, swarm-engine tui)
```

### 4. Complete an Agent Task (`complete`)
When an agent finishes its work in its worktree:
```bash
swarm-engine complete worker-1 "Implemented user schema and verified unit test suite"
```
The engine automatically:
1. Deletes `AGENT_TASK.md` so prompts never pollute git history (Safeguard 2).
2. Commits changes with `--allow-empty` to prevent zero-diff failures.
3. Merges the isolated worktree branch into the main project branch cleanly with `--no-ff`.
4. Prunes the worktree directory and temporary git branch.
5. Releases all held file locks, immediately unblocking dependent agents.

### 5. Clean Reset (`reset`)
Safely clean up all active worktrees, delete temporary branches, and reset state:
```bash
swarm-engine reset --hard
# Preserve shared blackboard state while resetting agents:
swarm-engine reset --hard --keep-blackboard
```

---

## 🛠️ MCP Tools Reference

When connected via Model Context Protocol (stdio JSON-RPC), Swarm Engine exposes 9 native tools:

### 1. `spawn_swarm`
Initializes and launches an unbounded multi-agent swarm with as many specialized subagents as required.
- **Parameters**:
  - `mission` (string, required): Overall mission goal.
  - `leaderModel` (string, optional): Orchestrator model identifier.
  - `maxConcurrency` (number, default: 0): Concurrency limit (0 = infinite concurrency).
  - `parallel` (boolean, default: true): Run all agents concurrently with zero queuing.
  - `strictDependencies` (boolean, default: false): Enforce strict sequential dependency blocking.
  - `workerCommand` (string, optional): Command executed to run workers in worktrees.
  - `agents` (array of objects, default: []): List of initial agent definitions (encouraging 5 to 20+ agents).
    - `id` (string, optional): Unique agent ID (auto-generated if omitted).
    - `role` (string, required): Specialized role name.
    - `model` (string, optional): Model override.
    - `taskSpec` (string, required): Detailed prompt and requirements.
    - `systemPrompt` (string, optional): Custom instructions for the agent.
    - `targetFiles` (array of strings, default: []): Files to lock and modify.
    - `dependsOn` (array of strings, default: []): Dependency agent IDs.

### 2. `add_dynamic_agent`
Dynamically injects an on-the-fly specialist subagent mid-execution into the running swarm with zero queuing.
- **Parameters**:
  - `id` (string, optional): Custom agent ID.
  - `role` (string, required): Role of the dynamic agent.
  - `taskSpec` (string, required): Task description and deliverables.
  - `model` (string, optional): Model override.
  - `systemPrompt` (string, optional): Custom instructions.
  - `targetFiles` (array of strings, default: []): Files to lock.
  - `dependsOn` (array of strings, default: []): Prerequisites.

### 3. `pull_agent_task`
Claims or inspects the next ready task or retrieves a specific agent's assigned worktree context.
- **Parameters**:
  - `agentId` (string, optional): Specific agent ID. If omitted, claims the next ready worker.
- **Returns**: `worktreePath`, `taskSpec`, `systemPrompt`, `targetFiles`, `branchName`, `blackboard`.

### 4. `write_blackboard`
Stores or updates shared memory (contracts, schemas, route maps) visible to all agents.
- **Parameters**:
  - `key` (string, required): Identifier key.
  - `value` (any, required): Data value (primitive, JSON object, or array).
- Automatically updates `AGENT_TASK.md` across all active worktrees.

### 5. `complete_agent_task`
Finalizes an agent task, commits changes, merges worktree to main, deletes worktree and branch, releases locks, and unblocks downstream tasks.
- **Parameters**:
  - `agentId` (string, required): ID of completed agent.
  - `summary` / `outputSummary` (string, optional): Summary of work performed.

### 6. `get_swarm_status`
Returns complete real-time snapshot of the swarm state.
- **Parameters**:
  - `detail` (boolean, default: false): Include full task specs and system prompts.
- **Returns**: `mission`, `maxConcurrency`, `counts` (pending, running, completed, failed), `agents`, `lockedFiles`, `blackboard`, `dashboard`.

### 7. `record_agent_action`
Streams a real-time tool action (edit, read, bash, update, delete, status) to the Fable TUI dashboard.
- **Parameters**:
  - `agentId` (string, required): Worker ID.
  - `actionType` (enum: `"edit" | "read" | "bash" | "update" | "delete" | "status"`, required).
  - `target` (string, required): File path or shell command.
  - `detail` (string, optional): Action description (e.g. `'29 passed'`).
  - `diffs` (array of `{ type: "add" | "del", line: string, lineNo?: number }`, optional).

### 8. `update_agent_progress`
Updates live telemetry metrics for a worker.
- **Parameters**:
  - `agentId` (string, required): Worker ID.
  - `thought` (string, optional): Current reasoning step.
  - `verb` (string, optional): Poetic action verb (`'Pruning...'`, `'Simmering...'`, `'Synthesizing...'`).
  - `tokens` (number, optional): Accumulated tokens.
  - `tokPerSec` (number, optional): Real-time token generation velocity.

### 9. `run_agent_task`
Triggers autonomous worker execution for an agent inside its isolated worktree.
- **Parameters**:
  - `agentId` (string, required): Target agent ID.

---

## 🛡️ Key Architectural Guarantees

Swarm Engine is engineered with 4 unbreakable architectural safeguards:

1. **Safeguard 1 — Pure JSON-RPC Frame Framing**:
   In MCP mode, all diagnostic logs and status updates are strictly redirected to `stderr` (`console.error`). `stdout` is reserved exclusively for clean JSON-RPC protocol frames, preventing client parsing failures.

2. **Safeguard 2 — Git History Hygiene & Zero-Diff Safety**:
   Task assignment context (`AGENT_TASK.md`) is injected into the worktree during execution, but is automatically purged before committing. All commits use `--allow-empty` to safely handle non-code tasks or validation checks, and merges use `--no-ff` to preserve branch provenance without prompt pollution.

3. **Safeguard 3 — Non-Git & Unborn Workspace Fallback**:
   If executed in an unborn git repository (0 commits) or a non-git directory, Swarm Engine automatically falls back to safe directory-level isolation and copy-on-write mechanisms, ensuring it never crashes due to missing git commits.

4. **Safeguard 4 — Normalized Atomic Directory File Locks**:
   File paths are canonicalized (`normalizePath`) to resolve platform-specific directory separators (Windows `\` vs POSIX `/`) and case differences. State writes and lock acquisitions are serialized via an atomic mutex directory (`.swarm/state.lock`) backed by PID liveness checks and stale lock reclamation (>30s or dead PID).

---

## 🔄 Get Shit Done (GSD) Workflow Integration

Swarm Engine natively bridges Get Shit Done (GSD) project planning and wave execution. While GSD structures milestones, phases, and roadmaps in `.planning/`, Swarm Engine provides the high-concurrency OS runtime to execute them concurrently with zero conflicts.

### 1. Mapping GSD Waves to Swarm Subagents
In GSD workflows:
- A phase is broken into plans: `.planning/phases/XX-name/{phase}-{plan}-PLAN.md`.
- Each plan specifies `wave: N`, `depends_on: [...]`, and `files_modified: [...]`.
- Map each GSD plan directly into a Swarm Engine subagent in `spawn_swarm`:
  - `agent.id`: GSD plan identifier (e.g. `plan-02-01`).
  - `agent.role`: Assigned specialist role (e.g. `auth_security_guard`).
  - `agent.taskSpec`: Content of `{phase}-{plan}-PLAN.md`.
  - `agent.targetFiles`: The plan's declared `files_modified`.
  - `agent.dependsOn`: The plan's declared `depends_on`.

### 2. Decomposing Monolithic Plans into 5–20+ Specialized Agents
Standard GSD runners often execute plans sequentially due to host environment limitations. Swarm Engine removes this bottleneck:
- Under infinite concurrency (`maxConcurrency: 0`), all plans in a wave run in parallel.
- Large individual plans can be sub-divided into 5 to 10 micro-specialists (e.g., schema designer, route builder, unit tester, documentation engineer) operating simultaneously in dedicated worktrees.

### 3. Blackboard Memory Synchronization
- Early-stage agents publish types, schemas, and API contracts to the shared blackboard using `write_blackboard`.
- Downstream agents in later waves automatically receive updated blackboard state inside their worktree's `AGENT_TASK.md`.

### 4. Summary & Verification Feedback Loop
- As each agent finishes, `complete_agent_task` merges its worktree and records a completion summary.
- These summaries feed directly into GSD `{phase}-{plan}-SUMMARY.md`.
- After all agents complete, run GSD goal-backward verification (`must_haves` checklist: truths, artifacts, key links) to produce `{phase}-VERIFICATION.md`.
