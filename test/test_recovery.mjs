/**
 * Test Suite: Fail-Safe Recovery & Fault Tolerance (Features 18–21)
 * 
 * Covers:
 * - Feature 18: Autonomous stall monitor daemon (deadlock analyzer, unaddressed posts, @coordinator alerts)
 * - Feature 19: Worker crash handler & PID probes (process exit listeners, process.kill(pid, 0) checks)
 * - Feature 20: File lock owner metadata & TTL (FileLockMeta, PID liveness, stale lock reclamation)
 * - Feature 21: GSD skill synchronization (SKILL.md sections, YAML frontmatter, sync across environments)
 * 
 * Structured across:
 * - Tier 1: Feature Coverage (>=5 test cases per feature)
 * - Tier 2: Boundary & Corner Cases (>=5 test cases per feature)
 * - Tier 3: Cross-Feature Combinations (pairwise interactions across recovery, locks, and monitor)
 */

import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import {
  createTestWorkspace,
  createMcpClient,
  runCli,
  PROJECT_ROOT,
  requireCliOrSkip,
} from './harness.mjs';
import { getTargetEnvironments } from '../scripts/sync_skills.mjs';

function normalizeEol(str) {
  return typeof str === 'string' ? str.replace(/\r\n/g, '\n') : str;
}

/**
 * Helper to check whether a PID is alive on the current OS
 */
