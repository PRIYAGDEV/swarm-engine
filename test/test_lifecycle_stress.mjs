/**
 * Test Suite: Lifecycle & Hierarchy Empirical Stress Testing (Milestone 2 Challenge)
 * 
 * Adversarial and stress verification covering:
 * - Challenge 1: Deep multi-tier cascades (5 tiers: Root -> L1 -> L2 -> L3 -> L4)
 * - Challenge 2: Repeated concurrent kills (10 simultaneous swarm kill calls)
 * - Challenge 3: Doorbell wakeup concurrency (broadcast storms & parallel targeted wakeups)
 * - Challenge 4: Terminal state immutability (completed, failed, killed state protection)
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
  transitionAgentStatus,
  validateStatusTransition,
  isTerminalStatus,
  readState,
  updateState,
  getSwarmDir,
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

test('Lifecycle & Hierarchy Empirical Stress Challenge Suite', async (suite) => {

  // =========================================================================
  // CHALLENGE 1: DEEP MULTI-TIER CASCADES (5 TIERS)
  // =========================================================================

  await suite.test('Challenge 1: Deep 5-Tier Hierarchical Cascades & Scoped Boundaries', async (t) => {

    await t.test('C1-01: 5-Tier linear cascade (Root -> L1 -> L2 -> L3 -> L4) terminates all descendants cleanly and releases locks', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        // Spawn 5 levels of hierarchy:
        // Tier 0: root-coordinator
        // Tier 1: lead-architect (parent: root-coordinator)
        // Tier 2: backend-lead (parent: lead-architect)
        // Tier 3: auth-specialist (parent: backend-lead)
        // Tier 4: crypto-worker (parent: auth-specialist)
        const levels = [
          { name: 'root-coordinator', parentId: undefined },
          { name: 'lead-architect', parentId: 'root-coordinator' },
          { name: 'backend-lead', parentId: 'lead-architect' },
          { name: 'auth-specialist', parentId: 'backend-lead' },
          { name: 'crypto-worker', parentId: 'auth-specialist' },
        ];

        for (const node of levels) {
          const res = await client.callTool('swarm', {
            action: 'add',
            name: node.name,
            parentId: node.parentId,
            brief: `Hierarchy node ${node.name}`,
          });
          assert.equal(res.isError, false, `Failed to spawn ${node.name}: ${res.message}`);
        }

        // Assign file locks across various tiers in state
        await updateState((state) => {
          state.lockedFiles['src/root.ts'] = 'root-coordinator';
          state.lockedFiles['src/arch.ts'] = 'lead-architect';
          state.lockedFiles['src/backend/core.ts'] = 'backend-lead';
          state.lockedFiles['src/backend/auth.ts'] = 'auth-specialist';
          state.lockedFiles['src/backend/crypto.ts'] = 'crypto-worker';
        }, getSwarmDir(ws.dir));

        // Verify initial state
        const initialStatus = await client.callTool('swarm', { action: 'status' });
        assert.equal(initialStatus.isError, false);
        const lockedBefore = Object.keys(initialStatus.data.lockedFiles || {});
        assert.equal(lockedBefore.length, 5, 'All 5 tiers must have locked files');

        // Verify helperIds linkage
        const agentsBefore = initialStatus.data.agents;
        assert.deepEqual(agentsBefore['root-coordinator'].helperIds, ['lead-architect']);
        assert.deepEqual(agentsBefore['lead-architect'].helperIds, ['backend-lead']);
        assert.deepEqual(agentsBefore['backend-lead'].helperIds, ['auth-specialist']);
        assert.deepEqual(agentsBefore['auth-specialist'].helperIds, ['crypto-worker']);
        assert.deepEqual(agentsBefore['crypto-worker'].helperIds, []);

        // Terminate root-coordinator
        const killRes = await client.callTool('swarm', {
          action: 'kill',
          name: 'root-coordinator',
        });
        assert.equal(killRes.isError, false);
        assert.ok(killRes.data.killed.includes('root-coordinator'));
        assert.ok(killRes.data.killed.includes('lead-architect'));
        assert.ok(killRes.data.killed.includes('backend-lead'));
        assert.ok(killRes.data.killed.includes('auth-specialist'));
        assert.ok(killRes.data.killed.includes('crypto-worker'));
        assert.equal(killRes.data.killed.length, 5, 'Exactly 5 agents must be in kill list');

        // Verify all agents are killed in status snapshot
        const afterStatus = await client.callTool('swarm', { action: 'status' });
        const agentsAfter = afterStatus.data.agents;
        for (const node of levels) {
          const ag = agentsAfter[node.name];
          assert.ok(ag, `${node.name} must exist in state`);
          assert.equal(ag.status, 'killed', `${node.name} must be in killed status`);
          assert.equal(ag.killed, true, `${node.name} killed flag must be true`);
          assert.ok(ag.endedAt > 0, `${node.name} endedAt must be populated`);
          assert.ok(ag.terminationReason, `${node.name} must have terminationReason`);
        }

        // Verify all 5 locks are completely released
        const lockedAfter = Object.keys(afterStatus.data.lockedFiles || {});
        assert.equal(lockedAfter.length, 0, 'All locks held by all descendants must be released');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('C1-02: Mid-tier cascade in branching hierarchy terminates only target subtree and leaves siblings unaffected', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        // Tree structure:
        // root
        //  ├── branch-A
        //  │    ├── child-A1
        //  │    └── child-A2
        //  └── branch-B
        //       └── child-B1
        await client.callTool('swarm', { action: 'add', name: 'root', brief: 'Root agent' });
        await client.callTool('swarm', { action: 'add', name: 'branch-A', parentId: 'root', brief: 'Branch A' });
        await client.callTool('swarm', { action: 'add', name: 'child-A1', parentId: 'branch-A', brief: 'Child A1' });
        await client.callTool('swarm', { action: 'add', name: 'child-A2', parentId: 'branch-A', brief: 'Child A2' });
        await client.callTool('swarm', { action: 'add', name: 'branch-B', parentId: 'root', brief: 'Branch B' });
        await client.callTool('swarm', { action: 'add', name: 'child-B1', parentId: 'branch-B', brief: 'Child B1' });

        // Assign file locks
        await updateState((state) => {
          state.lockedFiles['file-root.ts'] = 'root';
          state.lockedFiles['file-A.ts'] = 'branch-A';
          state.lockedFiles['file-A1.ts'] = 'child-A1';
          state.lockedFiles['file-A2.ts'] = 'child-A2';
          state.lockedFiles['file-B.ts'] = 'branch-B';
          state.lockedFiles['file-B1.ts'] = 'child-B1';
        }, getSwarmDir(ws.dir));

        // Kill branch-A
        const killRes = await client.callTool('swarm', {
          action: 'kill',
          name: 'branch-A',
        });
        assert.equal(killRes.isError, false);
        const killed = killRes.data.killed;
        assert.equal(killed.length, 3);
        assert.ok(killed.includes('branch-A'));
        assert.ok(killed.includes('child-A1'));
        assert.ok(killed.includes('child-A2'));

        // Verify root and branch-B are STILL untouched and not killed
        const statusRes = await client.callTool('swarm', { action: 'status' });
        const ags = statusRes.data.agents;
        assert.notEqual(ags['root'].status, 'killed');
        assert.notEqual(ags['branch-B'].status, 'killed');
        assert.notEqual(ags['child-B1'].status, 'killed');

        // Verify locks: file-A, file-A1, file-A2 removed; file-root, file-B, file-B1 retained
        const remainingLocks = statusRes.data.lockedFiles;
        assert.equal(remainingLocks['file-A.ts'], undefined);
        assert.equal(remainingLocks['file-A1.ts'], undefined);
        assert.equal(remainingLocks['file-A2.ts'], undefined);
        assert.equal(remainingLocks['file-root.ts'], 'root');
        assert.equal(remainingLocks['file-B.ts'], 'branch-B');
        assert.equal(remainingLocks['file-B1.ts'], 'child-B1');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('C1-03: Scoped boundary permissions strictly reject inverted or cross-branch termination', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        // Tree:
        // root
        //  ├── branch-A -> leaf-A
        //  └── branch-B -> leaf-B
        await client.callTool('swarm', { action: 'add', name: 'root', brief: 'Root agent' });
        await client.callTool('swarm', { action: 'add', name: 'branch-A', parentId: 'root', brief: 'Branch A' });
        await client.callTool('swarm', { action: 'add', name: 'leaf-A', parentId: 'branch-A', brief: 'Leaf A' });
        await client.callTool('swarm', { action: 'add', name: 'branch-B', parentId: 'root', brief: 'Branch B' });
        await client.callTool('swarm', { action: 'add', name: 'leaf-B', parentId: 'branch-B', brief: 'Leaf B' });

        // 1. leaf-A tries to kill its ancestor branch-A -> MUST FAIL
        const killAncestorRes = await client.callTool('swarm', {
          action: 'kill',
          name: 'branch-A',
          callerId: 'leaf-A',
        });
        assert.equal(killAncestorRes.isError, true, 'Descendant killing ancestor must be rejected');
        assert.match(killAncestorRes.message, /permission denied/i);

        // 2. leaf-A tries to kill root -> MUST FAIL
        const killRootRes = await client.callTool('swarm', {
          action: 'kill',
          name: 'root',
          callerId: 'leaf-A',
        });
        assert.equal(killRootRes.isError, true, 'Descendant killing root must be rejected');

        // 3. leaf-A tries to kill cross-branch sibling branch-B or leaf-B -> MUST FAIL
        const killCrossRes = await client.callTool('swarm', {
          action: 'kill',
          name: 'leaf-B',
          callerId: 'leaf-A',
        });
        assert.equal(killCrossRes.isError, true, 'Cross-branch kill must be rejected');

        // 4. branch-A terminates its own descendant leaf-A -> MUST SUCCEED
        const killDescendantRes = await client.callTool('swarm', {
          action: 'kill',
          name: 'leaf-A',
          callerId: 'branch-A',
        });
        assert.equal(killDescendantRes.isError, false, 'Ancestor terminating descendant must succeed');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

  });

  // =========================================================================
  // CHALLENGE 2: REPEATED CONCURRENT KILLS
  // =========================================================================

  await suite.test('Challenge 2: Repeated Concurrent Kills Stress', async (t) => {

    await t.test('C2-01: 10 concurrent swarm kill invocations on the same agent are atomic and safe', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'target-agent', brief: 'Target for concurrent kill' });

        // Launch 10 simultaneous kill calls
        const promises = Array.from({ length: 10 }, (_, i) =>
          client.callTool('swarm', {
            action: 'kill',
            name: 'target-agent',
            callerId: 'coordinator',
          })
        );

        const results = await Promise.all(promises);

        // Exactly one should succeed with isError: false
        const successes = results.filter((r) => !r.isError);
        const failures = results.filter((r) => r.isError);

        assert.equal(successes.length, 1, `Exactly 1 kill call must succeed, got ${successes.length}`);
        assert.equal(failures.length, 9, `Exactly 9 kill calls must fail gracefully, got ${failures.length}`);

        for (const f of failures) {
          assert.match(f.message, /already killed/i);
        }

        // Verify state consistency
        const statusRes = await client.callTool('swarm', { action: 'status' });
        assert.equal(statusRes.isError, false);
        const agent = statusRes.data.agents['target-agent'];
        assert.equal(agent.status, 'killed');
        assert.equal(agent.killed, true);

        // Verify state.json is valid and parseable
        const rawState = await fs.readFile(path.join(ws.dir, '.swarm', 'state.json'), 'utf8');
        const parsed = JSON.parse(rawState);
        assert.ok(parsed.agents['target-agent']);

        // Verify no leftover lock directory
        const lockExists = await fs.stat(path.join(ws.dir, '.swarm', 'state.lock')).then(() => true).catch(() => false);
        assert.equal(lockExists, false, 'state.lock directory must be cleanly removed');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('C2-02: Simultaneous concurrent kills on parent and child hierarchy do not deadlock', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'parent-race', brief: 'Parent agent' });
        await client.callTool('swarm', { action: 'add', name: 'child-race', parentId: 'parent-race', brief: 'Child agent' });

        // Fire simultaneous kills on parent and child
        const [resParent, resChild] = await Promise.all([
          client.callTool('swarm', { action: 'kill', name: 'parent-race' }),
          client.callTool('swarm', { action: 'kill', name: 'child-race' }),
        ]);

        // Either:
        // Case 1: Parent kill wins first -> parent & child killed by cascade. Child kill fails with "already killed".
        // Case 2: Child kill wins first -> child killed. Parent kill succeeds and cascades (child already killed).
        // In both cases, both calls resolve without timeout or deadlock!
        const statusRes = await client.callTool('swarm', { action: 'status' });
        assert.equal(statusRes.data.agents['parent-race'].status, 'killed');
        assert.equal(statusRes.data.agents['child-race'].status, 'killed');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('C2-03: Rapid sequential burst of 15 kill calls on dead agent returns consistent errors', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'burst-target', brief: 'Burst target' });
        const first = await client.callTool('swarm', { action: 'kill', name: 'burst-target' });
        assert.equal(first.isError, false);

        for (let i = 0; i < 15; i++) {
          const res = await client.callTool('swarm', { action: 'kill', name: 'burst-target' });
          assert.equal(res.isError, true, `Iteration ${i} must fail`);
          assert.match(res.message, /already killed/i);
        }
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

  });

  // =========================================================================
  // CHALLENGE 3: DOORBELL WAKEUP CONCURRENCY
  // =========================================================================

  await suite.test('Challenge 3: Doorbell Wakeup Concurrency Storms', async (t) => {

    await t.test('C3-01: Broadcast wakeup (@all) cleanly transitions 10 waiting agents simultaneously', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'post_message'))) return;

        // Spawn 10 agents
        const agentNames = Array.from({ length: 10 }, (_, i) => `waiter-${i}`);
        for (const name of agentNames) {
          await client.callTool('swarm', { action: 'add', name, brief: 'Sleepy agent' });
        }

        // Put all 10 into waiting state
        await updateState((state) => {
          for (const name of agentNames) {
            state.agents[name].status = 'waiting';
            state.agents[name].waitSince = Date.now();
          }
        }, getSwarmDir(ws.dir));

        // Verify all 10 waiting
        const beforeStatus = await client.callTool('swarm', { action: 'status' });
        assert.equal(beforeStatus.data.counts.waiting, 10);

        // Post broadcast message
        const postRes = await client.callTool('post_message', {
          text: '@all Attention swarm: begin operations',
          from: 'coordinator',
        });
        assert.equal(postRes.isError, false);
        assert.equal(postRes.data.broadcast, true);

        // Verify ALL 10 agents transitioned to working
        const afterStatus = await client.callTool('swarm', { action: 'status' });
        assert.equal(afterStatus.data.counts.waiting, 0, 'No agents should remain waiting');
        assert.equal(afterStatus.data.counts.working, 10, 'All 10 agents should be working');

        for (const name of agentNames) {
          const ag = afterStatus.data.agents[name];
          assert.equal(ag.status, 'working');
          assert.equal(ag.waitSince, undefined, 'waitSince must be cleared');
        }
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('C3-02: Rapid concurrent message storm (20 parallel posts) maintains monotonic sequence and wakes targets', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'post_message'))) return;

        // Spawn 4 target agents
        const targets = ['alpha', 'beta', 'gamma', 'delta'];
        for (const name of targets) {
          await client.callTool('swarm', { action: 'add', name, brief: 'Storm worker' });
        }

        // Put alpha and beta into waiting
        await updateState((state) => {
          state.agents['alpha'].status = 'waiting';
          state.agents['alpha'].waitSince = Date.now();
          state.agents['beta'].status = 'waiting';
          state.agents['beta'].waitSince = Date.now();
        }, getSwarmDir(ws.dir));

        // Launch 20 concurrent posts
        const posts = Array.from({ length: 20 }, (_, i) => {
          const mention = i % 2 === 0 ? '@alpha' : '@beta';
          return client.callTool('post_message', {
            text: `Storm post #${i} to ${mention}`,
            from: 'coordinator',
          });
        });

        const results = await Promise.all(posts);

        // All 20 must succeed
        for (let i = 0; i < results.length; i++) {
          assert.equal(results[i].isError, false, `Post ${i} failed: ${results[i].message}`);
        }

        // Extract sequence numbers and verify strictly monotonic
        const seqs = results.map((r) => r.data.seq);
        const uniqueSeqs = new Set(seqs);
        assert.equal(uniqueSeqs.size, 20, 'All 20 sequence numbers must be distinct');

        // Both alpha and beta must have been awakened
        const statusRes = await client.callTool('swarm', { action: 'status' });
        assert.equal(statusRes.data.agents['alpha'].status, 'working');
        assert.equal(statusRes.data.agents['beta'].status, 'working');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('C3-03: Targeted doorbell mention wakes specified agents while leaving non-mentioned dormant', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'post_message'))) return;

        await client.callTool('swarm', { action: 'add', name: 'worker-wake-1', brief: 'Wake target 1' });
        await client.callTool('swarm', { action: 'add', name: 'worker-wake-2', brief: 'Wake target 2' });
        await client.callTool('swarm', { action: 'add', name: 'worker-sleep-3', brief: 'Should stay asleep' });

        // Set all 3 to waiting
        await updateState((state) => {
          state.agents['worker-wake-1'].status = 'waiting';
          state.agents['worker-wake-1'].waitSince = Date.now();
          state.agents['worker-wake-2'].status = 'waiting';
          state.agents['worker-wake-2'].waitSince = Date.now();
          state.agents['worker-sleep-3'].status = 'waiting';
          state.agents['worker-sleep-3'].waitSince = Date.now();
        }, getSwarmDir(ws.dir));

        // Mention only wake-1 and wake-2
        await client.callTool('post_message', {
          text: '@worker-wake-1 and @worker-wake-2 please report in',
          from: 'coordinator',
        });

        const statusRes = await client.callTool('swarm', { action: 'status' });
        assert.equal(statusRes.data.agents['worker-wake-1'].status, 'working');
        assert.equal(statusRes.data.agents['worker-wake-2'].status, 'working');
        assert.equal(statusRes.data.agents['worker-sleep-3'].status, 'waiting', 'Non-mentioned worker MUST remain waiting');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

  });

  // =========================================================================
  // CHALLENGE 4: TERMINAL STATE IMMUTABILITY
  // =========================================================================

  await suite.test('Challenge 4: Terminal State Immutability & Reversion Resistance', async (t) => {

    await t.test('C4-01: Terminal states (completed, failed, killed) are recognized by isTerminalStatus', async () => {
      assert.equal(isTerminalStatus('completed'), true);
      assert.equal(isTerminalStatus('failed'), true);
      assert.equal(isTerminalStatus('killed'), true);
      assert.equal(isTerminalStatus('working'), false);
      assert.equal(isTerminalStatus('waiting'), false);
      assert.equal(isTerminalStatus('stopped'), false);
    });

    await t.test('C4-02: validateStatusTransition rejects transitions from any terminal state', async () => {
      const terminals = ['completed', 'failed', 'killed'];
      const targets = ['working', 'waiting', 'stopped', 'pending', 'running'];

      for (const term of terminals) {
        for (const target of targets) {
          const res = validateStatusTransition(term, target);
          assert.equal(res.valid, false, `${term} -> ${target} should be invalid`);
          assert.match(res.reason, /terminal state/i);
        }
      }
    });

    await t.test('C4-03: Doorbell @all broadcast or direct mentions NEVER revert terminal agents to working', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'post_message'))) return;

        await client.callTool('swarm', { action: 'add', name: 'agent-comp', brief: 'Completed agent' });
        await client.callTool('swarm', { action: 'add', name: 'agent-fail', brief: 'Failed agent' });
        await client.callTool('swarm', { action: 'add', name: 'agent-kill', brief: 'Killed agent' });

        // Transition them to their respective terminal states
        await updateState((state) => {
          state.agents['agent-comp'].status = 'completed';
          state.agents['agent-comp'].endedAt = Date.now();
          state.agents['agent-fail'].status = 'failed';
          state.agents['agent-fail'].endedAt = Date.now();
          state.agents['agent-fail'].error = 'Fatal execution error';
          state.agents['agent-kill'].status = 'killed';
          state.agents['agent-kill'].killed = true;
          state.agents['agent-kill'].endedAt = Date.now();
        }, getSwarmDir(ws.dir));

        // Broadcast post mentioning all of them
        await client.callTool('post_message', {
          text: '@all @agent-comp @agent-fail @agent-kill emergency restart!',
          from: 'coordinator',
        });

        // Verify status has NOT changed
        const statusRes = await client.callTool('swarm', { action: 'status' });
        assert.equal(statusRes.data.agents['agent-comp'].status, 'completed');
        assert.equal(statusRes.data.agents['agent-fail'].status, 'failed');
        assert.equal(statusRes.data.agents['agent-kill'].status, 'killed');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('C4-04: Cannot resurrect killed agent by re-adding with swarm add', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'doomed-one', brief: 'Doomed' });
        const killRes = await client.callTool('swarm', { action: 'kill', name: 'doomed-one' });
        assert.equal(killRes.isError, false);

        // Attempt to re-add doomed-one
        const reAddRes = await client.callTool('swarm', {
          action: 'add',
          name: 'doomed-one',
          brief: 'Resurrect attempt',
        });
        assert.equal(reAddRes.isError, true, 'Re-adding killed agent must fail');
        assert.match(reAddRes.message, /cannot be resurrected/i);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('C4-05: Model hot-swap rejected on killed agent', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'dead-agent', brief: 'To be killed' });
        await client.callTool('swarm', { action: 'kill', name: 'dead-agent' });

        const modelRes = await client.callTool('swarm', {
          action: 'model',
          name: 'dead-agent',
          model: 'claude-3-7-sonnet',
        });
        assert.equal(modelRes.isError, true, 'Hot-swapping model on killed agent must fail');
        assert.match(modelRes.message, /cannot change model of killed agent|cannot switch model/i);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('C4-06: Context forking and helper spawning from killed agent are rejected', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'source-dead', brief: 'Will die' });
        await client.callTool('swarm', { action: 'kill', name: 'source-dead' });

        // 1. Fork from killed agent
        const forkRes = await client.callTool('swarm', {
          action: 'add',
          name: 'fork-attempt',
          fork: 'source-dead',
        });
        assert.equal(forkRes.isError, true, 'Fork from killed agent must fail');
        assert.match(forkRes.message, /cannot fork from killed agent/i);

        // 2. Spawn helper under killed parent
        const helperRes = await client.callTool('swarm', {
          action: 'add',
          name: 'helper-attempt',
          parentId: 'source-dead',
        });
        assert.equal(helperRes.isError, true, 'Spawning helper under killed parent must fail');
        assert.match(helperRes.message, /parent agent '.*' is killed/i);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('C4-07: transitionAgentStatus programmatically throws on terminal agents and preserves terminal state', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'hard-terminal', brief: 'Terminal agent' });
        await client.callTool('swarm', { action: 'kill', name: 'hard-terminal' });

        const swarmDir = getSwarmDir(ws.dir);
        await assert.rejects(
          async () => {
            await transitionAgentStatus('hard-terminal', 'working', undefined, swarmDir);
          },
          /Illegal state transition: Agent is in terminal state 'killed'/
        );

        const stateAfter = await readState(swarmDir);
        assert.equal(stateAfter.agents['hard-terminal'].status, 'killed');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('C4-08: Model hot-swap on completed or failed terminal agents must be rejected per SCOPE.md Feature 9', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        // 1. Completed agent
        await client.callTool('swarm', { action: 'add', name: 'agent-done', brief: 'Done task' });
        await updateState((state) => {
          state.agents['agent-done'].status = 'completed';
          state.agents['agent-done'].endedAt = Date.now();
        }, getSwarmDir(ws.dir));

        const swapDoneRes = await client.callTool('swarm', {
          action: 'model',
          name: 'agent-done',
          model: 'claude-3-7-sonnet',
        });
        assert.equal(
          swapDoneRes.isError,
          true,
          'Hot-swapping model on completed agent must be rejected per SCOPE.md line 61'
        );

        // 2. Failed agent
        await client.callTool('swarm', { action: 'add', name: 'agent-err', brief: 'Errored task' });
        await updateState((state) => {
          state.agents['agent-err'].status = 'failed';
          state.agents['agent-err'].endedAt = Date.now();
        }, getSwarmDir(ws.dir));

        const swapErrRes = await client.callTool('swarm', {
          action: 'model',
          name: 'agent-err',
          model: 'claude-3-7-sonnet',
        });
        assert.equal(
          swapErrRes.isError,
          true,
          'Hot-swapping model on failed agent must be rejected per SCOPE.md line 61'
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

  });

  // =========================================================================
  // CHALLENGE 5: WARM CONTEXT FORKING ATTRIBUTE PARITY
  // =========================================================================

  await suite.test('Challenge 5: Warm Context Forking Parity', async (t) => {

    await t.test('C5-01: Forking without explicit role clones source agent role', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        // Spawn source agent with distinct role
        await client.callTool('swarm', {
          action: 'add',
          name: 'source-specialist',
          role: 'security-auditor',
          brief: 'Perform fuzz testing',
        });

        // Fork from source-specialist without specifying role
        const forkRes = await client.callTool('swarm', {
          action: 'add',
          name: 'fork-specialist',
          fork: 'source-specialist',
        });
        assert.equal(forkRes.isError, false);

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const forked = statusRes.data.agents['fork-specialist'];
        assert.equal(
          forked.role,
          'security-auditor',
          'Forked agent must clone source role when role is omitted'
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

  });

});
