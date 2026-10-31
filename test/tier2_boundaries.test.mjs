/**
 * Tier 2: Boundary & Corner Cases
 * 
 * Verifies stale lock recovery, concurrent state updates, zero-change merges,
 * non-git fallbacks, unborn HEAD repos, and Windows path normalization.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createTestWorkspace,
  createMcpClient,
  runCli,
  requireCliOrSkip,
} from './harness.mjs';

test('Tier 2 - Boundary & Corner Cases', async (t) => {
  if (!requireCliOrSkip(t)) return;

  await t.test('T2-BND-01: Stale lock recovery evicts locks >30s or dead PIDs', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      // 1. Initialize swarm state first
      client = await createMcpClient(ws.dir);
      await client.callTool('spawn_swarm', {
        mission: 'Stale Lock Test',
        agents: [],
      });

      // 2. Synthesize an orphaned stale lock directory with owner.json 45 seconds old and dead PID
      const lockDir = path.join(ws.dir, '.swarm', 'state.lock');
      await fs.mkdir(lockDir, { recursive: true });
      const staleOwner = {
        pid: 999999, // Unlikely to exist
        timestamp: Date.now() - 45000, // 45 seconds ago
      };
      await fs.writeFile(path.join(lockDir, 'owner.json'), JSON.stringify(staleOwner), 'utf8');

      // 3. Attempt a state mutation (write_blackboard)
      const res = await client.callTool('write_blackboard', {
        key: 'stale_test',
        value: 'recovered',
      });

      assert.equal(res.isError, false, 'State mutation should succeed despite stale lock');
      assert.equal(res.data.success, true);

      const state = await ws.readState();
      assert.equal(state.blackboard.stale_test, 'recovered');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T2-BND-02: Concurrent state writes are serialized cleanly by atomic lock', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);
      await client.callTool('spawn_swarm', {
        mission: 'Concurrent Writes Test',
        agents: [],
      });

      // Fire 8 concurrent write_blackboard operations simultaneously
      const keys = Array.from({ length: 8 }, (_, i) => `key_${i}`);
      const promises = keys.map((k) =>
        client.callTool('write_blackboard', {
          key: k,
          value: `val_${k}`,
        })
      );

      const results = await Promise.all(promises);
      for (const r of results) {
        assert.equal(r.isError, false, `Concurrent write should succeed: ${JSON.stringify(r)}`);
      }

      const state = await ws.readState();
      for (const k of keys) {
        assert.equal(state.blackboard[k], `val_${k}`, `Key ${k} must be preserved in state`);
      }
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T2-BND-03: Zero-diff merges complete cleanly with --allow-empty (Safeguard 2)', async () => {
    const ws = await createTestWorkspace({ isGit: true, initialCommit: true });
    let client;
    try {
      client = await createMcpClient(ws.dir);
      await client.callTool('spawn_swarm', {
        mission: 'Zero Diff Merge Test',
        agents: [
          {
            id: 'agent-noop',
            role: 'researcher',
            taskSpec: 'Analyze architecture (no code changes)',
            targetFiles: [],
          },
        ],
      });

      // Agent did NOT touch any files in worktree
      const compRes = await client.callTool('complete_agent_task', {
        agentId: 'agent-noop',
        summary: 'Architecture reviewed, no modifications required',
      });

      assert.equal(compRes.isError, false, 'Completing zero-diff task must not fail');
      assert.equal(compRes.data.success, true);
      assert.equal(compRes.data.status, 'completed');

      const state = await ws.readState();
      assert.equal(state.agents['agent-noop'].status, 'completed');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T2-BND-04: AGENT_TASK.md is deleted before merge and never enters git history (Safeguard 2)', async () => {
    const ws = await createTestWorkspace({ isGit: true, initialCommit: true });
    let client;
    try {
      client = await createMcpClient(ws.dir);
      await client.callTool('spawn_swarm', {
        mission: 'Clean Git History Test',
        agents: [
          {
            id: 'agent-clean',
            role: 'coder',
            taskSpec: 'Write app file',
            targetFiles: ['app.js'],
          },
        ],
      });

      // Verify worktree has AGENT_TASK.md
      const worktreeTaskFile = path.join(ws.dir, '.swarm', 'worktrees', 'agent-clean', 'AGENT_TASK.md');
      assert.ok(
        await fs.stat(worktreeTaskFile).then(() => true).catch(() => false),
        'AGENT_TASK.md should exist in worktree before completion'
      );

      // In the worktree, create app.js
      const appFile = path.join(ws.dir, '.swarm', 'worktrees', 'agent-clean', 'app.js');
      await fs.writeFile(appFile, 'console.log("hello world");\n', 'utf8');

      // Complete agent task
      const comp = await client.callTool('complete_agent_task', {
        agentId: 'agent-clean',
        summary: 'Created app.js',
      });
      assert.equal(comp.isError, false);

      // Verify app.js is now in root workspace
      assert.ok(ws.fileExists('app.js'), 'app.js should be merged into root workspace');

      // Check git log for any occurrence of AGENT_TASK.md
      const { stdout: gitLog } = await ws.runGit(['log', '--name-only', '--oneline']);
      assert.ok(
        !gitLog.includes('AGENT_TASK.md'),
        'AGENT_TASK.md must NEVER appear in git commit history (Safeguard 2)'
      );
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T2-BND-05: Non-Git fallback copies modified files back to root (Safeguard 3)', async () => {
    // Non-git workspace
    const ws = await createTestWorkspace({ isGit: false });
    let client;
    try {
      client = await createMcpClient(ws.dir);
      await client.callTool('spawn_swarm', {
        mission: 'Non-Git Workspace Test',
        agents: [
          {
            id: 'agent-nongit',
            role: 'script_writer',
            taskSpec: 'Create script.js in non-git directory',
            targetFiles: ['script.js'],
          },
        ],
      });

      // Locate worktree folder
      const worktreePath = path.join(ws.dir, '.swarm', 'worktrees', 'agent-nongit');
      assert.ok(
        await fs.stat(worktreePath).then(() => true).catch(() => false),
        'Non-git worktree copy directory must exist'
      );

      // Write script.js in the worktree
      await fs.writeFile(path.join(worktreePath, 'script.js'), 'export const active = true;\n', 'utf8');

      // Complete agent task
      const comp = await client.callTool('complete_agent_task', {
        agentId: 'agent-nongit',
        summary: 'Created script.js in non-git environment',
      });

      assert.equal(comp.isError, false, `Non-git completion should not error: ${JSON.stringify(comp)}`);
      assert.equal(comp.data.success, true);

      // Verify script.js was copied back to workspace root
      assert.ok(ws.fileExists('script.js'), 'Modified file must be copied back to root (Safeguard 3)');
      const content = await ws.readFile('script.js');
      assert.equal(content, 'export const active = true;\n');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T2-BND-06: Unborn git HEAD (0 commits) falls back safely without crashing (Safeguard 3)', async () => {
    // Git repo initialized, but no commits
    const ws = await createTestWorkspace({ isGit: true, initialCommit: false });
    let client;
    try {
      client = await createMcpClient(ws.dir);
      const res = await client.callTool('spawn_swarm', {
        mission: 'Unborn HEAD Test',
        agents: [
          {
            id: 'agent-unborn',
            role: 'bootstrap_dev',
            taskSpec: 'Create first commit file',
            targetFiles: ['init.txt'],
          },
        ],
      });

      assert.equal(res.isError, false, 'Should handle unborn HEAD without throwing error');

      // Modify file in worktree
      const worktreePath = path.join(ws.dir, '.swarm', 'worktrees', 'agent-unborn');
      if (await fs.stat(worktreePath).then(() => true).catch(() => false)) {
        await fs.writeFile(path.join(worktreePath, 'init.txt'), 'Initial commit content\n', 'utf8');
      }

      const comp = await client.callTool('complete_agent_task', {
        agentId: 'agent-unborn',
        summary: 'Created init.txt in unborn repo',
      });

      assert.equal(comp.isError, false, 'Completion in unborn HEAD repo must succeed');
      assert.ok(ws.fileExists('init.txt'), 'init.txt should be merged or copied back to root');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T2-BND-07: Path normalization resolves Windows backslashes and prevents collision (Safeguard 4)', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      // Spawn with 2 agents targeting the exact same file using different path styles
      const res = await client.callTool('spawn_swarm', {
        mission: 'Path Normalization Collision Test',
        maxConcurrency: 2,
        agents: [
          {
            id: 'agent-win-path',
            role: 'worker-1',
            taskSpec: 'Edit state file',
            targetFiles: ['.\\src\\state.ts'], // Windows backslash + relative prefix
          },
          {
            id: 'agent-posix-path',
            role: 'worker-2',
            taskSpec: 'Edit state file too',
            targetFiles: ['./src/state.ts'], // POSIX slash + relative prefix
          },
        ],
      });

      assert.equal(res.isError, false);

      const state = await ws.readState();
      const agent1 = state.agents['agent-win-path'];
      const agent2 = state.agents['agent-posix-path'];

      // Exactly ONE agent must be running; the other MUST be held in pending due to file lock collision
      const runningCount = [agent1.status, agent2.status].filter((s) => s === 'running').length;
      const pendingCount = [agent1.status, agent2.status].filter((s) => s === 'pending').length;

      assert.equal(runningCount, 1, 'Only one agent should run when target files collide');
      assert.equal(pendingCount, 1, 'Second agent must be held in pending due to lock collision');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T2-BND-08: swarm-engine status exits cleanly with code 1 when uninitialized', async () => {
    const ws = await createTestWorkspace({ isGit: false });
    try {
      // Run status without init or spawn
      const { stderr, stdout, exitCode } = await runCli(['status'], { cwd: ws.dir });
      assert.equal(exitCode, 1, 'CLI status should exit with code 1 when not initialized');
      assert.ok(
        stderr.toLowerCase().includes('not initialized') ||
          stdout.toLowerCase().includes('not initialized') ||
          stderr.toLowerCase().includes('swarm'),
        'CLI should report that swarm is not initialized'
      );
    } finally {
      await ws.cleanup();
    }
  });
});
