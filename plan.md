# Implementation Plan: Swarm Engine (CLI + MCP Server)

## Goal Description
Build a production-ready, self-contained Node.js + TypeScript CLI and MCP server package called `swarm-engine` in the workspace root (`e:/Swarm-engine`).
The package allows any coding agent (Kilo Code, Cline, Roo Code, Claude Code, Cursor) or human developer to connect via MCP to dynamically spawn as many sub-agents as a task requires (1 to N). It isolates parallel agents in Git worktrees (with non-git fallback), manages concurrent file access with atomic locking, coordinates shared memory via a blackboard, and synchronizes work completion through standard merging and scheduling.

The package is designed to be executed directly from GitHub via `npx github:owner/swarm-engine` or added as a standard stdio MCP server.

---

## Technical Architecture & Design Decisions

### 1. Minimal Zero-Bloat Dependencies
- **Production Dependencies**:
  - `@modelcontextprotocol/sdk`: High-level `McpServer` and `StdioServerTransport` for standard MCP protocol communication.
  - `zod`: Schema definitions for tool arguments with automatic type-checking.
- **Dev Dependencies**:
  - `typescript`: For compiling modern TypeScript to ES2022 ESM.
  - `@types/node`: Type definitions for Node.js standard libraries.
- **Node.js Native Modules**:
  - `node:child_process` (for git commands and detached worker spawning)
  - `node:fs/promises` and `node:fs` (for directory operations, worktrees, file tasks)
  - `node:path` (cross-platform path resolution)
  - `node:crypto` (UUID/hash generation for agent IDs)
  - `node:util`

### 2. State Management & Atomic File Locking (`src/state.ts`)
- Swarm state is stored at `.swarm/state.json`.
- Directory-based atomic locking (`.swarm/state.lock`) via `fs.mkdir` ensures POSIX/Windows filesystem-level mutual exclusion without relying on OS-specific advisory flock.
- Includes jittered exponential backoff (10ms-100ms) with timeout and stale lock reclamation (stale threshold: 30s) to prevent permanent deadlocks if a process crashes mid-write.
- Structures:
  - `AgentNode`: `{ id, role, systemPrompt, taskSpec, dependsOn, targetFiles, status, worktreePath, branchName, pid?, outputSummary? }`
  - `SwarmState`: `{ mission, maxConcurrency, workerCommand, agents, blackboard, lockedFiles }`
- Core methods: `initState`, `readState`, `updateState(mutatorFn)`.

### 3. Dynamic Spawner & Git Worktree Manager (`src/spawner.ts`)
- **Git Worktree Isolation**:
  - `createWorktree(agentId)` creates branch `swarm/<agentId>` and worktree `.swarm/worktrees/<agentId>`.
  - Non-git fallback: recursively copies workspace files (excluding `.git`, `node_modules`, `.swarm`) into `.swarm/worktrees/<agentId>`.
  - Generates `.swarm/worktrees/<agentId>/AGENT_TASK.md` embedding agent role, mission, system prompt, task spec, locked files, blackboard context, and instructions for completion.
- **DAG Scheduler (`tickScheduler`)**:
  - Inspects all `'pending'` agents.
  - Checks dependency resolution: all IDs in `dependsOn` must be in status `'completed'`.
  - Checks file collision resolution: none of the agent's `targetFiles` can be present in `lockedFiles`.
  - Limits concurrent execution to `maxConcurrency` (default: 4).
  - Transition ready agents to `'running'`, locks `targetFiles`, creates worktree + `AGENT_TASK.md`.
  - Optionally spawns background detached worker if `state.workerCommand` or `process.env.SWARM_WORKER_CMD` is set; otherwise leaves the worktree ready for direct pickup by MCP callers or human pair programmers.
- **Merge & Complete (`mergeAndComplete`)**:
  - In worktree: stages all changes (`git add -A`) and commits (`git commit -m "swarm(<id>): <summary>"`).
  - Main repository: merges branch back using `git merge --no-ff swarm/<agentId>`.
  - Clean up: deletes worktree (`git worktree remove --force`) and deletes branch (`git branch -D swarm/<agentId>`).
  - Unlocks all target files assigned to `agentId`.
  - Sets agent status to `'completed'` and writes `outputSummary`.
  - Immediately invokes `tickScheduler()` to advance any newly unblocked downstream agents.

### 4. Universal MCP Server (`src/mcp.ts`)
Registers and exposes 6 exact tools over standard I/O:
1. `spawn_swarm`: Initialize or schedule 1 to N agents with mission and dependency graph.
2. `add_dynamic_agent`: Add an on-the-fly specialist agent mid-execution.
3. `pull_agent_task`: Claim or view the next ready task, returning worktree path, task spec, system prompt, and blackboard memory.
4. `write_blackboard`: Save shared contracts, schemas, or memory keys visible to all agents.
5. `complete_agent_task`: Commit and merge worktree, unlock files, mark completed, and trigger the next scheduling tick.
6. `get_swarm_status`: Full snapshot of mission, agents, statuses, active file locks, and blackboard keys.

