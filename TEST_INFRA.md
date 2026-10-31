# Test Infrastructure & Strategy Specification: Swarm Engine

**Document Version:** 1.0.0  
**Test Framework:** Node.js Native Test Runner (`node:test` + `node:assert/strict`)  
**Target Package:** `swarm-engine` (CLI & Stdio MCP Server)  
**Workspace:** `e:/Swarm-engine`

---

## 1. Test Philosophy & Design Principles

### 1.1 Opaque-Box & Interface-Driven Verification
All tests in this suite are strictly **opaque-box** and requirement-driven. The test runner interacts with Swarm Engine solely through its published public interfaces:
1. **Command Line Interface (`swarm-engine` / `node dist/index.js`)**: Subcommands (`init`, `status`, `watch`, `reset`, `mcp`) executed as isolated child processes, asserting on exit codes, stdout formatting, stderr separation, and on-disk state artifacts (`.swarm/state.json`, `.gitignore`, `AGENTS.md`).
2. **Model Context Protocol Server (`swarm-engine mcp`)**: Standard JSON-RPC 2.0 protocol communication over stdio (`StdioServerTransport`), asserting on tool listing (`tools/list`), tool invocation (`tools/call`), schema conformity, return payloads, and stderr diagnostics.
3. **Filesystem & Git Artifacts**: Verifying git worktree isolation, worktree branch creation (`swarm/<agentId>`), zero-pollution merges (`AGENT_TASK.md` deletion before commit), `--allow-empty` handling, and non-git fallback directory replication.

Internal module functions are never monkey-patched, mocked with facades, or called with artificial bypasses.

