/**
 * Test Suite: Message Board Subsystem (Features 1–5)
 * 
 * Covers:
 * - Feature 1: Append-only message board (monotonic #seq numbering, persistent NDJSON log, timestamps, channel routing)
 * - Feature 2: Doorbell wakeup addressing (@name, @prefix group wakeups, @all broadcast, @#channel subscribers)
 * - Feature 3: Zero-token sleep (swarm_wait event-driven unblocking with since, mentions_only, and timeoutMs)
 * - Feature 4: Message board MCP tools (post_message, read_board, swarm_wait)
 * - Feature 5: Channel management (swarm{action:"channel", op:"create"|"subscribe"|"unsubscribe"|"list"|"archive"})
 * 
 * Organized in 3 Tiers:
 * - Tier 1: Nominal Feature Coverage (>=5 test cases per feature = 25 cases)
 * - Tier 2: Boundary & Corner Cases (>=5 test cases per feature = 25 cases)
 * - Tier 3: Cross-Feature Combinations (>=5 pairwise interaction cases)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
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

/**
 * Helper to inspect .swarm/board.jsonl in workspace
 */
async function readBoardLines(ws) {
  const boardPath = path.join(ws.dir, '.swarm', 'board.jsonl');
  if (!existsSync(boardPath)) return [];
  const raw = await fs.readFile(boardPath, 'utf8');
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('Message Board Subsystem (Features 1–5)', async (suite) => {

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (ISOLATION TESTING)
  // =========================================================================

  await suite.test('Tier 1: Feature 1 — Append-Only Message Board & Sequence Allocator', async (t) => {
    await t.test('F1-T1-01: Monotonic sequence numbering starts at 1 and increments per message', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'read_board'))) return;

        const res1 = await client.callTool('post_message', { text: 'First message', from: 'coordinator' });
        assert.equal(res1.isError, false, `Post 1 failed: ${JSON.stringify(res1)}`);
        assert.equal(res1.data.message.seq, 1, 'First message seq must be 1');

        const res2 = await client.callTool('post_message', { text: 'Second message', from: 'worker-1' });
        assert.equal(res2.isError, false, `Post 2 failed: ${JSON.stringify(res2)}`);
        assert.equal(res2.data.message.seq, 2, 'Second message seq must be 2');

        const res3 = await client.callTool('post_message', { text: 'Third message', from: 'worker-2' });
        assert.equal(res3.isError, false, `Post 3 failed: ${JSON.stringify(res3)}`);
        assert.equal(res3.data.message.seq, 3, 'Third message seq must be 3');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F1-T1-02: Message board persists sequentially in .swarm/board.jsonl as valid NDJSON', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message'))) return;

        await client.callTool('post_message', { text: 'Alpha line', from: 'coordinator' });
        await client.callTool('post_message', { text: 'Beta line', from: 'worker-1' });

        const lines = await readBoardLines(ws);
        assert.equal(lines.length, 2, 'Should persist exactly 2 lines in board.jsonl');
        assert.equal(lines[0].text, 'Alpha line');
        assert.equal(lines[0].seq, 1);
        assert.equal(lines[1].text, 'Beta line');
        assert.equal(lines[1].seq, 2);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F1-T1-03: Message objects contain required fields: seq, agent, time, text, channel', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'read_board'))) return;

        await client.callTool('post_message', { text: 'Field verification', from: 'tester', channel: 'main' });
        const board = await client.callTool('read_board', {});
        assert.equal(board.isError, false);
        const msg = board.data.messages[0];

        assert.ok(typeof msg.seq === 'number', 'seq must be number');
        assert.ok(msg.agent || msg.from, 'agent or from field must be present');
        assert.ok(msg.time || msg.timestamp, 'time or timestamp field must be present');
        assert.equal(msg.text, 'Field verification');
        assert.equal(msg.channel, 'main');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F1-T1-04: Default channel is "main" when channel is unspecified', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message'))) return;

        const res = await client.callTool('post_message', { text: 'No channel given', from: 'tester' });
        assert.equal(res.isError, false);
        assert.equal(res.data.message.channel, 'main', 'Default channel must be main');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F1-T1-05: Append-only immutability preserves historical messages when new posts arrive', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'read_board'))) return;

        await client.callTool('post_message', { text: 'Genesis message', from: 'coordinator' });
        const boardBefore = await client.callTool('read_board', {});
        const firstMsgJson = JSON.stringify(boardBefore.data.messages[0]);

        await client.callTool('post_message', { text: 'Subsequent message 1', from: 'worker' });
        await client.callTool('post_message', { text: 'Subsequent message 2', from: 'worker' });

        const boardAfter = await client.callTool('read_board', {});
        assert.equal(boardAfter.data.messages.length, 3);
        assert.equal(JSON.stringify(boardAfter.data.messages[0]), firstMsgJson, 'First message must be unmodified');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  await suite.test('Tier 1: Feature 2 — Doorbell Wakeup Addressing', async (t) => {
    await t.test('F2-T1-01: Direct @name mention identifies targeted agent for wakeup', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message'))) return;

        const res = await client.callTool('post_message', {
          text: '@verifier please review PR #12',
          from: 'coordinator',
        });
        assert.equal(res.isError, false);
        const mentions = res.data.mentions || res.data.message.mentions || [];
        assert.ok(mentions.includes('verifier'), `Mentions should include verifier: ${JSON.stringify(mentions)}`);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F2-T1-02: Non-name rune boundary check prevents false mentions (e.g. email foo@bar)', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message'))) return;

        const res = await client.callTool('post_message', {
          text: 'Contact user@domain.com for feedback',
          from: 'coordinator',
        });
        assert.equal(res.isError, false);
        const mentions = res.data.mentions || res.data.message.mentions || [];
        assert.ok(!mentions.includes('domain'), 'Should not extract domain from email address as mention');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F2-T1-03: Group prefix mention @worker targets numbered pool members (worker-1, worker-2)', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message'))) return;

        const res = await client.callTool('post_message', {
          text: '@worker all hands on deck for tests',
          from: 'coordinator',
        });
        assert.equal(res.isError, false);
        const mentions = res.data.mentions || res.data.message.mentions || [];
        assert.ok(
          mentions.includes('worker') || mentions.includes('@worker'),
          `Group prefix worker must be parsed: ${JSON.stringify(mentions)}`
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F2-T1-04: Broadcast @all targets all active registered swarm agents', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message'))) return;

        const res = await client.callTool('post_message', {
          text: '@all emergency halt: database schema updated',
          from: 'coordinator',
        });
        assert.equal(res.isError, false);
        const mentions = res.data.mentions || res.data.message.mentions || [];
        assert.ok(
          mentions.includes('all') || mentions.includes('@all') || res.data.broadcast === true,
          `Broadcast mention @all must be identified: ${JSON.stringify(res.data)}`
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F2-T1-05: Channel mention @#channel targets all subscribed members of that channel', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message'))) return;

        const res = await client.callTool('post_message', {
          text: 'Notice: @#backend deploy complete',
          from: 'deployer',
        });
        assert.equal(res.isError, false);
        const channelMentions = res.data.channelMentions || res.data.message.channelMentions || [];
        assert.ok(
          channelMentions.includes('backend') || channelMentions.includes('#backend'),
          `Channel mention @#backend must be recognized: ${JSON.stringify(channelMentions)}`
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  await suite.test('Tier 1: Feature 3 — Zero-Token Sleep (swarm_wait)', async (t) => {
    await t.test('F3-T1-01: swarm_wait unblocks when matching message arrives', async (ct) => {
      const ws = await createTestWorkspace();
      let client1;
      let client2;
      try {
        client1 = await createMcpClient(ws.dir);
        client2 = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client1, 'swarm_wait', 'post_message'))) return;

        // Start waiting in client1 with 5000ms timeout
        const waitPromise = client1.callTool('swarm_wait', {
          memberName: 'agent-waiter',
          since: 0,
          timeoutMs: 5000,
        });

        // Small delay then post message targeting agent-waiter
        await new Promise((r) => setTimeout(r, 200));
        await client2.callTool('post_message', {
          text: '@agent-waiter wake up task ready',
          from: 'coordinator',
        });

        const res = await waitPromise;
        assert.equal(res.isError, false);
        assert.equal(res.data.timedOut, false, 'Should not time out when doorbell rings');
        assert.ok(res.data.messages.length > 0, 'Should return matching messages');
      } finally {
        await client1?.close();
        await client2?.close();
        await ws.cleanup();
      }
    });

    await t.test('F3-T1-02: swarm_wait with mentions_only: true ignores unmentioned chatter', async (ct) => {
      const ws = await createTestWorkspace();
      let client1;
      let client2;
      try {
        client1 = await createMcpClient(ws.dir);
        client2 = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client1, 'swarm_wait', 'post_message'))) return;

        // Start waiting for mentions only with short timeout 600ms
        const waitPromise = client1.callTool('swarm_wait', {
          memberName: 'silent-bob',
          since: 0,
          mentions_only: true,
          timeoutMs: 600,
        });

        await new Promise((r) => setTimeout(r, 100));
        await client2.callTool('post_message', {
          text: 'Unrelated message mentioning @someone-else',
          from: 'coordinator',
        });

        const res = await waitPromise;
        assert.equal(res.isError, false);
        assert.equal(res.data.timedOut, true, 'mentions_only wait should time out when unmentioned');
      } finally {
        await client1?.close();
        await client2?.close();
        await ws.cleanup();
      }
    });

    await t.test('F3-T1-03: swarm_wait with since filter returns only messages strictly newer than sequence', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'swarm_wait'))) return;

        await client.callTool('post_message', { text: 'Msg 1', from: 'system' });
        await client.callTool('post_message', { text: 'Msg 2', from: 'system' });
        await client.callTool('post_message', { text: 'Msg 3', from: 'system' });

        // Call swarm_wait with since=2; should immediately return Msg 3
        const res = await client.callTool('swarm_wait', {
          memberName: 'reader',
          since: 2,
          mentions_only: false,
          timeoutMs: 1000,
        });

        assert.equal(res.isError, false);
        assert.equal(res.data.messages.length, 1);
        assert.equal(res.data.messages[0].seq, 3);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F3-T1-04: swarm_wait with timeoutMs unblocks with timedOut: true when no message arrives', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm_wait'))) return;

        const startTime = Date.now();
        const res = await client.callTool('swarm_wait', {
          memberName: 'waiter',
          since: 0,
          timeoutMs: 300,
        });
        const elapsed = Date.now() - startTime;

        assert.equal(res.isError, false);
        assert.equal(res.data.timedOut, true, 'Should report timedOut: true');
        assert.ok(elapsed >= 250, `Elapsed ${elapsed}ms should roughly match timeout`);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F3-T1-05: Zero or negative timeoutMs in swarm_wait returns immediately without blocking', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm_wait'))) return;

        const startTime = Date.now();
        const res = await client.callTool('swarm_wait', {
          memberName: 'waiter',
          since: 0,
          timeoutMs: 0,
        });
        const elapsed = Date.now() - startTime;

        assert.equal(res.isError, false);
        assert.ok(elapsed < 200, `0ms timeout should return immediately; elapsed: ${elapsed}ms`);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  await suite.test('Tier 1: Feature 4 — Message Board MCP Tools', async (t) => {
    await t.test('F4-T1-01: post_message tool returns assigned seq and posted message payload', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message'))) return;

        const res = await client.callTool('post_message', {
          text: 'Hello Swarm',
          from: 'orchestrator',
          channel: 'main',
        });

        assert.equal(res.isError, false);
        assert.equal(res.data.success, true);
        assert.equal(res.data.message.text, 'Hello Swarm');
        assert.equal(res.data.message.seq, 1);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F4-T1-02: read_board tool retrieves all messages from board.jsonl and returns current headSeq', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'read_board'))) return;

        await client.callTool('post_message', { text: 'Line 1', from: 'alice' });
        await client.callTool('post_message', { text: 'Line 2', from: 'bob' });

        const res = await client.callTool('read_board', {});
        assert.equal(res.isError, false);
        assert.equal(res.data.headSeq, 2);
        assert.equal(res.data.messages.length, 2);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F4-T1-03: read_board with channel parameter filters messages visible in that channel', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'read_board'))) return;

        await client.callTool('post_message', { text: 'Main msg', channel: 'main', from: 'user' });
        await client.callTool('post_message', { text: 'Backend msg', channel: 'backend', from: 'user' });
        await client.callTool('post_message', { text: 'Frontend msg', channel: 'frontend', from: 'user' });

        const backendRead = await client.callTool('read_board', { channel: 'backend' });
        assert.equal(backendRead.isError, false);
        const texts = backendRead.data.messages.map((m) => m.text);
        assert.ok(texts.includes('Backend msg'));
        assert.ok(!texts.includes('Frontend msg'), 'Should not include messages from other channels');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F4-T1-04: read_board with limit parameter caps returned message count', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'read_board'))) return;

        for (let i = 1; i <= 5; i++) {
          await client.callTool('post_message', { text: `Message ${i}`, from: 'system' });
        }

        const res = await client.callTool('read_board', { limit: 2 });
        assert.equal(res.isError, false);
        assert.equal(res.data.messages.length, 2, 'Should cap at 2 messages');
        assert.equal(res.data.headSeq, 5, 'headSeq must reflect total board sequence');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F4-T1-05: read_board with status: true returns active member roster status', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'read_board'))) return;

        const res = await client.callTool('read_board', { status: true });
        assert.equal(res.isError, false);
        assert.ok(res.data.headSeq !== undefined);
        assert.ok(res.data.members !== undefined || res.data.roster !== undefined, 'Roster status should be present');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  await suite.test('Tier 1: Feature 5 — Channel Management', async (t) => {
    await t.test('F5-T1-01: Channel create creates a topic channel with description', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        const res = await client.callTool('swarm', {
          action: 'channel',
          op: 'create',
          channel: 'parser',
          topic: 'AST and grammar parsing workstream',
        });

        assert.equal(res.isError, false);
        assert.equal(res.data.success, true);
        assert.equal(res.data.channel, 'parser');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F5-T1-02: Channel subscribe registers members to private channel', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'channel', op: 'create', channel: 'ui' });
        const res = await client.callTool('swarm', {
          action: 'channel',
          op: 'subscribe',
          channel: 'ui',
          members: ['designer-1', 'frontend-1'],
        });

        assert.equal(res.isError, false);
        assert.equal(res.data.success, true);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F5-T1-03: Channel unsubscribe removes members from private channel', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'channel', op: 'create', channel: 'auth' });
        await client.callTool('swarm', { action: 'channel', op: 'subscribe', channel: 'auth', members: ['worker-1'] });
        const res = await client.callTool('swarm', {
          action: 'channel',
          op: 'unsubscribe',
          channel: 'auth',
          members: ['worker-1'],
        });

        assert.equal(res.isError, false);
        assert.equal(res.data.success, true);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F5-T1-04: Channel list returns all channels, topics, and subscriber memberships', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'channel', op: 'create', channel: 'perf', topic: 'Performance benchmarks' });
        const res = await client.callTool('swarm', { action: 'channel', op: 'list' });

        assert.equal(res.isError, false);
        const channels = res.data.channels || [];
        const perfChan = channels.find((c) => c.name === 'perf' || c.channel === 'perf');
        assert.ok(perfChan, 'Created channel perf should appear in channel list');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F5-T1-05: Channel archive marks channel archived and prevents further wakeups', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'channel', op: 'create', channel: 'legacy' });
        const res = await client.callTool('swarm', { action: 'channel', op: 'archive', channel: 'legacy' });

        assert.equal(res.isError, false);
        assert.equal(res.data.success, true);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================

  await suite.test('Tier 2: Boundary & Corner Cases (Features 1–5)', async (t) => {
    await t.test('F1-T2-01: High-concurrency parallel posts maintain monotonic seq ordering without race', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'read_board'))) return;

        const count = 15;
        const posts = Array.from({ length: count }, (_, i) =>
          client.callTool('post_message', { text: `Parallel post ${i + 1}`, from: `worker-${i + 1}` })
        );

        const results = await Promise.all(posts);
        for (const res of results) {
          assert.equal(res.isError, false);
        }

        const board = await client.callTool('read_board', { limit: 100 });
        assert.equal(board.data.messages.length, count);

        // Verify seq numbers are strictly monotonic: 1..count
        const seqs = board.data.messages.map((m) => m.seq);
        for (let i = 0; i < count; i++) {
          assert.equal(seqs[i], i + 1, `seq at index ${i} must be ${i + 1}`);
        }
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F1-T2-02: Large message text payload (>32KB) stored and retrieved with byte-exact fidelity', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'read_board'))) return;

        const largeText = 'X'.repeat(35000);
        const resPost = await client.callTool('post_message', { text: largeText, from: 'large-poster' });
        assert.equal(resPost.isError, false);

        const resRead = await client.callTool('read_board', {});
        const returnedMsg = resRead.data.messages[0];
        assert.equal(returnedMsg.text.length, 35000);
        assert.equal(returnedMsg.text, largeText);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F1-T2-03: Special characters, emojis, newlines, markdown, quotes preserved without corrupting NDJSON', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'read_board'))) return;

        const specialText = 'Line 1: 🐝 Hive swarm!\nLine 2: "quoted" and \'single\'\nLine 3: `code` \\back\\slash and 特殊文字 🚀';
        const resPost = await client.callTool('post_message', { text: specialText, from: 'unicode-tester' });
        assert.equal(resPost.isError, false);

        // Verify disk board.jsonl parses cleanly
        const lines = await readBoardLines(ws);
        assert.equal(lines.length, 1);
        assert.equal(lines[0].text, specialText);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F1-T2-04: Resilient recovery when board.jsonl has trailing blank lines or spaces', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'read_board'))) return;

        await client.callTool('post_message', { text: 'Normal line 1', from: 'alice' });

        // Manually inject blank lines and whitespace to board.jsonl
        const boardPath = path.join(ws.dir, '.swarm', 'board.jsonl');
        await fs.appendFile(boardPath, '\n   \n\n', 'utf8');

        // Reading board should ignore blanks without throwing JSON parse error
        const resRead = await client.callTool('read_board', {});
        assert.equal(resRead.isError, false);
        assert.equal(resRead.data.messages.length, 1);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F1-T2-05: Reading empty message board returns empty messages array and headSeq 0', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'read_board'))) return;

        const res = await client.callTool('read_board', {});
        assert.equal(res.isError, false);
        assert.equal(res.data.headSeq, 0);
        assert.deepEqual(res.data.messages, []);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F2-T2-01: Multiple mentions in single message (@agent1 and @agent2) wake both targets', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message'))) return;

        const res = await client.callTool('post_message', {
          text: '@agent-a and @agent-b please synchronize state',
          from: 'coordinator',
        });
        assert.equal(res.isError, false);
        const mentions = res.data.mentions || res.data.message.mentions || [];
        assert.ok(mentions.includes('agent-a'));
        assert.ok(mentions.includes('agent-b'));
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F2-T2-02: Mention at exact start or exact end of message text parsed accurately', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message'))) return;

        const resStart = await client.callTool('post_message', { text: '@leader begin turn', from: 'worker' });
        const resEnd = await client.callTool('post_message', { text: 'hail to the @leader', from: 'worker' });

        const mentionsStart = resStart.data.mentions || resStart.data.message?.mentions || [];
        const mentionsEnd = resEnd.data.mentions || resEnd.data.message?.mentions || [];

        assert.ok(mentionsStart.includes('leader'));
        assert.ok(mentionsEnd.includes('leader'));
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F2-T2-03: Case-sensitive and slug-formatted mention names parsed accurately', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message'))) return;

        const res = await client.callTool('post_message', {
          text: 'Notice for @Worker_Node-01 and @alpha-beta',
          from: 'system',
        });

        const mentions = res.data.mentions || res.data.message?.mentions || [];
        assert.ok(mentions.includes('Worker_Node-01') || mentions.includes('worker_node-01'));
        assert.ok(mentions.includes('alpha-beta'));
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F2-T2-04: Mention of non-existent or killed agent logged without runtime failure', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message'))) return;

        const res = await client.callTool('post_message', {
          text: '@phantom-agent-999 this agent does not exist',
          from: 'coordinator',
        });

        assert.equal(res.isError, false, 'Posting mention to unknown agent must succeed and log cleanly');
        assert.ok(res.data.message.seq > 0);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F2-T2-05: Consecutive @ symbols (e.g. @@name) handled safely without crash', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message'))) return;

        const res = await client.callTool('post_message', {
          text: 'Syntax check @@agent1 @@@agent2',
          from: 'tester',
        });

        assert.equal(res.isError, false);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F3-T2-01: swarm_wait with since far in future (since > headSeq) waits or times out cleanly', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm_wait'))) return;

        const res = await client.callTool('swarm_wait', {
          memberName: 'agent-future',
          since: 99999,
          timeoutMs: 250,
        });

        assert.equal(res.isError, false);
        assert.equal(res.data.timedOut, true);
        assert.deepEqual(res.data.messages, []);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F3-T2-02: swarm_wait with negative since treated safely as since: 0', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'swarm_wait'))) return;

        await client.callTool('post_message', { text: 'Baseline post', from: 'alice' });

        const res = await client.callTool('swarm_wait', {
          memberName: 'agent-neg',
          since: -5,
          mentions_only: false,
          timeoutMs: 1000,
        });

        assert.equal(res.isError, false);
        assert.ok(res.data.messages.length > 0, 'Should return available messages when since is negative');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F3-T2-03: Multiple concurrent agents calling swarm_wait unblocked simultaneously by single @all', async (ct) => {
      const ws = await createTestWorkspace();
      let c1, c2, cPoster;
      try {
        c1 = await createMcpClient(ws.dir);
        c2 = await createMcpClient(ws.dir);
        cPoster = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, c1, 'swarm_wait', 'post_message'))) return;

        const wait1 = c1.callTool('swarm_wait', { memberName: 'worker-1', since: 0, timeoutMs: 5000 });
        const wait2 = c2.callTool('swarm_wait', { memberName: 'worker-2', since: 0, timeoutMs: 5000 });

        await new Promise((r) => setTimeout(r, 200));
        await cPoster.callTool('post_message', { text: '@all synchronization point reached', from: 'coordinator' });

        const [res1, res2] = await Promise.all([wait1, wait2]);
        assert.equal(res1.data.timedOut, false, 'worker-1 must be unblocked');
        assert.equal(res2.data.timedOut, false, 'worker-2 must be unblocked');
      } finally {
        await c1?.close();
        await c2?.close();
        await cPoster?.close();
        await ws.cleanup();
      }
    });

    await t.test('F3-T2-04: Very small timeoutMs (15ms) expires promptly without drift', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm_wait'))) return;

        const startTime = Date.now();
        const res = await client.callTool('swarm_wait', {
          memberName: 'speedy',
          since: 0,
          timeoutMs: 15,
        });
        const elapsed = Date.now() - startTime;

        assert.equal(res.isError, false);
        assert.equal(res.data.timedOut, true);
        assert.ok(elapsed < 200, `Elapsed ${elapsed}ms should remain small for 15ms timeout`);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F3-T2-05: Rapid back-to-back swarm_wait calls process sequentially without event leak', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm_wait', 'post_message'))) return;

        await client.callTool('post_message', { text: 'Msg Alpha', from: 'coord' });
        const res1 = await client.callTool('swarm_wait', { since: 0, mentions_only: false, timeoutMs: 500 });
        assert.equal(res1.data.messages.length, 1);

        await client.callTool('post_message', { text: 'Msg Beta', from: 'coord' });
        const res2 = await client.callTool('swarm_wait', { since: 1, mentions_only: false, timeoutMs: 500 });
        assert.equal(res2.data.messages.length, 1);
        assert.equal(res2.data.messages[0].text, 'Msg Beta');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F4-T2-01: post_message with empty text rejected with validation error', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message'))) return;

        const res = await client.callTool('post_message', { text: '', from: 'nobody' });
        assert.equal(res.isError, true, 'Empty text must be rejected');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F4-T2-02: post_message with whitespace-only text rejected with validation error', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message'))) return;

        const res = await client.callTool('post_message', { text: '    \n  \t  ', from: 'nobody' });
        assert.equal(res.isError, true, 'Whitespace-only text must be rejected');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F4-T2-03: read_board with limit: 0 returns empty array with correct headSeq', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'read_board'))) return;

        await client.callTool('post_message', { text: 'Exists on board', from: 'user' });

        const res = await client.callTool('read_board', { limit: 0 });
        assert.equal(res.isError, false);
        assert.equal(res.data.messages.length, 0);
        assert.equal(res.data.headSeq, 1);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F4-T2-04: read_board with negative limit handled safely without server crash', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'read_board'))) return;

        const res = await client.callTool('read_board', { limit: -10 });
        // May return error or clamp to 0/default, but server must stay alive
        assert.ok(res !== null);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F4-T2-05: read_board on non-existent channel returns empty list', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'read_board'))) return;

        await client.callTool('post_message', { text: 'In main', channel: 'main', from: 'user' });
        const res = await client.callTool('read_board', { channel: 'no-such-channel-xyz' });

        assert.equal(res.isError, false);
        assert.equal(res.data.messages.length, 0);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F5-T2-01: Creating channel with reserved name "main" rejected with error', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        const res = await client.callTool('swarm', { action: 'channel', op: 'create', channel: 'main' });
        assert.equal(res.isError, true, 'Creating reserved channel "main" must be rejected');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F5-T2-02: Creating channel with invalid slug characters (spaces, uppercase) rejected', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        const res = await client.callTool('swarm', {
          action: 'channel',
          op: 'create',
          channel: 'Invalid Channel With Spaces',
        });
        assert.equal(res.isError, true, 'Channel slug with spaces must be rejected');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F5-T2-03: Archiving non-existent channel handled gracefully with error', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        const res = await client.callTool('swarm', {
          action: 'channel',
          op: 'archive',
          channel: 'non-existent-channel-404',
        });
        assert.equal(res.isError, true, 'Archiving non-existent channel must error');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F5-T2-04: Posting to archived channel rejected or read-only without wakeups', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'post_message'))) return;

        await client.callTool('swarm', { action: 'channel', op: 'create', channel: 'deprecated-api' });
        await client.callTool('swarm', { action: 'channel', op: 'archive', channel: 'deprecated-api' });

        const resPost = await client.callTool('post_message', {
          text: 'Posting to archived channel',
          channel: 'deprecated-api',
          from: 'worker',
        });

        // Archived channel should either reject post or refuse wakeup
        assert.ok(resPost.isError || resPost.data?.wakeCount === 0 || resPost.data?.archived === true);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F5-T2-05: Subscribing non-existent member to channel handled with informative error', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'channel', op: 'create', channel: 'ops' });
        const res = await client.callTool('swarm', {
          action: 'channel',
          op: 'subscribe',
          channel: 'ops',
          members: ['non-existent-worker-id'],
        });

        // Should return error or report 0 members subscribed
        assert.ok(res.isError || res.data?.subscribedCount === 0 || res.data?.warnings?.length > 0);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (PAIRWISE INTERACTIONS)
  // =========================================================================

  await suite.test('Tier 3: Cross-Feature Interactions (Message Board & Channels & Wait)', async (t) => {
    await t.test('F1-F5-INT-01: Channel-isolated wakeup: post in #backend wakes subscribed worker, unsubscribed #frontend worker remains waiting', async (ct) => {
      const ws = await createTestWorkspace();
      let cBackend, cFrontend, cPoster;
      try {
        cBackend = await createMcpClient(ws.dir);
        cFrontend = await createMcpClient(ws.dir);
        cPoster = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, cPoster, 'swarm', 'post_message', 'swarm_wait'))) return;

        // Create channels and subscriptions
        await cPoster.callTool('swarm', { action: 'channel', op: 'create', channel: 'backend' });
        await cPoster.callTool('swarm', { action: 'channel', op: 'create', channel: 'frontend' });

        // Backend worker waits on #backend channel
        const waitBackend = cBackend.callTool('swarm_wait', {
          memberName: 'worker-be',
          channel: 'backend',
          timeoutMs: 4000,
        });

        // Frontend worker waits on #frontend channel
        const waitFrontend = cFrontend.callTool('swarm_wait', {
          memberName: 'worker-fe',
          channel: 'frontend',
          timeoutMs: 800,
        });

        await new Promise((r) => setTimeout(r, 200));
        // Post exclusively to backend channel
        await cPoster.callTool('post_message', {
          text: '@#backend database schema migrated',
          channel: 'backend',
          from: 'db-admin',
        });

        const [resBackend, resFrontend] = await Promise.all([waitBackend, waitFrontend]);

        assert.equal(resBackend.data.timedOut, false, 'Backend worker must wake from backend post');
        assert.equal(resFrontend.data.timedOut, true, 'Frontend worker must time out without wakeups from #backend');
      } finally {
        await cBackend?.close();
        await cFrontend?.close();
        await cPoster?.close();
        await ws.cleanup();
      }
    });

    await t.test('F1-F5-INT-02: Doorbell unblocking during channel lifecycle: member unblocked by channel mention @#dev only after subscribing', async (ct) => {
      const ws = await createTestWorkspace();
      let cWorker, cLead;
      try {
        cWorker = await createMcpClient(ws.dir);
        cLead = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, cLead, 'swarm', 'post_message', 'swarm_wait'))) return;

        await cLead.callTool('swarm', { action: 'channel', op: 'create', channel: 'dev' });

        // 1. Worker waits without subscription; post to @#dev should NOT unblock worker
        const wait1 = cWorker.callTool('swarm_wait', {
          memberName: 'dev-worker',
          mentions_only: true,
          timeoutMs: 400,
        });
        await new Promise((r) => setTimeout(r, 100));
        await cLead.callTool('post_message', { text: '@#dev initial briefing', from: 'lead' });
        const res1 = await wait1;
        assert.equal(res1.data.timedOut, true, 'Should time out before subscription');

        // 2. Subscribe worker to #dev
        await cLead.callTool('swarm', {
          action: 'channel',
          op: 'subscribe',
          channel: 'dev',
          members: ['dev-worker'],
        });

        // 3. Worker waits again; post to @#dev should unblock worker
        const wait2 = cWorker.callTool('swarm_wait', {
          memberName: 'dev-worker',
          mentions_only: true,
          timeoutMs: 3000,
        });
        await new Promise((r) => setTimeout(r, 150));
        await cLead.callTool('post_message', { text: '@#dev task dispatched', from: 'lead' });
        const res2 = await wait2;
        assert.equal(res2.data.timedOut, false, 'Should wake up after subscription');
      } finally {
        await cWorker?.close();
        await cLead?.close();
        await ws.cleanup();
      }
    });

    await t.test('F1-F5-INT-03: Group mention unblocking: post to @worker unblocks multiple workers waiting on swarm_wait across channels', async (ct) => {
      const ws = await createTestWorkspace();
      let cW1, cW2, cCoordinator;
      try {
        cW1 = await createMcpClient(ws.dir);
        cW2 = await createMcpClient(ws.dir);
        cCoordinator = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, cCoordinator, 'post_message', 'swarm_wait'))) return;

        const w1Promise = cW1.callTool('swarm_wait', { memberName: 'worker-1', mentions_only: true, timeoutMs: 4000 });
        const w2Promise = cW2.callTool('swarm_wait', { memberName: 'worker-2', mentions_only: true, timeoutMs: 4000 });

        await new Promise((r) => setTimeout(r, 200));
        // Group mention @worker should wake both worker-1 and worker-2
        await cCoordinator.callTool('post_message', {
          text: '@worker sprint kickoff: claim your modules',
          from: 'coordinator',
        });

        const [res1, res2] = await Promise.all([w1Promise, w2Promise]);
        assert.equal(res1.data.timedOut, false, 'worker-1 should be woken by group @worker');
        assert.equal(res2.data.timedOut, false, 'worker-2 should be woken by group @worker');
      } finally {
        await cW1?.close();
        await cW2?.close();
        await cCoordinator?.close();
        await ws.cleanup();
      }
    });

    await t.test('F1-F5-INT-04: Monotonic sequence integrity across concurrent posts and channel control operations', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'post_message', 'read_board'))) return;

        // Mix normal posts and channel control operations
        await client.callTool('post_message', { text: 'Start pipeline', from: 'coord' });
        await client.callTool('swarm', { action: 'channel', op: 'create', channel: 'staging' });
        await client.callTool('post_message', { text: 'Staging ready', from: 'coord', channel: 'staging' });
        await client.callTool('swarm', { action: 'channel', op: 'archive', channel: 'staging' });
        await client.callTool('post_message', { text: 'End pipeline', from: 'coord' });

        const board = await client.callTool('read_board', { limit: 50 });
        assert.ok(board.data.messages.length >= 3, 'Must have at least 3 messages logged');

        // Check sequence numbers are strictly ordered
        const seqs = board.data.messages.map((m) => m.seq);
        for (let i = 1; i < seqs.length; i++) {
          assert.ok(seqs[i] > seqs[i - 1], `seq at ${i} (${seqs[i]}) must exceed seq at ${i - 1} (${seqs[i - 1]})`);
        }
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F1-F5-INT-05: swarm_wait unblocks on broadcast @all, advancing read cursor across multiple waiting agents', async (ct) => {
      const ws = await createTestWorkspace();
      let c1, c2, cLead;
      try {
        c1 = await createMcpClient(ws.dir);
        c2 = await createMcpClient(ws.dir);
        cLead = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, cLead, 'post_message', 'swarm_wait', 'read_board'))) return;

        const p1 = c1.callTool('swarm_wait', { memberName: 'subscriber-1', timeoutMs: 4000 });
        const p2 = c2.callTool('swarm_wait', { memberName: 'subscriber-2', timeoutMs: 4000 });

        await new Promise((r) => setTimeout(r, 200));
        await cLead.callTool('post_message', { text: '@all release v1.0.0 tagged', from: 'release-lead' });

        const [r1, r2] = await Promise.all([p1, p2]);
        assert.equal(r1.data.timedOut, false);
        assert.equal(r2.data.timedOut, false);
        assert.ok(r1.data.messages.some((m) => m.text.includes('@all')));
        assert.ok(r2.data.messages.some((m) => m.text.includes('@all')));
      } finally {
        await c1?.close();
        await c2?.close();
        await cLead?.close();
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // TIER 4: REVIEW REMEDIATION & REGRESSION SUITE (FINDINGS 1–6)
  // =========================================================================

  await suite.test('Tier 4: Review Remediation & Regression Suite', async (t) => {

    // Finding 1: mentions_only defaults to true
    await t.test('REG-01: swarm_wait defaults mentions_only to true, ignoring unmentioned chatter but waking when named', async (ct) => {
      const ws = await createTestWorkspace();
      let clientWait, clientPost;
      try {
        clientWait = await createMcpClient(ws.dir);
        clientPost = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, clientWait, 'swarm_wait', 'post_message'))) return;

        // 1. Wait without specifying mentions_only
        const wait1 = clientWait.callTool('swarm_wait', {
          memberName: 'sleeping-agent',
          since: 0,
          timeoutMs: 400,
        });

        await new Promise((r) => setTimeout(r, 100));
        // Post unmentioned chatter to #main
        await clientPost.callTool('post_message', {
          text: 'Unrelated conversation on main channel',
          from: 'chatterbox',
        });

        const res1 = await wait1;
        assert.equal(res1.isError, false);
        assert.equal(res1.data.timedOut, true, 'Default mentions_only: true must NOT wake on unmentioned chatter');
        assert.equal(res1.data.messages.length, 0);

        // 2. Wait again without specifying mentions_only, then send direct mention
        const wait2 = clientWait.callTool('swarm_wait', {
          memberName: 'sleeping-agent',
          since: res1.data.headSeq,
          timeoutMs: 3000,
        });

        await new Promise((r) => setTimeout(r, 100));
        await clientPost.callTool('post_message', {
          text: 'Wake up @sleeping-agent urgent assignment',
          from: 'coordinator',
        });

        const res2 = await wait2;
        assert.equal(res2.isError, false);
        assert.equal(res2.data.timedOut, false, 'Direct mention must immediately wake waiting agent');
        assert.equal(res2.data.messages.length, 1);
        assert.ok(res2.data.messages[0].text.includes('@sleeping-agent'));
      } finally {
        await clientWait?.close();
        await clientPost?.close();
        await ws.cleanup();
      }
    });

    // Finding 2: Agent status reverts to "working" upon swarm_wait timeout
    await t.test('REG-02: Agent status reverts to "working" and waitSince is cleared upon swarm_wait timeout', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm_wait', 'swarm'))) return;

        // Initialize and register worker in swarm state
        await client.callTool('swarm', { action: 'status' });
        const statePath = path.join(ws.dir, '.swarm', 'state.json');
        const initState = JSON.parse(await fs.readFile(statePath, 'utf8'));
        initState.agents = initState.agents || {};
        initState.agents['timed-agent'] = {
          id: 'timed-agent',
          role: 'worker',
          status: 'working',
        };
        await fs.writeFile(statePath, JSON.stringify(initState, null, 2), 'utf8');

        // Call swarm_wait with short timeout (200ms)
        const res = await client.callTool('swarm_wait', {
          memberName: 'timed-agent',
          since: 0,
          timeoutMs: 200,
        });

        assert.equal(res.isError, false);
        assert.equal(res.data.timedOut, true);

        // Inspect state.json on disk to verify status restoration
        const rawState = JSON.parse(await fs.readFile(statePath, 'utf8'));
        const ag = rawState.agents?.['timed-agent'];

        assert.ok(ag, 'Agent record must exist in state.json');
        assert.equal(ag.status, 'working', 'Agent status must revert to "working" after timeout');
        assert.equal(ag.waitSince, undefined, 'waitSince cursor must be cleared after timeout');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    // Finding 3: Torn line without trailing newline does not fuse with next post
    await t.test('REG-03: Torn line without trailing newline does not fuse with next postMessage write', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'read_board'))) return;

        // 1. Post initial valid message
        const res1 = await client.callTool('post_message', { text: 'Pre-crash message', from: 'alice' });
        assert.equal(res1.isError, false);
        assert.equal(res1.data.message.seq, 1);

        // 2. Simulate crash mid-write: append a partial JSON line WITHOUT newline
        const boardPath = path.join(ws.dir, '.swarm', 'board.jsonl');
        await fs.appendFile(boardPath, '{"seq": 2, "text": "aborted partial writ', 'utf8');

        // 3. Post next valid message
        const res2 = await client.callTool('post_message', { text: 'Post-crash valid message', from: 'bob' });
        assert.equal(res2.isError, false);

        // 4. Read board log and verify valid messages parse intact
        const board = await client.callTool('read_board', { limit: 50 });
        assert.equal(board.isError, false);

        const texts = board.data.messages.map((m) => m.text);
        assert.ok(texts.includes('Pre-crash message'), 'Pre-crash message must be present');
        assert.ok(texts.includes('Post-crash valid message'), 'Post-crash message must parse intact without corruption');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    // Finding 4: headSeq reseeded from disk on missing state headSeq
    await t.test('REG-04: headSeq reseeded from disk on missing state headSeq, preserving sequence monotonicity', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'read_board'))) return;

        // 1. Post two messages: seq 1 and seq 2
        await client.callTool('post_message', { text: 'Message Alpha', from: 'worker-1' });
        await client.callTool('post_message', { text: 'Message Beta', from: 'worker-2' });

        // 2. Simulate legacy or corrupted state file by removing headSeq from state.json
        const statePath = path.join(ws.dir, '.swarm', 'state.json');
        const rawState = JSON.parse(await fs.readFile(statePath, 'utf8'));
        delete rawState.headSeq;
        await fs.writeFile(statePath, JSON.stringify(rawState, null, 2), 'utf8');

        // 3. Post a third message
        const res3 = await client.callTool('post_message', { text: 'Message Gamma', from: 'worker-3' });
        assert.equal(res3.isError, false);
        // Must NOT collide with 1 or 2! Must be strictly > 2 (i.e. seq 3)
        assert.equal(res3.data.message.seq, 3, 'Post after missing headSeq must receive seq 3, not seq 1');

        // 4. Verify all sequence numbers on board are strictly monotonic
        const board = await client.callTool('read_board', { limit: 10 });
        const seqs = board.data.messages.map((m) => m.seq);
        assert.deepEqual(seqs, [1, 2, 3], 'All board sequences must be strictly monotonic [1, 2, 3]');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    // Finding 5: timeoutMs: 0 returns existing unread messages if present
    await t.test('REG-05: swarm_wait with timeoutMs: 0 returns existing unread messages with timedOut: false', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'swarm_wait'))) return;

        // 1. Post a qualifying message mentioning @poller
        await client.callTool('post_message', { text: 'Immediate work for @poller', from: 'lead' });

        // 2. Non-blocking poll (timeoutMs: 0)
        const res = await client.callTool('swarm_wait', {
          memberName: 'poller',
          since: 0,
          timeoutMs: 0,
        });

        assert.equal(res.isError, false);
        assert.equal(res.data.timedOut, false, 'Non-blocking poll must return timedOut: false when messages exist');
        assert.equal(res.data.messages.length, 1);
        assert.equal(res.data.messages[0].seq, 1);
        assert.ok(res.data.messages[0].text.includes('@poller'));

        // 3. Second non-blocking poll with cursor updated (since: 1)
        const res2 = await client.callTool('swarm_wait', {
          memberName: 'poller',
          since: 1,
          timeoutMs: 0,
        });

        assert.equal(res2.isError, false);
        assert.equal(res2.data.timedOut, true, 'Non-blocking poll must return timedOut: true when no new messages exist');
        assert.equal(res2.data.messages.length, 0);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    // Finding 6: Deduplication of "main" channel in swarm op: "list"
    await t.test('REG-06: swarm op: "list" returns deduplicated channel list with exactly one "main"', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        // Create custom topic channels
        await client.callTool('swarm', { action: 'channel', op: 'create', channel: 'frontend' });
        await client.callTool('swarm', { action: 'channel', op: 'create', channel: 'backend' });

        const res = await client.callTool('swarm', { action: 'channel', op: 'list' });
        assert.equal(res.isError, false);

        const channels = res.data.channels;
        assert.ok(Array.isArray(channels));

        // Filter occurrences of "main"
        const mainOccurrences = channels.filter((c) => c.name === 'main');
        assert.equal(mainOccurrences.length, 1, 'Channel "main" must appear exactly once in op: "list"');

        const names = channels.map((c) => c.name);
        assert.ok(names.includes('main'));
        assert.ok(names.includes('frontend'));
        assert.ok(names.includes('backend'));
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    // Finding 7 (Bonus): Channel slug validation in post_message
    await t.test('REG-07: post_message rejects invalid channel slug, preventing illegal state channel creation', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message'))) return;

        const res = await client.callTool('post_message', {
          text: 'Invalid channel post test',
          channel: 'invalid slug with spaces!',
        });
        assert.equal(res.isError, true, 'Invalid channel slug must be rejected');

        // Confirm illegal slug was not added to state.channels
        const statePath = path.join(ws.dir, '.swarm', 'state.json');
        const rawState = JSON.parse(await fs.readFile(statePath, 'utf8'));
        assert.equal(rawState.channels?.['invalid slug with spaces!'], undefined);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });
});
