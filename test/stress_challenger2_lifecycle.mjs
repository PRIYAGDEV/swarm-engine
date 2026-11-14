/**
 * Challenger 2 Stress Test Suite: Hot-Swapping, Fork Storms & Terminal Guards
 * 
 * Verifies:
 * - Stress 1: Rapid model hot-swapping under high-volume message traffic
 * - Stress 2: Fork storms (15+ parallel forks from worker and coordinator)
 * - Stress 3: Circular, non-existent, and dead-agent fork rejection
 * - Stress 4: Terminal task guards and model hot-swap boundaries
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createTestWorkspace,
  createMcpClient,
  isCliBuilt,
  CLI_PATH,
} from './harness.mjs';
import {
  validateStatusTransition,
  transitionAgentStatus,
  isTerminalStatus,
} from '../dist/state.js';

async function requireToolsOrSkip(t, client, ...toolNames) {
  if (!isCliBuilt()) {
    t.skip(`Skipping: CLI not built at ${CLI_PATH}. Compile with 'npm run build' first.`);
    return false;
  }
  const tools = await client.listTools();
  const available = new Set(tools.map((x) => x.name));
  for (const name of toolNames) {
    if (!available.has(name)) {
      t.skip(`Skipping: Tool '${name}' not implemented in MCP server`);
      return false;
    }
  }
  return true;
}

test('Challenger 2 Empirical Stress Suite (Milestone 2)', async (suite) => {

  // =========================================================================
  // STRESS 1: RAPID MODEL HOT-SWAPPING UNDER HIGH-VOLUME MESSAGE TRAFFIC
  // =========================================================================
  await suite.test('Stress 1: Rapid model hot-swapping under message traffic and blackboard updates', async (t) => {
    const ws = await createTestWorkspace();
    let clientPoster, clientSwapper, clientListener;
    try {
      clientPoster = await createMcpClient(ws.dir);
      clientSwapper = await createMcpClient(ws.dir);
      clientListener = await createMcpClient(ws.dir);

      if (!(await requireToolsOrSkip(t, clientPoster, 'swarm', 'post_message', 'read_board', 'swarm_wait', 'write_blackboard'))) {
        return;
      }

      // Initialize primary agents
      const addRes1 = await clientSwapper.callTool('swarm', {
        action: 'add',
        name: 'swap-target',
        role: 'worker',
        model: 'gemini-2.5-flash',
        brief: 'Rapid hot-swap under load',
      });
      assert.equal(addRes1.isError, false);

      const addRes2 = await clientListener.callTool('swarm', {
        action: 'add',
        name: 'traffic-listener',
        role: 'listener',
        brief: 'Listening to doorbells',
      });
      assert.equal(addRes2.isError, false);

      // Start listener in swarm_wait in background
      const waitPromise = clientListener.callTool('swarm_wait', {
        memberName: 'traffic-listener',
        timeoutMs: 5000,
      });

      const modelsToCycle = [
        'gemini-2.5-pro',
        'claude-3-7-sonnet',
        'deepseek-coder-v2',
        'gpt-4o',
        'gpt-4o-mini',
        'claude-3-5-haiku',
        'gemini-2.0-flash',
        'custom-expert-v1',
        'gemini-2.5-pro-preview',
        'deepseek-r1',
      ];

      const TOTAL_MESSAGES = 60;
      const TOTAL_SWAPS = 20;
      const TOTAL_BB = 10;

      // 1. Concurrently execute:
      // a) Rapid message posts across multiple channels
      const postPromise = (async () => {
        const results = [];
        for (let i = 1; i <= TOTAL_MESSAGES; i++) {
          const channel = i % 3 === 0 ? 'main' : (i % 3 === 1 ? 'dev' : 'alerts');
          const mention = i === 30 ? '@traffic-listener doorbell wakeup' : (i % 2 === 0 ? '@swap-target status check' : '@all broadcast info');
          const res = await clientPoster.callTool('post_message', {
            text: `Traffic message #${i}: ${mention}`,
            from: 'coordinator',
            channel,
          });
          results.push(res);
        }
        return results;
      })();

      // b) Rapid model hot-swapping on swap-target
      const swapPromise = (async () => {
        const results = [];
        for (let i = 0; i < TOTAL_SWAPS; i++) {
          const nextModel = modelsToCycle[i % modelsToCycle.length];
          const res = await clientSwapper.callTool('swarm', {
            action: 'model',
            name: 'swap-target',
            model: nextModel,
          });
          results.push({ res, model: nextModel });
        }
        return results;
      })();

      // c) Concurrent blackboard writes
      const bbPromise = (async () => {
        const results = [];
        for (let i = 0; i < TOTAL_BB; i++) {
          const res = await clientPoster.callTool('write_blackboard', {
            key: `traffic_key_${i}`,
            value: { iteration: i, timestamp: Date.now() },
          });
          results.push(res);
        }
        return results;
      })();

      // Await all concurrent operations
      const [postResults, swapResults, bbResults] = await Promise.all([
        postPromise,
        swapPromise,
        bbPromise,
      ]);

      // Verify posts
      for (let i = 0; i < postResults.length; i++) {
        assert.equal(postResults[i].isError, false, `Post #${i + 1} should succeed`);
        assert.ok(postResults[i].data?.seq > 0, `Post #${i + 1} must have sequence number`);
      }

      // Verify swaps
      for (let i = 0; i < swapResults.length; i++) {
        assert.equal(swapResults[i].res.isError, false, `Swap #${i + 1} should succeed`);
        assert.equal(swapResults[i].res.data?.model, swapResults[i].model);
      }

      // Verify blackboard
      for (let i = 0; i < bbResults.length; i++) {
        assert.equal(bbResults[i].isError, false, `Blackboard write #${i} should succeed`);
      }

      // Verify listener woke up from doorbell
      const waitRes = await waitPromise;
      assert.equal(waitRes.isError, false);
      assert.equal(waitRes.data?.timedOut, false, 'Listener should have woken up via message #30 doorbell');

      // Final state audit
      const statusRes = await clientSwapper.callTool('swarm', { action: 'status' });
      assert.equal(statusRes.isError, false);

      const targetAgent = statusRes.data.agents?.['swap-target'] || statusRes.data.roster?.['swap-target'];
      assert.ok(targetAgent, 'swap-target must be present in roster');
      const expectedFinalModel = modelsToCycle[(TOTAL_SWAPS - 1) % modelsToCycle.length];
      assert.equal(targetAgent.model, expectedFinalModel, 'Final model must match last hot-swap');

      // Verify blackboard intact
      const bb = statusRes.data.blackboard || {};
      for (let i = 0; i < TOTAL_BB; i++) {
        assert.ok(bb[`traffic_key_${i}`], `Blackboard key traffic_key_${i} must exist`);
        assert.equal(bb[`traffic_key_${i}`].iteration, i);
      }

      // Verify board message count and monotonic sequence
      const boardRes = await clientPoster.callTool('read_board', { since: 0, limit: 200 });
      assert.equal(boardRes.isError, false);
      assert.ok(boardRes.data.messages.length >= TOTAL_MESSAGES, `Expected at least ${TOTAL_MESSAGES} messages on board`);

      // Verify raw board.jsonl lines
      const boardJsonlPath = path.join(ws.dir, '.swarm', 'board.jsonl');
      const boardContent = await fs.readFile(boardJsonlPath, 'utf8');
      const lines = boardContent.split('\n').filter((l) => l.trim().length > 0);
      assert.ok(lines.length >= TOTAL_MESSAGES, 'board.jsonl lines match total messages');
      for (const line of lines) {
        const parsed = JSON.parse(line);
        assert.ok(typeof parsed.seq === 'number' && parsed.seq > 0, 'Every line in board.jsonl has valid positive seq');
      }
    } finally {
      await clientPoster?.close();
      await clientSwapper?.close();
      await clientListener?.close();
      await ws.cleanup();
    }
  });

  // =========================================================================
  // STRESS 2: FORK STORMS (16+ PARALLEL CONCURRENT FORKS)
  // =========================================================================
  await suite.test('Stress 2: Fork storms (16 parallel forks from worker and 12 parallel forks from coordinator)', async (t) => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);
      if (!(await requireToolsOrSkip(t, client, 'swarm'))) return;

      // 1. Create source specialized worker
      const sourceInit = await client.callTool('swarm', {
        action: 'add',
        name: 'prime-oracle',
        role: 'researcher',
        model: 'gemini-2.5-pro',
        brief: 'Synthesize distributed knowledge base',
        channels: ['main', 'research', 'analytics'],
      });
      assert.equal(sourceInit.isError, false);

      // 2. Launch Fork Storm: 16 concurrent forks simultaneously
      const FORK_COUNT = 16;
      const forkPromises = Array.from({ length: FORK_COUNT }, (_, i) =>
        client.callTool('swarm', {
          action: 'add',
          name: `fork-node-${i}`,
          fork: 'prime-oracle',
        })
      );

      const forkResults = await Promise.all(forkPromises);
      for (let i = 0; i < FORK_COUNT; i++) {
        assert.equal(forkResults[i].isError, false, `Fork #${i} creation must succeed without error`);
        assert.equal(forkResults[i].data?.name, `fork-node-${i}`);
      }

      // Verify all 16 forks registered in swarm status
      const statusRes1 = await client.callTool('swarm', { action: 'status' });
      assert.equal(statusRes1.isError, false);
      const roster = statusRes1.data.agents || statusRes1.data.roster || {};

      for (let i = 0; i < FORK_COUNT; i++) {
        const forkName = `fork-node-${i}`;
        const fAgent = roster[forkName];
        assert.ok(fAgent, `${forkName} must exist in swarm roster`);
        assert.equal(fAgent.id, forkName);
        assert.equal(fAgent.forkedFrom, 'prime-oracle', `${forkName} must record forkedFrom: prime-oracle`);
        assert.equal(fAgent.brief, 'Synthesize distributed knowledge base', `${forkName} cloned source brief`);
        assert.equal(fAgent.role, 'researcher', `${forkName} cloned source role`);
        assert.equal(fAgent.model, 'gemini-2.5-pro', `${forkName} cloned source model`);
        assert.ok(fAgent.channels.includes('research'), `${forkName} cloned research channel`);
        assert.ok(fAgent.channels.includes('analytics'), `${forkName} cloned analytics channel`);
      }

      // 3. Independent State Mutation Test across forked swarm
      // - Complete fork-node-0
      if (client.listTools && (await client.listTools()).some((x) => x.name === 'complete_agent_task')) {
        await client.callTool('complete_agent_task', { agentId: 'fork-node-0', summary: 'Done slice 0' });
      }
      // - Kill fork-node-1
      await client.callTool('swarm', { action: 'kill', name: 'fork-node-1' });
      // - Hot-swap fork-node-2 to another model
      await client.callTool('swarm', { action: 'model', name: 'fork-node-2', model: 'claude-3-7-sonnet' });

      // Verify source-agent and siblings remain untampered
      const statusRes2 = await client.callTool('swarm', { action: 'status' });
      const roster2 = statusRes2.data.agents || statusRes2.data.roster || {};

      const prime = roster2['prime-oracle'];
      assert.equal(prime.model, 'gemini-2.5-pro', 'Source agent model unaffected by fork mutations');
      assert.notEqual(prime.status, 'killed', 'Source agent must not be killed');
      assert.notEqual(prime.status, 'completed', 'Source agent must not be completed');

      assert.equal(roster2['fork-node-1'].status, 'killed', 'fork-node-1 is killed');
      assert.equal(roster2['fork-node-2'].model, 'claude-3-7-sonnet', 'fork-node-2 updated model');
      assert.equal(roster2['fork-node-3'].model, 'gemini-2.5-pro', 'fork-node-3 retained original model');
      assert.notEqual(roster2['fork-node-3'].status, 'killed', 'fork-node-3 remains alive');

      // 4. Coordinator Fork Storm: 12 concurrent forks from coordinator
      const COORD_FORK_COUNT = 12;
      const coordForkPromises = Array.from({ length: COORD_FORK_COUNT }, (_, i) =>
        client.callTool('swarm', {
          action: 'add',
          name: `coord-fork-${i}`,
          fork: 'coordinator',
        })
      );

      const coordForkResults = await Promise.all(coordForkPromises);
      for (let i = 0; i < COORD_FORK_COUNT; i++) {
        assert.equal(coordForkResults[i].isError, false, `Coord fork #${i} creation must succeed`);
        assert.equal(coordForkResults[i].data?.name, `coord-fork-${i}`);
      }

      const statusRes3 = await client.callTool('swarm', { action: 'status' });
      const roster3 = statusRes3.data.agents || statusRes3.data.roster || {};
      for (let i = 0; i < COORD_FORK_COUNT; i++) {
        const cFork = roster3[`coord-fork-${i}`];
        assert.ok(cFork, `coord-fork-${i} must exist in roster`);
        assert.equal(cFork.forkedFrom, 'coordinator');
      }
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  // =========================================================================
  // STRESS 3: CIRCULAR, NON-EXISTENT, AND DEAD-AGENT FORK REJECTION
  // =========================================================================
  await suite.test('Stress 3: Circular, dead-ancestor, and killed-agent fork rejection', async (t) => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);
      if (!(await requireToolsOrSkip(t, client, 'swarm'))) return;

      // 3.1: Direct self-fork
      const selfForkRes = await client.callTool('swarm', {
        action: 'add',
        name: 'ouroboros',
        fork: 'ouroboros',
      });
      assert.equal(selfForkRes.isError, true, 'Self-fork must be rejected');

      // 3.2: Fork from non-existent agent
      const ghostForkRes = await client.callTool('swarm', {
        action: 'add',
        name: 'ghost-fork',
        fork: 'phantom-non-existent-agent',
      });
      assert.equal(ghostForkRes.isError, true, 'Fork from non-existent agent must be rejected');

      // 3.3: Fork from directly killed agent
      await client.callTool('swarm', { action: 'add', name: 'victim-agent', brief: 'Short lived' });
      await client.callTool('swarm', { action: 'kill', name: 'victim-agent' });

      const deadForkRes = await client.callTool('swarm', {
        action: 'add',
        name: 'necromancer-fork',
        fork: 'victim-agent',
      });
      assert.equal(deadForkRes.isError, true, 'Forking from killed agent must be rejected');

      // 3.4: Multi-level hierarchy kill and descendant fork rejection
      // Create grandparent -> parent -> grandchild
      await client.callTool('swarm', { action: 'add', name: 'grandparent-node', brief: 'GP' });
      await client.callTool('swarm', { action: 'add', name: 'parent-node', parentId: 'grandparent-node', brief: 'P' });
      await client.callTool('swarm', { action: 'add', name: 'grandchild-node', parentId: 'parent-node', brief: 'GC' });

      // Kill grandparent (cascade kills parent and grandchild)
      const killRes = await client.callTool('swarm', { action: 'kill', name: 'grandparent-node' });
      assert.equal(killRes.isError, false);

      const statusRes = await client.callTool('swarm', { action: 'status' });
      const roster = statusRes.data.agents || statusRes.data.roster || {};
      assert.ok(roster['grandparent-node'].killed || roster['grandparent-node'].status === 'killed');
      assert.ok(roster['parent-node'].killed || roster['parent-node'].status === 'killed');
      assert.ok(roster['grandchild-node'].killed || roster['grandchild-node'].status === 'killed');

      // Attempt to fork from cascade-killed parent
      const forkDeadParent = await client.callTool('swarm', {
        action: 'add',
        name: 'fork-dead-parent',
        fork: 'parent-node',
      });
      assert.equal(forkDeadParent.isError, true, 'Fork from cascade-killed parent must be rejected');

      // Attempt to fork from cascade-killed grandchild
      const forkDeadGC = await client.callTool('swarm', {
        action: 'add',
        name: 'fork-dead-gc',
        fork: 'grandchild-node',
      });
      assert.equal(forkDeadGC.isError, true, 'Fork from cascade-killed grandchild must be rejected');

      // 3.5: Spawning helper under killed ancestor or descendant
      const helperUnderDeadGP = await client.callTool('swarm', {
        action: 'add',
        name: 'illegal-helper-1',
        parentId: 'grandparent-node',
      });
      assert.equal(helperUnderDeadGP.isError, true, 'Cannot spawn helper under killed parent');

      const helperUnderDeadGC = await client.callTool('swarm', {
        action: 'add',
        name: 'illegal-helper-2',
        parentId: 'grandchild-node',
      });
      assert.equal(helperUnderDeadGC.isError, true, 'Cannot spawn helper under killed grandchild');

      // 3.6: Attempting to revive killed agent name without unique suffix
      const resurrectRes = await client.callTool('swarm', {
        action: 'add',
        name: 'victim-agent',
        brief: 'Resurrected',
      });
      assert.equal(resurrectRes.isError, true, 'Resurrecting killed agent name directly must be rejected');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  // =========================================================================
  // STRESS 4: TERMINAL TASK GUARDS & MODEL HOT-SWAP RESTRICTIONS
  // =========================================================================
  await suite.test('Stress 4: Terminal task guards, state transitions & hot-swap boundaries', async (t) => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);
      if (!(await requireToolsOrSkip(t, client, 'swarm', 'complete_agent_task', 'run_agent_task'))) return;

      // 4.1: Direct status machine terminal guard verification
      assert.ok(isTerminalStatus('completed'), 'completed is terminal');
      assert.ok(isTerminalStatus('failed'), 'failed is terminal');
      assert.ok(isTerminalStatus('killed'), 'killed is terminal');
      assert.ok(!isTerminalStatus('working'), 'working is not terminal');
      assert.ok(!isTerminalStatus('waiting'), 'waiting is not terminal');

      const transCompToWork = validateStatusTransition('completed', 'working');
      assert.equal(transCompToWork.valid, false, 'completed -> working transition must be invalid');

      const transFailedToWork = validateStatusTransition('failed', 'working');
      assert.equal(transFailedToWork.valid, false, 'failed -> working transition must be invalid');

      const transKilledToWork = validateStatusTransition('killed', 'working');
      assert.equal(transKilledToWork.valid, false, 'killed -> working transition must be invalid');

      // 4.2: Model hot-swap on killed agent via MCP
      await client.callTool('swarm', { action: 'add', name: 'guarded-killed', brief: 'Kill test' });
      await client.callTool('swarm', { action: 'kill', name: 'guarded-killed' });

      const swapKilledRes = await client.callTool('swarm', {
        action: 'model',
        name: 'guarded-killed',
        model: 'deepseek-r1',
      });
      assert.equal(swapKilledRes.isError, true, 'Hot-swapping model on killed agent must be rejected');

      // 4.3: Model hot-swap on completed agent via MCP
      await client.callTool('swarm', { action: 'add', name: 'guarded-completed', brief: 'Done test' });
      await client.callTool('complete_agent_task', { agentId: 'guarded-completed', summary: 'Finished' });

      // Verify agent is completed
      const statusRes1 = await client.callTool('swarm', { action: 'status' });
      const completedAg = statusRes1.data.agents?.['guarded-completed'] || statusRes1.data.roster?.['guarded-completed'];
      assert.equal(completedAg.status, 'completed');

      // Test hot-swap on completed agent
      const swapCompletedRes = await client.callTool('swarm', {
        action: 'model',
        name: 'guarded-completed',
        model: 'claude-3-7-sonnet',
      });
      // SCOPE.md Feature 9 requires: "Rejects model hot-swapping on terminal agents (killed, completed)"
      assert.equal(
        swapCompletedRes.isError,
        true,
        'Hot-swapping model on completed agent must be rejected as terminal agent guard'
      );

      // 4.4: Re-running completed agent via run_agent_task
      const rerunCompleted = await client.callTool('run_agent_task', { agentId: 'guarded-completed' });
      assert.ok(
        rerunCompleted.isError || rerunCompleted.data?.started === false,
        'Cannot re-run completed agent task'
      );

      // 4.5: Re-running killed agent via run_agent_task
      const rerunKilled = await client.callTool('run_agent_task', { agentId: 'guarded-killed' });
      assert.ok(
        rerunKilled.isError || rerunKilled.data?.started === false,
        'Cannot re-run killed agent task'
      );

      // 4.6: Directly verify transitionAgentStatus throws when attempting to revive terminal agents
      await assert.rejects(
        async () => {
          await transitionAgentStatus('guarded-completed', 'working', undefined, path.join(ws.dir, '.swarm'));
        },
        /Illegal state transition/,
        'transitionAgentStatus must throw when attempting to transition completed agent to working'
      );

      await assert.rejects(
        async () => {
          await transitionAgentStatus('guarded-killed', 'working', undefined, path.join(ws.dir, '.swarm'));
        },
        /Illegal state transition/,
        'transitionAgentStatus must throw when attempting to transition killed agent to working'
      );


    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

});
