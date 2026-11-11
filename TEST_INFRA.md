# E2E Test Infra: Antigravity Native Swarm Parity in Swarm Engine

## Test Philosophy
- **Opaque-Box & Requirement-Driven**: Tests derive directly from `ORIGINAL_REQUEST.md` and `PROJECT.md` Feature Inventory (Features 1–23), without dependency on internal implementation private details.
- **Methodology**: Systematic 4-tier testing hierarchy combining:
  1. Category-Partition Equivalence Class testing
  2. Boundary Value Analysis (BVA) & Corner Cases
  3. Pairwise Combinatorial Subsystem Interaction testing
  4. Real-World Multi-Agent Workload Orchestration scenarios
- **Zero Invalidation**: Test assertions inspect observable CLI outputs, MCP JSON-RPC protocol responses, workspace filesystem mutations, git commits, and `.swarm/` artifacts (`state.json`, `board.jsonl`, `view.json`, locks).

## Feature Inventory Coverage Matrix
| # | Feature | Source Requirement | Tier 1 (Nominal) | Tier 2 (Boundary) | Tier 3 (Cross-Subsystem) |
|---|---------|---------------------|:----------------:|:-----------------:|:------------------------:|
| 1 | Append-only message board | ORIGINAL_REQUEST §R2, PROJECT §F1 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 2 | Doorbell wakeup addressing (@name, @prefix, @all, @#channel) | ORIGINAL_REQUEST §R2, PROJECT §F2 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 3 | Zero-token sleep (swarm_wait) | ORIGINAL_REQUEST §R2, PROJECT §F3 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 4 | Message board MCP tools (post_message, read_board, swarm_wait) | ORIGINAL_REQUEST §R2, PROJECT §F4 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 5 | Channel management (swarm{action:"channel", op:...}) | ORIGINAL_REQUEST §R2, PROJECT §F5 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 6 | 6-state lifecycle state machine (waiting, working, stopped, etc.) | ORIGINAL_REQUEST §R2, PROJECT §F6 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 7 | Unified swarm management tool (status, add, kill, model, models, title) | ORIGINAL_REQUEST §R2, PROJECT §F7 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 8 | Hierarchical helper subagents (parentId, scoped subagents) | ORIGINAL_REQUEST §R2, PROJECT §F8 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 9 | Runtime model hot-swapping (swarm{action:"model"}) | ORIGINAL_REQUEST §R2, PROJECT §F9 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 10 | Context forking (fork:"<member>") | ORIGINAL_REQUEST §R2, PROJECT §F10 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 11 | Multi-mode workspace allocation (inherit, share, branch) | ORIGINAL_REQUEST §R2, PROJECT §F11 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 12 | Pre-merge boundary enforcement (targetFiles diff check) | ORIGINAL_REQUEST §R2, PROJECT §F12 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 13 | Dirty-workspace stash & clean merge | ORIGINAL_REQUEST §R2, PROJECT §F13 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 14 | Conflict-resilient merge recovery (abort merge, diffs, no lock stranding) | ORIGINAL_REQUEST §R2, PROJECT §F14 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 15 | Canonical view.json generator (<64KB, goals, threads, attention) | ORIGINAL_REQUEST §R2, PROJECT §F15 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 16 | get_swarm_view MCP tool | ORIGINAL_REQUEST §R2, PROJECT §F16 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 17 | State cursor tracking (lastReadSeq, waitSince, wakeMode) | ORIGINAL_REQUEST §R2, PROJECT §F17 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 18 | Autonomous stall monitor daemon (cron periodic checks, deadlock analyzer) | ORIGINAL_REQUEST §R2, PROJECT §F18 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 19 | Worker crash handler & PID probes | ORIGINAL_REQUEST §R2, PROJECT §F19 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 20 | File lock owner metadata & TTL (FileLockMeta pid, acquiredAt, auto-reclaim) | ORIGINAL_REQUEST §R2, PROJECT §F20 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 21 | GSD skill synchronization (GSD sections in SKILL.md) | ORIGINAL_REQUEST §R1, §R4, PROJECT §F21 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 22 | Automated parity test suite modular runner | ORIGINAL_REQUEST §R3, PROJECT §F22 | ≥5 cases | ≥5 cases | ✓ Pairwise |
| 23 | E2E multi-agent orchestration execution script | ORIGINAL_REQUEST §R2, §R3, PROJECT §F23 | ≥5 cases | ≥5 cases | ✓ Pairwise |

## Test Architecture
- **Test Framework**: Native Node.js test runner (`node:test`) and strict assertions (`node:assert/strict`).
- **Test Invocation**:
  - Full suite: `node --test test/test_*.mjs`
  - Modular suites:
    - `node --test test/test_board.mjs`
    - `node --test test/test_lifecycle.mjs`
    - `node --test test/test_workspaces.mjs`
    - `node --test test/test_telemetry.mjs`
    - `node --test test/test_recovery.mjs`
    - `node --test test/test_e2e_antigravity_parity.mjs`
- **Pass/Fail Semantics**: All test suites must exit with status `0`. Uncaught rejections or assertion errors trigger non-zero exit status and immediate failure.
- **Harness & Sandboxing**:
  - Uses `test/harness.mjs` providing `createTestWorkspace` (isolated temp directories with git init and commit support).
  - Uses `createMcpClient` providing stdio JSON-RPC 2.0 communication against `dist/index.js mcp`.
  - Non-destructive teardown: all workspaces clean up ephemeral files, with retry loops for Windows filesystem lock delays.

## Test Suite Distribution & Layout
```
test/
├── harness.mjs                        # Ephemeral workspace sandbox, McpTestClient, runCli
├── test_board.mjs                     # Features 1–5: Message board, sequence allocator, doorbells, channels, swarm_wait (55 tests)
├── test_lifecycle.mjs                 # Features 6–10: 6-state lifecycle, unified swarm tool, helpers, hot-swap, forking (55 tests)
├── test_workspaces.mjs                # Features 11–14: Workspace modes (inherit/share/branch), boundary enforcement, stash/merge, conflict recovery (45 tests)
├── test_telemetry.mjs                 # Features 15–17: Canonical view.json generator, get_swarm_view tool, sequence cursor tracking (35 tests)
├── test_recovery.mjs                  # Features 18–21: Stall watchdog daemon, worker crash handler, lock owner metadata & TTL, GSD sync (42 tests / 52 subtests)
└── test_e2e_antigravity_parity.mjs    # Features 22–23: End-to-end multi-agent orchestration, full system interaction scenarios (Tier 4: 34 tests)
```

## Real-World Application Scenarios (Tier 4)
| # | Scenario | Features Exercised | Complexity |
|---|----------|--------------------|------------|
| 1 | Multi-Agent Collaborative Refactor with Doorbell Handoff | F1, F2, F3, F4, F6, F7, F11, F15 | High |
| 2 | High-Contention Multi-Worker Pipeline with Stash & Clean Merge | F6, F11, F12, F13, F14, F17, F20 | High |
| 3 | Worker Crash & Automatic Lock Reclamation Recovery | F6, F18, F19, F20, F15, F17 | High |
| 4 | Runtime Quota Exhaustion & Dynamic Model Hot-Swap | F7, F9, F10, F15, F17 | Medium |
| 5 | Hierarchical Helper Tree with Channel Partitioning | F1, F2, F5, F7, F8, F15, F16 | High |

## Coverage Thresholds
- **Tier 1 (Feature Coverage)**: ≥5 test cases per feature (23 × 5 = ≥115 test cases)
- **Tier 2 (Boundary & Corner Cases)**: ≥5 test cases per feature (23 × 5 = ≥115 test cases)
- **Tier 3 (Cross-Feature Combinations)**: ≥23 pairwise interaction tests across subsystems
- **Tier 4 (Real-World Application Scenarios)**: ≥5 comprehensive multi-agent workflow tests
- **Total Suite Minimum**: ≥258 verifiable test cases (Actual implemented: 266 test cases)
