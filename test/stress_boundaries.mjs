/**
 * Empirical Boundary Stress Test for Milestone 1
 * 
 * Verifies:
 * 1. Reset behavior:
 *    - When maxConcurrency is 0, does reset keep maxConcurrency as 0 rather than resetting to 4?
 *    - Preserves custom concurrency (e.g. 8) or default concurrency (0).
 * 2. spawn_swarm schemas over MCP stdio:
 *    - spawn_swarm correctly accepts empty arrays, 1 agent, 5 agents, and 25 agents without validation failure.
 *    - maxConcurrency rejects negative numbers (-1, -5).
 *    - maxConcurrency accepts 0 and positive numbers.
 */

import assert from 'node:assert/strict';
import { createTestWorkspace, runCli, createMcpClient } from './harness.mjs';

async function runAllStressTests() {
  console.log('=== STARTING EMPIRICAL BOUNDARY STRESS TESTS ===\n');
  let passed = 0;
  let failed = 0;

  // TEST 1: Reset behavior with maxConcurrency = 0
  console.log('--- TEST GROUP 1: Reset Behavior with maxConcurrency = 0 ---');

  // Test 1A: init with --concurrency 0, then reset
  {
    const ws = await createTestWorkspace({ isGit: true });
    try {
      console.log('Test 1A: CLI init --concurrency 0 -> reset -> check state.maxConcurrency');
      const initRes = await runCli(['init', '--mission', 'Test Mission 0', '--concurrency', '0'], { cwd: ws.dir });
      assert.equal(initRes.exitCode, 0, `init failed: ${initRes.stderr}`);

      let state = await ws.readState();
      assert.equal(state.maxConcurrency, 0, `Expected initial maxConcurrency to be 0, got ${state.maxConcurrency}`);

      const resetRes = await runCli(['reset'], { cwd: ws.dir });
      assert.equal(resetRes.exitCode, 0, `reset failed: ${resetRes.stderr}`);

      state = await ws.readState();
      assert.strictEqual(
        state.maxConcurrency,
        0,
        `RESET FAILED: maxConcurrency was ${state.maxConcurrency}, expected strictly 0 (not 4)!`
      );
      console.log('  ✔ Test 1A PASSED: maxConcurrency preserved as 0 after reset');
      passed++;
    } catch (err) {
      console.error('  ✘ Test 1A FAILED:', err.message);
      failed++;
    } finally {
      await ws.cleanup();
    }
  }

  // Test 1B: init with default concurrency (no --concurrency flag), then reset
  {
    const ws = await createTestWorkspace({ isGit: true });
    try {
      console.log('Test 1B: CLI init default concurrency (no flag) -> reset -> check state.maxConcurrency');
      const initRes = await runCli(['init', '--mission', 'Default Concurrency'], { cwd: ws.dir });
      assert.equal(initRes.exitCode, 0, `init failed: ${initRes.stderr}`);

      let state = await ws.readState();
      assert.equal(state.maxConcurrency, 0, `Expected default maxConcurrency to be 0, got ${state.maxConcurrency}`);

      const resetRes = await runCli(['reset'], { cwd: ws.dir });
      assert.equal(resetRes.exitCode, 0, `reset failed: ${resetRes.stderr}`);

      state = await ws.readState();
      assert.strictEqual(
        state.maxConcurrency,
        0,
        `RESET FAILED: default maxConcurrency was ${state.maxConcurrency}, expected 0`
      );
      console.log('  ✔ Test 1B PASSED: default maxConcurrency (0) preserved after reset');
      passed++;
    } catch (err) {
      console.error('  ✘ Test 1B FAILED:', err.message);
      failed++;
    } finally {
      await ws.cleanup();
    }
  }

  // Test 1C: init with custom concurrency 8 -> reset -> check state.maxConcurrency
  {
    const ws = await createTestWorkspace({ isGit: true });
    try {
      console.log('Test 1C: CLI init with custom concurrency 8 -> reset -> check state.maxConcurrency');
      const initRes = await runCli(['init', '--mission', 'Custom 8', '--concurrency', '8'], { cwd: ws.dir });
      assert.equal(initRes.exitCode, 0, `init failed: ${initRes.stderr}`);

      let state = await ws.readState();
      assert.equal(state.maxConcurrency, 8, `Expected initial maxConcurrency to be 8, got ${state.maxConcurrency}`);

      const resetRes = await runCli(['reset'], { cwd: ws.dir });
      assert.equal(resetRes.exitCode, 0, `reset failed: ${resetRes.stderr}`);

      state = await ws.readState();
      assert.strictEqual(
        state.maxConcurrency,
        8,
        `RESET FAILED: custom maxConcurrency was ${state.maxConcurrency}, expected 8`
      );
      console.log('  ✔ Test 1C PASSED: custom maxConcurrency (8) preserved after reset');
      passed++;
    } catch (err) {
      console.error('  ✘ Test 1C FAILED:', err.message);
      failed++;
    } finally {
      await ws.cleanup();
    }
  }

  // TEST 2: spawn_swarm Schemas & Concurrency Validation over MCP stdio
  console.log('\n--- TEST GROUP 2: spawn_swarm over MCP Stdio ---');

  // Test 2A: Empty array agents: []
  {
    const ws = await createTestWorkspace({ isGit: true });
    let client;
    try {
      console.log('Test 2A: spawn_swarm with empty array (agents: [])');
      client = await createMcpClient(ws.dir);
      const res = await client.callTool('spawn_swarm', {
        mission: 'Boundary Mission: 0 agents',
        agents: [],
      });
      assert.equal(res.isError, false, `spawn_swarm with [] failed: ${JSON.stringify(res)}`);
      const state = await ws.readState();
      assert.ok(state, 'state.json must exist');
      assert.equal(Object.keys(state.agents).length, 0, 'Expected 0 agents in state');
      console.log('  ✔ Test 2A PASSED: spawn_swarm accepts agents: [] without error');
      passed++;
    } catch (err) {
      console.error('  ✘ Test 2A FAILED:', err.message);
      failed++;
    } finally {
      if (client) await client.close();
      await ws.cleanup();
    }
  }

  // Test 2B: 1 agent
  {
    const ws = await createTestWorkspace({ isGit: true });
    let client;
    try {
      console.log('Test 2B: spawn_swarm with 1 agent');
      client = await createMcpClient(ws.dir);
      const res = await client.callTool('spawn_swarm', {
        mission: 'Boundary Mission: 1 agent',
        agents: [
          { role: 'solo-worker', taskSpec: 'Single specialized task', targetFiles: ['src/solo.ts'] },
        ],
      });
      assert.equal(res.isError, false, `spawn_swarm with 1 agent failed: ${JSON.stringify(res)}`);
      const state = await ws.readState();
      assert.ok(state, 'state.json must exist');
      assert.equal(Object.keys(state.agents).length, 1, 'Expected 1 agent in state');
      console.log('  ✔ Test 2B PASSED: spawn_swarm accepts 1 agent cleanly');
      passed++;
    } catch (err) {
      console.error('  ✘ Test 2B FAILED:', err.message);
      failed++;
    } finally {
      if (client) await client.close();
      await ws.cleanup();
    }
  }

  // Test 2C: 5 agents
  {
    const ws = await createTestWorkspace({ isGit: true });
    let client;
    try {
      console.log('Test 2C: spawn_swarm with 5 agents');
      client = await createMcpClient(ws.dir);
      const agents5 = [
        { role: 'architect', taskSpec: 'Design system spec', targetFiles: ['docs/arch.md'] },
        { role: 'backend', taskSpec: 'API implementation', targetFiles: ['src/api.ts'] },
        { role: 'frontend', taskSpec: 'UI components', targetFiles: ['src/ui.tsx'] },
        { role: 'database', taskSpec: 'Schema migration', targetFiles: ['db/schema.sql'] },
        { role: 'testing', taskSpec: 'Test suite', targetFiles: ['test/api.test.ts'] },
      ];
      const res = await client.callTool('spawn_swarm', {
        mission: 'Boundary Mission: 5 agents',
        agents: agents5,
      });
      assert.equal(res.isError, false, `spawn_swarm with 5 agents failed: ${JSON.stringify(res)}`);
      const state = await ws.readState();
      assert.ok(state, 'state.json must exist');
      assert.equal(Object.keys(state.agents).length, 5, 'Expected 5 agents in state');
      console.log('  ✔ Test 2C PASSED: spawn_swarm accepts 5 agents cleanly');
      passed++;
    } catch (err) {
      console.error('  ✘ Test 2C FAILED:', err.message);
      failed++;
    } finally {
      if (client) await client.close();
      await ws.cleanup();
    }
  }

  // Test 2D: 25 agents (Boundary scaling challenge!)
  {
    const ws = await createTestWorkspace({ isGit: true });
    let client;
    try {
      console.log('Test 2D: spawn_swarm with 25 agents (Scaling Boundary Test)');
      client = await createMcpClient(ws.dir);
      const roles = [
        'architect', 'backend', 'frontend', 'database', 'auth',
        'testing', 'perf', 'docs', 'security', 'devops',
        'l10n', 'a11y', 'analytics', 'billing', 'caching',
        'indexer', 'search', 'worker-queue', 'mailer', 'notifications',
        'storage', 'api-gateway', 'rate-limiter', 'monitoring', 'compliance'
      ];
      assert.equal(roles.length, 25, 'Precondition: 25 roles defined');

      const agents25 = roles.map((role, idx) => ({
        id: `agent-${String(idx + 1).padStart(2, '0')}`,
        role,
        taskSpec: `Implement specialized deliverables for ${role}`,
        targetFiles: [`modules/${role}/index.ts`],
      }));

      const res = await client.callTool('spawn_swarm', {
        mission: 'Boundary Mission: 25 parallel agents',
        maxConcurrency: 0,
        agents: agents25,
      });
      assert.equal(res.isError, false, `spawn_swarm with 25 agents failed: ${JSON.stringify(res)}`);
      const state = await ws.readState();
      assert.ok(state, 'state.json must exist');
      assert.equal(Object.keys(state.agents).length, 25, 'Expected exactly 25 agents registered in state');

      // Verify each agent exists and has correct targetFiles and is running (unbounded parallel execution)
      for (const a of agents25) {
        assert.ok(state.agents[a.id], `Agent ${a.id} missing in state`);
        assert.equal(state.agents[a.id].role, a.role);
        assert.equal(state.agents[a.id].status, 'running', `Agent ${a.id} should be running under unbounded concurrency`);
        assert.deepEqual(state.agents[a.id].targetFiles, [`modules/${a.role}/index.ts`]);
      }

      console.log('  ✔ Test 2D PASSED: spawn_swarm successfully accepted and registered 25 parallel agents without validation failure');
      passed++;
    } catch (err) {
      console.error('  ✘ Test 2D FAILED:', err.message);
      failed++;
    } finally {
      if (client) await client.close();
      await ws.cleanup();
    }
  }

  // Test 2E: maxConcurrency negative numbers rejected
  {
    const ws = await createTestWorkspace({ isGit: true });
    let client;
    try {
      console.log('Test 2E: spawn_swarm rejects negative maxConcurrency (-1, -5)');
      client = await createMcpClient(ws.dir);

      // Attempt with -1
      const resNeg1 = await client.callTool('spawn_swarm', {
        mission: 'Should fail with negative concurrency',
        maxConcurrency: -1,
      });

      // Zod or MCP validation failure will either set isError: true or return an error object
      const failedNeg1 = resNeg1.isError === true || resNeg1.error !== undefined;
      assert.ok(
        failedNeg1,
        `Expected spawn_swarm with maxConcurrency: -1 to fail validation! Got: ${JSON.stringify(resNeg1)}`
      );

      // Attempt with -5
      const resNeg5 = await client.callTool('spawn_swarm', {
        mission: 'Should fail with negative concurrency',
        maxConcurrency: -5,
      });
      const failedNeg5 = resNeg5.isError === true || resNeg5.error !== undefined;
      assert.ok(
        failedNeg5,
        `Expected spawn_swarm with maxConcurrency: -5 to fail validation! Got: ${JSON.stringify(resNeg5)}`
      );

      console.log('  ✔ Test 2E PASSED: maxConcurrency: -1 and -5 are properly rejected by schema validation');
      passed++;
    } catch (err) {
      console.error('  ✘ Test 2E FAILED:', err.message);
      failed++;
    } finally {
      if (client) await client.close();
      await ws.cleanup();
    }
  }

  // Test 2F: maxConcurrency accepts 0 and positive numbers
  {
    const ws = await createTestWorkspace({ isGit: true });
    let client;
    try {
      console.log('Test 2F: spawn_swarm accepts maxConcurrency: 0 and maxConcurrency: 15');
      client = await createMcpClient(ws.dir);

      const res0 = await client.callTool('spawn_swarm', {
        mission: 'Accepts 0',
        maxConcurrency: 0,
      });
      assert.equal(res0.isError, false, `maxConcurrency: 0 should be accepted! Got: ${JSON.stringify(res0)}`);
      let state = await ws.readState();
      assert.equal(state.maxConcurrency, 0);

      const res15 = await client.callTool('spawn_swarm', {
        mission: 'Accepts 15',
        maxConcurrency: 15,
      });
      assert.equal(res15.isError, false, `maxConcurrency: 15 should be accepted! Got: ${JSON.stringify(res15)}`);
      state = await ws.readState();
      assert.equal(state.maxConcurrency, 15);

      console.log('  ✔ Test 2F PASSED: maxConcurrency 0 and 15 accepted correctly');
      passed++;
    } catch (err) {
      console.error('  ✘ Test 2F FAILED:', err.message);
      failed++;
    } finally {
      if (client) await client.close();
      await ws.cleanup();
    }
  }

  console.log(`\n=== STRESS TEST SUMMARY: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

runAllStressTests().catch((err) => {
  console.error('Fatal stress test runner error:', err);
  process.exit(1);
});
