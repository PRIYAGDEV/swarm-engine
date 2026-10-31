/**
 * Tier 3: Cross-Feature Interactions
 * 
 * Verifies DAG diamond dependency resolution, file lock contention,
 * concurrency limits, dynamic agent addition, and blackboard synchronization.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  createTestWorkspace,
  createMcpClient,
  requireCliOrSkip,
} from './harness.mjs';

test('Tier 3 - Cross-Feature Interactions', async (t) => {
  if (!requireCliOrSkip(t)) return;

  await t.test('T3-INT-01: DAG Diamond dependency execution (A -> [B, C] -> D)', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      // Define Diamond DAG:
      //         A
      //       /   \
      //      B     C
      //       \   /
      //         D
      const res = await client.callTool('spawn_swarm', {
        mission: 'Diamond DAG Execution',
        maxConcurrency: 4,
        strictDependencies: true,
        agents: [
          {
            id: 'agent-A',
            role: 'architect',
            taskSpec: 'Define base interfaces',
            dependsOn: [],
            targetFiles: ['src/base.ts'],
          },
          {
            id: 'agent-B',
            role: 'client_dev',
            taskSpec: 'Build client',
            dependsOn: ['agent-A'],
            targetFiles: ['src/client.ts'],
          },
          {
            id: 'agent-C',
            role: 'server_dev',
            taskSpec: 'Build server',
            dependsOn: ['agent-A'],
            targetFiles: ['src/server.ts'],
          },
          {
            id: 'agent-D',
            role: 'qa_engineer',
            taskSpec: 'Integration test',
            dependsOn: ['agent-B', 'agent-C'],
            targetFiles: ['src/integration.test.ts'],
          },
        ],
      });

      assert.equal(res.isError, false);

      // Step 1: Only A should be running initially
      let state = await ws.readState();
      assert.equal(state.agents['agent-A'].status, 'running');
      assert.equal(state.agents['agent-B'].status, 'pending');
      assert.equal(state.agents['agent-C'].status, 'pending');
      assert.equal(state.agents['agent-D'].status, 'pending');

      // Step 2: Complete A
      await client.callTool('complete_agent_task', {
        agentId: 'agent-A',
        summary: 'Base interfaces completed',
      });

      // Both B and C should now be running in parallel; D still pending
      state = await ws.readState();
      assert.equal(state.agents['agent-A'].status, 'completed');
      assert.equal(state.agents['agent-B'].status, 'running');
      assert.equal(state.agents['agent-C'].status, 'running');
      assert.equal(state.agents['agent-D'].status, 'pending');

      // Step 3: Complete B (C still running)
      await client.callTool('complete_agent_task', {
        agentId: 'agent-B',
        summary: 'Client completed',
      });

      state = await ws.readState();
      assert.equal(state.agents['agent-B'].status, 'completed');
      assert.equal(state.agents['agent-C'].status, 'running');
      assert.equal(state.agents['agent-D'].status, 'pending', 'D must remain pending until C completes');

      // Step 4: Complete C
      await client.callTool('complete_agent_task', {
        agentId: 'agent-C',
        summary: 'Server completed',
      });

      // Now D should automatically transition to running
      state = await ws.readState();
      assert.equal(state.agents['agent-C'].status, 'completed');
      assert.equal(state.agents['agent-D'].status, 'running', 'D should start once both B and C are completed');

      // Step 5: Complete D
      await client.callTool('complete_agent_task', {
        agentId: 'agent-D',
        summary: 'Integration tests pass',
      });

      state = await ws.readState();
      assert.equal(state.agents['agent-D'].status, 'completed');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T3-INT-02: File lock contention blocks concurrent agents on same file', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      // Agents A and B have NO dependency, but both target shared.json
      await client.callTool('spawn_swarm', {
        mission: 'File Contention Test',
        maxConcurrency: 4,
        agents: [
          {
            id: 'agent-lock-A',
            role: 'writer-A',
            taskSpec: 'Update shared config',
            dependsOn: [],
            targetFiles: ['shared.json'],
          },
          {
            id: 'agent-lock-B',
            role: 'writer-B',
            taskSpec: 'Also update shared config',
            dependsOn: [],
            targetFiles: ['shared.json'],
          },
        ],
      });

      let state = await ws.readState();
      const aStatus = state.agents['agent-lock-A'].status;
      const bStatus = state.agents['agent-lock-B'].status;

      // Exactly one is running, one is pending
      assert.ok(
        (aStatus === 'running' && bStatus === 'pending') ||
          (bStatus === 'running' && aStatus === 'pending'),
        'One agent must run while the other is blocked on file lock'
      );

      const runningId = aStatus === 'running' ? 'agent-lock-A' : 'agent-lock-B';
      const blockedId = runningId === 'agent-lock-A' ? 'agent-lock-B' : 'agent-lock-A';

      // Complete the running agent
      await client.callTool('complete_agent_task', {
        agentId: runningId,
        summary: 'First agent finished updating shared.json',
      });

      // Blocked agent should now automatically transition to running
      state = await ws.readState();
      assert.equal(state.agents[runningId].status, 'completed');
      assert.equal(
        state.agents[blockedId].status,
        'running',
        'Previously blocked agent should now be running after lock release'
      );
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T3-INT-03: Concurrency throttling restricts running agents to maxConcurrency', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      // 4 independent agents targeting separate files, maxConcurrency: 2
      await client.callTool('spawn_swarm', {
        mission: 'Concurrency Gating Test',
        maxConcurrency: 2,
        agents: [
          { id: 'agent-cg-1', role: 'w1', taskSpec: 'T1', targetFiles: ['f1.txt'] },
          { id: 'agent-cg-2', role: 'w2', taskSpec: 'T2', targetFiles: ['f2.txt'] },
          { id: 'agent-cg-3', role: 'w3', taskSpec: 'T3', targetFiles: ['f3.txt'] },
          { id: 'agent-cg-4', role: 'w4', taskSpec: 'T4', targetFiles: ['f4.txt'] },
        ],
      });

      let state = await ws.readState();
      const runningAgents = Object.values(state.agents).filter((a) => a.status === 'running');
      const pendingAgents = Object.values(state.agents).filter((a) => a.status === 'pending');

      assert.equal(runningAgents.length, 2, 'Exactly 2 agents should be running');
      assert.equal(pendingAgents.length, 2, 'Remaining 2 agents must be pending');

      // Complete one running agent
      await client.callTool('complete_agent_task', {
        agentId: runningAgents[0].id,
        summary: 'Task completed',
      });

      // A pending agent should now take the freed slot
      state = await ws.readState();
      const newRunning = Object.values(state.agents).filter((a) => a.status === 'running');
      const newCompleted = Object.values(state.agents).filter((a) => a.status === 'completed');

      assert.equal(newCompleted.length, 1);
      assert.equal(newRunning.length, 2, 'Running count should remain at maxConcurrency (2)');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T3-INT-04: Mid-run dynamic agent addition resolves dependencies cleanly', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      await client.callTool('spawn_swarm', {
        mission: 'Dynamic Addition Test',
        strictDependencies: true,
        agents: [
          {
            id: 'agent-parent',
            role: 'lead',
            taskSpec: 'Design architecture',
            targetFiles: ['arch.md'],
          },
        ],
      });

      // Inject child agent depending on agent-parent
      const dynRes = await client.callTool('add_dynamic_agent', {
        role: 'subordinate',
        taskSpec: 'Implement based on arch',
        dependsOn: ['agent-parent'],
        targetFiles: ['impl.js'],
      });

      assert.equal(dynRes.isError, false);
      const childId = dynRes.data.agent.id;

      let state = await ws.readState();
      assert.equal(state.agents[childId].status, 'pending', 'Dynamic agent should be pending initially');

      // Complete parent
      await client.callTool('complete_agent_task', {
        agentId: 'agent-parent',
        summary: 'Architecture complete',
      });

      // Dynamic child should now be scheduled and running
      state = await ws.readState();
      assert.equal(state.agents[childId].status, 'running', 'Dynamic agent should activate after dependency completes');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T3-INT-05: Blackboard data is shared across agents and injected into worktree context', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      await client.callTool('spawn_swarm', {
        mission: 'Blackboard Data Sync Test',
        agents: [
          {
            id: 'agent-producer',
            role: 'api_designer',
            taskSpec: 'Publish API specs',
            targetFiles: ['api.json'],
          },
          {
            id: 'agent-consumer',
            role: 'client_impl',
            taskSpec: 'Consume API specs',
            dependsOn: ['agent-producer'],
            targetFiles: ['client.js'],
          },
        ],
      });

      // Producer publishes shared schema to blackboard
      await client.callTool('write_blackboard', {
        key: 'auth_endpoints',
        value: { login: '/api/v1/login', logout: '/api/v1/logout' },
      });

      // Complete producer
      await client.callTool('complete_agent_task', {
        agentId: 'agent-producer',
        summary: 'API specs designed',
      });

      // Pull consumer task
      const pull = await client.callTool('pull_agent_task', { agentId: 'agent-consumer' });
      assert.equal(pull.isError, false);
      assert.ok(pull.data.blackboard);
      assert.deepEqual(pull.data.blackboard.auth_endpoints, {
        login: '/api/v1/login',
        logout: '/api/v1/logout',
      });

      // Verify AGENT_TASK.md in consumer worktree also contains blackboard data
      const consumerWorktree = path.join(ws.dir, '.swarm', 'worktrees', 'agent-consumer');
      const taskMd = await fs.readFile(path.join(consumerWorktree, 'AGENT_TASK.md'), 'utf8');
      assert.ok(
        taskMd.includes('auth_endpoints') && taskMd.includes('/api/v1/login'),
        'AGENT_TASK.md should embed blackboard context'
      );
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T3-INT-06: Cascading unblocking in a 3-agent chain (A -> B -> C)', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      await client.callTool('spawn_swarm', {
        mission: 'Cascade Chain Test',
        strictDependencies: true,
        agents: [
          { id: 'chain-1', role: 'r1', taskSpec: 'T1', dependsOn: [] },
          { id: 'chain-2', role: 'r2', taskSpec: 'T2', dependsOn: ['chain-1'] },
          { id: 'chain-3', role: 'r3', taskSpec: 'T3', dependsOn: ['chain-2'] },
        ],
      });

      // Step 1: Complete 1 -> 2 starts
      await client.callTool('complete_agent_task', { agentId: 'chain-1', summary: 'C1 done' });
      let state = await ws.readState();
      assert.equal(state.agents['chain-2'].status, 'running');
      assert.equal(state.agents['chain-3'].status, 'pending');

      // Step 2: Complete 2 -> 3 starts
      await client.callTool('complete_agent_task', { agentId: 'chain-2', summary: 'C2 done' });
      state = await ws.readState();
      assert.equal(state.agents['chain-3'].status, 'running');

      // Step 3: Complete 3 -> all complete
      await client.callTool('complete_agent_task', { agentId: 'chain-3', summary: 'C3 done' });
      state = await ws.readState();
      assert.ok(Object.values(state.agents).every((a) => a.status === 'completed'));
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T3-INT-07: Default parallel swarm runs all agents simultaneously with zero queuing', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      // Spawn 5 agents where some have dependsOn tags
      const res = await client.callTool('spawn_swarm', {
        mission: 'Parallel Execution Test',
        agents: [
          { id: 'explorer', role: 'explorer', taskSpec: 'Explore' },
          { id: 'backend-dev', role: 'backend', taskSpec: 'Backend', dependsOn: ['explorer'] },
          { id: 'ui-dev', role: 'ui', taskSpec: 'UI', dependsOn: ['explorer'] },
          { id: 'tester', role: 'tester', taskSpec: 'Test', dependsOn: ['backend-dev', 'ui-dev'] },
          { id: 'reviewer', role: 'reviewer', taskSpec: 'Review', dependsOn: ['tester'] },
        ],
      });

      assert.equal(res.isError, false);
      const state = await ws.readState();

      // ALL 5 agents must be 'running' simultaneously in parallel
      const runningAgents = Object.values(state.agents).filter((a) => a.status === 'running');
      const pendingAgents = Object.values(state.agents).filter((a) => a.status === 'pending');

      assert.equal(runningAgents.length, 5, 'All 5 agents must run simultaneously in parallel');
      assert.equal(pendingAgents.length, 0, 'Zero agents should be stuck in pending or queued');

      // Verify each agent has its own isolated worktree
      for (const a of Object.values(state.agents)) {
        assert.ok(a.worktreePath, `Agent ${a.id} must have a dedicated worktree`);
      }
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });
});
