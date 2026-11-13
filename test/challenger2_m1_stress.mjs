/**
 * Challenger 2: Empirical Stress Test Suite for Milestone 1 (Shared Message Board Subsystem)
 * 
 * Focus Areas:
 * 1. Zero-token sleep (swarm_wait):
 *    - Unblocking timing (<100ms) for in-process (EventBus) and cross-process (file polling)
 *    - Timeout precision with timedOut: true and empty messages
 *    - Filtering of untargeted messages (general chatter, mentions of other agents, other channels)
 * 2. Crash tolerance & torn-line recovery:
 *    - Incomplete/truncated JSON lines with newline at EOF
 *    - Truncated JSON line without newline at EOF (edge-case / fusion risk)
 *    - Corrupted non-JSON and null-byte lines in middle of log
 *    - Automatic recovery via recoverBoardLog
 *    - MCP read_board tool resilience over stdio
 * 3. Channel isolation:
 *    - Private channels hide messages from non-subscribers
 *    - Subscription and unsubscription visibility lifecycle
 *    - Doorbell targeting and channel mention isolation
 *    - Explicit channel query behavior
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
} from '../dist/board.js';
import { ensureState, getSwarmDir } from '../dist/state.js';

test('Challenger 2 Empirical Stress: Milestone 1 Message Board Subsystem', async (suite) => {

  // =========================================================================
  // 1. ZERO-TOKEN SLEEP (swarm_wait) STRESS & PRECISION
  // =========================================================================

  await suite.test('Focus 1: Zero-Token Sleep Timing, Precision & Filtering', async (t) => {

    await t.test('1.1 In-Process Unblocking Timing: unblocks in <100ms (microsecond EventEmitter dispatch)', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);
        const latencies = [];
        let cursor = 0;

        for (let i = 1; i <= 5; i++) {
          const waitPromise = swarmWait(swarmDir, {
            memberName: 'speed-agent',
            since: cursor,
            mentionsOnly: true,
            timeoutMs: 3000,
          });

          // Allow the wait listener to register
          await new Promise((r) => setTimeout(r, 20));

          const tStart = performance.now();
          const postResult = await postMessage(swarmDir, {
            text: `@speed-agent ping cycle ${i}`,
            from: 'coordinator',
          });

          const res = await waitPromise;
          const elapsed = performance.now() - tStart;
          latencies.push(elapsed);

          assert.equal(res.timedOut, false, `Cycle ${i} should not time out`);
          assert.equal(res.messages.length, 1, `Cycle ${i} should have 1 new message`);
          assert.equal(res.messages[0].text, `@speed-agent ping cycle ${i}`);
          assert.ok(
            elapsed < 100,
            `In-process unblock took ${elapsed.toFixed(2)}ms, must be <100ms`
          );

          cursor = postResult.seq;
        }

        const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        assert.ok(avg < 50, `Average in-process unblock latency was ${avg.toFixed(2)}ms (expected <50ms)`);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('1.2 Cross-Process Unblocking Timing: unblocks in <100ms across separate MCP client processes', async () => {
      const ws = await createTestWorkspace();
      let clientWait, clientPost;
      try {
        clientWait = await createMcpClient(ws.dir);
        clientPost = await createMcpClient(ws.dir);

        const latencies = [];
        let cursor = 0;

        for (let i = 1; i <= 4; i++) {
          const waitPromise = clientWait.callTool('swarm_wait', {
            memberName: 'worker-x',
            since: cursor,
            mentions_only: true,
            timeoutMs: 4000,
          });

          // Wait 60ms to ensure clientWait's stdio request is actively parked in wait loop
          await new Promise((r) => setTimeout(r, 60));

          const tStart = performance.now();
          const postRes = await clientPost.callTool('post_message', {
            text: `@worker-x wake up cycle ${i}`,
            from: 'sender-x',
          });
          assert.equal(postRes.isError, false);

          const waitRes = await waitPromise;
          const elapsed = performance.now() - tStart;
          latencies.push(elapsed);

          assert.equal(waitRes.isError, false);
          assert.equal(waitRes.data.timedOut, false, `Cycle ${i} should not time out`);
          assert.ok(waitRes.data.messages.length >= 1, `Cycle ${i} should receive wake message`);
          assert.ok(
            elapsed < 200,
            `Cross-process unblock took ${elapsed.toFixed(2)}ms (target <200ms with process IPC)`
          );

          cursor = postRes.data.seq;
        }

        const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        assert.ok(avg < 120, `Average cross-process unblock latency was ${avg.toFixed(2)}ms`);
      } finally {
        await clientWait?.close();
        await clientPost?.close();
        await ws.cleanup();
      }
    });

    await t.test('1.3 Timeout Precision: clean timeout with timedOut: true and empty messages', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        // Test timeout = 120ms
        const tStart1 = performance.now();
        const res1 = await swarmWait(swarmDir, {
          memberName: 'timeout-tester',
          timeoutMs: 120,
        });
        const elapsed1 = performance.now() - tStart1;

        assert.equal(res1.timedOut, true, 'Must report timedOut: true');
        assert.equal(res1.messages.length, 0, 'Timed out wait must return empty messages');
        assert.ok(elapsed1 >= 100, `Elapsed ${elapsed1.toFixed(1)}ms should be >= 100ms`);
        assert.ok(elapsed1 < 300, `Elapsed ${elapsed1.toFixed(1)}ms should be < 300ms`);

        // Test timeout = 0 returns immediately
        const tStart0 = performance.now();
        const res0 = await swarmWait(swarmDir, {
          memberName: 'timeout-tester',
          timeoutMs: 0,
        });
        const elapsed0 = performance.now() - tStart0;

        assert.equal(res0.timedOut, true);
        assert.equal(res0.messages.length, 0);
        assert.ok(elapsed0 < 50, `Zero timeout must return immediately, took ${elapsed0.toFixed(1)}ms`);

        // Test negative timeout
        const resNeg = await swarmWait(swarmDir, {
          memberName: 'timeout-tester',
          timeoutMs: -50,
        });
        assert.equal(resNeg.timedOut, true);
        assert.equal(resNeg.messages.length, 0);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('1.4 Filtering of Untargeted Messages: stays dormant during unmentioned chatter and wakes only on target mention', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        // Target agent starts waiting with mentionsOnly: true
        const waitPromise = swarmWait(swarmDir, {
          memberName: 'target-agent',
          mentionsOnly: true,
          timeoutMs: 2500,
        });

        await new Promise((r) => setTimeout(r, 30));

        // 1. Post untargeted general chatter
        await postMessage(swarmDir, { text: 'General chat without any mentions', from: 'random-1' });

        // 2. Post message mentioning another agent
        await postMessage(swarmDir, { text: 'Hey @other-agent please do task B', from: 'random-2' });

        // 3. Post message with prefix that does not match
        await postMessage(swarmDir, { text: 'Update for @target-other', from: 'random-3' });

        // Wait 100ms to verify agent has NOT prematurely unblocked
        await new Promise((r) => setTimeout(r, 100));

        // 4. Now post direct mention for target-agent
        await postMessage(swarmDir, { text: 'Hello @target-agent, wake up!', from: 'lead' });

        const res = await waitPromise;
        assert.equal(res.timedOut, false, 'Must unblock when target mention arrives');
        assert.equal(res.messages.length, 1, 'Should return only the targeted message');
        assert.equal(res.messages[0].text, 'Hello @target-agent, wake up!');
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('1.5 Untargeted Chatter Flood: 15 rapid untargeted messages do not prematurely unblock dormant agent', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        const waitPromise = swarmWait(swarmDir, {
          memberName: 'sleepy-worker',
          mentionsOnly: true,
          timeoutMs: 1200,
        });

        await new Promise((r) => setTimeout(r, 20));

        // Flood board with 15 non-targeted messages
        for (let i = 1; i <= 15; i++) {
          await postMessage(swarmDir, {
            text: `Background log entry #${i} for @worker-other`,
            from: 'noise-generator',
          });
        }

        const res = await waitPromise;
        assert.equal(res.timedOut, true, 'Agent must stay asleep through untargeted chatter flood and time out');
        assert.equal(res.messages.length, 0);
      } finally {
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // 2. CRASH TOLERANCE & TORN-LINE RECOVERY IN .swarm/board.jsonl
  // =========================================================================

  await suite.test('Focus 2: Crash Tolerance & Torn-Line Recovery in board.jsonl', async (t) => {

    await t.test('2.1a Truncated JSON line with newline at EOF: read_board returns valid messages and post_message continues cleanly', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        // Write 2 valid messages
        await postMessage(swarmDir, { text: 'Valid message 1', from: 'worker-1' });
        await postMessage(swarmDir, { text: 'Valid message 2', from: 'worker-2' });

        // Simulate crash: append a truncated / torn line terminated with newline
        const boardFile = path.join(swarmDir, 'board.jsonl');
        await fs.appendFile(boardFile, '{"seq": 3, "from": "worker-1", "text": "partial line cut mid-wri\n', 'utf8');

        // Read board messages - should parse valid messages without crashing
        const msgs = await readBoardMessages(swarmDir);
        assert.equal(msgs.length, 2, 'Should recover 2 valid messages, ignoring truncated line');
        assert.equal(msgs[0].seq, 1);
        assert.equal(msgs[1].seq, 2);

        // Next post should succeed without throwing
        const nextMsg = await postMessage(swarmDir, { text: 'Post after torn line', from: 'worker-1' });
        assert.ok(nextMsg.seq >= 3, 'Sequence numbering should advance monotonically');

        // Verify board messages now contain the new message
        const finalMsgs = await readBoardMessages(swarmDir);
        assert.equal(finalMsgs.length, 3, 'Should have exactly 3 valid messages');
        assert.equal(finalMsgs[finalMsgs.length - 1].text, 'Post after torn line');
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('2.1b Torn line WITHOUT newline at EOF: recoverBoardLog repairs un-terminated line before append', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        // Write 2 valid messages
        await postMessage(swarmDir, { text: 'Valid message A', from: 'worker-1' });
        await postMessage(swarmDir, { text: 'Valid message B', from: 'worker-2' });

        // Simulate abrupt process termination mid-byte (no trailing newline)
        const boardFile = path.join(swarmDir, 'board.jsonl');
        await fs.appendFile(boardFile, '{"seq": 3, "from": "worker-1", "text": "abrupt crash without newline', 'utf8');

        // Calling readBoardMessages directly drops the un-terminated torn line cleanly
        const parsedBefore = await readBoardMessages(swarmDir);
        assert.equal(parsedBefore.length, 2, 'parseBoardLog safely drops un-terminated trailing line');

        // Running recoverBoardLog cleans up the un-terminated fragment
        const recovered = await recoverBoardLog(swarmDir);
        assert.equal(recovered.length, 2);

        // Now postMessage appends cleanly onto a proper new line
        const newMsg = await postMessage(swarmDir, { text: 'Post after clean recovery', from: 'worker-1' });
        assert.ok(newMsg.seq >= 3);

        const parsedAfter = await readBoardMessages(swarmDir);
        assert.equal(parsedAfter.length, 3, 'Clean log now contains 3 messages');
        assert.equal(parsedAfter[2].text, 'Post after clean recovery');
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('2.2 Corrupted garbage and null bytes in middle of board.jsonl: safely skipped without error', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);
        const boardFile = path.join(swarmDir, 'board.jsonl');

        // Construct raw content with valid, corrupted, null-byte, and valid lines
        const rawContent = [
          JSON.stringify({ seq: 1, from: 'w1', text: 'Good line 1', timestamp: Date.now() }),
          'INVALID NON JSON GARBAGE CHARACTERS !@#$%^&*()',
          '\u0000\u0000\u0000\u0000\u0000\u0000\u0000\u0000',
          '{"incomplete": "missing seq"}',
          '{"seq": "not-a-number", "text": "bad seq"}',
          JSON.stringify({ seq: 2, from: 'w2', text: 'Good line 2', timestamp: Date.now() }),
        ].join('\n') + '\n';

        await fs.writeFile(boardFile, rawContent, 'utf8');

        const readRes = await readBoard(swarmDir, {});
        assert.equal(readRes.messages.length, 2, 'Must parse exactly the 2 valid messages and skip corrupt lines');
        assert.equal(readRes.messages[0].text, 'Good line 1');
        assert.equal(readRes.messages[1].text, 'Good line 2');
        assert.equal(readRes.headSeq, 2);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('2.3 recoverBoardLog cleanses corrupted lines and rewrites compact valid NDJSON', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);
        const boardFile = path.join(swarmDir, 'board.jsonl');

        const dirtyContent = [
          JSON.stringify({ seq: 1, from: 'w1', text: 'Alpha', timestamp: 1000 }),
          'GARBAGE LINE 1',
          JSON.stringify({ seq: 2, from: 'w2', text: 'Beta', timestamp: 2000 }),
          '{"torn": json',
          JSON.stringify({ seq: 3, from: 'w3', text: 'Gamma', timestamp: 3000 }),
          '   ',
        ].join('\n') + '\n';

        await fs.writeFile(boardFile, dirtyContent, 'utf8');

        // Run recovery
        const recovered = await recoverBoardLog(swarmDir);
        assert.equal(recovered.length, 3, 'Recovered messages should contain 3 valid entries');

        // Check rewritten file on disk
        const cleanContent = await fs.readFile(boardFile, 'utf8');
        const lines = cleanContent.split('\n').filter(Boolean);
        assert.equal(lines.length, 3, 'Cleansed file must have exactly 3 lines');
        for (const line of lines) {
          const parsed = JSON.parse(line);
          assert.ok(typeof parsed.seq === 'number', 'Every line must be valid JSON with numeric seq');
        }
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('2.4 MCP read_board tool over stdio survives torn board.jsonl cleanly', async () => {
      const ws = await createTestWorkspace();
      let client;
      try {
        const swarmDir = path.join(ws.dir, '.swarm');
        await ensureState(swarmDir);
        const boardFile = path.join(swarmDir, 'board.jsonl');

        // Pre-populate with torn data in .swarm/board.jsonl
        const tornData = [
          JSON.stringify({ seq: 1, from: 'alpha', text: 'Message 1', timestamp: 1000 }),
          '{"torn": "halfway written json string...',
        ].join('\n') + '\n';
        await fs.writeFile(boardFile, tornData, 'utf8');

        client = await createMcpClient(ws.dir);
        const res = await client.callTool('read_board', {});

        assert.equal(res.isError, false, 'MCP server must handle torn log without error');
        assert.equal(res.data.messages.length, 1, 'Should return the single valid message');
        assert.equal(res.data.messages[0].text, 'Message 1');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('2.5 Special characters, unicode emojis, and multiline markdown payloads preserve NDJSON line integrity', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        const complexPayload = `
### Task Update 🚀🔥
Here is the code:
\`\`\`typescript
interface State {
  id: "uuid-123";
  meta: { test: true };
}
\`\`\`
Special runes: ñ, é, 中文, ⚡, 🛡️, "\\nested quotes\\" and \\n escapes.
`;
        await postMessage(swarmDir, { text: complexPayload, from: 'dev-1' });

        const readRes = await readBoard(swarmDir, {});
        assert.equal(readRes.messages.length, 1);
        assert.equal(readRes.messages[0].text, complexPayload);

        // Verify board.jsonl contains exactly 1 physical line
        const boardFile = path.join(swarmDir, 'board.jsonl');
        const raw = await fs.readFile(boardFile, 'utf8');
        const nonBlankLines = raw.split('\n').filter((l) => l.trim().length > 0);
        assert.equal(nonBlankLines.length, 1, 'Multiline markdown payload must be escaped to a single NDJSON line');
      } finally {
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // 3. CHANNEL ISOLATION & VISIBILITY
  // =========================================================================

  await suite.test('Focus 3: Channel Isolation & Membership Security', async (t) => {

    await t.test('3.1 Private channel messages are invisible to non-subscribers in general board reads', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        // 1. Create private channel
        await postMessage(swarmDir, {
          text: 'Create private ops channel',
          from: 'coordinator',
          control: {
            op: 'create',
            channel: 'secret-ops',
            topic: 'Classified operations',
            members: ['alice'],
          },
        });

        // 2. Post on #main and #secret-ops
        await postMessage(swarmDir, { text: 'Public broadcast on main', channel: 'main', from: 'alice' });
        await postMessage(swarmDir, { text: 'Top secret plan details', channel: 'secret-ops', from: 'alice' });

        // 3. Non-subscriber bob reads board
        const bobView = await readBoard(swarmDir, { memberName: 'bob' });
        const bobTexts = bobView.messages.map((m) => m.text);

        assert.ok(bobTexts.includes('Public broadcast on main'), 'Bob must see main channel messages');
        assert.ok(
          !bobTexts.includes('Top secret plan details'),
          'Bob (non-subscriber) MUST NOT see messages from secret-ops'
        );

        // 4. Subscriber alice reads board
        const aliceView = await readBoard(swarmDir, { memberName: 'alice' });
        const aliceTexts = aliceView.messages.map((m) => m.text);
        assert.ok(aliceTexts.includes('Top secret plan details'), 'Alice (subscriber) must see secret-ops messages');
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('3.2 Channel subscription lifecycle: visibility granted upon subscribe and revoked on unsubscribe', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        // Create channel
        await postMessage(swarmDir, {
          text: 'Create engineering channel',
          from: 'lead',
          control: { op: 'create', channel: 'engineering', members: ['lead'] },
        });

        await postMessage(swarmDir, { text: 'Secret architecture v1', channel: 'engineering', from: 'lead' });

        // Worker is initially not subscribed
        const viewBefore = await readBoard(swarmDir, { memberName: 'worker-bob' });
        assert.equal(
          viewBefore.messages.some((m) => m.text === 'Secret architecture v1'),
          false,
          'Unsubscribed worker cannot see message'
        );

        // Subscribe worker-bob
        await postMessage(swarmDir, {
          text: 'Subscribe bob to engineering',
          from: 'lead',
          control: { op: 'subscribe', channel: 'engineering', members: ['worker-bob'] },
        });

        // Worker now sees the message
        const viewAfter = await readBoard(swarmDir, { memberName: 'worker-bob' });
        assert.equal(
          viewAfter.messages.some((m) => m.text === 'Secret architecture v1'),
          true,
          'Subscribed worker now sees the message'
        );

        // Unsubscribe worker-bob
        await postMessage(swarmDir, {
          text: 'Unsubscribe bob from engineering',
          from: 'lead',
          control: { op: 'unsubscribe', channel: 'engineering', members: ['worker-bob'] },
        });

        // Post new secret message
        await postMessage(swarmDir, { text: 'Secret architecture v2', channel: 'engineering', from: 'lead' });

        // Worker should NOT see v2
        const viewRevoked = await readBoard(swarmDir, { memberName: 'worker-bob' });
        assert.equal(
          viewRevoked.messages.some((m) => m.text === 'Secret architecture v2'),
          false,
          'Revoked worker cannot see newly posted secret message'
        );
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('3.3 Channel mention isolation: @#channel wakes ONLY members subscribed to that channel', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        // Create channel 'dev' with member 'worker-dev'
        await postMessage(swarmDir, {
          text: 'Create dev channel',
          from: 'coordinator',
          control: { op: 'create', channel: 'dev', members: ['worker-dev'] },
        });

        // Worker-dev and Worker-other wait concurrently
        const waitDev = swarmWait(swarmDir, {
          memberName: 'worker-dev',
          mentionsOnly: true,
          timeoutMs: 2000,
        });

        const waitOther = swarmWait(swarmDir, {
          memberName: 'worker-other',
          mentionsOnly: true,
          timeoutMs: 600,
        });

        await new Promise((r) => setTimeout(r, 40));

        // Post channel mention @#dev
        await postMessage(swarmDir, {
          text: '@#dev sprint planning has started',
          channel: 'main',
          from: 'lead',
        });

        const [resDev, resOther] = await Promise.all([waitDev, waitOther]);

        assert.equal(resDev.timedOut, false, 'worker-dev (subscriber) must be woken by @#dev');
        assert.equal(resOther.timedOut, true, 'worker-other (non-subscriber) must time out');
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('3.4 Explicit channel parameter behavior: non-member querying private channel', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        // Create channel
        await postMessage(swarmDir, {
          text: 'Create private ops channel',
          from: 'coordinator',
          control: { op: 'create', channel: 'vault', members: ['admin'] },
        });

        await postMessage(swarmDir, { text: 'Vault passcode is 9876', channel: 'vault', from: 'admin' });

        // Case A: Querying with member filter without specifying channel
        const memberView = await readBoard(swarmDir, { memberName: 'stranger' });
        assert.equal(
          memberView.messages.some((m) => m.text.includes('Vault passcode')),
          false,
          'Member view must hide vault messages from non-member'
        );

        // Case B: Direct channel filter `channel: "vault"`
        const channelView = await readBoard(swarmDir, { channel: 'vault' });
        assert.equal(
          channelView.messages.some((m) => m.text.includes('Vault passcode')),
          true,
          'Channel filter retrieves messages for that explicit stream'
        );
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('3.5 Multi-channel concurrent waiters: post to #alpha wakes ONLY #alpha waiter', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        const m1 = await postMessage(swarmDir, {
          text: 'Create alpha',
          from: 'coordinator',
          control: { op: 'create', channel: 'alpha', members: ['worker-alpha'] },
        });

        const m2 = await postMessage(swarmDir, {
          text: 'Create beta',
          from: 'coordinator',
          control: { op: 'create', channel: 'beta', members: ['worker-beta'] },
        });

        const cursor = m2.seq;

        const waitAlpha = swarmWait(swarmDir, {
          memberName: 'worker-alpha',
          channel: 'alpha',
          since: cursor,
          timeoutMs: 3000,
        });

        const waitBeta = swarmWait(swarmDir, {
          memberName: 'worker-beta',
          channel: 'beta',
          since: cursor,
          timeoutMs: 600,
        });

        const waitMain = swarmWait(swarmDir, {
          memberName: 'worker-main',
          channel: 'main',
          since: cursor,
          timeoutMs: 600,
        });

        await new Promise((r) => setTimeout(r, 40));

        // Post only to alpha
        await postMessage(swarmDir, {
          text: 'Message exclusively in alpha',
          channel: 'alpha',
          from: 'lead',
        });

        const [resAlpha, resBeta, resMain] = await Promise.all([waitAlpha, waitBeta, waitMain]);

        assert.equal(resAlpha.timedOut, false, 'Alpha waiter must wake up');
        assert.equal(resAlpha.messages[0].text, 'Message exclusively in alpha');
        assert.equal(resBeta.timedOut, true, 'Beta waiter must time out');
        assert.equal(resMain.timedOut, true, 'Main waiter must time out');
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('3.6 Archived channel protection: posting to archived channel throws and prevents wakeups', async () => {
      const ws = await createTestWorkspace();
      const swarmDir = path.join(ws.dir, '.swarm');
      try {
        await ensureState(swarmDir);

        await postMessage(swarmDir, {
          text: 'Create old-project',
          from: 'coordinator',
          control: { op: 'create', channel: 'old-project', members: ['worker-old'] },
        });

        // Archive the channel
        await postMessage(swarmDir, {
          text: 'Archive old-project',
          from: 'coordinator',
          control: { op: 'archive', channel: 'old-project' },
        });

        // Attempting to post to archived channel should throw
        await assert.rejects(
          async () => {
            await postMessage(swarmDir, {
              text: 'Attempt to post in dead channel',
              channel: 'old-project',
              from: 'worker-old',
            });
          },
          /archived and read-only/
        );
      } finally {
        await ws.cleanup();
      }
    });

  });

});