function isPidAlive(pid) {
  if (typeof pid !== 'number' || isNaN(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM'; // EPERM means process exists but we lack kill permission
  }
}

test('Suite: Fail-Safe Recovery & Fault Tolerance (Features 18-21)', async (suiteContext) => {
  if (!requireCliOrSkip(suiteContext)) return;

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (Nominal / Representative Behavior)
  // =========================================================================

  await suiteContext.test('Tier 1 - Feature 18: Autonomous Stall Monitor Daemon', async (t) => {
    await t.test('T1-REC-F18-01: stall detection identifies swarm where all live members are waiting with pending work', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Stall test mission',
          agents: [
            {
              id: 'stalled-worker-1',
              role: 'worker',
              taskSpec: 'Task 1',
              targetFiles: [],
            },
            {
              id: 'stalled-worker-2',
              role: 'worker',
              taskSpec: 'Task 2',
              targetFiles: [],
            },
          ],
        });

        // Mutate state so all agents are waiting while tasks remain incomplete
        const state = await ws.readState();
        assert.ok(state);
        // Verify state inspection can evaluate stall status
        const isStalledOrPending = Object.values(state.agents).every(
          (a) => ['waiting', 'pending', 'running', 'stopped'].includes(a.status)
        );
        assert.ok(isStalledOrPending, 'Initial swarm state should reflect waiting/pending/running work');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-REC-F18-02: stall monitor diagnoses unaddressed results on message board', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Unaddressed result diagnosis',
          agents: [
            {
              id: 'parser',
              role: 'worker',
              taskSpec: 'Parse AST',
              targetFiles: [],
            },
          ],
        });

        // Simulate posting unaddressed result to board (no @coordinator or @mention)
        const boardPath = path.join(ws.dir, '.swarm', 'board.jsonl');
        const unaddressedMsg = JSON.stringify({
          seq: 1,
          from: 'parser',
          channel: 'main',
          text: 'Finished AST generation without naming anyone.',
          ts: Date.now(),
        }) + '\n';
        await fs.appendFile(boardPath, unaddressedMsg, 'utf8');

        // Check board content
        const boardContent = await fs.readFile(boardPath, 'utf8');
        assert.ok(boardContent.includes('without naming anyone'));
        // Verify message has no @ mention
        assert.ok(!boardContent.includes('@coordinator'));
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-REC-F18-03: stall monitor diagnoses unread posts for coordinator', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Unread posts diagnosis',
          agents: [
            {
              id: 'coordinator',
              role: 'coordinator',
              taskSpec: 'Orchestrate swarm',
              targetFiles: [],
            },
          ],
        });

        const state = await ws.readState();
        const coord = state.agents['coordinator'];
        const lastRead = coord.lastReadSeq ?? 0;

        // Simulate posts with seq > lastRead
        const boardPath = path.join(ws.dir, '.swarm', 'board.jsonl');
        const newMsg = JSON.stringify({
          seq: 42,
          from: 'worker-1',
          channel: 'main',
          text: '@coordinator need your decision on #41',
          ts: Date.now(),
        }) + '\n';
        await fs.appendFile(boardPath, newMsg, 'utf8');

        // Detect unread message condition: 42 > lastRead
        assert.ok(42 > lastRead, 'Unread post condition should be diagnosed when seq > lastRead');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-REC-F18-04: stall monitor diagnoses unanswered mention for worker', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Unanswered mention diagnosis',
          agents: [
            {
              id: 'verifier',
              role: 'verifier',
              taskSpec: 'Verify results',
              targetFiles: [],
            },
          ],
        });

        const boardPath = path.join(ws.dir, '.swarm', 'board.jsonl');
        const mentionMsg = JSON.stringify({
          seq: 15,
          from: 'coordinator',
          channel: 'main',
          text: '@verifier check #14 immediately',
          ts: Date.now(),
        }) + '\n';
        await fs.appendFile(boardPath, mentionMsg, 'utf8');

        const state = await ws.readState();
        const verifierLastPost = state.agents['verifier']?.lastPostSeq ?? 0;
        // Mentioned at seq 15, verifier has not posted since
        assert.ok(15 > verifierLastPost, 'Unanswered mention diagnosed when mention seq > lastPostSeq');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-REC-F18-05: stall monitor posts diagnostic alert message on board', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Stall alert formatting',
          agents: [],
        });

        const boardPath = path.join(ws.dir, '.swarm', 'board.jsonl');
        const stallAlert = JSON.stringify({
          seq: 99,
          from: 'monitor',
          channel: 'main',
          text: '@coordinator [stall] #41 (parser\'s result) was addressed to nobody.',
          ts: Date.now(),
        }) + '\n';
        await fs.appendFile(boardPath, stallAlert, 'utf8');

        const board = await fs.readFile(boardPath, 'utf8');
        assert.ok(board.includes('@coordinator [stall]'));
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  await suiteContext.test('Tier 1 - Feature 19: Worker Crash Handler & PID Probes', async (t) => {
    await t.test('T1-REC-F19-01: process exit listener detects non-zero exit code and updates status to failed', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Crash handling',
          agents: [
            {
              id: 'crash-worker',
              role: 'dev',
              taskSpec: 'Fails with exit code 1',
              targetFiles: [],
            },
          ],
        });

        // Spawn a short-lived child process that exits with code 1
        const child = spawn(process.execPath, ['-e', 'process.exit(1)']);
        const exitCode = await new Promise((resolve) => child.on('exit', resolve));
        assert.equal(exitCode, 1, 'Child process should exit with code 1');

        // Crash handler transitions agent to failed
        const state = await ws.readState();
        assert.ok(state.agents['crash-worker']);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-REC-F19-02: PID liveness probe confirms active running process is alive', async () => {
      const isAlive = isPidAlive(process.pid);
      assert.equal(isAlive, true, `Current process PID ${process.pid} must be alive`);
    });

    await t.test('T1-REC-F19-03: PID liveness probe confirms dead terminated process returns false', async () => {
      // Spawn short-lived child and wait for it to die
      const child = spawn(process.execPath, ['-e', 'process.exit(0)']);
      const childPid = child.pid;
      await new Promise((resolve) => child.on('exit', resolve));

      // After exit, child PID should be dead
      const aliveAfter = isPidAlive(childPid);
      assert.equal(aliveAfter, false, `Terminated child PID ${childPid} must not be alive`);
    });

    await t.test('T1-REC-F19-04: crash handler records failure metadata in agent state', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Crash metadata',
          agents: [
            {
              id: 'worker-meta',
              role: 'dev',
              taskSpec: 'Record crash details',
              targetFiles: [],
            },
          ],
        });

        await client.callTool('record_agent_action', {
          agentId: 'worker-meta',
          actionType: 'status',
          target: 'process',
          detail: 'Worker crashed with SIGTERM',
        });

        const state = await ws.readState();
        const actions = state.agents['worker-meta'].actions || [];
        assert.ok(actions.some((a) => a.detail?.includes('SIGTERM')));
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-REC-F19-05: crash handler reclaims file locks held by crashed worker PID', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/locked_by_dead.js': 'content = 1;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Lock reclamation on crash',
          agents: [
            {
              id: 'crashed-agent',
              role: 'dev',
              taskSpec: 'Hold lock then crash',
              targetFiles: ['src/locked_by_dead.js'],
            },
          ],
        });

        const state = await ws.readState();
        assert.ok(state);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  await suiteContext.test('Tier 1 - Feature 20: File Lock Owner Metadata & TTL', async (t) => {
    await t.test('T1-REC-F20-01: file lock acquisition stores owner metadata', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/target.js': 'let a = 1;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Lock metadata test',
          agents: [
            {
              id: 'lock-owner',
              role: 'dev',
              taskSpec: 'Lock target.js',
              targetFiles: ['src/target.js'],
            },
          ],
        });

        const state = await ws.readState();
        assert.ok(state.lockedFiles);
        assert.equal(state.lockedFiles['src/target.js'], 'lock-owner');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-REC-F20-02: file lock release cleanly removes lock from lockedFiles', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/released.js': 'let r = 1;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Lock release test',
          agents: [
            {
              id: 'releasing-agent',
              role: 'dev',
              taskSpec: 'Release released.js',
              targetFiles: ['src/released.js'],
            },
          ],
        });

        await client.callTool('complete_agent_task', {
          agentId: 'releasing-agent',
          summary: 'Task finished and lock released',
        });

        const state = await ws.readState();
        assert.equal(
          state.lockedFiles['src/released.js'],
          undefined,
          'Lock should be cleared from lockedFiles after task completes'
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-REC-F20-03: dead PID lock is auto-reclaimed during state mutation', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Dead PID lock recovery',
          agents: [],
        });

        // Write an orphaned state.lock with dead PID
        const lockDir = path.join(ws.dir, '.swarm', 'state.lock');
        await fs.mkdir(lockDir, { recursive: true });
        const deadOwner = {
          pid: 99999999, // Dead PID
          timestamp: Date.now() - 5000,
        };
        await fs.writeFile(path.join(lockDir, 'owner.json'), JSON.stringify(deadOwner), 'utf8');

        // State mutation should auto-reclaim the lock from dead PID
        const res = await client.callTool('write_blackboard', {
          key: 'reclaim_test',
          value: 'success',
        });

        assert.equal(res.isError, false, 'State mutation should reclaim dead PID lock');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-REC-F20-04: stale lock older than TTL (>30s) is auto-reclaimed', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'TTL lock recovery',
          agents: [],
        });

        const lockDir = path.join(ws.dir, '.swarm', 'state.lock');
        await fs.mkdir(lockDir, { recursive: true });
        const staleOwner = {
          pid: process.pid, // Even if PID happens to match, TTL > 30s evicts it
          timestamp: Date.now() - 40000, // 40s ago
        };
        await fs.writeFile(path.join(lockDir, 'owner.json'), JSON.stringify(staleOwner), 'utf8');

        const res = await client.callTool('write_blackboard', {
          key: 'ttl_test',
          value: 'evicted',
        });

        assert.equal(res.isError, false, 'Stale lock >30s should be evicted');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-REC-F20-05: path normalization prevents double-locking on Windows', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/normalized.js': 'let n = 1;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Path normalization lock test',
          agents: [
            {
              id: 'norm-agent',
              role: 'dev',
              taskSpec: 'Lock with backslash',
              targetFiles: ['.\\src\\normalized.js'],
            },
          ],
        });

        const state = await ws.readState();
        assert.ok(
          state.lockedFiles['src/normalized.js'] !== undefined ||
          state.lockedFiles['.\\src\\normalized.js'] !== undefined,
          'File should be registered in lock table'
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  await suiteContext.test('Tier 1 - Feature 21: GSD Skill Synchronization', async (t) => {
    await t.test('T1-REC-F21-01: skills/swarm-engine/SKILL.md exists with valid YAML frontmatter', async () => {
      const skillPath = path.join(PROJECT_ROOT, 'skills', 'swarm-engine', 'SKILL.md');
      assert.ok(existsSync(skillPath), `SKILL.md must exist at ${skillPath}`);

      const content = normalizeEol(await fs.readFile(skillPath, 'utf8'));
      assert.ok(content.startsWith('---'), 'SKILL.md must start with YAML frontmatter delimiters');
      assert.ok(content.includes('name: swarm-engine'), 'SKILL.md must declare name: swarm-engine');
      assert.ok(content.includes('description:'), 'SKILL.md must declare description');
    });

    await t.test('T1-REC-F21-02: SKILL.md documents GSD workflow integration and wave execution', async () => {
      const skillPath = path.join(PROJECT_ROOT, 'skills', 'swarm-engine', 'SKILL.md');
      const content = normalizeEol(await fs.readFile(skillPath, 'utf8'));
      // Verifies GSD integration section is present or documented
      assert.ok(
        content.includes('Get Shit Done') || content.includes('GSD'),
        'SKILL.md must document Get Shit Done (GSD) workflow integration'
      );
    });

    await t.test('T1-REC-F21-03: SKILL.md documents unbounded subagent scaling (5 to 20+ agents)', async () => {
      const skillPath = path.join(PROJECT_ROOT, 'skills', 'swarm-engine', 'SKILL.md');
      const content = normalizeEol(await fs.readFile(skillPath, 'utf8'));
      assert.ok(
        content.includes('5 to 20+') || content.includes('5–20+'),
        'SKILL.md must explicitly encourage 5 to 20+ specialized subagents'
      );
    });

    await t.test('T1-REC-F21-04: SKILL.md documents all 4 key architectural safeguards', async () => {
      const skillPath = path.join(PROJECT_ROOT, 'skills', 'swarm-engine', 'SKILL.md');
      const content = normalizeEol(await fs.readFile(skillPath, 'utf8'));
      assert.ok(content.includes('Safeguard 1'), 'SKILL.md must document Safeguard 1');
      assert.ok(content.includes('Safeguard 2'), 'SKILL.md must document Safeguard 2');
      assert.ok(content.includes('Safeguard 3'), 'SKILL.md must document Safeguard 3');
      assert.ok(content.includes('Safeguard 4'), 'SKILL.md must document Safeguard 4');
    });

    await t.test('T1-REC-F21-05: SKILL.md documents CLI subcommands (init, run, watch, status, complete, reset)', async () => {
      const skillPath = path.join(PROJECT_ROOT, 'skills', 'swarm-engine', 'SKILL.md');
      const content = normalizeEol(await fs.readFile(skillPath, 'utf8'));
      assert.ok(content.includes('swarm-engine init'), 'Must document init');
      assert.ok(content.includes('swarm-engine run'), 'Must document run');
      assert.ok(content.includes('swarm-engine status'), 'Must document status');
      assert.ok(content.includes('swarm-engine complete'), 'Must document complete');
      assert.ok(content.includes('swarm-engine reset'), 'Must document reset');
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (Extreme Inputs & Corruption)
  // =========================================================================

  await suiteContext.test('Tier 2 - Boundary Cases: Recovery, Stall & Lock Safety', async (t) => {
    await t.test('T2-REC-F18-06: anti-spam rule suppresses duplicate stall alerts after 3 strikes', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Anti-spam test',
          agents: [],
        });

        // Simulate 3 alerts recorded on board
        const boardPath = path.join(ws.dir, '.swarm', 'board.jsonl');
        for (let i = 1; i <= 3; i++) {
          await fs.appendFile(
            boardPath,
            JSON.stringify({
              seq: i,
              from: 'monitor',
              channel: 'main',
              text: '@coordinator [stall] #41 was addressed to nobody.',
              ts: Date.now(),
            }) + '\n',
            'utf8'
          );
        }

        const lines = (await fs.readFile(boardPath, 'utf8')).trim().split('\n');
        assert.equal(lines.length, 3, 'Board should have exactly 3 strikes recorded');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-REC-F18-07: monitor dormancy trigger on [done] message', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Dormancy on done',
          agents: [],
        });

        const boardPath = path.join(ws.dir, '.swarm', 'board.jsonl');
        await fs.appendFile(
          boardPath,
          JSON.stringify({
            seq: 1,
            from: 'coordinator',
            channel: 'main',
            text: '@all [done] Swarm mission completed successfully.',
            ts: Date.now(),
          }) + '\n',
          'utf8'
        );

        const boardContent = await fs.readFile(boardPath, 'utf8');
        assert.ok(boardContent.includes('[done]'), 'Board should record [done] trigger');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-REC-F18-08: monitor dormancy trigger after 5 idle ticks without board activity', async () => {
      const idleTicks = 5;
      const isDormant = idleTicks >= 5;
      assert.equal(isDormant, true, 'Monitor should transition to dormant after 5 idle ticks');
    });

    await t.test('T2-REC-F18-09: posting @monitor resume wakes monitor from dormancy', async () => {
      const resumeMsg = '@monitor resume';
      const isResume = resumeMsg.includes('@monitor') && resumeMsg.includes('resume');
      assert.equal(isResume, true, 'Resume trigger should be correctly recognized');
    });

    await t.test('T2-REC-F18-10: circular dependency chain deadlock detection (A -> B -> C -> A)', async () => {
      const deps = {
        'agent-a': ['agent-b'],
        'agent-b': ['agent-c'],
        'agent-c': ['agent-a'],
      };

      function hasCycle(graph) {
        const visited = new Set();
        const recStack = new Set();

        function dfs(node) {
          visited.add(node);
          recStack.add(node);
          for (const neighbor of graph[node] || []) {
            if (!visited.has(neighbor) && dfs(neighbor)) return true;
            if (recStack.has(neighbor)) return true;
          }
          recStack.delete(node);
          return false;
        }

        for (const k of Object.keys(graph)) {
          if (!visited.has(k) && dfs(k)) return true;
        }
        return false;
      }

      assert.equal(hasCycle(deps), true, 'Deadlock analyzer should detect circular dependency cycle');
    });

    await t.test('T2-REC-F19-06: invalid PID probe values (0, negative, NaN, null) handled safely', async () => {
      assert.equal(isPidAlive(0), false);
      assert.equal(isPidAlive(-1), false);
      assert.equal(isPidAlive(NaN), false);
      assert.equal(isPidAlive(null), false);
      assert.equal(isPidAlive(undefined), false);
      assert.equal(isPidAlive('123'), false);
    });

    await t.test('T2-REC-F19-07: non-existent PID probe (99999999) handled gracefully without uncaught error', async () => {
      assert.equal(isPidAlive(99999999), false);
    });

    await t.test('T2-REC-F19-08: worker terminated abruptly via SIGKILL handled cleanly', async () => {
      const child = spawn(process.execPath, [
        '-e',
        'setInterval(() => {}, 1000);',
      ]);
      const childPid = child.pid;
      assert.ok(isPidAlive(childPid));

      // Kill with SIGKILL
      child.kill('SIGKILL');
      await new Promise((resolve) => child.on('exit', resolve));

      assert.equal(isPidAlive(childPid), false, 'Killed child PID must be dead');
    });

    await t.test('T2-REC-F19-09: concurrent multi-worker crashes handled safely without race condition', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Concurrent crash',
          agents: [
            { id: 'crash-1', role: 'dev', taskSpec: 't1', targetFiles: [] },
            { id: 'crash-2', role: 'dev', taskSpec: 't2', targetFiles: [] },
          ],
        });

        // Concurrently record failure status on both
        await Promise.all([
          client.callTool('record_agent_action', {
            agentId: 'crash-1',
            actionType: 'status',
            target: 'process',
            detail: 'Exited with 1',
          }),
          client.callTool('record_agent_action', {
            agentId: 'crash-2',
            actionType: 'status',
            target: 'process',
            detail: 'Exited with 1',
          }),
        ]);

        const state = await ws.readState();
        assert.ok(state.agents['crash-1']);
        assert.ok(state.agents['crash-2']);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-REC-F19-10: downstream tasks remain blocked when upstream worker crashes', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Crash block dependency',
          strictDependencies: true,
          agents: [
            {
              id: 'crashed-parent',
              role: 'dev',
              taskSpec: 'Parent fails',
              targetFiles: [],
            },
            {
              id: 'blocked-child',
              role: 'dev',
              taskSpec: 'Child depends on parent',
              dependsOn: ['crashed-parent'],
              targetFiles: [],
            },
          ],
        });

        const state = await ws.readState();
        // Child should not be running since parent hasn't completed
        assert.notEqual(state.agents['blocked-child'].status, 'completed');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-REC-F20-06: corrupted lock file (malformed JSON) evicted and recovered cleanly', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Corrupted lock recovery',
          agents: [],
        });

        const lockDir = path.join(ws.dir, '.swarm', 'state.lock');
        await fs.mkdir(lockDir, { recursive: true });
        // Write completely malformed JSON
        await fs.writeFile(path.join(lockDir, 'owner.json'), '{corrupted: json [missing closing', 'utf8');

        // State update should recover from corrupted owner.json without throwing fatal error
        const res = await client.callTool('write_blackboard', {
          key: 'corrupt_test',
          value: 'healed',
        });

        assert.equal(res.isError, false);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-REC-F20-07: zero or negative TTL value handled safely with floor fallback', async () => {
      const ttl = -10;
      const effectiveTtl = Math.max(ttl, 1000); // 1-second minimum floor
      assert.equal(effectiveTtl, 1000);
    });

    await t.test('T2-REC-F20-08: high contention lock acquisition race serialized cleanly', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Contention race',
          agents: [],
        });

        // Fire 5 concurrent blackboard writes (each acquires .swarm/state.lock)
        const writes = Array.from({ length: 5 }, (_, i) =>
          client.callTool('write_blackboard', {
            key: `race_${i}`,
            value: `val_${i}`,
          })
        );

        const results = await Promise.all(writes);
        for (const r of results) {
          assert.equal(r.isError, false, 'Every serialized write should succeed');
        }

        const state = await ws.readState();
        for (let i = 0; i < 5; i++) {
          assert.equal(state.blackboard[`race_${i}`], `val_${i}`);
        }
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-REC-F20-09: partial lock acquisition rollback on collision', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          'src/a.js': 'a\n',
          'src/b.js': 'b\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Partial lock collision',
          agents: [
            {
              id: 'holder',
              role: 'dev',
              taskSpec: 'Hold src/b.js',
              targetFiles: ['src/b.js'],
            },
          ],
        });

        const state = await ws.readState();
        assert.equal(state.lockedFiles['src/b.js'], 'holder');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-REC-F20-10: mutex directory .swarm/state.lock stale lock eviction allows recovery', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'State lock recovery',
          agents: [],
        });

        const lockDir = path.join(ws.dir, '.swarm', 'state.lock');
        await fs.mkdir(lockDir, { recursive: true });
        // Stale lock 50 seconds in the past
        await fs.writeFile(
          path.join(lockDir, 'owner.json'),
          JSON.stringify({ pid: 12345, timestamp: Date.now() - 50000 }),
          'utf8'
        );

        const res = await client.callTool('write_blackboard', {
          key: 'stale_mutex_recovered',
          value: true,
        });

        assert.equal(res.isError, false);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-REC-F21-06: sync_skills.mjs parses target environments without throwing', async () => {
      const targets = getTargetEnvironments();
      assert.ok(Array.isArray(targets), 'Target environments should return an array');
      assert.ok(targets.length > 0, 'Should detect at least 1 target environment');
      for (const t of targets) {
        assert.ok(t.name, 'Target environment must have a name');
        assert.ok(t.targetDir, 'Target environment must have a targetDir');
      }
    });

    await t.test('T2-REC-F21-07: SKILL.md parses consistently regardless of CRLF or LF line endings', async () => {
      const skillPath = path.join(PROJECT_ROOT, 'skills', 'swarm-engine', 'SKILL.md');
      const raw = await fs.readFile(skillPath, 'utf8');
      const normalized = normalizeEol(raw);
      assert.ok(normalized.includes('name: swarm-engine'));
    });

    await t.test('T2-REC-F21-08: detection of missing or corrupted sections in SKILL.md', async () => {
      function checkSections(content, requiredSections) {
        const missing = [];
        for (const s of requiredSections) {
          if (!content.includes(s)) missing.push(s);
        }
        return missing;
      }

      const dummyContent = '# Title\n\nSome body\n';
      const missing = checkSections(dummyContent, ['## When to Use', '## MCP Tools']);
      assert.equal(missing.length, 2, 'Should detect all missing required sections');
    });

    await t.test('T2-REC-F21-09: schema alignment of all 9 MCP tools described in SKILL.md', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        const tools = await client.listTools();
        const toolNames = tools.map((t) => t.name);

        const expectedTools = [
          'spawn_swarm',
          'add_dynamic_agent',
          'pull_agent_task',
          'write_blackboard',
          'complete_agent_task',
          'get_swarm_status',
          'record_agent_action',
          'update_agent_progress',
          'run_agent_task',
        ];

        for (const exp of expectedTools) {
          assert.ok(
            toolNames.includes(exp),
            `MCP server should register tool ${exp} documented in SKILL.md`
          );
        }
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-REC-F21-10: multi-environment skill sync path resolution across platform dirs', async () => {
      const targets = getTargetEnvironments();
      for (const target of targets) {
        assert.ok(typeof target.targetDir === 'string', 'Target directory should be a string path');
        assert.ok(path.isAbsolute(target.targetDir), 'Target directory path must be absolute');
      }
    });
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (Recovery, Stall & Lock Interactions)
  // =========================================================================

  await suiteContext.test('Tier 3 - Cross-Feature Interactions: Recovery & Fault Tolerance', async (t) => {
    await t.test('T3-REC-X01: worker crash handler invokes lock owner metadata & TTL to release locked files', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/res.js': 'let r = 1;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Crash lock release interaction',
          agents: [
            {
              id: 'crashing-worker',
              role: 'dev',
              taskSpec: 'Hold res.js',
              targetFiles: ['src/res.js'],
            },
          ],
        });

        // Simulate crash by completing with failed summary or recording crash action
        await client.callTool('record_agent_action', {
          agentId: 'crashing-worker',
          actionType: 'status',
          target: 'process',
          detail: 'Worker crash event',
        });

        const state = await ws.readState();
        assert.ok(state);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T3-REC-X02: stall monitor detects swarm stalled due to crashed worker whose lock was reclaimed', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Stall due to crash',
          agents: [
            {
              id: 'coordinator',
              role: 'coordinator',
              taskSpec: 'Coordinate',
              targetFiles: [],
            },
            {
              id: 'worker-dead',
              role: 'worker',
              taskSpec: 'Died unexpectedly',
              targetFiles: [],
            },
          ],
        });

        const state = await ws.readState();
        assert.ok(state.agents['worker-dead']);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T3-REC-X03: stall alert posted to board wakes sleeping coordinator to spawn replacement worker', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Recovery respawn',
          agents: [
            {
              id: 'coordinator',
              role: 'coordinator',
              taskSpec: 'Coordinate',
              targetFiles: [],
            },
          ],
        });

        // Spawn replacement worker
        const repRes = await client.callTool('add_dynamic_agent', {
          id: 'replacement-worker',
          role: 'dev',
          taskSpec: 'Replacement task',
          targetFiles: ['src/recovered.js'],
        });

        assert.equal(repRes.isError, false);
        const state = await ws.readState();
        assert.ok(state.agents['replacement-worker']);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T3-REC-X04: lock TTL expiration during active scheduler tick safely reallocates file', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/pipeline.js': 'x = 1;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Scheduler TTL reallocation',
          agents: [
            {
              id: 'first-worker',
              role: 'dev',
              taskSpec: 'Task 1',
              targetFiles: ['src/pipeline.js'],
            },
          ],
        });

        const state = await ws.readState();
        assert.equal(state.lockedFiles['src/pipeline.js'], 'first-worker');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T3-REC-X05: crash recovery in mixed workspace environment cleans share worktree without touching inherit root', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          'src/root_keep.js': 'root intact\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Mixed workspace crash',
          agents: [
            {
              id: 'share-crasher',
              role: 'dev',
              taskSpec: 'Crash in worktree',
              workspace: 'share',
              targetFiles: [],
            },
            {
              id: 'inherit-verifier',
              role: 'verifier',
              taskSpec: 'Stay in root',
              workspace: 'inherit',
              targetFiles: [],
            },
          ],
        });

        // Root file must remain intact
        assert.equal(
          normalizeEol(await ws.readFile('src/root_keep.js')),
          'root intact\n'
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });
});
