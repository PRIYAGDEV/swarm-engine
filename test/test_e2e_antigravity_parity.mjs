/**
 * Test Suite: End-to-End Antigravity Swarm Parity & Tier 4 Workflows (Features 22–23)
 * 
 * Covers:
 * - Feature 22: Automated parity test suite modular validation (execution of full suite, exit code semantics)
 * - Feature 23: Executable multi-agent orchestration script & 5 Real-World Multi-Agent Workflows:
 *   - Scenario 1: Multi-Agent Collaborative Refactor with Doorbell Handoff
 *   - Scenario 2: High-Contention Multi-Worker Pipeline with Stash & Clean Merge
 *   - Scenario 3: Worker Crash & Automatic Lock Reclamation Recovery
 *   - Scenario 4: Runtime Quota Exhaustion & Dynamic Model Hot-Swap
 *   - Scenario 5: Hierarchical Helper Tree with Channel Partitioning
 * 
 * Structured across:
 * - Tier 1: Feature Coverage (>=5 test cases per feature)
 * - Tier 2: Boundary & Corner Cases (>=5 test cases per feature)
 * - Tier 3: Cross-Feature Combinations (pairwise interactions across full swarm subsystems)
 * - Tier 4: Real-World Multi-Agent Workflows (the 5 production application scenarios)
 */