### 1.2 Strict Safeguard Verification
The test suite explicitly audits the 4 mandatory operational safeguards:
- **Safeguard 1 (Protect Stdio in MCP)**: Validates that stdout receives pure, single-line JSON-RPC frames with zero stray logs, and that all engine diagnostics, worktree notices, and scheduling logs strictly route to stderr.
- **Safeguard 2 (Clean Git Merges & .gitignore)**: Validates that `swarm-engine init` adds `.swarm/` and `AGENT_TASK.md` to `.gitignore`, that `AGENT_TASK.md` is unlinked prior to `git add -A`, and that empty diffs commit cleanly via `--allow-empty`.
- **Safeguard 3 (Non-Git Fallback in `mergeAndComplete`)**: Validates that when operating outside a git repository or inside an unborn HEAD repo (zero commits), files modified within `.swarm/worktrees/<agentId>` are cleanly copied back to the workspace root without failing.
- **Safeguard 4 (Normalize File Lock Paths)**: Validates that Windows backslashes (`\`) and relative prefixes (`./`) are normalized to POSIX forward slashes, ensuring cross-platform collision detection on locked files.

### 1.3 Hermetic Sandbox Isolation
Every test execution runs inside an ephemeral sandbox directory created in the operating system's temp directory (`os.tmpdir()/swarm-test-<uuid>`). Each test creates its own isolated Git repository (or non-git directory), configures its own local dummy Git committer identity, executes Swarm Engine, verifies observables, and deterministically tears down all temporary worktrees, locks, and files.

---

## 2. Test Architecture & Runner Instructions

### 2.1 Directory Structure
```
e:/Swarm-engine/test/
├── harness.mjs               # Shared test harness: sandbox setup, CLI runner, MCP stdio client
├── e2e_runner.mjs            # Standalone test runner & reporter
├── tier1_features.test.mjs   # Tier 1: MCP tools & CLI subcommands in isolation
├── tier2_boundaries.test.mjs # Tier 2: Stale locks, empty diffs, non-git fallback, unborn HEAD, path normalization
├── tier3_interactions.test.mjs # Tier 3: DAG diamond, lock collisions, dynamic agents, blackboard sync
└── tier4_realworld.test.mjs  # Tier 4: Full multi-agent concurrent refactoring & feature workflows
```

### 2.2 Execution Commands

```bash
# Run entire test suite using native Node.js test runner
node --test test/*.test.mjs

# Run test suite via standalone runner
node test/e2e_runner.mjs

# Run individual test tier
node --test test/tier1_features.test.mjs
node --test test/tier2_boundaries.test.mjs
node --test test/tier3_interactions.test.mjs
node --test test/tier4_realworld.test.mjs

# Run via npm lifecycle script (after package.json script setup)
npm test
```

---

## 3. 4-Tier Test Catalog

### Tier 1: Feature Coverage (Isolation Testing)
Verifies each feature independently under clean, standard conditions.

| Test ID | Scope | Target | Test Scenario | Observable Verification |
|---------|-------|--------|---------------|-------------------------|
| `T1-MCP-01` | MCP | `spawn_swarm` | Initialize mission with 2 independent agents | `.swarm/state.json` created; agents transition to running/pending up to concurrency; returns success payload |
| `T1-MCP-02` | MCP | `add_dynamic_agent` | Inject dynamic agent mid-run | Agent node added to state; scheduled immediately if unblocked; returns valid agent metadata |
| `T1-MCP-03` | MCP | `pull_agent_task` | Claim next ready agent task | Returns worktree path, taskSpec, systemPrompt, blackboard context, and target files |
| `T1-MCP-04` | MCP | `pull_agent_task` (empty) | Pull when no tasks are ready | Returns clean `{ success: false, message: ... }` response without throwing unhandled exceptions |
| `T1-MCP-05` | MCP | `write_blackboard` | Write primitive and structured object | State file updates `blackboard`; returns updated keys array |
| `T1-MCP-06` | MCP | `complete_agent_task` | Complete running task with summary | Agent marked `completed`; worktree merged and pruned; locked files released |
| `T1-MCP-07` | MCP | `get_swarm_status` | Query status (summary & detail modes) | Returns correct metrics counts, agent list, active locks, and blackboard snapshot |
| `T1-CLI-01` | CLI | `init` | Run in clean directory | Creates `.swarm/`, `.gitignore` (with `.swarm/` and `AGENT_TASK.md`), `AGENTS.md`, and prints MCP config |
| `T1-CLI-02` | CLI | `status` | Run on active swarm | Emits formatted table with agent statuses and file locks |
| `T1-CLI-03` | CLI | `status --json` | Run with `--json` flag | Emits valid, parseable JSON matching `SwarmState` to stdout |
| `T1-CLI-04` | CLI | `reset` | Run reset on active swarm | Prunes worktrees, removes branches, clears locks, resets state |
| `T1-CLI-05` | CLI | `mcp` stdio handshake | Send `initialize` JSON-RPC request | Receives valid JSON-RPC response; stdout contains zero log bytes (Safeguard 1) |

---

### Tier 2: Boundary & Corner Cases
Verifies resilience against environmental edge cases, race conditions, and error recovery.

| Test ID | Scope | Target | Test Scenario | Observable Verification |
|---------|-------|--------|---------------|-------------------------|
| `T2-BND-01` | State | Stale Lock Recovery | State lock directory `.swarm/state.lock` left behind with defunct PID and >30s age | Next state operation detects stale lock, evicts lock directory, and completes successfully without timeout |
| `T2-BND-02` | State | Concurrent State Writes | 10 concurrent asynchronous state mutations | Atomic `fs.mkdir` directory lock serializes all updates without `EEXIST` crash; all mutations preserved |
| `T2-BND-03` | Spawner | Zero-Diff Commit (S2) | Agent modifies zero files in worktree | `mergeAndComplete` commits with `--allow-empty` or zero-op commit without failing with "nothing to commit" |
| `T2-BND-04` | Spawner | Clean Git History (S2) | Worktree contains `AGENT_TASK.md` and user files | `AGENT_TASK.md` deleted before staging; `git log` in main repo confirms file was never committed |
| `T2-BND-05` | Spawner | Non-Git Fallback (S3) | Run in non-git folder (`isGitRepo() === false`) | Worktree clones directory; `complete_agent_task` copies modified files back to root directory cleanly |
| `T2-BND-06` | Spawner | Unborn HEAD (S3) | Git repository with 0 commits (unborn HEAD) | Fallback copies files back to root without crashing on `git rev-parse HEAD` or `git worktree add` |
| `T2-BND-07` | State | Path Normalization (S4) | Windows backslash `.\src\auth.ts` vs POSIX `src/auth.ts` | Normalized to `src/auth.ts`; collision check blocks second agent until first completes |
| `T2-BND-08` | CLI | Uninitialized State | Run `status` when `.swarm/state.json` is missing | Exits cleanly with code 1 and error message rather than unhandled exception |

---

### Tier 3: Cross-Feature Interactions
Verifies complex multi-agent scheduling dynamics, dependency DAGs, and concurrency limits.

| Test ID | Scope | Target | Test Scenario | Observable Verification |
|---------|-------|--------|---------------|-------------------------|
| `T3-INT-01` | DAG | Diamond Dependency | Agent A -> (Agent B, Agent C) -> Agent D | A runs first; completing A launches B and C in parallel; completing B leaves D pending; completing C launches D |
| `T3-INT-02` | Locks | File Collision Contention | Independent Agents A and B both target `config.json` | A runs and locks `config.json`; B remains pending; completing A automatically schedules B |
| `T3-INT-03` | Spawner | Concurrency Throttling | 4 ready agents with `maxConcurrency: 2` | Exactly 2 agents run initially; completing one triggers exactly one pending agent to start |
| `T3-INT-04` | Spawner | Mid-Run Dynamic Injection | Inject Agent E depending on running Agent A | Agent E enqueued as pending; completing Agent A immediately unblocks and schedules Agent E |
| `T3-INT-05` | Memory | Blackboard Context Sync | Agent A writes to blackboard; downstream Agent B pulls task | Agent B receives blackboard context in task payload and in `AGENT_TASK.md` |
| `T3-INT-06` | Spawner | Cascade Unblocking Chain | Chain of agents A -> B -> C -> D | Each `complete_agent_task` call triggers `tickScheduler()` advancing the next agent without manual polling |

---

### Tier 4: Real-World Workflows
Verifies end-to-end multi-agent production use cases with real source trees and clean git branches.

| Test ID | Scope | Target | Test Scenario | Observable Verification |
|---------|-------|--------|---------------|-------------------------|
| `T4-E2E-01` | E2E | Multi-Agent Refactoring | 3 agents sequentially refactoring `types.ts`, `db.ts`, `server.ts` | All 3 file edits cleanly committed and merged (`--no-ff`); main repo contains cumulative changes; zero lock leaks |
| `T4-E2E-02` | E2E | Parallel Feature Addition | 2 parallel agents creating `Button.js` and `Card.js` sharing design tokens via blackboard | Both worktrees merge cleanly; both files present in main repo; blackboard retains shared contract |
| `T4-E2E-03` | E2E | Resilience Under Interruption | Agent crashes or disconnects while holding locks | `swarm-engine reset` prunes worktrees, deletes dangling branches, releases locks, and restores clean slate |

---

## 4. Test Environment Requirements & Isolation Protocol

1. **Self-Contained Workspaces**: Each test invokes `createTestWorkspace()` from `test/harness.mjs`, which creates an isolated directory in `os.tmpdir()`. Tests never touch the main `Swarm-engine` workspace repository.
2. **Git Configuration**: Temporary git repositories configure local throwaway committer identities (`user.name = "Swarm Test"`, `user.email = "test@swarm.local"`) to ensure tests run consistently in any CI/CD environment without depending on global git configs.
3. **Cross-Platform Path Resolution**: All path comparisons and directory removals accommodate Windows backslashes, drive letters, and file locks. Retried directory deletion prevents Windows `EBUSY` / `EPERM` flakiness.
4. **Zero Third-Party Testing Dependencies**: Uses only standard Node.js APIs (`node:test`, `node:assert/strict`, `node:child_process`, `node:fs/promises`, `node:path`, `node:os`, `node:crypto`).
