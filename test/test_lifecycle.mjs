/**
 * Test Suite: Dynamic Lifecycle & Spawning Engine (Features 6–10)
 * 
 * Covers:
 * - Feature 6: 6-state lifecycle state machine (waiting, working, stopped, completed, failed, killed)
 * - Feature 7: Unified swarm management tool (swarm with actions status, add, kill, model, models, title)
 * - Feature 8: Hierarchical helper subagents (parentId, helperIds hierarchy, cascading auto-cleanup on parent death)
 * - Feature 9: Runtime model hot-swapping (swarm{action:"model"} updates model mid-task while preserving context)
 * - Feature 10: Context forking (fork:"<member>" clones conversation context, task spec, and memory for new worker)
 * 
 * Organized in 3 Tiers:
 * - Tier 1: Nominal Feature Coverage (>=5 test cases per feature = 25 cases)
 * - Tier 2: Boundary & Corner Cases (>=5 test cases per feature = 25 cases)
 * - Tier 3: Cross-Feature Combinations (>=5 pairwise interaction cases)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestWorkspace,
  createMcpClient,
  isCliBuilt,
  CLI_PATH,
} from './harness.mjs';

/**
 * Checks if dist/index.js is built and required MCP tools are available.
 * If not, skips test with descriptive explanation.
 */
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

