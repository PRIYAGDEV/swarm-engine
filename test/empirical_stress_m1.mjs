/**
 * Empirical Stress-Testing Harness for Milestone 1
 * 
 * Verifies:
 * 1. MCP server spawn_swarm with 20 parallel agents: all 20 accepted without schema errors, zero queuing when maxConcurrency is 0.
 * 2. Dynamic agent addition: add 5 dynamic agents mid-flight, verify state reaches 25 running agents.
 * 3. Status table output: verify maxConcurrency: 0 renders as "∞ (unlimited)" and not "4", both before and after reset.
 * 4. CLI run parsing: verify worker counts > 16 (e.g. --workers 24, --workers 30) are not clamped to 16.
 * 5. Adversarial checks: file lock serialization with maxConcurrency 0, cycle detection in 20+ agents, negative concurrency rejection.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createTestWorkspace, createMcpClient, runCli } from './harness.mjs';

async function main() {
  console.log('================================================================');
  console.log('STARTING EMPIRICAL STRESS TEST FOR MILESTONE 1');
  console.log('================================================================\n');

  let passedTests = 0;
  let totalTests = 0;

  async function test(name, fn) {
    totalTests++;
    console.log(`[TEST ${totalTests}] ${name}...`);
    try {
      await fn();
      console.log(`  --> PASS\n`);
      passedTests++;
    } catch (err) {
      console.error(`  --> FAIL: ${err.message}`);
      console.error(err.stack);
      console.error('\n');
      throw err;
    }
  }

  // Workspace for MCP testing
  const ws1 = await createTestWorkspace({ isGit: true });

  try {
    // -------------------------------------------------------------------------
    // TEST 1: MCP spawn_swarm with 20 parallel agents (infinite concurrency, 0 queuing)
    // -------------------------------------------------------------------------
    let mcpClient = await createMcpClient(ws1.dir);

    await test('MCP spawn_swarm accepts 20 parallel agents with 0 queuing and maxConcurrency: 0', async () => {
      const agents = [];
      for (let i = 1; i <= 20; i++) {
        agents.push({
          id: `worker-p${i}`,
          role: `specialist_role_${i}`,
          taskSpec: `Perform isolated task slice ${i} with complete prompt decomposition`,
          targetFiles: [`src/components/module_${i}.ts`],
          dependsOn: [],
        });
      }

      const res = await mcpClient.callTool('spawn_swarm', {
        mission: 'Empirical Stress Test: 20 Parallel Subagents',
        maxConcurrency: 0,
        parallel: true,
        agents,
      });

      assert.equal(res.isError, false, `Tool call failed: ${JSON.stringify(res)}`);
      assert.ok(res.data, 'Expected JSON payload in tool response');
      assert.equal(res.data.success, true);
      assert.equal(res.data.maxConcurrency, 0);
      assert.equal(res.data.totalAgents, 20);
      assert.equal(res.data.runningAgents.length, 20, `Expected 20 running agents, got ${res.data.runningAgents.length}`);
      assert.equal(res.data.pendingAgents.length, 0, `Expected 0 pending agents (zero queuing), got ${res.data.pendingAgents.length}`);

      // Verify on-disk state
      const state = await ws1.readState();
      assert.ok(state, 'State file .swarm/state.json should exist');
      assert.equal(state.maxConcurrency, 0);
      assert.equal(Object.keys(state.agents).length, 20);

      // Verify all 20 agents have status 'running' and worktrees created
      for (let i = 1; i <= 20; i++) {
        const agent = state.agents[`worker-p${i}`];
        assert.ok(agent, `Agent worker-p${i} must be in state`);
        assert.equal(agent.status, 'running', `Agent worker-p${i} status must be running`);
        assert.ok(agent.worktreePath, `Agent worker-p${i} must have worktreePath`);
        const wtExists = ws1.fileExists(`.swarm/worktrees/worker-p${i}`);
        assert.ok(wtExists, `Worktree directory for worker-p${i} must exist on disk`);
      }
    });

    // -------------------------------------------------------------------------
    // TEST 2: Dynamic agent addition (add 5 additional dynamic agents to reach 25)
    // -------------------------------------------------------------------------
    await test('MCP add_dynamic_agent adds 5 additional agents mid-execution to reach 25 running agents', async () => {
      for (let i = 21; i <= 25; i++) {
        const res = await mcpClient.callTool('add_dynamic_agent', {
          id: `worker-p${i}`,
          role: `dynamic_specialist_${i}`,
          taskSpec: `Dynamically added task slice ${i}`,
          targetFiles: [`src/dynamic/feature_${i}.ts`],
          dependsOn: [],
        });

        assert.equal(res.isError, false, `add_dynamic_agent failed for agent ${i}: ${JSON.stringify(res)}`);
        assert.equal(res.data.scheduled, true, `Agent worker-p${i} should be immediately scheduled (no queuing)`);
        assert.equal(res.data.agent.status, 'running');
      }

      // Check state through get_swarm_status tool
      const statusRes = await mcpClient.callTool('get_swarm_status', { detail: true });
      assert.equal(statusRes.isError, false);
      assert.equal(statusRes.data.totalAgents, 25);
      assert.equal(statusRes.data.runningCount, 25);
      assert.equal(statusRes.data.pendingCount, 0);
      assert.equal(statusRes.data.maxConcurrency, 0);

      // Verify on-disk state
      const state = await ws1.readState();
      assert.equal(Object.keys(state.agents).length, 25);
      for (let i = 1; i <= 25; i++) {
        const agent = state.agents[`worker-p${i}`];
        assert.ok(agent);
        assert.equal(agent.status, 'running');
        assert.ok(ws1.fileExists(`.swarm/worktrees/worker-p${i}`));
      }
    });

    // -------------------------------------------------------------------------
    // TEST 3: Status table rendering: maxConcurrency: 0 renders as "∞ (unlimited)" and not "4"
    // -------------------------------------------------------------------------
    await test('Status table renders maxConcurrency: 0 as "∞ (unlimited)" and not "4"', async () => {
      const cliStatus = await runCli(['status', '--table'], { cwd: ws1.dir });
      assert.equal(cliStatus.exitCode, 0);

      console.log('  [CLI status output snippet]:');
      const lines = cliStatus.stdout.split('\n').filter(l => l.includes('Concurrency:') || l.includes('Mission:'));
      lines.forEach(l => console.log('   ', l));

      assert.ok(
        cliStatus.stdout.includes('∞ (unlimited)'),
        'Status table must contain "∞ (unlimited)"'
      );
      assert.ok(
        !cliStatus.stdout.includes('/ 4 active'),
        'Status table must NOT contain "/ 4 active"'
      );
      assert.match(
        cliStatus.stdout,
        /Concurrency:\s+25\s*\/\s*∞ \(unlimited\)\s+active\s+\(25 total agents\)/,
        'Concurrency line must match format "Concurrency: 25 / ∞ (unlimited) active (25 total agents)"'
      );
    });

    await test('Reset preserves maxConcurrency: 0 and status continues to render "∞ (unlimited)"', async () => {
      // Close MCP client first to release any handles in ws1
      await mcpClient.close();

      const cliReset = await runCli(['reset', '--force'], { cwd: ws1.dir });
      assert.equal(cliReset.exitCode, 0, `Reset failed: ${cliReset.stderr}`);

      const stateAfterReset = await ws1.readState();
      assert.ok(stateAfterReset, 'State must exist after reset');
      assert.equal(
        stateAfterReset.maxConcurrency,
        0,
        `Expected maxConcurrency to remain 0 after reset, got ${stateAfterReset.maxConcurrency}`
      );
      assert.equal(Object.keys(stateAfterReset.agents).length, 0, 'Agents should be cleared');

      const cliStatusAfterReset = await runCli(['status', '--table'], { cwd: ws1.dir });
      assert.equal(cliStatusAfterReset.exitCode, 0);

      assert.ok(
        cliStatusAfterReset.stdout.includes('∞ (unlimited)'),
        'Status table after reset must still contain "∞ (unlimited)"'
      );
      assert.ok(
        !cliStatusAfterReset.stdout.includes('/ 4 active'),
        'Status table after reset must NOT contain "/ 4 active"'
      );
      assert.match(
        cliStatusAfterReset.stdout,
        /Concurrency:\s+0\s*\/\s*∞ \(unlimited\)\s+active\s+\(0 total agents\)/,
        'Concurrency line after reset must match "Concurrency: 0 / ∞ (unlimited) active (0 total agents)"'
      );
    });

  } finally {
    await ws1.cleanup();
  }

  // ---------------------------------------------------------------------------
  // TEST 4: CLI run parsing: worker counts > 16 (e.g. --workers 24, --workers 30)
  // ---------------------------------------------------------------------------
  const ws2 = await createTestWorkspace({ isGit: true });

  try {
    await test('CLI run --workers 24 initializes 24 agents without clamping to 16', async () => {
      const runResult = await runCli(
        ['run', 'Empirical 24-Worker CLI Run Test', '--workers', '24', '--once', '--plain'],
        { cwd: ws2.dir, timeout: 20000 }
      );

      assert.equal(runResult.exitCode, 0, `CLI run failed: ${runResult.stderr}`);

      const state = await ws2.readState();
      assert.ok(state, 'State file should exist after run');
      assert.equal(state.maxConcurrency, 0, 'Default concurrency should be 0 (unlimited)');

      const agentKeys = Object.keys(state.agents);
      console.log(`  [Agents created by --workers 24]: count = ${agentKeys.length}`);
      assert.equal(
        agentKeys.length,
        24,
        `Expected 24 agents created, got ${agentKeys.length} (must not be clamped to 16)`
      );

      // Verify specific agent IDs
      assert.ok(state.agents['worker-1'], 'worker-1 should exist');
      assert.ok(state.agents['worker-16'], 'worker-16 should exist');
      assert.ok(state.agents['worker-24'], 'worker-24 should exist');

      // Verify stdout also rendered status table with 24 agents and ∞ (unlimited)
      assert.ok(
        runResult.stdout.includes('∞ (unlimited)'),
        'CLI run --plain output must display "∞ (unlimited)"'
      );
      assert.match(
        runResult.stdout,
        /Concurrency:\s+24\s*\/\s*∞ \(unlimited\)\s+active\s+\(24 total agents\)/,
        'CLI run output must match "Concurrency: 24 / ∞ (unlimited) active (24 total agents)"'
      );
    });

    await test('CLI run --workers 30 with --concurrency 0 initializes 30 agents', async () => {
      const runResult = await runCli(
        ['run', 'Empirical 30-Worker Test', '--workers', '30', '--concurrency', '0', '--force', '--once', '--plain'],
        { cwd: ws2.dir, timeout: 25000 }
      );

      assert.equal(runResult.exitCode, 0, `CLI run failed: ${runResult.stderr}`);

      const state = await ws2.readState();
      const agentKeys = Object.keys(state.agents);
      console.log(`  [Agents created by --workers 30]: count = ${agentKeys.length}`);
      assert.equal(agentKeys.length, 30, `Expected 30 agents, got ${agentKeys.length}`);
      assert.ok(state.agents['worker-30'], 'worker-30 should exist');
      assert.equal(state.maxConcurrency, 0);
    });

  } finally {
    await ws2.cleanup();
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Adversarial Stress Checks
  // ---------------------------------------------------------------------------
  const ws3 = await createTestWorkspace({ isGit: true });

  try {
    const client = await createMcpClient(ws3.dir);

    await test('Adversarial: File lock serialization is preserved under infinite concurrency (maxConcurrency: 0)', async () => {
      // If 2 agents both target "src/core/critical.ts", even with maxConcurrency: 0,
      // the second agent must NOT run simultaneously; it must queue for file lock.
      const res = await client.callTool('spawn_swarm', {
        mission: 'Lock Contention Stress Test with maxConcurrency 0',
        maxConcurrency: 0,
        parallel: true,
        agents: [
          {
            id: 'lock-holder-1',
            role: 'writer-1',
            taskSpec: 'Modifying critical core file',
            targetFiles: ['src/core/critical.ts'],
            dependsOn: [],
          },
          {
            id: 'lock-waiter-2',
            role: 'writer-2',
            taskSpec: 'Also modifying critical core file',
            targetFiles: ['src/core/critical.ts'],
            dependsOn: [],
          },
          {
            id: 'independent-worker-3',
            role: 'independent',
            taskSpec: 'Modifying independent file',
            targetFiles: ['src/utils/helper.ts'],
            dependsOn: [],
          },
        ],
      });

      assert.equal(res.isError, false);
      const state = await ws3.readState();

      // lock-holder-1 and independent-worker-3 should be running
      assert.equal(state.agents['lock-holder-1'].status, 'running');
      assert.equal(state.agents['independent-worker-3'].status, 'running');

      // lock-waiter-2 MUST remain pending because of file lock collision!
      assert.equal(
        state.agents['lock-waiter-2'].status,
        'pending',
        'Agent targeting colliding file must be pending even with maxConcurrency: 0'
      );
    });

    await test('Adversarial: Cycle detection across large dependency chains in spawn_swarm', async () => {
      // Create 20 agents where 1->2->...->20->1 (cycle)
      const cyclicAgents = [];
      for (let i = 1; i <= 20; i++) {
        const nextId = i === 20 ? 1 : i + 1;
        cyclicAgents.push({
          id: `cycle-node-${i}`,
          role: `cycle_worker_${i}`,
          taskSpec: `Cyclic task ${i}`,
          targetFiles: [`file_${i}.ts`],
          dependsOn: [`cycle-node-${nextId}`],
        });
      }

      const res = await client.callTool('spawn_swarm', {
        mission: 'Cyclic Graph Stress Test',
        maxConcurrency: 0,
        parallel: true,
        agents: cyclicAgents,
      });

      assert.equal(res.isError, true, 'Spawn swarm must reject cyclic dependency graph');
      assert.ok(
        res.message.includes('Cycle detected') || res.content?.[0]?.text?.includes('Cycle detected'),
        'Error message must indicate cycle detected'
      );
    });

    await test('Adversarial: Negative maxConcurrency is rejected by Zod schema validation', async () => {
      const res = await client.callTool('spawn_swarm', {
        mission: 'Negative Concurrency Test',
        maxConcurrency: -1,
        agents: [],
      });

      assert.equal(res.isError, true, 'Negative maxConcurrency must be rejected by Zod schema');
    });

    await client.close();
  } finally {
    await ws3.cleanup();
  }

  console.log('================================================================');
  console.log(`ALL ${passedTests}/${totalTests} EMPIRICAL STRESS TESTS PASSED SUCCESSFULLY!`);
  console.log('================================================================\n');
}

main().catch((err) => {
  console.error('\n*** EMPIRICAL STRESS TEST SUITE FAILED ***\n', err);
  process.exit(1);
});