### 5. CLI Entrypoint (`src/index.ts`)
Shebang `#!/usr/bin/env node` executable with subcommands:
- `swarm-engine mcp`: Starts stdio MCP server.
- `swarm-engine init`: Initializes `.swarm/` and creates universal `AGENTS.md` guiding AI agents to use MCP swarm coordination, printing client configuration JSON snippets.
- `swarm-engine status`: Formatted CLI table showing agents, status, dependencies, file locks, and blackboard.
- `swarm-engine watch`: Live 2-second autorefresh dashboard of the status table.
- `swarm-engine reset`: Prunes git worktrees and resets `.swarm/state.json`.

---

## Proposed Changes

```
e:/Swarm-engine/
├── package.json          [NEW]
├── tsconfig.json          [NEW]
├── src/
│   ├── state.ts           [NEW]
│   ├── spawner.ts         [NEW]
│   ├── mcp.ts             [NEW]
│   └── index.ts           [NEW]
└── README.md              [NEW]
```

### [NEW] `package.json`
- Module type `"module"`.
- Binary registration `"bin": { "swarm-engine": "./dist/index.js" }`.
- Lifecycle scripts:
  - `"build"`: Compiles TypeScript and applies executable permissions (`chmod 755`).
  - `"prepare"`: Runs `"npm run build"` (vital for `npx github:user/swarm-engine`).
  - `"start"`: Runs `dist/index.js`.
- Dependencies: `@modelcontextprotocol/sdk` and `zod`.
- DevDependencies: `typescript` and `@types/node`.

### [NEW] `tsconfig.json`
- Target: `ES2022`.
- Module: `NodeNext`.
- Module Resolution: `NodeNext`.
- RootDir: `./src`, OutDir: `./dist`.
- Strict mode enabled, `skipLibCheck: true`.

### [NEW] `src/state.ts`
- Atomic lock mechanism using `.swarm/state.lock` with jittered exponential backoff and stale lock eviction.
- TypeScript interfaces: `AgentNode`, `SwarmState`.
- Exported functions:
  - `getSwarmDir()`: Returns path to `.swarm`.
  - `initState(mission?: string, maxConcurrency?: number, workerCommand?: string)`: Initializes `.swarm/state.json`.
  - `readState()`: Reads current state.
  - `updateState<T>(mutator: (state: SwarmState) => T | Promise<T>)`: Atomically locks, mutates, saves, and unlocks state.

### [NEW] `src/spawner.ts`
- Worktree lifecycle management:
  - `isGitRepo()`: Detection helper using `git rev-parse --is-inside-work-tree`.
  - `createWorktree(agentId)`: Adds git worktree or performs directory clone fallback; generates `AGENT_TASK.md`.
  - `tickScheduler()`: Core DAG evaluation loop. Resolves pending agents with satisfied dependencies and conflict-free target files up to `maxConcurrency`. Transitions to running, locks files, creates worktrees, and launches background workers if configured.
  - `mergeAndComplete(agentId, summary)`: Auto-commits worktree changes, merges to main, cleans up worktree and branch, releases file locks, records summary, and recursively triggers `tickScheduler()`.

### [NEW] `src/mcp.ts`
- Sets up `McpServer({ name: "swarm-engine", version: "1.0.0" })`.
- Implements the 6 MCP tools:
  - `spawn_swarm`
  - `add_dynamic_agent`
  - `pull_agent_task`
  - `write_blackboard`
  - `complete_agent_task`
  - `get_swarm_status`
- Connects to `StdioServerTransport` and starts server loop.

### [NEW] `src/index.ts`
- CLI router parsing `process.argv[2]`.
- Commands:
  - `mcp`: Launches MCP server.
  - `init`: Generates `.swarm/` and universal `AGENTS.md` with instructions and MCP JSON config snippets.
  - `status`: Visual CLI summary table (active agents, status badges, dependencies, file locks, blackboard).
  - `watch`: Terminal polling loop redrawing status every 2s.
  - `reset`: Worktree cleanup and state reset.

### [NEW] `README.md`
- Documentation covering:
  - 1-command GitHub execution: `npx github:<owner>/swarm-engine init`
  - Ready-to-copy MCP server configs for Kilo Code, Cline, Roo Code, Claude Code, Cursor.
  - Full CLI command documentation.
  - Dynamic multi-agent workflow description (worktrees, blackboard, DAG dependencies).

---

## Verification Plan

### Automated Build & Compilation
1. Run `npm install` to install `@modelcontextprotocol/sdk`, `zod`, `typescript`, `@types/node`.
2. Run `npm run build` to compile TypeScript to `dist/index.js` and verify zero compiler errors.

### CLI & Worktree Testing
1. Execute `node dist/index.js init` in the repo to verify `.swarm/` and `AGENTS.md` generation.
2. Execute `node dist/index.js status` to verify table rendering with initial state.
3. Verify `node dist/index.js reset` runs cleanly without error.
4. Execute simulated MCP tool invocation or task creation to verify atomic lock behavior, state mutations, and worktree creation.
