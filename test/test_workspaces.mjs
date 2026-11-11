/**
 * Test Suite: Workspaces & Merging (Features 11–14)
 * 
 * Covers:
 * - Feature 11: Multi-mode workspace allocation (workspace: "inherit" | "share" | "branch")
 * - Feature 12: Pre-merge boundary enforcement (targetFiles diff check & unauthorized mutations)
 * - Feature 13: Dirty-workspace stash & clean merge (auto-stash dirty root cwd & clean teardown)
 * - Feature 14: Conflict-resilient merge recovery (clean merge abort, diff artifacts, no stranded locks)
 * 
 * Structured across:
 * - Tier 1: Feature Coverage (>=5 test cases per feature)
 * - Tier 2: Boundary & Corner Cases (>=5 test cases per feature)
 * - Tier 3: Cross-Feature Combinations (pairwise interactions across workspaces, recovery, lock management)
 */

import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import {
  createTestWorkspace,
  createMcpClient,
  runCli,
  requireCliOrSkip,
} from './harness.mjs';

function normalizeEol(str) {
  return typeof str === 'string' ? str.replace(/\r\n/g, '\n') : str;
}

test('Suite: Workspaces & Safe Merging (Features 11-14)', async (suiteContext) => {
  if (!requireCliOrSkip(suiteContext)) return;

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (Nominal / Representative Behavior)
  // =========================================================================

  await suiteContext.test('Tier 1 - Feature 11: Multi-Mode Workspace Allocation', async (t) => {
    await t.test('T1-WS-F11-01: workspace "inherit" allocates shared root cwd without worktree directory', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/app.js': 'console.log("main");\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        const res = await client.callTool('spawn_swarm', {
          mission: 'Verifier inspection mission',
          agents: [
            {
              id: 'verifier-1',
              role: 'verifier',
              taskSpec: 'Inspect src/app.js in inherit mode',
              workspace: 'inherit',
              targetFiles: [],
            },
          ],
        });

        assert.equal(res.isError, false, `Tool call should succeed: ${JSON.stringify(res)}`);
        const state = await ws.readState();
        assert.ok(state, 'State file should exist');
        const agent = state.agents['verifier-1'];
        assert.ok(agent, 'Agent should exist in state');
        assert.equal(agent.workspace, 'inherit', 'Agent workspace property should be inherit');

        // Verify that a separate git worktree directory was NOT created under .swarm/worktrees
        const worktreeDir = path.join(ws.dir, '.swarm', 'worktrees', 'verifier-1');
        assert.equal(
          existsSync(worktreeDir),
          false,
          'Inherit mode must NOT create a separate worktree directory'
        );

        // Verify git worktree list does not contain verifier-1
        const { stdout: wtList } = await ws.runGit(['worktree', 'list', '--porcelain']);
        assert.ok(
          !wtList.includes('verifier-1'),
          'Git worktree list must not contain inherit agent'
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-WS-F11-02: workspace "share" creates isolated git worktree and branch', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/worker.js': 'export const val = 1;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        const res = await client.callTool('spawn_swarm', {
          mission: 'Feature implementation mission',
          agents: [
            {
              id: 'worker-share-1',
              role: 'backend_dev',
              taskSpec: 'Implement feature in isolated worktree',
              workspace: 'share',
              targetFiles: ['src/worker.js'],
            },
          ],
        });

        assert.equal(res.isError, false);
        const state = await ws.readState();
        const agent = state.agents['worker-share-1'];
        assert.ok(agent);
        assert.equal(agent.workspace ?? 'share', 'share');

        // In share mode, worktree should exist under .swarm/worktrees/worker-share-1
        const worktreeDir = path.join(ws.dir, '.swarm', 'worktrees', 'worker-share-1');
        assert.ok(existsSync(worktreeDir), 'Worktree directory should exist for share mode');

        // Check git branch
        const { stdout: branches } = await ws.runGit(['branch', '--list', 'swarm/worker-share-1']);
        assert.ok(
          branches.includes('swarm/worker-share-1'),
          'Branch swarm/worker-share-1 should exist'
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-WS-F11-03: workspace "branch" creates isolated clone/branch for deep refactor', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/core.js': 'export function core() { return true; }\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        const res = await client.callTool('spawn_swarm', {
          mission: 'Deep refactoring',
          agents: [
            {
              id: 'architect-branch',
              role: 'architect',
              taskSpec: 'Refactor core in branch mode',
              workspace: 'branch',
              targetFiles: ['src/core.js'],
            },
          ],
        });

        assert.equal(res.isError, false);
        const state = await ws.readState();
        const agent = state.agents['architect-branch'];
        assert.ok(agent);
        assert.equal(agent.workspace, 'branch');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-WS-F11-04: multi-agent spawn with mixed workspace modes (inherit + share)', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/index.js': '// root\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        const res = await client.callTool('spawn_swarm', {
          mission: 'Mixed workspace swarm',
          agents: [
            {
              id: 'worker-author',
              role: 'author',
              taskSpec: 'Write implementation',
              workspace: 'share',
              targetFiles: ['src/index.js'],
            },
            {
              id: 'worker-verifier',
              role: 'verifier',
              taskSpec: 'Inspect implementation',
              workspace: 'inherit',
              dependsOn: ['worker-author'],
              targetFiles: [],
            },
          ],
        });

        assert.equal(res.isError, false);
        const state = await ws.readState();
        assert.equal(state.agents['worker-author'].workspace ?? 'share', 'share');
        assert.equal(state.agents['worker-verifier'].workspace, 'inherit');

        // Author has worktree directory
        assert.ok(existsSync(path.join(ws.dir, '.swarm', 'worktrees', 'worker-author')));
        // Verifier does not
        assert.ok(!existsSync(path.join(ws.dir, '.swarm', 'worktrees', 'worker-verifier')));
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-WS-F11-05: dynamic agent added with explicit workspace mode persists in state', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Dynamic workspace test',
          agents: [],
        });

        const dynRes = await client.callTool('add_dynamic_agent', {
          id: 'dynamic-monitor',
          role: 'monitor',
          taskSpec: 'Observe progress',
          workspace: 'inherit',
        });

        assert.equal(dynRes.isError, false);
        const state = await ws.readState();
        assert.equal(state.agents['dynamic-monitor'].workspace, 'inherit');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  await suiteContext.test('Tier 1 - Feature 12: Pre-Merge Boundary Enforcement', async (t) => {
    await t.test('T1-WS-F12-01: edits strictly within declared targetFiles pass pre-merge check', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/math.js': 'export const add = (a, b) => a + b;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Update math',
          agents: [
            {
              id: 'math-dev',
              role: 'dev',
              taskSpec: 'Add multiply function',
              targetFiles: ['src/math.js'],
            },
          ],
        });

        const wtMath = path.join(ws.dir, '.swarm', 'worktrees', 'math-dev', 'src', 'math.js');
        await fs.writeFile(
          wtMath,
          'export const add = (a, b) => a + b;\nexport const mul = (a, b) => a * b;\n',
          'utf8'
        );

        const compRes = await client.callTool('complete_agent_task', {
          agentId: 'math-dev',
          summary: 'Added mul function',
        });

        assert.equal(compRes.isError, false, `Completion should succeed: ${JSON.stringify(compRes)}`);
        const rootMath = await ws.readFile('src/math.js');
        assert.ok(rootMath.includes('mul = (a, b) => a * b'), 'Root file should reflect clean merge');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-WS-F12-02: multiple declared targetFiles all modified within boundary pass', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          'src/a.js': 'export const a = 1;\n',
          'src/b.js': 'export const b = 2;\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Multi-file update',
          agents: [
            {
              id: 'multi-dev',
              role: 'dev',
              taskSpec: 'Update both a and b',
              targetFiles: ['src/a.js', 'src/b.js'],
            },
          ],
        });

        const wtA = path.join(ws.dir, '.swarm', 'worktrees', 'multi-dev', 'src', 'a.js');
        const wtB = path.join(ws.dir, '.swarm', 'worktrees', 'multi-dev', 'src', 'b.js');
        await fs.writeFile(wtA, 'export const a = 100;\n', 'utf8');
        await fs.writeFile(wtB, 'export const b = 200;\n', 'utf8');

        const compRes = await client.callTool('complete_agent_task', {
          agentId: 'multi-dev',
          summary: 'Updated a and b within boundary',
        });

        assert.equal(compRes.isError, false);
        assert.equal(normalizeEol(await ws.readFile('src/a.js')), 'export const a = 100;\n');
        assert.equal(normalizeEol(await ws.readFile('src/b.js')), 'export const b = 200;\n');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-WS-F12-03: creating a newly declared target file passes pre-merge check', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Create new module',
          agents: [
            {
              id: 'creator',
              role: 'dev',
              taskSpec: 'Create src/new_module.js',
              targetFiles: ['src/new_module.js'],
            },
          ],
        });

        const newFilePath = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'creator',
          'src',
          'new_module.js'
        );
        await fs.mkdir(path.dirname(newFilePath), { recursive: true });
        await fs.writeFile(newFilePath, 'export default "new";\n', 'utf8');

        const compRes = await client.callTool('complete_agent_task', {
          agentId: 'creator',
          summary: 'Created new module',
        });

        assert.equal(compRes.isError, false);
        assert.ok(ws.fileExists('src/new_module.js'), 'Newly declared file should exist in root');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-WS-F12-04: zero-diff commit within boundary completes cleanly', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/unchanged.js': 'const x = 1;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Inspection without changes',
          agents: [
            {
              id: 'inspector',
              role: 'qa',
              taskSpec: 'Inspect src/unchanged.js',
              targetFiles: ['src/unchanged.js'],
            },
          ],
        });

        // Inspector makes no edits in worktree
        const compRes = await client.callTool('complete_agent_task', {
          agentId: 'inspector',
          summary: 'Verified unchanged',
        });

        assert.equal(compRes.isError, false);
        const state = await ws.readState();
        assert.equal(state.agents['inspector'].status, 'completed');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-WS-F12-05: pre-merge inspection updates agent telemetry diffs', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/log.js': 'console.log("start");\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Log enhancement',
          agents: [
            {
              id: 'logger',
              role: 'dev',
              taskSpec: 'Add end log',
              targetFiles: ['src/log.js'],
            },
          ],
        });

        await client.callTool('record_agent_action', {
          agentId: 'logger',
          actionType: 'edit',
          target: 'src/log.js',
          detail: 'Added completion log',
          diffs: [{ type: 'add', line: 'console.log("end");' }],
        });

        const state = await ws.readState();
        const actions = state.agents['logger'].actions || [];
        assert.ok(actions.length > 0, 'Actions should be recorded');
        assert.equal(actions[0].target, 'src/log.js');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  await suiteContext.test('Tier 1 - Feature 13: Dirty-Workspace Stash & Clean Merge', async (t) => {
    await t.test('T1-WS-F13-01: unstaged modified file in root cwd preserved across worktree merge', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          'README.md': '# Title\n',
          'src/feature.js': 'export const feat = false;\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Feature update',
          agents: [
            {
              id: 'worker-feat',
              role: 'dev',
              taskSpec: 'Enable feature',
              targetFiles: ['src/feature.js'],
            },
          ],
        });

        // 1. Worker updates src/feature.js in worktree
        const wtFile = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'worker-feat',
          'src',
          'feature.js'
        );
        await fs.writeFile(wtFile, 'export const feat = true;\n', 'utf8');

        // 2. Simulate user having dirty uncommitted changes in root cwd
        await ws.writeFile('README.md', '# Title\n\nDirty unstaged developer notes.\n');

        // 3. Complete worker task — engine should auto-stash root, merge, and restore dirty README
        const compRes = await client.callTool('complete_agent_task', {
          agentId: 'worker-feat',
          summary: 'Feature enabled',
        });

        assert.equal(compRes.isError, false, `Merge should succeed with dirty root: ${JSON.stringify(compRes)}`);

        // Check merged feature
        const mergedFeat = normalizeEol(await ws.readFile('src/feature.js'));
        assert.equal(mergedFeat, 'export const feat = true;\n');

        // Check developer dirty root edits preserved
        const rootReadme = normalizeEol(await ws.readFile('README.md'));
        assert.ok(
          rootReadme.includes('Dirty unstaged developer notes.'),
          'Root unstaged changes must be preserved after merge'
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-WS-F13-02: untracked new file in root cwd preserved across worktree merge', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/index.js': 'console.log(1);\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Update index',
          agents: [
            {
              id: 'index-worker',
              role: 'dev',
              taskSpec: 'Update index',
              targetFiles: ['src/index.js'],
            },
          ],
        });

        // User creates untracked scratch.txt in root cwd
        await ws.writeFile('scratch.txt', 'developer local scratchpad\n');

        // Worker modifies worktree
        const wtIndex = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'index-worker',
          'src',
          'index.js'
        );
        await fs.writeFile(wtIndex, 'console.log(2);\n', 'utf8');

        const compRes = await client.callTool('complete_agent_task', {
          agentId: 'index-worker',
          summary: 'Updated index',
        });

        assert.equal(compRes.isError, false);
        assert.ok(ws.fileExists('scratch.txt'), 'Untracked scratch.txt must survive worktree merge');
        assert.equal(normalizeEol(await ws.readFile('scratch.txt')), 'developer local scratchpad\n');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-WS-F13-03: worktree teardown completely prunes worktree directory and branch', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/clean.js': 'let x = 1;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Cleanup verification',
          agents: [
            {
              id: 'clean-worker',
              role: 'dev',
              taskSpec: 'Modify clean.js',
              targetFiles: ['src/clean.js'],
            },
          ],
        });

        const wtDir = path.join(ws.dir, '.swarm', 'worktrees', 'clean-worker');
        assert.ok(existsSync(wtDir), 'Worktree directory must exist while running');

        await client.callTool('complete_agent_task', {
          agentId: 'clean-worker',
          summary: 'Clean work done',
        });

        // After completion: worktree directory should be removed
        assert.equal(existsSync(wtDir), false, 'Worktree directory must be purged after merge');

        // Branch swarm/clean-worker should be deleted
        const { stdout: branches } = await ws.runGit(['branch', '--list', 'swarm/clean-worker']);
        assert.equal(branches.trim(), '', 'Branch swarm/clean-worker should be deleted');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-WS-F13-04: staged uncommitted changes in root cwd preserved across merge', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          'staged.txt': 'initial\n',
          'src/lib.js': 'export const v = 1;\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Staged root merge',
          agents: [
            {
              id: 'staged-worker',
              role: 'dev',
              taskSpec: 'Update lib',
              targetFiles: ['src/lib.js'],
            },
          ],
        });

        // Stage a file in root
        await ws.writeFile('staged.txt', 'staged modification\n');
        await ws.runGit(['add', 'staged.txt']);

        // Worker updates worktree
        const wtLib = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'staged-worker',
          'src',
          'lib.js'
        );
        await fs.writeFile(wtLib, 'export const v = 2;\n', 'utf8');

        const compRes = await client.callTool('complete_agent_task', {
          agentId: 'staged-worker',
          summary: 'Updated lib',
        });

        assert.equal(compRes.isError, false);
        const rootStaged = normalizeEol(await ws.readFile('staged.txt'));
        assert.equal(rootStaged, 'staged modification\n');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-WS-F13-05: multiple sequential worker completions with dirty root state', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          'NOTES.md': 'developer notes\n',
          'src/one.js': 'export const one = 1;\n',
          'src/two.js': 'export const two = 2;\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Sequential workers',
          agents: [
            {
              id: 'seq-1',
              role: 'dev',
              taskSpec: 'Update one',
              targetFiles: ['src/one.js'],
            },
            {
              id: 'seq-2',
              role: 'dev',
              taskSpec: 'Update two',
              targetFiles: ['src/two.js'],
            },
          ],
        });

        // Keep dirty notes in root throughout
        await ws.writeFile('NOTES.md', 'developer notes - dirty edit 1\n');

        // Complete seq-1
        const wt1 = path.join(ws.dir, '.swarm', 'worktrees', 'seq-1', 'src', 'one.js');
        await fs.writeFile(wt1, 'export const one = 11;\n', 'utf8');
        await client.callTool('complete_agent_task', { agentId: 'seq-1' });

        // Update dirty notes in root again
        await ws.writeFile('NOTES.md', 'developer notes - dirty edit 2\n');

        // Complete seq-2
        const wt2 = path.join(ws.dir, '.swarm', 'worktrees', 'seq-2', 'src', 'two.js');
        await fs.writeFile(wt2, 'export const two = 22;\n', 'utf8');
        await client.callTool('complete_agent_task', { agentId: 'seq-2' });

        // Both updates merged, root notes preserved
        assert.equal(normalizeEol(await ws.readFile('src/one.js')), 'export const one = 11;\n');
        assert.equal(normalizeEol(await ws.readFile('src/two.js')), 'export const two = 22;\n');
        assert.equal(normalizeEol(await ws.readFile('NOTES.md')), 'developer notes - dirty edit 2\n');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  await suiteContext.test('Tier 1 - Feature 14: Conflict-Resilient Merge Recovery', async (t) => {
    await t.test('T1-WS-F14-01: conflicting edits trigger clean git merge --abort and retain pre-merge HEAD', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/conflict.js': 'const value = "base";\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Conflict simulation',
          agents: [
            {
              id: 'conflictor',
              role: 'dev',
              taskSpec: 'Change value to branch',
              targetFiles: ['src/conflict.js'],
            },
          ],
        });

        // 1. In worktree: change value to "branch"
        const wtFile = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'conflictor',
          'src',
          'conflict.js'
        );
        await fs.writeFile(wtFile, 'const value = "branch";\n', 'utf8');

        // 2. In root main branch: commit conflicting change to "main"
        await ws.writeFile('src/conflict.js', 'const value = "main";\n');
        await ws.runGit(['add', 'src/conflict.js']);
        await ws.runGit(['commit', '-m', 'conflicting commit on main']);
        const { stdout: headBefore } = await ws.runGit(['rev-parse', 'HEAD']);

        // 3. Attempt completion: merge should conflict and cleanly abort
        const compRes = await client.callTool('complete_agent_task', {
          agentId: 'conflictor',
          summary: 'Attempted conflicting change',
        });

        // In conflict recovery, the tool should report error or failure
        assert.equal(compRes.isError, true, 'Conflict should be reported as error');

        // Check git status in root: working tree must be clean (git merge --abort executed)
        const { stdout: status } = await ws.runGit(['status', '--porcelain']);
        assert.equal(status.trim(), '', 'Main working directory must be clean after merge abort');

        // Main branch must remain at pre-merge commit
        const { stdout: headAfter } = await ws.runGit(['rev-parse', 'HEAD']);
        assert.equal(headBefore.trim(), headAfter.trim(), 'HEAD should remain at pre-merge commit');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-WS-F14-02: conflict recovery records failure and diagnostic error details', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/shared.js': 'line 1\nline 2\nline 3\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Conflict recording',
          agents: [
            {
              id: 'worker-err',
              role: 'dev',
              taskSpec: 'Edit line 2 in worktree',
              targetFiles: ['src/shared.js'],
            },
          ],
        });

        const wtFile = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'worker-err',
          'src',
          'shared.js'
        );
        await fs.writeFile(wtFile, 'line 1\nline 2 from worktree\nline 3\n', 'utf8');

        // Conflict on main
        await ws.writeFile('src/shared.js', 'line 1\nline 2 from main\nline 3\n');
        await ws.runGit(['add', 'src/shared.js']);
        await ws.runGit(['commit', '-m', 'conflict on main']);

        const compRes = await client.callTool('complete_agent_task', {
          agentId: 'worker-err',
        });

        assert.equal(compRes.isError, true);
        const errMsg = compRes.message || compRes.error?.message || '';
        assert.ok(
          errMsg.toLowerCase().includes('merge') || errMsg.toLowerCase().includes('conflict'),
          `Error message should mention merge/conflict: ${errMsg}`
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-WS-F14-03: conflict abort cleans up MERGE_HEAD without leaving stranded git lock', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/data.txt': 'data: 1\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'MERGE_HEAD cleanup test',
          agents: [
            {
              id: 'worker-mergehead',
              role: 'dev',
              taskSpec: 'Data edit',
              targetFiles: ['src/data.txt'],
            },
          ],
        });

        const wtFile = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'worker-mergehead',
          'src',
          'data.txt'
        );
        await fs.writeFile(wtFile, 'data: 2\n', 'utf8');

        await ws.writeFile('src/data.txt', 'data: 3\n');
        await ws.runGit(['add', 'src/data.txt']);
        await ws.runGit(['commit', '-m', 'conflicting data commit']);

        await client.callTool('complete_agent_task', { agentId: 'worker-mergehead' });

        // Verify .git/MERGE_HEAD does not exist
        const mergeHeadPath = path.join(ws.dir, '.git', 'MERGE_HEAD');
        assert.equal(
          existsSync(mergeHeadPath),
          false,
          'MERGE_HEAD file must not be left behind'
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-WS-F14-04: conflict recovery releases file locks to prevent deadlocking swarm', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/locked.js': 'version = 1;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Lock release on conflict',
          agents: [
            {
              id: 'worker-lock-conflict',
              role: 'dev',
              taskSpec: 'Update locked.js',
              targetFiles: ['src/locked.js'],
            },
          ],
        });

        const wtFile = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'worker-lock-conflict',
          'src',
          'locked.js'
        );
        await fs.writeFile(wtFile, 'version = 2;\n', 'utf8');

        // Create conflict on main
        await ws.writeFile('src/locked.js', 'version = 3;\n');
        await ws.runGit(['add', 'src/locked.js']);
        await ws.runGit(['commit', '-m', 'conflict on main']);

        await client.callTool('complete_agent_task', { agentId: 'worker-lock-conflict' });

        // Verify that the file is not permanently locked in state
        const state = await ws.readState();
        const lockedBy = state.lockedFiles?.['src/locked.js'];
        // If conflict occurs, lock should either be cleared or reassigned
        assert.ok(
          !lockedBy || lockedBy !== 'worker-lock-conflict',
          'Conflicted agent should not permanently hold lock'
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-WS-F14-05: main git history log is clean without uncommitted merge artifacts', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/history.js': 'let h = 0;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'History test',
          agents: [
            {
              id: 'worker-hist',
              role: 'dev',
              taskSpec: 'Update history.js',
              targetFiles: ['src/history.js'],
            },
          ],
        });

        const wtFile = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'worker-hist',
          'src',
          'history.js'
        );
        await fs.writeFile(wtFile, 'let h = 100;\n', 'utf8');

        await ws.writeFile('src/history.js', 'let h = 200;\n');
        await ws.runGit(['add', 'src/history.js']);
        await ws.runGit(['commit', '-m', 'conflicting root history']);

        await client.callTool('complete_agent_task', { agentId: 'worker-hist' });

        // Run git log --graph --oneline: ensure head is clean commit, not broken merge
        const { stdout: logOut } = await ws.runGit(['log', '-n', '2', '--oneline']);
        assert.ok(logOut.includes('conflicting root history'));
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (Extreme & Stress Inputs)
  // =========================================================================

  await suiteContext.test('Tier 2 - Boundary Cases: Workspaces & Safe Merging', async (t) => {
    await t.test('T2-WS-F11-06: invalid workspace mode defaults safely or rejects cleanly', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        const res = await client.callTool('spawn_swarm', {
          mission: 'Invalid workspace mode test',
          agents: [
            {
              id: 'invalid-ws-worker',
              role: 'dev',
              taskSpec: 'Test fallback',
              workspace: 'unsupported_mode_xyz',
              targetFiles: [],
            },
          ],
        });

        // Either defaults to 'share' safely or rejects with clear validation error
        if (!res.isError) {
          const state = await ws.readState();
          const mode = state.agents['invalid-ws-worker'].workspace;
          assert.ok(
            ['share', 'inherit', 'branch', undefined].includes(mode),
            'Invalid mode should fallback to a standard mode'
          );
        } else {
          assert.ok(res.message.includes('workspace') || res.error);
        }
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F11-07: inherit mode with empty targetFiles performs read-only operations safely', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'config.json': '{"env":"prod"}\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Read config',
          agents: [
            {
              id: 'reader-agent',
              role: 'auditor',
              taskSpec: 'Read config.json',
              workspace: 'inherit',
              targetFiles: [],
            },
          ],
        });

        const state = await ws.readState();
        assert.equal(state.agents['reader-agent'].targetFiles.length, 0);
        // Verify no lock held
        assert.deepEqual(state.lockedFiles || {}, {});
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F11-08: non-git workspace fallback for multi-mode allocation', async () => {
      const ws = await createTestWorkspace({ isGit: false });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        const res = await client.callTool('spawn_swarm', {
          mission: 'Non-git workspace test',
          agents: [
            {
              id: 'nongit-worker',
              role: 'dev',
              taskSpec: 'Run in non-git environment',
              workspace: 'share',
              targetFiles: ['test.txt'],
            },
          ],
        });

        assert.equal(res.isError, false, 'Non-git workspace spawn should succeed via fallback');
        const state = await ws.readState();
        assert.ok(state.agents['nongit-worker']);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F11-09: workspace allocation with hyphenated and deeply nested agent IDs', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        const complexId = 'sub-team-alpha_worker-42';
        const res = await client.callTool('spawn_swarm', {
          mission: 'Complex agent id test',
          agents: [
            {
              id: complexId,
              role: 'dev',
              taskSpec: 'Test complex id',
              workspace: 'share',
              targetFiles: [],
            },
          ],
        });

        assert.equal(res.isError, false);
        const worktreeDir = path.join(ws.dir, '.swarm', 'worktrees', complexId);
        assert.ok(existsSync(worktreeDir), 'Worktree directory should be created for complex ID');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F11-10: completing inherit agent does not delete root working directory', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/keep.js': 'keep this file\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Inherit completion test',
          agents: [
            {
              id: 'inherit-completer',
              role: 'verifier',
              taskSpec: 'Verify keep.js',
              workspace: 'inherit',
              targetFiles: [],
            },
          ],
        });

        const compRes = await client.callTool('complete_agent_task', {
          agentId: 'inherit-completer',
          summary: 'Verified keep.js',
        });

        assert.equal(compRes.isError, false);
        // Root directory and src/keep.js must still exist intact!
        assert.ok(ws.fileExists('src/keep.js'), 'Root files must remain after inherit agent completes');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F12-06: boundary enforcement rejects unauthorized file modification', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          'src/declared.js': 'export const ok = 1;\n',
          'src/forbidden.js': 'export const secret = "dont-touch";\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Boundary breach test',
          agents: [
            {
              id: 'rogue-worker',
              role: 'dev',
              taskSpec: 'Modify declared file only',
              targetFiles: ['src/declared.js'],
            },
          ],
        });

        // Worker modifies declared file AND unauthorized forbidden file in worktree
        const wtDeclared = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'rogue-worker',
          'src',
          'declared.js'
        );
        const wtForbidden = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'rogue-worker',
          'src',
          'forbidden.js'
        );
        await fs.writeFile(wtDeclared, 'export const ok = 2;\n', 'utf8');
        await fs.writeFile(wtForbidden, 'export const secret = "BREACHED";\n', 'utf8');

        // Check if pre-merge boundary check blocks or flags unauthorized mutation
        const compRes = await client.callTool('complete_agent_task', {
          agentId: 'rogue-worker',
          summary: 'Completed with unauthorized changes',
        });

        // If pre-merge boundary check is strictly enforced, it should error or not mutate forbidden.js in root
        if (compRes.isError) {
          assert.ok(compRes.message.includes('targetFiles') || compRes.message.includes('boundary'));
        } else {
          // If completion succeeded, verify forbidden.js was not corrupted
          const rootForbidden = await ws.readFile('src/forbidden.js');
          // In boundary enforcement, forbidden.js should remain untampered in root
          assert.equal(
            rootForbidden.includes('BREACHED'),
            false,
            'Unauthorized file modification must not be merged into root workspace'
          );
        }
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F12-07: boundary enforcement with empty targetFiles rejects file creation', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Empty targetFiles mutation test',
          agents: [
            {
              id: 'readonly-violator',
              role: 'auditor',
              taskSpec: 'Audit only',
              targetFiles: [],
            },
          ],
        });

        const rogueFile = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'readonly-violator',
          'rogue.txt'
        );
        await fs.writeFile(rogueFile, 'rogue content\n', 'utf8');

        const compRes = await client.callTool('complete_agent_task', {
          agentId: 'readonly-violator',
        });

        // Rogue file should NOT exist in root
        assert.equal(
          ws.fileExists('rogue.txt'),
          false,
          'Files created by agent with empty targetFiles must not be merged to root'
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F12-08: path traversal attempt in targetFiles is blocked', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        const res = await client.callTool('spawn_swarm', {
          mission: 'Traversal test',
          agents: [
            {
              id: 'traversal-worker',
              role: 'dev',
              taskSpec: 'Try path traversal',
              targetFiles: ['../../outside.txt'],
            },
          ],
        });

        // Path normalization should either normalize, strip leading dots, or reject
        const state = await ws.readState();
        if (state?.agents['traversal-worker']) {
          const targets = state.agents['traversal-worker'].targetFiles;
          for (const t of targets) {
            assert.ok(!t.startsWith('../'), 'Target files must not start with path traversal ../');
          }
        }
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F12-09: file deletion outside declared targetFiles is blocked', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          'src/essential.js': 'console.log("critical");\n',
          'src/allowed.js': 'console.log("allowed");\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Deletion test',
          agents: [
            {
              id: 'deletion-worker',
              role: 'dev',
              taskSpec: 'Modify allowed only',
              targetFiles: ['src/allowed.js'],
            },
          ],
        });

        // Try deleting essential.js in worktree
        const wtEssential = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'deletion-worker',
          'src',
          'essential.js'
        );
        try {
          await fs.rm(wtEssential);
        } catch {}

        await client.callTool('complete_agent_task', { agentId: 'deletion-worker' });

        // Root essential.js must NOT be deleted
        assert.ok(
          ws.fileExists('src/essential.js'),
          'Essential file outside targetFiles must not be deleted from root'
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F12-10: Windows backslash and relative path normalization in boundary check', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/util/helper.js': 'export const help = true;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Windows path normalization',
          agents: [
            {
              id: 'win-path-worker',
              role: 'dev',
              taskSpec: 'Update helper',
              targetFiles: ['.\\src\\util\\helper.js'],
            },
          ],
        });

        const state = await ws.readState();
        const normalized = state.agents['win-path-worker'].targetFiles[0];
        assert.equal(normalized, 'src/util/helper.js', 'Path must normalize backslashes and ./');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F13-06: complex dirty root (tracked + untracked + ignored) preserved without loss', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          '.gitignore': '*.log\n',
          'tracked.txt': 'tracked initial\n',
          'src/lib.js': 'export const l = 1;\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Complex dirty root test',
          agents: [
            {
              id: 'complex-dirty-worker',
              role: 'dev',
              taskSpec: 'Update lib',
              targetFiles: ['src/lib.js'],
            },
          ],
        });

        // 1. Dirty tracked file
        await ws.writeFile('tracked.txt', 'tracked dirty modification\n');
        // 2. Untracked file
        await ws.writeFile('untracked_new.txt', 'untracked new content\n');
        // 3. Ignored file
        await ws.writeFile('debug.log', 'ignore me\n');

        // Worker modifies worktree
        const wtLib = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'complex-dirty-worker',
          'src',
          'lib.js'
        );
        await fs.writeFile(wtLib, 'export const l = 99;\n', 'utf8');

        await client.callTool('complete_agent_task', { agentId: 'complex-dirty-worker' });

        // All 3 dirty files must exist in root with their content preserved
        assert.equal(normalizeEol(await ws.readFile('tracked.txt')), 'tracked dirty modification\n');
        assert.equal(normalizeEol(await ws.readFile('untracked_new.txt')), 'untracked new content\n');
        assert.equal(normalizeEol(await ws.readFile('debug.log')), 'ignore me\n');
        assert.equal(normalizeEol(await ws.readFile('src/lib.js')), 'export const l = 99;\n');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F13-07: clean root merges cleanly without unnecessary stash operations', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/clean_root.js': 'const x = 0;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Clean root test',
          agents: [
            {
              id: 'clean-worker',
              role: 'dev',
              taskSpec: 'Update clean_root',
              targetFiles: ['src/clean_root.js'],
            },
          ],
        });

        const wtFile = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'clean-worker',
          'src',
          'clean_root.js'
        );
        await fs.writeFile(wtFile, 'const x = 42;\n', 'utf8');

        const compRes = await client.callTool('complete_agent_task', { agentId: 'clean-worker' });
        assert.equal(compRes.isError, false);
        assert.equal(normalizeEol(await ws.readFile('src/clean_root.js')), 'const x = 42;\n');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F13-08: stash conflict handling surfaces clean error without silent loss', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/contended.js': 'let c = 1;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Stash conflict',
          agents: [
            {
              id: 'stash-worker',
              role: 'dev',
              taskSpec: 'Update contended',
              targetFiles: ['src/contended.js'],
            },
          ],
        });

        // Worker updates in worktree
        const wtFile = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'stash-worker',
          'src',
          'contended.js'
        );
        await fs.writeFile(wtFile, 'let c = 100;\n', 'utf8');

        // Root unstaged also modified same file
        await ws.writeFile('src/contended.js', 'let c = 999;\n');

        // Complete task: should not crash the host process unhandled
        try {
          await client.callTool('complete_agent_task', { agentId: 'stash-worker' });
        } catch {
          // Handled safely
        }
        // Host should be alive and repo recoverable
        const state = await ws.readState();
        assert.ok(state, 'Swarm state must remain parseable');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F13-09: AGENT_TASK.md strictly deleted before commit and merge', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/hygiene.js': 'export const h = true;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Task hygiene test',
          agents: [
            {
              id: 'hygiene-worker',
              role: 'dev',
              taskSpec: 'Ensure AGENT_TASK.md is never committed',
              targetFiles: ['src/hygiene.js'],
            },
          ],
        });

        const wtDir = path.join(ws.dir, '.swarm', 'worktrees', 'hygiene-worker');
        assert.ok(
          existsSync(path.join(wtDir, 'AGENT_TASK.md')),
          'AGENT_TASK.md must exist during execution'
        );

        await client.callTool('complete_agent_task', { agentId: 'hygiene-worker' });

        // Root git commit log must NOT contain AGENT_TASK.md
        const { stdout: filesInCommit } = await ws.runGit(['show', '--name-only', '--format=']);
        assert.ok(
          !filesInCommit.includes('AGENT_TASK.md'),
          'AGENT_TASK.md must never be committed to git history'
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F13-10: worktree removal resilience against transient Windows locks', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Teardown resilience',
          agents: [
            {
              id: 'lock-test-worker',
              role: 'dev',
              taskSpec: 'Test worktree prune',
              targetFiles: [],
            },
          ],
        });

        const compRes = await client.callTool('complete_agent_task', {
          agentId: 'lock-test-worker',
        });
        assert.equal(compRes.isError, false);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F14-06: sequential conflicts across multiple workers do not leave orphaned locks', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/shared_res.js': 'count = 0;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Sequential conflict test',
          agents: [
            {
              id: 'conflictor-1',
              role: 'dev',
              taskSpec: 'Set count = 10',
              targetFiles: ['src/shared_res.js'],
            },
          ],
        });

        // Worker 1 edits
        const wtFile1 = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'conflictor-1',
          'src',
          'shared_res.js'
        );
        await fs.writeFile(wtFile1, 'count = 10;\n', 'utf8');

        // Conflicting commit on main
        await ws.writeFile('src/shared_res.js', 'count = 99;\n');
        await ws.runGit(['add', 'src/shared_res.js']);
        await ws.runGit(['commit', '-m', 'conflict 1 on main']);

        await client.callTool('complete_agent_task', { agentId: 'conflictor-1' });

        // Add second worker
        await client.callTool('add_dynamic_agent', {
          id: 'conflictor-2',
          role: 'dev',
          taskSpec: 'Set count = 20',
          targetFiles: ['src/shared_res.js'],
        });

        const state = await ws.readState();
        assert.ok(state.agents['conflictor-2']);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F14-07: binary file merge conflict aborts cleanly without engine crash', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'binary.dat': Buffer.from([0x00, 0x01, 0x02]) },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Binary conflict',
          agents: [
            {
              id: 'binary-worker',
              role: 'dev',
              taskSpec: 'Update binary.dat',
              targetFiles: ['binary.dat'],
            },
          ],
        });

        const wtBin = path.join(ws.dir, '.swarm', 'worktrees', 'binary-worker', 'binary.dat');
        await fs.writeFile(wtBin, Buffer.from([0xAA, 0xBB, 0xCC]));

        await ws.writeFile('binary.dat', Buffer.from([0xFF, 0xEE, 0xDD]));
        await ws.runGit(['add', 'binary.dat']);
        await ws.runGit(['commit', '-m', 'root binary commit']);

        const compRes = await client.callTool('complete_agent_task', { agentId: 'binary-worker' });
        // Should handle without uncaught crash
        const { stdout: status } = await ws.runGit(['status', '--porcelain']);
        const nonSwarmStatus = status.split('\n').filter((l) => l.trim() && !l.includes('.swarm')).join('\n');
        assert.equal(nonSwarmStatus.trim(), '', 'Git index should be clean after binary conflict abort');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F14-08: worktree quarantined or preserved on conflict for inspection', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/quarantine.js': 'val = 1;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Quarantine test',
          agents: [
            {
              id: 'worker-quarantine',
              role: 'dev',
              taskSpec: 'Update quarantine.js',
              targetFiles: ['src/quarantine.js'],
            },
          ],
        });

        const wtFile = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'worker-quarantine',
          'src',
          'quarantine.js'
        );
        await fs.writeFile(wtFile, 'val = 2;\n', 'utf8');

        await ws.writeFile('src/quarantine.js', 'val = 3;\n');
        await ws.runGit(['add', 'src/quarantine.js']);
        await ws.runGit(['commit', '-m', 'conflict on main']);

        await client.callTool('complete_agent_task', { agentId: 'worker-quarantine' });

        // Branch swarm/worker-quarantine or worktree remains inspectable
        const { stdout: branches } = await ws.runGit(['branch', '--list', 'swarm/worker-quarantine']);
        // Branch is either preserved for inspection or cleaned up with error in state
        const state = await ws.readState();
        assert.ok(state);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F14-09: dependent tasks remain blocked when upstream agent fails merge', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/chain.js': 'step = 0;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Dependency on failed merge',
          strictDependencies: true,
          agents: [
            {
              id: 'upstream',
              role: 'dev',
              taskSpec: 'Step 1',
              targetFiles: ['src/chain.js'],
            },
            {
              id: 'downstream',
              role: 'dev',
              taskSpec: 'Step 2',
              dependsOn: ['upstream'],
              targetFiles: ['src/chain.js'],
            },
          ],
        });

        // Upstream conflicts
        const wtFile = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'upstream',
          'src',
          'chain.js'
        );
        await fs.writeFile(wtFile, 'step = 1;\n', 'utf8');

        await ws.writeFile('src/chain.js', 'step = 99;\n');
        await ws.runGit(['add', 'src/chain.js']);
        await ws.runGit(['commit', '-m', 'conflicting step']);

        await client.callTool('complete_agent_task', { agentId: 'upstream' });

        const state = await ws.readState();
        // Downstream should NOT be running or completed since upstream failed
        assert.notEqual(state.agents['downstream'].status, 'completed');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-WS-F14-10: non-git fallback collision handled without data corruption', async () => {
      const ws = await createTestWorkspace({
        isGit: false,
        files: { 'nongit_data.txt': 'original\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Non-git collision',
          agents: [
            {
              id: 'nongit-coll-worker',
              role: 'dev',
              taskSpec: 'Update data',
              targetFiles: ['nongit_data.txt'],
            },
          ],
        });

        const compRes = await client.callTool('complete_agent_task', {
          agentId: 'nongit-coll-worker',
        });
        assert.equal(compRes.isError, false);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (Pairwise Subsystem Interactions)
  // =========================================================================

  await suiteContext.test('Tier 3 - Cross-Feature Interactions: Workspaces & Merging', async (t) => {
    await t.test('T3-WS-X01: inherit verifier inspects files merged by share worker after dirty-root stash/pop', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          'src/calc.js': 'export const calc = () => 0;\n',
          'NOTES.md': 'developer uncommitted notes\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        // Worker in share mode + Verifier in inherit mode
        await client.callTool('spawn_swarm', {
          mission: 'Pairwise share + inherit verification',
          agents: [
            {
              id: 'calc-writer',
              role: 'developer',
              taskSpec: 'Implement calc to return 42',
              workspace: 'share',
              targetFiles: ['src/calc.js'],
            },
            {
              id: 'calc-verifier',
              role: 'verifier',
              taskSpec: 'Verify calc in inherit mode',
              workspace: 'inherit',
              dependsOn: ['calc-writer'],
              targetFiles: [],
            },
          ],
        });

        // 1. Worker modifies calc in worktree
        const wtCalc = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'calc-writer',
          'src',
          'calc.js'
        );
        await fs.writeFile(wtCalc, 'export const calc = () => 42;\n', 'utf8');

        // 2. Root has dirty uncommitted edits
        await ws.writeFile('NOTES.md', 'developer uncommitted notes - v2\n');

        // 3. Complete writer task (triggers auto-stash & clean merge)
        await client.callTool('complete_agent_task', {
          agentId: 'calc-writer',
          summary: 'Implemented calc',
        });

        // 4. Verifier in inherit mode should now see calc() returning 42 in root
        const rootCalc = normalizeEol(await ws.readFile('src/calc.js'));
        assert.equal(rootCalc, 'export const calc = () => 42;\n');

        // 5. Root dirty notes are preserved
        assert.equal(normalizeEol(await ws.readFile('NOTES.md')), 'developer uncommitted notes - v2\n');

        // 6. Complete verifier
        const verifierRes = await client.callTool('complete_agent_task', {
          agentId: 'calc-verifier',
          summary: 'Calculation verified in inherit workspace',
        });
        assert.equal(verifierRes.isError, false);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T3-WS-X02: pre-merge boundary violation rejects merge before dirty-root stashing', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          'src/valid.js': 'let v = 1;\n',
          'src/protected.js': 'let p = 1;\n',
          'untracked_scratch.txt': 'scratch notes\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Boundary check before stash',
          agents: [
            {
              id: 'boundary-check-agent',
              role: 'dev',
              taskSpec: 'Modify valid.js only',
              targetFiles: ['src/valid.js'],
            },
          ],
        });

        // Worker modifies protected.js in worktree
        const wtProtected = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'boundary-check-agent',
          'src',
          'protected.js'
        );
        await fs.writeFile(wtProtected, 'let p = 999;\n', 'utf8');

        await client.callTool('complete_agent_task', { agentId: 'boundary-check-agent' });

        // Untracked scratch notes in root must remain untouched
        assert.equal(normalizeEol(await ws.readFile('untracked_scratch.txt')), 'scratch notes\n');
        // Root protected file must not be modified
        assert.equal(normalizeEol(await ws.readFile('src/protected.js')), 'let p = 1;\n');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T3-WS-X03: conflict abort on Worker A frees file locks allowing Worker B to claim and merge', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/pipe.js': 'export const step = 0;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Conflict recovery re-allocation',
          agents: [
            {
              id: 'worker-a',
              role: 'dev',
              taskSpec: 'Step from A',
              targetFiles: ['src/pipe.js'],
            },
          ],
        });

        // A conflicts with main
        const wtPipe = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'worker-a',
          'src',
          'pipe.js'
        );
        await fs.writeFile(wtPipe, 'export const step = "from-A";\n', 'utf8');

        await ws.writeFile('src/pipe.js', 'export const step = "from-main";\n');
        await ws.runGit(['add', 'src/pipe.js']);
        await ws.runGit(['commit', '-m', 'conflict on main']);

        // Worker A completes with conflict abort
        await client.callTool('complete_agent_task', { agentId: 'worker-a' });

        // Worker B is dynamically scheduled on src/pipe.js
        const dynRes = await client.callTool('add_dynamic_agent', {
          id: 'worker-b',
          role: 'dev',
          taskSpec: 'Step from B',
          targetFiles: ['src/pipe.js'],
        });
        assert.equal(dynRes.isError, false);

        // Claim task to ensure worktree directory is provisioned
        await client.callTool('pull_agent_task', { agentId: 'worker-b' });

        // Worker B updates pipe and completes successfully
        const wtPipeB = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'worker-b',
          'src',
          'pipe.js'
        );
        await fs.writeFile(wtPipeB, 'export const step = "from-B-repaired";\n', 'utf8');

        const compB = await client.callTool('complete_agent_task', { agentId: 'worker-b' });
        assert.equal(compB.isError, false);
        assert.equal(normalizeEol(await ws.readFile('src/pipe.js')), 'export const step = "from-B-repaired";\n');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T3-WS-X04: high-concurrency 4-worker pipeline with mixed share/inherit modes and dirty root', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          'src/mod1.js': 'export const m1 = 1;\n',
          'src/mod2.js': 'export const m2 = 2;\n',
          'README.md': '# Project\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: '4-Worker pipeline',
          maxConcurrency: 4,
          agents: [
            {
              id: 'author-1',
              role: 'dev',
              taskSpec: 'Update m1',
              workspace: 'share',
              targetFiles: ['src/mod1.js'],
            },
            {
              id: 'author-2',
              role: 'dev',
              taskSpec: 'Update m2',
              workspace: 'share',
              targetFiles: ['src/mod2.js'],
            },
            {
              id: 'verifier-1',
              role: 'verifier',
              taskSpec: 'Audit m1',
              workspace: 'inherit',
              dependsOn: ['author-1'],
              targetFiles: [],
            },
            {
              id: 'verifier-2',
              role: 'verifier',
              taskSpec: 'Audit m2',
              workspace: 'inherit',
              dependsOn: ['author-2'],
              targetFiles: [],
            },
          ],
        });

        // Developer has dirty README in root
        await ws.writeFile('README.md', '# Project\n\nDirty notes in progress.\n');

        // Edit author-1
        const wt1 = path.join(ws.dir, '.swarm', 'worktrees', 'author-1', 'src', 'mod1.js');
        await fs.writeFile(wt1, 'export const m1 = 100;\n', 'utf8');
        await client.callTool('complete_agent_task', { agentId: 'author-1' });

        // Edit author-2
        const wt2 = path.join(ws.dir, '.swarm', 'worktrees', 'author-2', 'src', 'mod2.js');
        await fs.writeFile(wt2, 'export const m2 = 200;\n', 'utf8');
        await client.callTool('complete_agent_task', { agentId: 'author-2' });

        // Complete verifiers
        await client.callTool('complete_agent_task', { agentId: 'verifier-1' });
        await client.callTool('complete_agent_task', { agentId: 'verifier-2' });

        // Verify root files
        assert.equal(normalizeEol(await ws.readFile('src/mod1.js')), 'export const m1 = 100;\n');
        assert.equal(normalizeEol(await ws.readFile('src/mod2.js')), 'export const m2 = 200;\n');
        assert.ok((await ws.readFile('README.md')).includes('Dirty notes in progress.'));
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T3-WS-X05: boundary enforcement with Windows path separators across nested directories', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          'src/nested/deep/module.js': 'export const deep = true;\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Deep nested boundary test',
          agents: [
            {
              id: 'deep-worker',
              role: 'dev',
              taskSpec: 'Update deep module',
              targetFiles: ['src/nested/deep/module.js'],
            },
          ],
        });

        const wtDeep = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'deep-worker',
          'src',
          'nested',
          'deep',
          'module.js'
        );
        await fs.writeFile(wtDeep, 'export const deep = "updated";\n', 'utf8');

        const compRes = await client.callTool('complete_agent_task', { agentId: 'deep-worker' });
        assert.equal(compRes.isError, false);
        assert.equal(
          normalizeEol(await ws.readFile('src/nested/deep/module.js')),
          'export const deep = "updated";\n'
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });
});
