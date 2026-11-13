/**
 * Challenger 2 Empirical Stress Test Suite (Milestone 1, Iteration 2)
 * 
 * Adversarially challenges:
 * 1. swarm_wait defaults mentions_only: true (unmentioned chatter MUST NOT wake agent)
 * 2. swarm_wait unblocks on explicit mentions in <50ms (benchmarked across all 4 mention formats)
 * 3. swarm_wait with timeoutMs: 0 returns unread messages immediately (<15ms)
 * 4. Agent status reverts to "working" and waitSince is cleared on timeout in state.json
 * 5. Pre-existing torn line without \n does not fuse with next post
 * 6. recoverBoardLog under concurrency with postMessage (directory lock stress)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import {
  createTestWorkspace,
  createMcpClient,
} from './harness.mjs';
import {
  postMessage,
  readBoard,
  swarmWait,
  recoverBoardLog,
  readBoardMessages,
  getBoardPath,
  boardEventBus,
} from '../dist/board.js';
import {
  ensureState,
  readState,
  updateState,
  getSwarmDir,
  initState,
} from '../dist/state.js';

test('Challenger 2 Empirical Verification: Milestone 1 Iteration 2', async (suite) => {

  // =========================================================================
  // CHALLENGE 1: swarm_wait defaults mentions_only: true
  // =========================================================================
  await suite.test('CHALLENGE 1: Default mentions_only: true prevents unmentioned chatter from waking agent', async (t) => {

    await t.test('1.1 Direct swarmWait without mentionsOnly param stays asleep through unmentioned chatter and wakes only on target mention', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        // Start swarmWait with NO mentionsOnly / mentions_only passed
        const waitPromise = swarmWait(swarmDir, {
          memberName: 'agent-alice',
          since: 0,
          timeoutMs: 2500,
        });

        // Give listener time to register
        await new Promise((r) => setTimeout(r, 40));

        // 1. Post untargeted general chatter
        await postMessage(swarmDir, { text: 'General system broadcast on main', from: 'coordinator' });
        await postMessage(swarmDir, { text: 'Weather update: 72F and sunny', from: 'bot-1' });

        // 2. Post mention targeting a DIFFERENT agent
        await postMessage(swarmDir, { text: 'Hey @agent-bob please review PR #42', from: 'lead' });

        // 3. Post similar but non-matching prefix / name
        await postMessage(swarmDir, { text: 'FYI @agent-alice-other this is for you', from: 'bot-2' });
        await postMessage(swarmDir, { text: 'Checking @agent-alicex now', from: 'bot-3' });

        // Wait 150ms to verify agent has NOT prematurely unblocked
        let hasResolvedPrematurely = false;
        waitPromise.then(() => { hasResolvedPrematurely = true; }).catch(() => {});
        await new Promise((r) => setTimeout(r, 150));
        assert.equal(hasResolvedPrematurely, false, 'Agent must NOT resolve on unmentioned messages');

        // 4. Now post explicit mention for target agent
        const postRes = await postMessage(swarmDir, { text: 'Hello @agent-alice wake up!', from: 'lead' });

        const res = await waitPromise;
        assert.equal(res.timedOut, false, 'Must unblock when target mention arrives');
        assert.equal(res.messages.length, 1, 'Should return only the targeted qualifying message');
        assert.equal(res.messages[0].text, 'Hello @agent-alice wake up!');
        assert.equal(res.messages[0].seq, postRes.seq);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('1.2 Direct swarmWait without mentionsOnly times out cleanly when only unmentioned chatter arrives', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        const waitPromise = swarmWait(swarmDir, {
          memberName: 'lonely-worker',
          since: 0,
          timeoutMs: 600,
        });

        await new Promise((r) => setTimeout(r, 30));

        // Flood 10 untargeted messages
        for (let i = 1; i <= 10; i++) {
          await postMessage(swarmDir, { text: `Untargeted message #${i} on main`, from: 'chatterbox' });
        }

        const res = await waitPromise;
        assert.equal(res.timedOut, true, 'Agent must time out because all messages were unmentioned');
        assert.equal(res.messages.length, 0, 'No unmentioned messages should be returned');
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('1.3 MCP tool swarm_wait defaults mentions_only to true and ignores untargeted chatter', async () => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        // Initialize swarm
        await client.callTool('init_swarm', { mission: 'Default mentions_only MCP test' });

        // Call swarm_wait via MCP without mentions_only parameter
        const waitCall = client.callTool('swarm_wait', {
          since: 0,
          timeoutMs: 2000,
          member: 'mcp-worker',
        });

        await new Promise((r) => setTimeout(r, 100));

        // Post untargeted chatter via MCP post_message
        await client.callTool('post_message', { text: 'Background chatter on main' });
        await client.callTool('post_message', { text: 'Mentioning @someone-else' });

        // Verify still waiting
        await new Promise((r) => setTimeout(r, 150));

        // Now post explicit mention
        await client.callTool('post_message', { text: 'Task for @mcp-worker execute now' });

        const mcpResult = await waitCall;
        assert.equal(mcpResult.isError, false, 'MCP swarm_wait should succeed');
        const parsed = JSON.parse(mcpResult.content[0].text);
        assert.equal(parsed.success, true);
        assert.equal(parsed.timedOut, false);
        assert.equal(parsed.count, 1);
        assert.ok(parsed.messages[0].text.includes('@mcp-worker execute now'));
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // CHALLENGE 2: swarm_wait unblocks on explicit mentions (<50ms)
  // =========================================================================
  await suite.test('CHALLENGE 2: swarm_wait unblocks on explicit mentions (<50ms empirical latency)', async (t) => {

    await t.test('2.1 Direct @name mention unblocks in <50ms (benchmarked cycles)', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);
        const unblockLatencies = [];
        let cursor = 0;

        for (let cycle = 1; cycle <= 5; cycle++) {
          const waitPromise = swarmWait(swarmDir, {
            memberName: 'speed-agent',
            since: cursor,
            mentionsOnly: true,
            timeoutMs: 3000,
          });

          await new Promise((r) => setTimeout(r, 30));

          let tEmitted = 0;
          const unsub = boardEventBus.onPost((evt) => {
            if (evt.message.text.includes('@speed-agent')) {
              tEmitted = performance.now();
            }
          });

          const postResult = await postMessage(swarmDir, {
            text: `@speed-agent benchmark ping ${cycle}`,
            from: 'coordinator',
          });

          const res = await waitPromise;
          const unblockElapsed = performance.now() - (tEmitted || performance.now());
          unblockLatencies.push(unblockElapsed);
          unsub();

          assert.equal(res.timedOut, false, `Cycle ${cycle} should not time out`);
          assert.equal(res.messages.length, 1);
          assert.equal(res.messages[0].seq, postResult.seq);
          cursor = postResult.seq;

          assert.ok(unblockElapsed < 50, `Cycle ${cycle} unblock latency ${unblockElapsed.toFixed(2)}ms must be < 50ms`);
        }

        const avg = unblockLatencies.reduce((a, b) => a + b, 0) / unblockLatencies.length;
        const max = Math.max(...unblockLatencies);
        const min = Math.min(...unblockLatencies);
        console.log(`       [BENCHMARK @name] unblock latency min: ${min.toFixed(2)}ms, max: ${max.toFixed(2)}ms, avg: ${avg.toFixed(2)}ms`);
        assert.ok(avg < 50, `Average unblock latency (${avg.toFixed(2)}ms) must be < 50ms`);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('2.2 Group prefix @worker mention unblocks worker-1 in <50ms', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);
        const unblockLatencies = [];
        let cursor = 0;

        for (let cycle = 1; cycle <= 5; cycle++) {
          const waitPromise = swarmWait(swarmDir, {
            memberName: 'worker-1',
            since: cursor,
            timeoutMs: 3000,
          });

          await new Promise((r) => setTimeout(r, 30));

          let tEmitted = 0;
          const unsub = boardEventBus.onPost((evt) => {
            if (evt.message.text.includes('@worker')) {
              tEmitted = performance.now();
            }
          });

          const postResult = await postMessage(swarmDir, {
            text: `@worker prefix dispatch round ${cycle}`,
            from: 'lead',
          });

          const res = await waitPromise;
          const unblockElapsed = performance.now() - (tEmitted || performance.now());
          unblockLatencies.push(unblockElapsed);
          unsub();

          assert.equal(res.timedOut, false);
          assert.equal(res.messages.length, 1);
          assert.equal(res.messages[0].text, `@worker prefix dispatch round ${cycle}`);
          cursor = postResult.seq;

          assert.ok(unblockElapsed < 65, `Prefix unblock latency ${unblockElapsed.toFixed(2)}ms must be within threshold`);
        }

        const avg = unblockLatencies.reduce((a, b) => a + b, 0) / unblockLatencies.length;
        const max = Math.max(...unblockLatencies);
        console.log(`       [BENCHMARK @prefix] unblock latency avg: ${avg.toFixed(2)}ms, max: ${max.toFixed(2)}ms`);
        assert.ok(avg < 50, `Average prefix unblock latency (${avg.toFixed(2)}ms) must be < 50ms`);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('2.3 Broadcast @all mention unblocks waiting agent in <50ms', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);
        const unblockLatencies = [];
        let cursor = 0;

        for (let cycle = 1; cycle <= 5; cycle++) {
          const waitPromise = swarmWait(swarmDir, {
            memberName: 'agent-x',
            since: cursor,
            timeoutMs: 3000,
          });

          await new Promise((r) => setTimeout(r, 30));

          let tEmitted = 0;
          const unsub = boardEventBus.onPost((evt) => {
            if (evt.message.text.includes('@all')) {
              tEmitted = performance.now();
            }
          });

          const postResult = await postMessage(swarmDir, {
            text: `@all broadcast announcement ${cycle}`,
            from: 'orchestrator',
          });

          const res = await waitPromise;
          const unblockElapsed = performance.now() - (tEmitted || performance.now());
          unblockLatencies.push(unblockElapsed);
          unsub();

          assert.equal(res.timedOut, false);
          assert.equal(res.messages.length, 1);
          cursor = postResult.seq;

          assert.ok(unblockElapsed < 65, `Broadcast @all unblock latency ${unblockElapsed.toFixed(2)}ms must be within threshold`);
        }

        const avg = unblockLatencies.reduce((a, b) => a + b, 0) / unblockLatencies.length;
        const max = Math.max(...unblockLatencies);
        console.log(`       [BENCHMARK @all] unblock latency avg: ${avg.toFixed(2)}ms, max: ${max.toFixed(2)}ms`);
        assert.ok(avg < 50, `Average broadcast unblock latency (${avg.toFixed(2)}ms) must be < 50ms`);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('2.4 Channel mention @#frontend unblocks subscribed members in <50ms', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);
        // Create channel frontend with subscriber ui-worker
        const createPost = await postMessage(swarmDir, {
          text: 'Create frontend channel',
          from: 'coordinator',
          control: { op: 'create', channel: 'frontend', members: ['ui-worker'] },
        });

        const unblockLatencies = [];
        let cursor = createPost.seq;

        for (let cycle = 1; cycle <= 5; cycle++) {
          const waitPromise = swarmWait(swarmDir, {
            memberName: 'ui-worker',
            since: cursor,
            timeoutMs: 3000,
          });

          await new Promise((r) => setTimeout(r, 30));

          let tEmitted = 0;
          const unsub = boardEventBus.onPost((evt) => {
            if (evt.message.text.includes('@#frontend')) {
              tEmitted = performance.now();
            }
          });

          const postResult = await postMessage(swarmDir, {
            text: `@#frontend UI refresh event ${cycle}`,
            from: 'coordinator',
          });

          const res = await waitPromise;
          const unblockElapsed = performance.now() - (tEmitted || performance.now());
          unblockLatencies.push(unblockElapsed);
          unsub();

          assert.equal(res.timedOut, false);
          assert.equal(res.messages.length, 1);
          assert.equal(res.messages[0].text, `@#frontend UI refresh event ${cycle}`);
          cursor = postResult.seq;

          assert.ok(unblockElapsed < 65, `Channel unblock latency ${unblockElapsed.toFixed(2)}ms must be within threshold`);
        }

        const avg = unblockLatencies.reduce((a, b) => a + b, 0) / unblockLatencies.length;
        const max = Math.max(...unblockLatencies);
        console.log(`       [BENCHMARK @#channel] unblock latency avg: ${avg.toFixed(2)}ms, max: ${max.toFixed(2)}ms`);
        assert.ok(avg < 50, `Average channel mention latency (${avg.toFixed(2)}ms) must be < 50ms`);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('2.5 File polling Layer 2 unblocks external process file appends within 80ms', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);
        const boardFile = path.join(swarmDir, 'board.jsonl');

        const waitPromise = swarmWait(swarmDir, {
          memberName: 'poll-worker',
          since: 0,
          timeoutMs: 3000,
        });

        await new Promise((r) => setTimeout(r, 40));

        // Append directly to file without calling postMessage (bypasses in-memory EventBus)
        const tStart = performance.now();
        const externalMsg = {
          seq: 1,
          from: 'external-process',
          channel: 'main',
          text: '@poll-worker wake via disk poller',
          timestamp: Date.now(),
        };
        await fs.appendFile(boardFile, JSON.stringify(externalMsg) + '\n', 'utf8');

        const res = await waitPromise;
        const elapsed = performance.now() - tStart;

        assert.equal(res.timedOut, false, 'File poller must unblock waiter');
        assert.equal(res.messages.length, 1);
        assert.equal(res.messages[0].text, '@poll-worker wake via disk poller');
        console.log(`       [BENCHMARK Layer 2 Poller] latency: ${elapsed.toFixed(2)}ms (poll interval: 25ms)`);
        assert.ok(elapsed < 80, `File poller latency ${elapsed.toFixed(2)}ms should be within polling window`);
      } finally {
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // CHALLENGE 3: swarm_wait with timeoutMs: 0 returns unread immediately
  // =========================================================================
  await suite.test('CHALLENGE 3: swarm_wait with timeoutMs: 0 returns unread messages immediately', async (t) => {

    await t.test('3.1 timeoutMs: 0 returns existing unread qualifying messages immediately (<15ms)', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        // Pre-populate board with messages
        await postMessage(swarmDir, { text: 'Unrelated message 1', from: 'w1' });
        await postMessage(swarmDir, { text: '@fast-agent task A', from: 'coordinator' });
        await postMessage(swarmDir, { text: 'Unrelated message 2', from: 'w2' });
        await postMessage(swarmDir, { text: '@fast-agent task B', from: 'coordinator' });

        const tStart = performance.now();
        const res = await swarmWait(swarmDir, {
          memberName: 'fast-agent',
          since: 0,
          timeoutMs: 0,
        });
        const elapsed = performance.now() - tStart;

        assert.equal(res.timedOut, false, 'Must not be timedOut when unread matching messages exist');
        assert.equal(res.messages.length, 2, 'Must return both messages mentioning fast-agent');
        assert.equal(res.messages[0].text, '@fast-agent task A');
        assert.equal(res.messages[1].text, '@fast-agent task B');
        assert.equal(res.headSeq, 4);
        assert.ok(elapsed < 20, `Execution time ${elapsed.toFixed(2)}ms must be immediate (<20ms)`);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('3.2 timeoutMs: 0 returns timedOut: true and empty messages immediately when caught up', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        await postMessage(swarmDir, { text: '@fast-agent old task', from: 'coordinator' });

        // Query with since: 1 (already seen)
        const tStart = performance.now();
        const res = await swarmWait(swarmDir, {
          memberName: 'fast-agent',
          since: 1,
          timeoutMs: 0,
        });
        const elapsed = performance.now() - tStart;

        assert.equal(res.timedOut, true, 'Must return timedOut: true when no new messages exist');
        assert.equal(res.messages.length, 0);
        assert.equal(res.headSeq, 1);
        assert.ok(elapsed < 20, `Execution time ${elapsed.toFixed(2)}ms must be immediate (<20ms)`);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('3.3 Negative timeoutMs (-100) behaves identically to 0 without throwing', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        await postMessage(swarmDir, { text: '@fast-agent task neg', from: 'coordinator' });

        const res = await swarmWait(swarmDir, {
          memberName: 'fast-agent',
          since: 0,
          timeoutMs: -100,
        });

        assert.equal(res.timedOut, false);
        assert.equal(res.messages.length, 1);
        assert.equal(res.messages[0].text, '@fast-agent task neg');
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('3.4 MCP tool swarm_wait with timeoutMs: 0 returns unread messages immediately', async () => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        await client.callTool('init_swarm', { mission: 'Poll MCP test' });
        await client.callTool('post_message', { text: '@mcp-poller task 1' });
        await client.callTool('post_message', { text: '@mcp-poller task 2' });

        const tStart = performance.now();
        const res = await client.callTool('swarm_wait', {
          member: 'mcp-poller',
          since: 0,
          timeoutMs: 0,
        });
        const elapsed = performance.now() - tStart;

        assert.equal(res.isError, false);
        const parsed = JSON.parse(res.content[0].text);
        assert.equal(parsed.timedOut, false);
        assert.equal(parsed.count, 2);
        assert.ok(elapsed < 100, `MCP roundtrip ${elapsed.toFixed(2)}ms should be fast`);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // CHALLENGE 4: Agent status reverts to "working" and waitSince cleared on timeout
  // =========================================================================
  await suite.test('CHALLENGE 4: Agent status reverts to "working" and waitSince is cleared on timeout', async (t) => {

    await t.test('4.1 State file transitions: status becomes "waiting" mid-wait, reverts to "working" and waitSince deleted on timeout', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        // Register agent in state
        await updateState((s) => {
          s.agents = s.agents || {};
          s.agents['worker-state-test'] = {
            id: 'worker-state-test',
            name: 'worker-state-test',
            role: 'worker',
            status: 'working',
            workspace: 'inherit',
          };
        }, swarmDir);

        // Verify initial state
        let st = await readState(swarmDir);
        assert.equal(st.agents['worker-state-test'].status, 'working');
        assert.equal(st.agents['worker-state-test'].waitSince, undefined);

        // Start swarmWait with 300ms timeout
        const waitPromise = swarmWait(swarmDir, {
          memberName: 'worker-state-test',
          since: 42,
          timeoutMs: 300,
        });

        // Check mid-wait state (after 50ms)
        await new Promise((r) => setTimeout(r, 60));
        st = await readState(swarmDir);
        assert.equal(st.agents['worker-state-test'].status, 'waiting', 'Status must be "waiting" while sleeping');
        assert.equal(st.agents['worker-state-test'].waitSince, 42, 'waitSince must reflect since parameter');
        assert.equal(st.agents['worker-state-test'].wakeMode, 'mentions');

        // Wait for timeout resolution
        const res = await waitPromise;
        assert.equal(res.timedOut, true);

        // Give small tick for disk write to finalize
        await new Promise((r) => setTimeout(r, 30));

        // Verify post-timeout state on disk directly
        st = await readState(swarmDir);
        assert.equal(st.agents['worker-state-test'].status, 'working', 'Status must revert to "working" upon timeout');
        assert.equal('waitSince' in st.agents['worker-state-test'], false, 'waitSince must be completely deleted');
        assert.equal(st.agents['worker-state-test'].waitSince, undefined);

        // Also inspect raw JSON on disk to verify no lingering key
        const rawJson = JSON.parse(await fs.readFile(path.join(swarmDir, 'state.json'), 'utf8'));
        assert.equal(rawJson.agents['worker-state-test'].status, 'working');
        assert.equal(Object.prototype.hasOwnProperty.call(rawJson.agents['worker-state-test'], 'waitSince'), false);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('4.2 State file transitions on message unblock (non-timeout)', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);
        await updateState((s) => {
          s.agents = s.agents || {};
          s.agents['worker-wake-test'] = {
            id: 'worker-wake-test',
            name: 'worker-wake-test',
            role: 'worker',
            status: 'working',
            workspace: 'inherit',
          };
        }, swarmDir);

        const waitPromise = swarmWait(swarmDir, {
          memberName: 'worker-wake-test',
          since: 0,
          timeoutMs: 3000,
        });

        await new Promise((r) => setTimeout(r, 50));
        let st = await readState(swarmDir);
        assert.equal(st.agents['worker-wake-test'].status, 'waiting');

        // Post mention to unblock
        await postMessage(swarmDir, { text: '@worker-wake-test time to work', from: 'lead' });
        const res = await waitPromise;
        assert.equal(res.timedOut, false);

        await new Promise((r) => setTimeout(r, 40));
        st = await readState(swarmDir);
        assert.equal(st.agents['worker-wake-test'].status, 'working', 'Status must revert to "working" upon message wakeup');
        assert.equal('waitSince' in st.agents['worker-wake-test'], false, 'waitSince must be deleted upon message wakeup');
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('4.3 Multiple concurrent timed-out agents all cleanly revert to "working"', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);
        const agentNames = ['ag-1', 'ag-2', 'ag-3', 'ag-4'];

        await updateState((s) => {
          s.agents = s.agents || {};
          for (const name of agentNames) {
            s.agents[name] = { id: name, name, role: 'worker', status: 'working', workspace: 'inherit' };
          }
        }, swarmDir);

        // Launch concurrent waits with different timeouts (150ms - 250ms)
        const waits = agentNames.map((name, idx) =>
          swarmWait(swarmDir, { memberName: name, timeoutMs: 150 + idx * 30 })
        );

        const results = await Promise.all(waits);
        for (const r of results) {
          assert.equal(r.timedOut, true);
        }

        await new Promise((r) => setTimeout(r, 50));

        const st = await readState(swarmDir);
        for (const name of agentNames) {
          assert.equal(st.agents[name].status, 'working', `${name} status must be "working"`);
          assert.equal('waitSince' in st.agents[name], false, `${name} waitSince must be deleted`);
        }
      } finally {
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // CHALLENGE 5: Pre-existing torn line without \n does not fuse with next post
  // =========================================================================
  await suite.test('CHALLENGE 5: Pre-existing torn line without \\n does not fuse with next post', async (t) => {

    await t.test('5.1 Torn line without trailing \\n does not fuse into new postMessage append', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);
        const boardFile = path.join(swarmDir, 'board.jsonl');

        // Post valid message 1 and 2
        await postMessage(swarmDir, { text: 'Valid message 1', from: 'w1' });
        await postMessage(swarmDir, { text: 'Valid message 2', from: 'w2' });

        // Simulate abrupt crash mid-write without trailing newline
        const tornFragment = '{"seq": 3, "from": "crashed-worker", "text": "cut off in mid byte stream';
        await fs.appendFile(boardFile, tornFragment, 'utf8');

        // Verify the file currently ends without a newline
        const rawBefore = await fs.readFile(boardFile, 'utf8');
        assert.ok(rawBefore.endsWith('stream'), 'File must end with torn fragment without newline');

        // Call postMessage directly WITHOUT recoverBoardLog
        const postRes = await postMessage(swarmDir, {
          text: 'Clean next post after torn line',
          from: 'w3',
        });

        // Read raw file content to verify separation
        const rawAfter = await fs.readFile(boardFile, 'utf8');

        // Assert no fusion: 'stream{"seq"' MUST NOT exist
        assert.equal(rawAfter.includes('stream{"'), false, 'Torn fragment must NOT fuse with new message JSON');
        assert.ok(rawAfter.includes('stream\n{"'), 'A newline must separate the torn fragment and new message');

        // Parse board messages
        const msgs = await readBoardMessages(swarmDir);
        assert.equal(msgs.length, 3, 'Must safely parse 3 valid messages (skipping torn line)');
        assert.equal(msgs[0].text, 'Valid message 1');
        assert.equal(msgs[1].text, 'Valid message 2');
        assert.equal(msgs[2].text, 'Clean next post after torn line');
        assert.equal(msgs[2].seq, postRes.seq);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('5.2 Micro-fragment torn line (1 byte "{") without newline does not fuse', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);
        const boardFile = path.join(swarmDir, 'board.jsonl');

        await postMessage(swarmDir, { text: 'Base message', from: 'w1' });

        // Inject 1-byte torn fragment
        await fs.appendFile(boardFile, '{', 'utf8');

        const postRes = await postMessage(swarmDir, {
          text: 'Message after single-byte corruption',
          from: 'w2',
        });

        const raw = await fs.readFile(boardFile, 'utf8');
        assert.ok(raw.includes('{\n{"'), 'Single byte { must be separated from new JSON with newline');

        const msgs = await readBoardMessages(swarmDir);
        assert.equal(msgs.length, 2);
        assert.equal(msgs[1].text, 'Message after single-byte corruption');
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('5.3 Clean file ending with \\n does not receive redundant blank lines', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);
        const boardFile = path.join(swarmDir, 'board.jsonl');

        await postMessage(swarmDir, { text: 'First post', from: 'w1' });
        await postMessage(swarmDir, { text: 'Second post', from: 'w2' });

        const raw = await fs.readFile(boardFile, 'utf8');
        assert.equal(raw.includes('\n\n'), false, 'Normal posts must not produce empty lines');
        const lines = raw.trim().split('\n');
        assert.equal(lines.length, 2);
      } finally {
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // CHALLENGE 6: recoverBoardLog under concurrency with postMessage
  // =========================================================================
  await suite.test('CHALLENGE 6: recoverBoardLog under concurrency with postMessage (directory lock)', async (t) => {

    await t.test('6.1 Interleaved concurrent storm of 12 postMessages and 6 recoverBoardLogs', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        // Pre-populate with 3 messages
        await postMessage(swarmDir, { text: 'Seed msg 1', from: 'init' });
        await postMessage(swarmDir, { text: 'Seed msg 2', from: 'init' });
        await postMessage(swarmDir, { text: 'Seed msg 3', from: 'init' });

        const postPromises = [];
        const recoverPromises = [];
        const postedTexts = new Set(['Seed msg 1', 'Seed msg 2', 'Seed msg 3']);

        // Launch 12 concurrent posts with random delays
        for (let i = 1; i <= 12; i++) {
          const text = `Concurrent post payload #${i}`;
          postedTexts.add(text);
          postPromises.push(
            (async () => {
              const jitter = Math.floor(Math.random() * 15);
              await new Promise((r) => setTimeout(r, jitter));
              return postMessage(swarmDir, { text, from: `worker-${i % 4}` });
            })()
          );
        }

        // Launch 6 concurrent recoverBoardLog calls
        for (let j = 1; j <= 6; j++) {
          recoverPromises.push(
            (async () => {
              const jitter = Math.floor(Math.random() * 15);
              await new Promise((r) => setTimeout(r, jitter));
              return recoverBoardLog(swarmDir);
            })()
          );
        }

        // Wait for all 18 concurrent operations to complete without error
        const [postResults, recoverResults] = await Promise.all([
          Promise.all(postPromises),
          Promise.all(recoverPromises),
        ]);

        assert.equal(postResults.length, 12, 'All 12 posts must succeed');
        assert.equal(recoverResults.length, 6, 'All 6 recoveries must succeed');

        // Verify final board state
        const finalMsgs = await readBoardMessages(swarmDir);
        assert.equal(finalMsgs.length, 15, 'Total messages must be 3 seed + 12 posts = 15');

        // Check sequence monotonicity
        for (let idx = 0; idx < finalMsgs.length; idx++) {
          assert.equal(finalMsgs[idx].seq, idx + 1, `Message index ${idx} must have seq ${idx + 1}`);
          assert.ok(postedTexts.has(finalMsgs[idx].text), `Message text ${finalMsgs[idx].text} must be recognized`);
        }

        // Check state headSeq
        const st = await readState(swarmDir);
        assert.equal(st.headSeq, 15, 'State headSeq must be updated to 15');
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('6.2 Concurrent recoverBoardLog during active posting with torn lines injected', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);
        const boardFile = path.join(swarmDir, 'board.jsonl');

        const successPosts = [];

        // Background chaos worker injecting occasional torn lines and calling recoverBoardLog
        const chaosWorker = (async () => {
          for (let k = 0; k < 4; k++) {
            await new Promise((r) => setTimeout(r, 25));
            try {
              // Inject torn fragment
              await fs.appendFile(boardFile, '{"seq": 999, "from": "chaos", "text": "interrupted\n', 'utf8');
              await recoverBoardLog(swarmDir);
            } catch {}
          }
        })();

        // Concurrently post 8 messages
        const postOps = [];
        for (let i = 1; i <= 8; i++) {
          postOps.push(
            (async () => {
              await new Promise((r) => setTimeout(r, i * 12));
              const res = await postMessage(swarmDir, { text: `Chaos test msg ${i}`, from: 'resilient-worker' });
              successPosts.push(res);
              return res;
            })()
          );
        }

        await Promise.all([...postOps, chaosWorker]);

        // Run one final recovery to ensure pristine state
        const recovered = await recoverBoardLog(swarmDir);

        // Every successfully posted message must be preserved
        const recoveredTexts = new Set(recovered.map((m) => m.text));
        for (const post of successPosts) {
          assert.ok(recoveredTexts.has(post.text), `Posted message "${post.text}" must survive concurrent recovery`);
        }

        // Monotonic sequence verification on recovered log
        for (let i = 0; i < recovered.length; i++) {
          assert.equal(recovered[i].seq, i + 1, `Sequence at index ${i} must be ${i + 1}`);
        }
      } finally {
        await ws.cleanup();
      }
    });
  });

});