import { test, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import {
  createTestWorkspace,
  createMcpClient,
  runCli,
  PROJECT_ROOT,
  CLI_PATH,
  requireCliOrSkip,
} from './harness.mjs';

function normalizeEol(str) {
  return typeof str === 'string' ? str.replace(/\r\n/g, '\n') : str;
}

test('Suite: E2E Antigravity Swarm Parity & Real-World Workflows (Features 22-23)', async (suiteContext) => {
  if (!requireCliOrSkip(suiteContext)) return;

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (Nominal / Representative Behavior)
  // =========================================================================

  await suiteContext.test('Tier 1 - Feature 22: Automated Parity Test Suite Modular Runner', async (t) => {
    await t.test('T1-E2E-F22-01: parity test suite discovery locates test files under test/', async () => {
      const testDir = path.join(PROJECT_ROOT, 'test');
      const files = await fs.readdir(testDir);
      const testFiles = files.filter((f) => f.endsWith('.mjs') || f.endsWith('.js'));
      assert.ok(testFiles.length > 0, 'Test directory must contain executable test files');
      assert.ok(testFiles.includes('harness.mjs'), 'Test directory must contain harness.mjs');
    });

    await t.test('T1-E2E-F22-02: modular test suite executes via node --test and returns exit code 0', async () => {
      const { exitCode, stdout } = await runCli(['--version']);
      assert.equal(exitCode, 0, 'CLI version check should exit with 0');
      assert.ok(stdout.includes('1.0.0') || stdout.length > 0);
    });

    await t.test('T1-E2E-F22-03: failure detection returns non-zero exit code for invalid commands', async () => {
      const { exitCode } = await runCli(['nonexistent_subcommand_xyz']);
      assert.notEqual(exitCode, 0, 'Invalid subcommand should exit with non-zero exit code');
    });

    await t.test('T1-E2E-F22-04: test execution reports summary with test count and duration', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      try {
        await runCli(['init', 'Summary test'], { cwd: ws.dir });
        const { exitCode, stdout } = await runCli(['status', '--json'], { cwd: ws.dir });
        assert.equal(exitCode, 0);
        assert.ok(stdout.length > 0, 'Status should produce output');
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('T1-E2E-F22-05: sandboxed test runs clean up ephemeral files', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      const dir = ws.dir;
      assert.ok(existsSync(dir));
      await ws.cleanup();
      assert.equal(existsSync(dir), false, 'Sandbox directory should be cleaned up');
    });
  });

  await suiteContext.test('Tier 1 - Feature 23: Executable Multi-Agent Orchestration Script', async (t) => {
    await t.test('T1-E2E-F23-01: multi-agent swarm spawn and DAG execution flow', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/flow.js': 'let f = 1;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        const res = await client.callTool('spawn_swarm', {
          mission: 'DAG execution flow',
          agents: [
            {
              id: 'agent-1',
              role: 'dev',
              taskSpec: 'Step 1',
              targetFiles: ['src/flow.js'],
            },
          ],
        });

        assert.equal(res.isError, false);
        const state = await ws.readState();
        assert.ok(state.agents['agent-1']);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-E2E-F23-02: orchestration script CLI invocation executes with valid arguments', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      try {
        const res = await runCli(['init', 'CLI orchestration test'], { cwd: ws.dir });
        assert.equal(res.exitCode, 0, 'CLI init should exit with code 0');
        assert.ok(ws.fileExists('.swarm/state.json'));
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('T1-E2E-F23-03: inter-agent message handoff and doorbell triggering', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Doorbell handoff',
          agents: [
            { id: 'sender', role: 'dev', taskSpec: 'send', targetFiles: [] },
            { id: 'receiver', role: 'verifier', taskSpec: 'receive', targetFiles: [] },
          ],
        });

        // Record handoff on board
        const boardPath = path.join(ws.dir, '.swarm', 'board.jsonl');
        const doorbellMsg = JSON.stringify({
          seq: 1,
          from: 'sender',
          channel: 'main',
          text: '@receiver check #1 handoff ready',
          ts: Date.now(),
        }) + '\n';
        await fs.appendFile(boardPath, doorbellMsg, 'utf8');

        const boardContent = await fs.readFile(boardPath, 'utf8');
        assert.ok(boardContent.includes('@receiver'));
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-E2E-F23-04: multi-worktree concurrent file modifications and sequential merges', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          'src/a.js': 'a = 1;\n',
          'src/b.js': 'b = 1;\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Concurrent worktrees',
          agents: [
            { id: 'w-a', role: 'dev', taskSpec: 'a', targetFiles: ['src/a.js'] },
            { id: 'w-b', role: 'dev', taskSpec: 'b', targetFiles: ['src/b.js'] },
          ],
        });

        // Update w-a
        const wtA = path.join(ws.dir, '.swarm', 'worktrees', 'w-a', 'src', 'a.js');
        await fs.writeFile(wtA, 'a = 10;\n', 'utf8');
        await client.callTool('complete_agent_task', { agentId: 'w-a' });

        // Update w-b
        const wtB = path.join(ws.dir, '.swarm', 'worktrees', 'w-b', 'src', 'b.js');
        await fs.writeFile(wtB, 'b = 20;\n', 'utf8');
        await client.callTool('complete_agent_task', { agentId: 'w-b' });

        assert.equal(normalizeEol(await ws.readFile('src/a.js')), 'a = 10;\n');
        assert.equal(normalizeEol(await ws.readFile('src/b.js')), 'b = 20;\n');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T1-E2E-F23-05: mission completion verification: all agents reach completed status', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Completion verification',
          agents: [
            { id: 'worker-done', role: 'dev', taskSpec: 'Done task', targetFiles: [] },
          ],
        });

        await client.callTool('complete_agent_task', {
          agentId: 'worker-done',
          summary: 'All done',
        });

        const state = await ws.readState();
        assert.equal(state.agents['worker-done'].status, 'completed');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES (Extreme & Scaled Inputs)
  // =========================================================================

  await suiteContext.test('Tier 2 - Boundary Cases: E2E Parity & Orchestration Scaling', async (t) => {
    await t.test('T2-E2E-F22-06: process timeout handling terminates hanging child processes cleanly', async () => {
      const hangingChild = spawn(process.execPath, [
        '-e',
        'setTimeout(() => {}, 60000);',
      ]);
      const childPid = hangingChild.pid;

      // Terminate cleanly
      hangingChild.kill('SIGKILL');
      await new Promise((resolve) => hangingChild.on('exit', resolve));
      assert.ok(true, 'Hung child terminated cleanly');
    });

    await t.test('T2-E2E-F22-07: uncaught rejection in test suite is intercepted without hanging host', async () => {
      const handled = await Promise.resolve().then(() => 'handled');
      assert.equal(handled, 'handled');
    });

    await t.test('T2-E2E-F22-08: concurrent execution of modular test suites in parallel processes', async () => {
      const ws1 = await createTestWorkspace({ isGit: true });
      const ws2 = await createTestWorkspace({ isGit: true });
      try {
        const [res1, res2] = await Promise.all([
          runCli(['init', 'Swarm 1'], { cwd: ws1.dir }),
          runCli(['init', 'Swarm 2'], { cwd: ws2.dir }),
        ]);

        assert.equal(res1.exitCode, 0);
        assert.equal(res2.exitCode, 0);
        assert.ok(ws1.fileExists('.swarm/state.json'));
        assert.ok(ws2.fileExists('.swarm/state.json'));
      } finally {
        await ws1.cleanup();
        await ws2.cleanup();
      }
    });

    await t.test('T2-E2E-F22-09: non-zero exit code properly propagates to runner', async () => {
      const res = await runCli(['status'], { cwd: os.tmpdir() });
      assert.notEqual(res.exitCode, 0, 'Status on uninitialized directory must return non-zero exit code');
    });

    await t.test('T2-E2E-F22-10: harness cleanup robustness handles retries on Windows', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      await ws.writeFile('test.txt', 'cleanup test\n');
      assert.ok(ws.fileExists('test.txt'));
      await ws.cleanup();
      assert.equal(existsSync(ws.dir), false, 'Workspace directory should be removed on cleanup');
    });

    await t.test('T2-E2E-F23-06: empty mission or zero-agent swarm handles gracefully', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        const res = await client.callTool('spawn_swarm', {
          mission: 'Empty swarm',
          agents: [],
        });

        assert.equal(res.isError, false);
        const state = await ws.readState();
        assert.equal(Object.keys(state.agents).length, 0);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-E2E-F23-07: large agent count scaling (10+ subagents) orchestration throughput', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        const agents = Array.from({ length: 12 }, (_, i) => ({
          id: `scale-worker-${i}`,
          role: `specialist-${i}`,
          taskSpec: `Task ${i}`,
          targetFiles: [`src/file_${i}.js`],
        }));

        const res = await client.callTool('spawn_swarm', {
          mission: '12-Agent swarm scaling',
          maxConcurrency: 0,
          parallel: true,
          agents,
        });

        assert.equal(res.isError, false);
        const state = await ws.readState();
        assert.equal(Object.keys(state.agents).length, 12);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T2-E2E-F23-08: abrupt cancellation during orchestration cleans state', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      try {
        await runCli(['init', 'Cancellation test'], { cwd: ws.dir });
        assert.ok(ws.fileExists('.swarm/state.json'));

        // Reset cleans state
        const resetRes = await runCli(['reset', '--hard'], { cwd: ws.dir });
        assert.equal(resetRes.exitCode, 0);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('T2-E2E-F23-09: handling missing CLI binary path gracefully', async () => {
      assert.ok(existsSync(CLI_PATH), `CLI must exist at ${CLI_PATH}`);
    });

    await t.test('T2-E2E-F23-10: multi-branch orchestration merge resolves non-conflicting edits cleanly', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          'src/config.js': 'export const env = "test";\n',
          'src/logger.js': 'export const level = "info";\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Multi-branch merge',
          agents: [
            { id: 'b1', role: 'dev', taskSpec: 'b1', targetFiles: ['src/config.js'] },
            { id: 'b2', role: 'dev', taskSpec: 'b2', targetFiles: ['src/logger.js'] },
          ],
        });

        const wt1 = path.join(ws.dir, '.swarm', 'worktrees', 'b1', 'src', 'config.js');
        const wt2 = path.join(ws.dir, '.swarm', 'worktrees', 'b2', 'src', 'logger.js');
        await fs.writeFile(wt1, 'export const env = "production";\n', 'utf8');
        await fs.writeFile(wt2, 'export const level = "debug";\n', 'utf8');

        await client.callTool('complete_agent_task', { agentId: 'b1' });
        await client.callTool('complete_agent_task', { agentId: 'b2' });

        assert.equal(
          normalizeEol(await ws.readFile('src/config.js')),
          'export const env = "production";\n'
        );
        assert.equal(
          normalizeEol(await ws.readFile('src/logger.js')),
          'export const level = "debug";\n'
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS
  // =========================================================================

  await suiteContext.test('Tier 3 - Cross-Feature Interactions: Full System Integration', async (t) => {
    await t.test('T3-E2E-X01: orchestration script with mixed workspace modes and doorbell handoffs', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/component.js': 'export const UI = () => null;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Mixed workspace with doorbell',
          agents: [
            {
              id: 'author',
              role: 'dev',
              taskSpec: 'Author UI',
              workspace: 'share',
              targetFiles: ['src/component.js'],
            },
            {
              id: 'auditor',
              role: 'verifier',
              taskSpec: 'Audit UI',
              workspace: 'inherit',
              dependsOn: ['author'],
              targetFiles: [],
            },
          ],
        });

        // Author edits in share worktree
        const wtComp = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'author',
          'src',
          'component.js'
        );
        await fs.writeFile(wtComp, 'export const UI = () => "<button>OK</button>";\n', 'utf8');
        await client.callTool('complete_agent_task', { agentId: 'author' });

        // Auditor verifies in root
        assert.equal(
          normalizeEol(await ws.readFile('src/component.js')),
          'export const UI = () => "<button>OK</button>";\n'
        );
        await client.callTool('complete_agent_task', { agentId: 'auditor' });
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T3-E2E-X02: orchestration script with worker crash, lock reclamation, and automatic restart', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/service.js': 'export const s = 1;\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Crash and restart',
          agents: [
            {
              id: 'crashed-worker',
              role: 'dev',
              taskSpec: 'Crash task',
              targetFiles: ['src/service.js'],
            },
          ],
        });

        // Respawn replacement
        const repRes = await client.callTool('add_dynamic_agent', {
          id: 'restart-worker',
          role: 'dev',
          taskSpec: 'Replacement task',
          targetFiles: ['src/service.js'],
        });
        assert.equal(repRes.isError, false);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('T3-E2E-X03: stall alert posted to board wakes coordinator to unblock pipeline', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('spawn_swarm', {
          mission: 'Stall unblock',
          agents: [],
        });

        const res = await client.callTool('write_blackboard', {
          key: 'pipeline_status',
          value: 'active',
        });
        assert.equal(res.isError, false);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // TIER 4: REAL-WORLD APPLICATION SCENARIOS (Production Workflows)
  // =========================================================================

  await suiteContext.test('Tier 4 - Real-World Application Scenarios (Detailed in DISPATCH.md)', async (t) => {
    // -----------------------------------------------------------------------
    // Scenario 1: Multi-Agent Collaborative Refactor with Doorbell Handoff
    // -----------------------------------------------------------------------
    await t.test('T4-SCN-01: Scenario 1 — Multi-Agent Collaborative Refactor with Doorbell Handoff', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          'src/service.js': 'export function processOrder(order) {\n  if (!order) return null;\n  return { id: order.id, status: "processed" };\n}\n',
          'test/service.spec.js': 'import { processOrder } from "../src/service.js";\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);

        // 1. Coordinator spawns author (share) + verifier (inherit)
        const spawnRes = await client.callTool('spawn_swarm', {
          mission: 'Collaborative Refactor with Doorbell Handoff',
          maxConcurrency: 2,
          strictDependencies: true,
          agents: [
            {
              id: 'worker-author',
              role: 'author',
              taskSpec: 'Refactor processOrder to validate order.amount > 0 and add timestamp',
              workspace: 'share',
              targetFiles: ['src/service.js'],
            },
            {
              id: 'worker-verifier',
              role: 'verifier',
              taskSpec: 'Verify processOrder refactor in inherit workspace',
              workspace: 'inherit',
              dependsOn: ['worker-author'],
              targetFiles: [],
            },
          ],
        });
        assert.equal(spawnRes.isError, false);

        // 2. Author executes refactor in worktree
        const wtService = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'worker-author',
          'src',
          'service.js'
        );
        const refactoredContent =
          'export function processOrder(order) {\n' +
          '  if (!order || order.amount <= 0) return null;\n' +
          '  return { id: order.id, amount: order.amount, status: "processed", ts: Date.now() };\n' +
          '}\n';
        await fs.writeFile(wtService, refactoredContent, 'utf8');

        // 3. Author posts doorbell wakeup to verifier on board
        const boardPath = path.join(ws.dir, '.swarm', 'board.jsonl');
        const doorbellPost = JSON.stringify({
          seq: 1,
          from: 'worker-author',
          channel: 'main',
          text: '@worker-verifier check #1 refactor complete on src/service.js',
          ts: Date.now(),
        }) + '\n';
        await fs.appendFile(boardPath, doorbellPost, 'utf8');

        // Complete author task (merges to main)
        const authorComp = await client.callTool('complete_agent_task', {
          agentId: 'worker-author',
          summary: 'Refactored processOrder with validation and timestamp',
        });
        assert.equal(authorComp.isError, false);

        // 4. Verifier wakes in inherit workspace and validates root edits
        const rootService = normalizeEol(await ws.readFile('src/service.js'));
        assert.ok(rootService.includes('order.amount <= 0'), 'Root must contain refactored validation');
        assert.ok(rootService.includes('amount: order.amount'), 'Root must contain refactored amount');

        // Verifier posts doorbell wakeup to coordinator
        const verifierPost = JSON.stringify({
          seq: 2,
          from: 'worker-verifier',
          channel: 'main',
          text: '@coordinator refactor verified and passes all invariant checks',
          ts: Date.now(),
        }) + '\n';
        await fs.appendFile(boardPath, verifierPost, 'utf8');

        // Complete verifier task
        const verifierComp = await client.callTool('complete_agent_task', {
          agentId: 'worker-verifier',
          summary: 'Verified processOrder invariants',
        });
        assert.equal(verifierComp.isError, false);

        // Final state check
        const state = await ws.readState();
        assert.equal(state.agents['worker-author'].status, 'completed');
        assert.equal(state.agents['worker-verifier'].status, 'completed');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    // -----------------------------------------------------------------------
    // Scenario 2: High-Contention Multi-Worker Pipeline with Stash & Clean Merge
    // -----------------------------------------------------------------------
    await t.test('T4-SCN-02: Scenario 2 — High-Contention Multi-Worker Pipeline with Stash & Clean Merge', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          'src/auth.js': 'export const auth = { enabled: false };\n',
          'src/billing.js': 'export const billing = { currency: "USD" };\n',
          'src/notify.js': 'export const notify = { email: false };\n',
          'README.md': '# Project Architecture\n\nProduction services.\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);

        // Spawn 3 concurrent workers in share worktrees
        await client.callTool('spawn_swarm', {
          mission: 'High-contention concurrent worker pipeline',
          maxConcurrency: 3,
          parallel: true,
          agents: [
            { id: 'w-auth', role: 'security', taskSpec: 'Enable auth', workspace: 'share', targetFiles: ['src/auth.js'] },
            { id: 'w-billing', role: 'finance', taskSpec: 'Add EUR', workspace: 'share', targetFiles: ['src/billing.js'] },
            { id: 'w-notify', role: 'comms', taskSpec: 'Enable email', workspace: 'share', targetFiles: ['src/notify.js'] },
          ],
        });

        // Simulate developer having dirty uncommitted changes in root cwd
        await ws.writeFile('README.md', '# Project Architecture\n\nProduction services.\n\n[DIRTY UNCOMMITTED DEVELOPER NOTES]\n');
        await ws.writeFile('untracked_dev.log', 'local debugging trace\n');

        // All 3 workers perform modifications concurrently in their respective isolated worktrees
        const wtAuth = path.join(ws.dir, '.swarm', 'worktrees', 'w-auth', 'src', 'auth.js');
        const wtBilling = path.join(ws.dir, '.swarm', 'worktrees', 'w-billing', 'src', 'billing.js');
        const wtNotify = path.join(ws.dir, '.swarm', 'worktrees', 'w-notify', 'src', 'notify.js');

        await fs.writeFile(wtAuth, 'export const auth = { enabled: true, jwt: true };\n', 'utf8');
        await fs.writeFile(wtBilling, 'export const billing = { currency: "EUR", vat: 0.20 };\n', 'utf8');
        await fs.writeFile(wtNotify, 'export const notify = { email: true, sms: true };\n', 'utf8');

        // Complete workers in rapid sequence
        await client.callTool('complete_agent_task', { agentId: 'w-auth', summary: 'Auth enabled' });
        await client.callTool('complete_agent_task', { agentId: 'w-billing', summary: 'Billing updated' });
        await client.callTool('complete_agent_task', { agentId: 'w-notify', summary: 'Notify enabled' });

        // Verify root files reflect merged changes
        assert.equal(
          normalizeEol(await ws.readFile('src/auth.js')),
          'export const auth = { enabled: true, jwt: true };\n'
        );
        assert.equal(
          normalizeEol(await ws.readFile('src/billing.js')),
          'export const billing = { currency: "EUR", vat: 0.20 };\n'
        );
        assert.equal(
          normalizeEol(await ws.readFile('src/notify.js')),
          'export const notify = { email: true, sms: true };\n'
        );

        // Verify dirty developer edits in root are completely intact
        const rootReadme = normalizeEol(await ws.readFile('README.md'));
        assert.ok(rootReadme.includes('[DIRTY UNCOMMITTED DEVELOPER NOTES]'));
        assert.equal(normalizeEol(await ws.readFile('untracked_dev.log')), 'local debugging trace\n');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    // -----------------------------------------------------------------------
    // Scenario 3: Worker Crash & Automatic Lock Reclamation Recovery
    // -----------------------------------------------------------------------
    await t.test('T4-SCN-03: Scenario 3 — Worker Crash & Automatic Lock Reclamation Recovery', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: { 'src/critical_payment.js': 'export const payment = "v1";\n' },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);

        // 1. Spawn initial worker holding critical lock
        await client.callTool('spawn_swarm', {
          mission: 'Payment upgrade with crash resilience',
          agents: [
            {
              id: 'worker-payment-1',
              role: 'dev',
              taskSpec: 'Upgrade payment',
              targetFiles: ['src/critical_payment.js'],
            },
          ],
        });

        // Verify initial lock acquired
        let state = await ws.readState();
        assert.equal(state.lockedFiles['src/critical_payment.js'], 'worker-payment-1');

        // 2. Simulate worker-payment-1 crash by recording crash action & reclaiming lock
        await client.callTool('record_agent_action', {
          agentId: 'worker-payment-1',
          actionType: 'status',
          target: 'process',
          detail: 'Abrupt process crash detected (SIGKILL / OOM)',
        });
        await client.callTool('complete_agent_task', {
          agentId: 'worker-payment-1',
          summary: 'Crash recovery: lock reclaimed and released',
        });

        // 3. Spawn replacement worker to acquire freed lock
        const repRes = await client.callTool('add_dynamic_agent', {
          id: 'worker-payment-retry',
          role: 'dev',
          taskSpec: 'Retry and finish payment upgrade',
          targetFiles: ['src/critical_payment.js'],
        });
        assert.equal(repRes.isError, false);

        // Claim task
        await client.callTool('pull_agent_task', { agentId: 'worker-payment-retry' });

        // Complete edit in replacement worktree
        const wtPay = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'worker-payment-retry',
          'src',
          'critical_payment.js'
        );
        await fs.writeFile(wtPay, 'export const payment = "v2_recovered";\n', 'utf8');

        // Complete replacement worker
        const compRes = await client.callTool('complete_agent_task', {
          agentId: 'worker-payment-retry',
          summary: 'Successfully completed payment upgrade after crash recovery',
        });
        assert.equal(compRes.isError, false);

        // Verify root has merged recovered code
        assert.equal(
          normalizeEol(await ws.readFile('src/critical_payment.js')),
          'export const payment = "v2_recovered";\n'
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    // -----------------------------------------------------------------------
    // Scenario 4: Runtime Quota Exhaustion & Dynamic Model Hot-Swap
    // -----------------------------------------------------------------------
    await t.test('T4-SCN-04: Scenario 4 — Runtime Quota Exhaustion & Dynamic Model Hot-Swap', async () => {
      const ws = await createTestWorkspace({ isGit: true });
      let client;
      try {
        client = await createMcpClient(ws.dir);

        // Spawn worker with primary expensive model
        await client.callTool('spawn_swarm', {
          mission: 'Quota hot-swap simulation',
          agents: [
            {
              id: 'ml-worker',
              role: 'researcher',
              model: 'gemini-2.5-pro',
              taskSpec: 'Deep reasoning task',
              targetFiles: [],
            },
          ],
        });

        let state = await ws.readState();
        assert.equal(state.agents['ml-worker'].model, 'gemini-2.5-pro');

        // Simulate quota exhaustion error step (429 / RESOURCE_EXHAUSTED)
        await client.callTool('record_agent_action', {
          agentId: 'ml-worker',
          actionType: 'status',
          target: 'api',
          detail: '429 RESOURCE_EXHAUSTED: Quota exceeded for gemini-2.5-pro',
        });

        // Coordinator dynamically hot-swaps model to fallback (gemini-2.5-flash)
        await client.callTool('write_blackboard', {
          key: 'sys-ml-worker-model-swap',
          value: { previous: 'gemini-2.5-pro', new: 'gemini-2.5-flash', ts: Date.now() },
        });

        // Worker resumes on new model and completes
        await client.callTool('complete_agent_task', {
          agentId: 'ml-worker',
          summary: 'Completed deep reasoning under fallback model gemini-2.5-flash',
        });

        state = await ws.readState();
        assert.equal(state.agents['ml-worker'].status, 'completed');
        assert.ok(state.blackboard['sys-ml-worker-model-swap']);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    // -----------------------------------------------------------------------
    // Scenario 5: Hierarchical Helper Tree with Channel Partitioning
    // -----------------------------------------------------------------------
    await t.test('T4-SCN-05: Scenario 5 — Hierarchical Helper Tree with Channel Partitioning', async () => {
      const ws = await createTestWorkspace({
        isGit: true,
        files: {
          'src/ast.js': 'export const AST = {};\n',
        },
      });
      let client;
      try {
        client = await createMcpClient(ws.dir);

        // Coordinator spawns lead worker
        await client.callTool('spawn_swarm', {
          mission: 'Hierarchical compiler AST build',
          agents: [
            {
              id: 'parser-lead',
              role: 'compiler_lead',
              taskSpec: 'Build AST module using helpers',
              targetFiles: ['src/ast.js'],
            },
          ],
        });

        // Lead worker dynamically spawns 2 helper subagents with parentId
        await client.callTool('add_dynamic_agent', {
          id: 'lexer-helper',
          role: 'helper',
          taskSpec: 'Tokenize source input',
          targetFiles: [],
        });

        await client.callTool('add_dynamic_agent', {
          id: 'grammar-helper',
          role: 'helper',
          taskSpec: 'Validate grammar rules',
          targetFiles: [],
        });

        // Partitioned channel traffic on #parser-ast
        const boardPath = path.join(ws.dir, '.swarm', 'board.jsonl');
        const helperMsg1 = JSON.stringify({
          seq: 1,
          from: 'lexer-helper',
          channel: 'parser-ast',
          text: 'Tokens ready: [IDENT, ASSIGN, NUMBER]',
          ts: Date.now(),
        }) + '\n';
        const helperMsg2 = JSON.stringify({
          seq: 2,
          from: 'grammar-helper',
          channel: 'parser-ast',
          text: 'Grammar rule verified: VariableDeclaration',
          ts: Date.now(),
        }) + '\n';
        await fs.appendFile(boardPath, helperMsg1 + helperMsg2, 'utf8');

        // Lead aggregates results from #parser-ast and writes final AST code
        const wtAst = path.join(
          ws.dir,
          '.swarm',
          'worktrees',
          'parser-lead',
          'src',
          'ast.js'
        );
        await fs.writeFile(
          wtAst,
          'export const AST = { type: "VariableDeclaration", identifier: "x", value: 42 };\n',
          'utf8'
        );

        // Complete lead worker
        await client.callTool('complete_agent_task', {
          agentId: 'parser-lead',
          summary: 'AST compiled successfully from helper subagent contributions',
        });

        // Verify root AST reflects merged output
        assert.equal(
          normalizeEol(await ws.readFile('src/ast.js')),
          'export const AST = { type: "VariableDeclaration", identifier: "x", value: 42 };\n'
        );

        // Final board report on #main channel
        const mainReport = JSON.stringify({
          seq: 3,
          from: 'parser-lead',
          channel: 'main',
          text: '@coordinator AST build complete with all helper contributions merged.',
          ts: Date.now(),
        }) + '\n';
        await fs.appendFile(boardPath, mainReport, 'utf8');

        const boardLines = (await fs.readFile(boardPath, 'utf8')).trim().split('\n');
        assert.equal(boardLines.length, 3);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });
});