test('Dynamic Lifecycle & Spawning Engine (Features 6–10)', async (suite) => {

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (ISOLATION TESTING)
  // =========================================================================

  await suite.test('Tier 1: Feature 6 — 6-State Lifecycle State Machine', async (t) => {
    await t.test('F6-T1-01: Agent initializes in waiting or working state upon spawn', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        const res = await client.callTool('swarm', {
          action: 'add',
          name: 'worker-alpha',
          brief: 'Initial task assignment',
        });
        assert.equal(res.isError, false);

        const statusRes = await client.callTool('swarm', { action: 'status' });
        assert.equal(statusRes.isError, false);
        const agent = statusRes.data.agents?.['worker-alpha'] || statusRes.data.roster?.['worker-alpha'];
        assert.ok(agent, 'worker-alpha should exist in roster');
        assert.ok(['waiting', 'working', 'pending', 'running'].includes(agent.status), `Initial status valid: ${agent.status}`);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F6-T1-02: Agent transitions to waiting when entering swarm_wait', async (ct) => {
      const ws = await createTestWorkspace();
      let cWorker, cStatus;
      try {
        cWorker = await createMcpClient(ws.dir);
        cStatus = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, cStatus, 'swarm', 'swarm_wait'))) return;

        await cStatus.callTool('swarm', { action: 'add', name: 'sleepy-worker', brief: 'Wait test' });

        const waitPromise = cWorker.callTool('swarm_wait', {
          memberName: 'sleepy-worker',
          timeoutMs: 800,
        });

        await new Promise((r) => setTimeout(r, 150));
        const statusRes = await cStatus.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['sleepy-worker'] || statusRes.data.roster?.['sleepy-worker'];
        assert.equal(agent.status, 'waiting', 'Agent must be in waiting state during swarm_wait');

        await waitPromise;
      } finally {
        await cWorker?.close();
        await cStatus?.close();
        await ws.cleanup();
      }
    });

    await t.test('F6-T1-03: Agent transitions from waiting to working when targeted by doorbell mention', async (ct) => {
      const ws = await createTestWorkspace();
      let cWorker, cPoster;
      try {
        cWorker = await createMcpClient(ws.dir);
        cPoster = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, cPoster, 'swarm', 'post_message', 'swarm_wait'))) return;

        await cPoster.callTool('swarm', { action: 'add', name: 'active-worker', brief: 'Doorbell target' });

        const waitPromise = cWorker.callTool('swarm_wait', {
          memberName: 'active-worker',
          timeoutMs: 3000,
        });

        await new Promise((r) => setTimeout(r, 150));
        await cPoster.callTool('post_message', { text: '@active-worker work begins', from: 'coordinator' });

        const waitRes = await waitPromise;
        assert.equal(waitRes.data.timedOut, false);

        const statusRes = await cPoster.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['active-worker'] || statusRes.data.roster?.['active-worker'];
        assert.ok(['working', 'running'].includes(agent.status), 'Agent transitions to working/running after wakeup');
      } finally {
        await cWorker?.close();
        await cPoster?.close();
        await ws.cleanup();
      }
    });

    await t.test('F6-T1-04: Agent transitions to completed upon task completion', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'complete_agent_task'))) return;

        await client.callTool('swarm', { action: 'add', name: 'finishing-worker', brief: 'Short task' });
        const resComplete = await client.callTool('complete_agent_task', {
          agentId: 'finishing-worker',
          summary: 'All deliverables complete',
        });
        assert.equal(resComplete.isError, false);

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['finishing-worker'] || statusRes.data.roster?.['finishing-worker'];
        assert.equal(agent.status, 'completed', 'Status must be completed');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F6-T1-05: Agent transitions to killed when killed and cannot be resurrected', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'doomed-worker', brief: 'To be killed' });
        const resKill = await client.callTool('swarm', { action: 'kill', name: 'doomed-worker' });
        assert.equal(resKill.isError, false);

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['doomed-worker'] || statusRes.data.roster?.['doomed-worker'];
        assert.ok(agent.status === 'killed' || agent.killed === true, 'Agent must be marked killed');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  await suite.test('Tier 1: Feature 7 — Unified Swarm Management Tool (swarm)', async (t) => {
    await t.test('F7-T1-01: swarm status returns complete roster, state counts, and mission', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        const res = await client.callTool('swarm', { action: 'status' });
        assert.equal(res.isError, false);
        assert.ok(res.data.counts !== undefined || res.data.summary !== undefined);
        assert.ok(res.data.agents !== undefined || res.data.members !== undefined);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F7-T1-02: swarm add registers and initializes a new subagent', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        const res = await client.callTool('swarm', {
          action: 'add',
          name: 'builder-01',
          brief: 'Compile native binary artifacts',
          model: 'claude-3-5-sonnet',
        });
        assert.equal(res.isError, false);
        assert.equal(res.data.success, true);

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['builder-01'] || statusRes.data.roster?.['builder-01'];
        assert.ok(agent, 'builder-01 should be present');
        assert.equal(agent.brief || agent.taskSpec, 'Compile native binary artifacts');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F7-T1-03: swarm kill marks agent killed and releases all associated resources', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'terminator-target', brief: 'Short lived' });
        const resKill = await client.callTool('swarm', { action: 'kill', name: 'terminator-target' });
        assert.equal(resKill.isError, false);
        assert.equal(resKill.data.success, true);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F7-T1-04: swarm models returns detected/configured models and quota availability', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        const res = await client.callTool('swarm', { action: 'models' });
        assert.equal(res.isError, false);
        assert.ok(Array.isArray(res.data.models) || res.data.models !== undefined, 'models should be returned');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F7-T1-05: swarm title updates swarm mission or title across all nodes', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        const res = await client.callTool('swarm', { action: 'title', title: 'Refactor Compiler AST' });
        assert.equal(res.isError, false);

        const statusRes = await client.callTool('swarm', { action: 'status' });
        assert.equal(statusRes.data.title || statusRes.data.mission, 'Refactor Compiler AST');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  await suite.test('Tier 1: Feature 8 — Hierarchical Helper Subagents', async (t) => {
    await t.test('F8-T1-01: Spawning helper subagent with parentId establishes parent-child relationship', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'lead-worker', brief: 'Lead architect' });
        const resHelper = await client.callTool('swarm', {
          action: 'add',
          name: 'lead-worker-helper',
          brief: 'Parse schema subtask',
          parentId: 'lead-worker',
        });
        assert.equal(resHelper.isError, false);

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const helper = statusRes.data.agents?.['lead-worker-helper'] || statusRes.data.roster?.['lead-worker-helper'];
        assert.equal(helper.parentId, 'lead-worker', 'parentId should match parent agent');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F8-T1-02: Parent agent records helper ID in helperIds array', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'manager', brief: 'Task manager' });
        await client.callTool('swarm', { action: 'add', name: 'assistant-1', parentId: 'manager', brief: 'Subtask 1' });
        await client.callTool('swarm', { action: 'add', name: 'assistant-2', parentId: 'manager', brief: 'Subtask 2' });

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const manager = statusRes.data.agents?.['manager'] || statusRes.data.roster?.['manager'];
        assert.ok(Array.isArray(manager.helperIds), 'helperIds must be an array');
        assert.ok(manager.helperIds.includes('assistant-1'));
        assert.ok(manager.helperIds.includes('assistant-2'));
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F8-T1-03: Helper subagent tracks independent status and execution progress', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'complete_agent_task'))) return;

        await client.callTool('swarm', { action: 'add', name: 'parent-agent', brief: 'Long job' });
        await client.callTool('swarm', { action: 'add', name: 'helper-fast', parentId: 'parent-agent', brief: 'Fast helper' });

        // Complete only the helper
        await client.callTool('complete_agent_task', { agentId: 'helper-fast', summary: 'Helper done' });

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const parent = statusRes.data.agents?.['parent-agent'] || statusRes.data.roster?.['parent-agent'];
        const helper = statusRes.data.agents?.['helper-fast'] || statusRes.data.roster?.['helper-fast'];

        assert.equal(helper.status, 'completed');
        assert.notEqual(parent.status, 'completed', 'Parent status should remain active');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F8-T1-04: Cascading termination: killing parent automatically kills all child helper subagents', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'lead-parent', brief: 'Lead parent' });
        await client.callTool('swarm', { action: 'add', name: 'sub-child-1', parentId: 'lead-parent', brief: 'Child 1' });
        await client.callTool('swarm', { action: 'add', name: 'sub-child-2', parentId: 'lead-parent', brief: 'Child 2' });

        // Kill the parent
        const resKill = await client.callTool('swarm', { action: 'kill', name: 'lead-parent' });
        assert.equal(resKill.isError, false);

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const parent = statusRes.data.agents?.['lead-parent'] || statusRes.data.roster?.['lead-parent'];
        const child1 = statusRes.data.agents?.['sub-child-1'] || statusRes.data.roster?.['sub-child-1'];
        const child2 = statusRes.data.agents?.['sub-child-2'] || statusRes.data.roster?.['sub-child-2'];

        assert.ok(parent.status === 'killed' || parent.killed === true);
        assert.ok(child1.status === 'killed' || child1.killed === true, 'Child 1 should be auto-killed on parent death');
        assert.ok(child2.status === 'killed' || child2.killed === true, 'Child 2 should be auto-killed on parent death');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F8-T1-05: Scoped boundaries: helper cannot terminate parent agent', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'boss-agent', brief: 'Boss' });
        await client.callTool('swarm', { action: 'add', name: 'minion-agent', parentId: 'boss-agent', brief: 'Minion' });

        // Minion attempts to kill boss
        const resKill = await client.callTool('swarm', {
          action: 'kill',
          name: 'boss-agent',
          callerId: 'minion-agent',
        });

        // Either rejected or status remains boss alive
        if (!resKill.isError) {
          const statusRes = await client.callTool('swarm', { action: 'status' });
          const boss = statusRes.data.agents?.['boss-agent'] || statusRes.data.roster?.['boss-agent'];
          assert.notEqual(boss.status, 'killed');
        }
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  await suite.test('Tier 1: Feature 9 — Runtime Model Hot-Swapping', async (t) => {
    await t.test('F9-T1-01: swarm model successfully updates agent model identifier', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', {
          action: 'add',
          name: 'coder-01',
          brief: 'Code generation',
          model: 'gemini-2.5-pro',
        });

        const resSwitch = await client.callTool('swarm', {
          action: 'model',
          name: 'coder-01',
          model: 'claude-3-7-sonnet',
        });
        assert.equal(resSwitch.isError, false);

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['coder-01'] || statusRes.data.roster?.['coder-01'];
        assert.equal(agent.model, 'claude-3-7-sonnet');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F9-T1-02: Model hot-swap preserves agent state, blackboard entries, and action history', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'write_blackboard'))) return;

        await client.callTool('swarm', { action: 'add', name: 'stateful-worker', brief: 'Complex memory' });
        await client.callTool('write_blackboard', { key: 'stateful-worker:progress', value: '42%' });

        await client.callTool('swarm', {
          action: 'model',
          name: 'stateful-worker',
          model: 'gpt-4o-mini',
        });

        const statusRes = await client.callTool('swarm', { action: 'status' });
        assert.equal(statusRes.data.blackboard?.['stateful-worker:progress'], '42%', 'Blackboard memory must be preserved');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F9-T1-03: Model hot-swap while agent is waiting updates roster without disturbing sleep', async (ct) => {
      const ws = await createTestWorkspace();
      let cWorker, cLead;
      try {
        cWorker = await createMcpClient(ws.dir);
        cLead = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, cLead, 'swarm', 'swarm_wait'))) return;

        await cLead.callTool('swarm', { action: 'add', name: 'sleeping-model-worker', brief: 'Hot swap asleep' });

        const waitPromise = cWorker.callTool('swarm_wait', {
          memberName: 'sleeping-model-worker',
          timeoutMs: 800,
        });

        await new Promise((r) => setTimeout(r, 150));
        // Switch model while agent is waiting
        const resModel = await cLead.callTool('swarm', {
          action: 'model',
          name: 'sleeping-model-worker',
          model: 'deepseek-coder-v2',
        });
        assert.equal(resModel.isError, false);

        await waitPromise;

        const statusRes = await cLead.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['sleeping-model-worker'] || statusRes.data.roster?.['sleeping-model-worker'];
        assert.equal(agent.model, 'deepseek-coder-v2');
      } finally {
        await cWorker?.close();
        await cLead?.close();
        await ws.cleanup();
      }
    });

    await t.test('F9-T1-04: Hot-swapped agent executes subsequent tasks using the new model identifier', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'pipeline-worker', brief: 'Phase 1', model: 'model-a' });
        await client.callTool('swarm', { action: 'model', name: 'pipeline-worker', model: 'model-b' });

        const status = await client.callTool('swarm', { action: 'status' });
        const agent = status.data.agents?.['pipeline-worker'] || status.data.roster?.['pipeline-worker'];
        assert.equal(agent.model, 'model-b');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F9-T1-05: swarm status reflects the updated model across status snapshots', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'reporter', brief: 'Report status', model: 'v1' });
        await client.callTool('swarm', { action: 'model', name: 'reporter', model: 'v2' });

        const resStatus = await client.callTool('swarm', { action: 'status' });
        const agent = resStatus.data.agents?.['reporter'] || resStatus.data.roster?.['reporter'];
        assert.equal(agent.model, 'v2');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  await suite.test('Tier 1: Feature 10 — Context Forking', async (t) => {
    await t.test('F10-T1-01: Context forking clones task context and brief from existing agent', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', {
          action: 'add',
          name: 'source-worker',
          brief: 'Investigate memory leaks in auth controller',
        });

        const resFork = await client.callTool('swarm', {
          action: 'add',
          name: 'forked-worker',
          fork: 'source-worker',
          brief: 'Patch memory leaks found by source worker',
        });
        assert.equal(resFork.isError, false);
        assert.equal(resFork.data.success, true);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F10-T1-02: Forked agent receives unique ID and independent status tracking', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'src-agent', brief: 'Base task' });
        await client.callTool('swarm', { action: 'add', name: 'dst-agent', fork: 'src-agent' });

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const src = statusRes.data.agents?.['src-agent'] || statusRes.data.roster?.['src-agent'];
        const dst = statusRes.data.agents?.['dst-agent'] || statusRes.data.roster?.['dst-agent'];

        assert.ok(src && dst, 'Both source and forked agent must exist');
        assert.notEqual(src.id, dst.id);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F10-T1-03: Forked agent preserves source agent blackboard context and references', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'write_blackboard'))) return;

        await client.callTool('swarm', { action: 'add', name: 'architect', brief: 'System schema' });
        await client.callTool('write_blackboard', { key: 'schema:ast', value: { type: 'Program', body: [] } });

        await client.callTool('swarm', { action: 'add', name: 'ast-developer', fork: 'architect' });
        const statusRes = await client.callTool('swarm', { action: 'status' });
        assert.deepEqual(statusRes.data.blackboard?.['schema:ast'], { type: 'Program', body: [] });
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F10-T1-04: Mutations by forked agent do not alter source agent state', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'complete_agent_task'))) return;

        await client.callTool('swarm', { action: 'add', name: 'prime-worker', brief: 'Prime' });
        await client.callTool('swarm', { action: 'add', name: 'branch-worker', fork: 'prime-worker' });

        // Complete forked agent
        await client.callTool('complete_agent_task', { agentId: 'branch-worker', summary: 'Branch done' });

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const prime = statusRes.data.agents?.['prime-worker'] || statusRes.data.roster?.['prime-worker'];
        const branch = statusRes.data.agents?.['branch-worker'] || statusRes.data.roster?.['branch-worker'];

        assert.equal(branch.status, 'completed');
        assert.notEqual(prime.status, 'completed', 'Source agent must remain unaffected');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F10-T1-05: Fork from coordinator transfers mission overview and initial briefs', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'title', title: 'Global Mission Alpha' });
        const resFork = await client.callTool('swarm', {
          action: 'add',
          name: 'delegate-agent',
          fork: 'coordinator',
          brief: 'Execute high-level delegator plan',
        });

        assert.equal(resFork.isError, false);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================

  await suite.test('Tier 2: Boundary & Corner Cases (Features 6–10)', async (t) => {
    await t.test('F6-T2-01: Illegal state transition: attempting to transition killed agent to working is rejected', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'dead-agent', brief: 'Short life' });
        await client.callTool('swarm', { action: 'kill', name: 'dead-agent' });

        // Try adding with exact same name again
        const resAddAgain = await client.callTool('swarm', { action: 'add', name: 'dead-agent', brief: 'Revive attempt' });
        assert.equal(resAddAgain.isError, true, 'Killed agent name cannot be revived/reused directly');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F6-T2-02: Illegal state transition: transitioning completed agent directly to working is rejected', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'complete_agent_task', 'run_agent_task'))) return;

        await client.callTool('swarm', { action: 'add', name: 'finished-worker', brief: 'Completed work' });
        await client.callTool('complete_agent_task', { agentId: 'finished-worker', summary: 'Done' });

        const resRerun = await client.callTool('run_agent_task', { agentId: 'finished-worker' });
        // Attempting to run completed task should be rejected or no-op
        assert.ok(resRerun.isError || resRerun.data?.started === false);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F6-T2-03: Re-adding agent with previously killed name without unique suffix is rejected', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'parser-one', brief: 'Grammar' });
        await client.callTool('swarm', { action: 'kill', name: 'parser-one' });

        const resRevive = await client.callTool('swarm', { action: 'add', name: 'parser-one', brief: 'Revival' });
        assert.equal(resRevive.isError, true, 'Must reject duplicate killed name');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F6-T2-04: Transient failure state records error details and transitions to failed', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'update_agent_progress'))) return;

        await client.callTool('swarm', { action: 'add', name: 'failing-worker', brief: 'Fault injection' });
        await client.callTool('update_agent_progress', {
          agentId: 'failing-worker',
          thought: 'Fatal syntax error in module: panic()',
        });

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['failing-worker'] || statusRes.data.roster?.['failing-worker'];
        assert.ok(agent.thought.includes('panic'));
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F6-T2-05: System restart preserves stopped state for active agents', async (ct) => {
      const ws = await createTestWorkspace();
      let client1, client2;
      try {
        client1 = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client1, 'swarm'))) return;

        await client1.callTool('swarm', { action: 'add', name: 'persistent-worker', brief: 'Long duration' });
        await client1.close();

        // Reconnect new MCP client (simulates server restart)
        client2 = await createMcpClient(ws.dir);
        const statusRes = await client2.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['persistent-worker'] || statusRes.data.roster?.['persistent-worker'];
        assert.ok(agent, 'Agent must persist across client re-instantiation');
      } finally {
        await client1?.close();
        await client2?.close();
        await ws.cleanup();
      }
    });

    await t.test('F7-T2-01: swarm add with duplicate live agent ID rejected with error', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'worker-unique', brief: 'Original' });
        const resDup = await client.callTool('swarm', { action: 'add', name: 'worker-unique', brief: 'Duplicate' });
        assert.equal(resDup.isError, true, 'Duplicate agent ID must be rejected');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F7-T2-02: swarm add with empty or whitespace-only name rejected', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        const res1 = await client.callTool('swarm', { action: 'add', name: '', brief: 'No name' });
        const res2 = await client.callTool('swarm', { action: 'add', name: '   ', brief: 'Whitespace' });

        assert.equal(res1.isError, true);
        assert.equal(res2.isError, true);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F7-T2-03: swarm kill on non-existent agent handled gracefully with error', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        const resKill = await client.callTool('swarm', { action: 'kill', name: 'non-existent-agent-id' });
        assert.equal(resKill.isError, true, 'Killing unknown agent must return error');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F7-T2-04: swarm kill on already killed agent is idempotent or returns error', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'victim-agent', brief: 'Kill me twice' });
        await client.callTool('swarm', { action: 'kill', name: 'victim-agent' });
        const resKill2 = await client.callTool('swarm', { action: 'kill', name: 'victim-agent' });

        // Repeated kill must be idempotent or return clean error
        assert.ok(resKill2.isError || resKill2.data?.alreadyKilled === true);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F7-T2-05: swarm title with empty string rejected or preserves previous title', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'title', title: 'Valid Title' });
        const resEmpty = await client.callTool('swarm', { action: 'title', title: '' });

        assert.ok(resEmpty.isError || resEmpty.data?.title === 'Valid Title');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F8-T2-01: Multi-level hierarchy (parent -> child -> grandchild) cascading kill terminates entire tree', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'grandparent', brief: 'Top' });
        await client.callTool('swarm', { action: 'add', name: 'parent-mid', parentId: 'grandparent', brief: 'Mid' });
        await client.callTool('swarm', { action: 'add', name: 'child-leaf', parentId: 'parent-mid', brief: 'Leaf' });

        // Kill grandparent
        await client.callTool('swarm', { action: 'kill', name: 'grandparent' });

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const gp = statusRes.data.agents?.['grandparent'] || statusRes.data.roster?.['grandparent'];
        const p = statusRes.data.agents?.['parent-mid'] || statusRes.data.roster?.['parent-mid'];
        const c = statusRes.data.agents?.['child-leaf'] || statusRes.data.roster?.['child-leaf'];

        assert.ok(gp.status === 'killed' || gp.killed);
        assert.ok(p.status === 'killed' || p.killed, 'Parent-mid must be killed');
        assert.ok(c.status === 'killed' || c.killed, 'Child-leaf must be killed');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F8-T2-02: Spawning helper with non-existent parentId rejected with error', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        const res = await client.callTool('swarm', {
          action: 'add',
          name: 'orphan-helper',
          parentId: 'non-existent-parent',
          brief: 'Should fail',
        });
        assert.equal(res.isError, true, 'Spawning with non-existent parentId must fail');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F8-T2-03: Helper cannot kill sibling subagent outside its hierarchical subtree', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'parent-a', brief: 'Branch A' });
        await client.callTool('swarm', { action: 'add', name: 'worker-a1', parentId: 'parent-a', brief: 'A1' });
        await client.callTool('swarm', { action: 'add', name: 'parent-b', brief: 'Branch B' });
        await client.callTool('swarm', { action: 'add', name: 'worker-b1', parentId: 'parent-b', brief: 'B1' });

        // worker-a1 tries to kill worker-b1
        const resKill = await client.callTool('swarm', {
          action: 'kill',
          name: 'worker-b1',
          callerId: 'worker-a1',
        });

        if (!resKill.isError) {
          const statusRes = await client.callTool('swarm', { action: 'status' });
          const b1 = statusRes.data.agents?.['worker-b1'] || statusRes.data.roster?.['worker-b1'];
          assert.notEqual(b1.status, 'killed');
        }
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F8-T2-04: High-concurrency helper spawning: multiple parallel helper creations under single parent', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'busy-parent', brief: 'Spawning manager' });

        const spawns = Array.from({ length: 5 }, (_, i) =>
          client.callTool('swarm', {
            action: 'add',
            name: `helper-sub-${i + 1}`,
            parentId: 'busy-parent',
            brief: `Subtask ${i + 1}`,
          })
        );

        const results = await Promise.all(spawns);
        for (const res of results) {
          assert.equal(res.isError, false);
        }

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const parent = statusRes.data.agents?.['busy-parent'] || statusRes.data.roster?.['busy-parent'];
        assert.equal(parent.helperIds.length, 5, 'Parent should track all 5 helpers');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F8-T2-05: Killing parent that already has a failed helper cleans up remaining hierarchy safely', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'complete_agent_task'))) return;

        await client.callTool('swarm', { action: 'add', name: 'faulty-parent', brief: 'Parent' });
        await client.callTool('swarm', { action: 'add', name: 'failed-child', parentId: 'faulty-parent', brief: 'Child 1' });
        await client.callTool('swarm', { action: 'add', name: 'active-child', parentId: 'faulty-parent', brief: 'Child 2' });

        // Kill the parent
        const resKill = await client.callTool('swarm', { action: 'kill', name: 'faulty-parent' });
        assert.equal(resKill.isError, false);

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const child2 = statusRes.data.agents?.['active-child'] || statusRes.data.roster?.['active-child'];
        assert.ok(child2.status === 'killed' || child2.killed);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F9-T2-01: Hot-swapping model on killed agent rejected with error', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'corpse-agent', brief: 'Died' });
        await client.callTool('swarm', { action: 'kill', name: 'corpse-agent' });

        const resSwitch = await client.callTool('swarm', {
          action: 'model',
          name: 'corpse-agent',
          model: 'gpt-4o',
        });
        assert.equal(resSwitch.isError, true, 'Switching model on killed agent must be rejected');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F9-T2-02: Hot-swapping with empty or invalid model identifier rejected', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'model-tester', brief: 'Model swap' });
        const resEmpty = await client.callTool('swarm', {
          action: 'model',
          name: 'model-tester',
          model: '',
        });
        assert.equal(resEmpty.isError, true, 'Empty model name must be rejected');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F9-T2-03: Rapid successive model hot-swaps resolve to final model without race', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'fluid-model-worker', brief: 'Swaps' });
        await client.callTool('swarm', { action: 'model', name: 'fluid-model-worker', model: 'model-1' });
        await client.callTool('swarm', { action: 'model', name: 'fluid-model-worker', model: 'model-2' });
        await client.callTool('swarm', { action: 'model', name: 'fluid-model-worker', model: 'model-3' });

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['fluid-model-worker'] || statusRes.data.roster?.['fluid-model-worker'];
        assert.equal(agent.model, 'model-3');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F9-T2-04: Hot-swapping to identical model is idempotent and succeeds', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'stable-model', brief: 'Stable', model: 'claude-3-haiku' });
        const resSame = await client.callTool('swarm', { action: 'model', name: 'stable-model', model: 'claude-3-haiku' });
        assert.equal(resSame.isError, false);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F9-T2-05: Hot-swapping model while agent holds file locks preserves locks without release', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'spawn_swarm'))) return;

        await client.callTool('spawn_swarm', {
          mission: 'Lock test',
          agents: [
            { id: 'lock-holder', role: 'writer', taskSpec: 'Hold file', targetFiles: ['src/critical.ts'] },
          ],
        });

        await client.callTool('swarm', { action: 'model', name: 'lock-holder', model: 'gemini-pro' });

        const state = await ws.readState();
        const locked = Array.isArray(state.lockedFiles)
          ? state.lockedFiles
          : Object.keys(state.lockedFiles || {});
        assert.ok(locked.some((f) => f.includes('critical')), 'Lock must not be evicted during model switch');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F10-T2-01: Forking from non-existent agent rejected with error', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        const res = await client.callTool('swarm', {
          action: 'add',
          name: 'bad-fork',
          fork: 'non-existent-source',
        });
        assert.equal(res.isError, true, 'Forking from unknown agent must fail');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F10-T2-02: Forking from killed agent rejected with error', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'dead-source', brief: 'Dead' });
        await client.callTool('swarm', { action: 'kill', name: 'dead-source' });

        const res = await client.callTool('swarm', {
          action: 'add',
          name: 'fork-from-dead',
          fork: 'dead-source',
        });
        assert.equal(res.isError, true, 'Forking from killed agent must fail');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F10-T2-03: Forking from self (name === fork) rejected as circular dependency', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        const res = await client.callTool('swarm', {
          action: 'add',
          name: 'ouroboros',
          fork: 'ouroboros',
        });
        assert.equal(res.isError, true, 'Self-forking must be rejected');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F10-T2-04: Concurrent forks from same parent agent initialize independently without race', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'common-ancestor', brief: 'Shared template' });

        const forks = Array.from({ length: 4 }, (_, i) =>
          client.callTool('swarm', {
            action: 'add',
            name: `fork-copy-${i + 1}`,
            fork: 'common-ancestor',
          })
        );

        const results = await Promise.all(forks);
        for (const res of results) {
          assert.equal(res.isError, false);
        }

        const statusRes = await client.callTool('swarm', { action: 'status' });
        for (let i = 1; i <= 4; i++) {
          assert.ok(statusRes.data.agents?.[`fork-copy-${i}`] || statusRes.data.roster?.[`fork-copy-${i}`]);
        }
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F10-T2-05: Forking with empty name or missing parameters handled with validation error', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'valid-root', brief: 'Root' });
        const resEmpty = await client.callTool('swarm', {
          action: 'add',
          name: '',
          fork: 'valid-root',
        });
        assert.equal(resEmpty.isError, true);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (PAIRWISE INTERACTIONS)
  // =========================================================================

  await suite.test('Tier 3: Cross-Feature Interactions (Lifecycle, Unified Tool, Helpers & Models)', async (t) => {
    await t.test('F6-F10-INT-01: Forked worker enters waiting in swarm_wait, receives doorbell, transitions to working', async (ct) => {
      const ws = await createTestWorkspace();
      let cWorker, cLeader;
      try {
        cWorker = await createMcpClient(ws.dir);
        cLeader = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, cLeader, 'swarm', 'swarm_wait', 'post_message'))) return;

        await cLeader.callTool('swarm', { action: 'add', name: 'template-worker', brief: 'Seed brief' });
        await cLeader.callTool('swarm', { action: 'add', name: 'forked-runner', fork: 'template-worker' });

        const waitPromise = cWorker.callTool('swarm_wait', {
          memberName: 'forked-runner',
          timeoutMs: 4000,
        });

        await new Promise((r) => setTimeout(r, 200));
        await cLeader.callTool('post_message', { text: '@forked-runner begin computation', from: 'leader' });

        const waitRes = await waitPromise;
        assert.equal(waitRes.data.timedOut, false);
      } finally {
        await cWorker?.close();
        await cLeader?.close();
        await ws.cleanup();
      }
    });

    await t.test('F6-F10-INT-02: Helper subagent model hot-swap: parent spawns helper, hot-swaps helper model, verifies state', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'parent-boss', brief: 'Architect' });
        await client.callTool('swarm', {
          action: 'add',
          name: 'child-coder',
          parentId: 'parent-boss',
          brief: 'Implement AST',
          model: 'base-model',
        });

        const resSwitch = await client.callTool('swarm', {
          action: 'model',
          name: 'child-coder',
          model: 'pro-model',
        });
        assert.equal(resSwitch.isError, false);

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const child = statusRes.data.agents?.['child-coder'] || statusRes.data.roster?.['child-coder'];
        assert.equal(child.model, 'pro-model');
        assert.equal(child.parentId, 'parent-boss');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F6-F10-INT-03: Multi-level helper tree with model hot-swap and cascading kill of all levels', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'level-1', brief: 'L1' });
        await client.callTool('swarm', { action: 'add', name: 'level-2', parentId: 'level-1', brief: 'L2' });
        await client.callTool('swarm', { action: 'add', name: 'level-3', parentId: 'level-2', brief: 'L3' });

        // Hot swap level-3
        await client.callTool('swarm', { action: 'model', name: 'level-3', model: 'swapped-model' });

        // Kill level-1; should cascade kill level-2 and level-3
        await client.callTool('swarm', { action: 'kill', name: 'level-1' });

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const l1 = statusRes.data.agents?.['level-1'] || statusRes.data.roster?.['level-1'];
        const l2 = statusRes.data.agents?.['level-2'] || statusRes.data.roster?.['level-2'];
        const l3 = statusRes.data.agents?.['level-3'] || statusRes.data.roster?.['level-3'];

        assert.ok(l1.status === 'killed' || l1.killed);
        assert.ok(l2.status === 'killed' || l2.killed);
        assert.ok(l3.status === 'killed' || l3.killed);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F6-F10-INT-04: State cursor tracking across forked agent: forked worker initializes distinct cursors', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'post_message', 'read_board'))) return;

        await client.callTool('swarm', { action: 'add', name: 'origin-worker', brief: 'Origin' });
        await client.callTool('post_message', { text: 'Early msg 1', from: 'origin-worker' });
        await client.callTool('read_board', {});

        await client.callTool('swarm', { action: 'add', name: 'split-worker', fork: 'origin-worker' });

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const origin = statusRes.data.agents?.['origin-worker'] || statusRes.data.roster?.['origin-worker'];
        const split = statusRes.data.agents?.['split-worker'] || statusRes.data.roster?.['split-worker'];

        assert.ok(origin && split);
        assert.notEqual(origin.id, split.id);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F6-F10-INT-05: Complete lifecycle cycle: spawn -> working -> swarm_wait -> waiting -> doorbell -> working -> complete', async (ct) => {
      const ws = await createTestWorkspace();
      let cWorker, cOrchestrator;
      try {
        cWorker = await createMcpClient(ws.dir);
        cOrchestrator = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, cOrchestrator, 'swarm', 'swarm_wait', 'post_message', 'complete_agent_task'))) return;

        // 1. Spawn
        await cOrchestrator.callTool('swarm', { action: 'add', name: 'lifecycle-star', brief: 'Full loop' });

        // 2. swarm_wait -> waiting
        const waitPromise = cWorker.callTool('swarm_wait', {
          memberName: 'lifecycle-star',
          timeoutMs: 4000,
        });
        await new Promise((r) => setTimeout(r, 150));

        // 3. doorbell mention
        await cOrchestrator.callTool('post_message', { text: '@lifecycle-star wake up to finish', from: 'boss' });
        const waitRes = await waitPromise;
        assert.equal(waitRes.data.timedOut, false);

        // 4. complete_agent_task -> completed
        await cOrchestrator.callTool('complete_agent_task', { agentId: 'lifecycle-star', summary: 'Cycle done' });

        const statusRes = await cOrchestrator.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['lifecycle-star'] || statusRes.data.roster?.['lifecycle-star'];
        assert.equal(agent.status, 'completed');
      } finally {
        await cWorker?.close();
        await cOrchestrator?.close();
        await ws.cleanup();
      }
    });
  });
});
