/**
 * Challenger Test Suite: Milestone 1 Empirical Stress Tests
 * 
 * Verifies:
 * 1. High-concurrency sequence monotonicity (50+ concurrent calls):
 *    - 55 concurrent MCP tool post_message requests
 *    - 75 concurrent direct board.ts postMessage calls
 *    - 100 mixed concurrent operations (posts, reads, channel operations)
 *    - Zero gaps, zero duplicates, strictly contiguous sequence numbers 1..N.
 * 
 * 2. Doorbell mention parsing under adversarial string patterns:
 *    - Boundary runes (foo@bar, (@worker), hello @worker!, brackets, punctuation, digits, emails)
 *    - Group prefix matching (@worker -> worker-1, worker-2, worker-99; no cross-wakeups)
 *    - Broadcast @all (case-insensitivity, boundary checks, universal wakeups)
 *    - Channel mentions @#channel (@#dev, @#main ignored, reserved channels, archived channels)
 *    - Unicode runes and emoji prefixes (🐝@worker, 🔥 @worker, Привет @worker, café@worker vs café @worker, 你好@worker vs 你好 @worker)
 *    - Unicode agent names (@élise, @разработчик, @élise-1 with group @élise)
 *    - Mixed mentions in single post (@alice @bob @#testing @all)
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

import {
  postMessage,
  readBoard,
  parseMentions,
  isMentioned,
  namedToken,
  named,
  channelMentions,
  readBoardMessages,
} from '../dist/board.js';
import { initState, updateState } from '../dist/state.js';

test('Challenger M1 Stress Suite: Concurrency Monotonicity & Adversarial Mention Parsing', async (suite) => {

  // =========================================================================
  // SECTION 1: HIGH CONCURRENCY MONOTONICITY (50+ CONCURRENT CALLS)
  // =========================================================================

  await suite.test('Concurrency 1: 55 Concurrent post_message MCP Tool Requests', async (t) => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);
      const tools = await client.listTools();
      const available = new Set(tools.map((x) => x.name));
      if (!available.has('post_message') || !available.has('read_board')) {
        t.skip('Required MCP tools not available');
        return;
      }

      const CONCURRENCY = 55;
      const startTime = Date.now();

      // Launch 55 concurrent post_message calls
      const promises = Array.from({ length: CONCURRENCY }, (_, i) =>
        client.callTool('post_message', {
          text: `Concurrent MCP message #${i + 1}`,
          from: `agent-${(i % 10) + 1}`,
        })
      );

      const results = await Promise.all(promises);
      const elapsed = Date.now() - startTime;

      // 1. All calls must succeed without error
      for (let i = 0; i < CONCURRENCY; i++) {
        assert.equal(
          results[i].isError,
          false,
          `Request #${i + 1} failed with: ${JSON.stringify(results[i])}`
        );
        assert.ok(
          typeof results[i].data?.message?.seq === 'number',
          `Request #${i + 1} did not return valid seq`
        );
      }

      // 2. Read physical board.jsonl from disk
      const boardPath = path.join(ws.dir, '.swarm', 'board.jsonl');
      const rawLines = (await fs.readFile(boardPath, 'utf8'))
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);

      assert.equal(
        rawLines.length,
        CONCURRENCY,
        `Expected exactly ${CONCURRENCY} lines in board.jsonl, found ${rawLines.length}`
      );

      // Parse every line and verify valid JSON
      const parsedEntries = rawLines.map((line, idx) => {
        try {
          return JSON.parse(line);
        } catch (err) {
          assert.fail(`Line ${idx + 1} is invalid JSON: ${line}`);
        }
      });

      // 3. Monotonicity: Collect all assigned sequence numbers
      const returnedSeqs = results.map((r) => r.data.message.seq);
      const diskSeqs = parsedEntries.map((e) => e.seq);

      // Assert zero duplicates
      assert.equal(
        new Set(returnedSeqs).size,
        CONCURRENCY,
        `Duplicate sequence numbers detected in returned responses! Unique count: ${new Set(returnedSeqs).size}`
      );
      assert.equal(
        new Set(diskSeqs).size,
        CONCURRENCY,
        `Duplicate sequence numbers detected in disk board.jsonl! Unique count: ${new Set(diskSeqs).size}`
      );

      // Assert zero gaps (strictly contiguous 1..CONCURRENCY)
      const sortedReturned = [...returnedSeqs].sort((a, b) => a - b);
      const sortedDisk = [...diskSeqs].sort((a, b) => a - b);

      for (let expected = 1; expected <= CONCURRENCY; expected++) {
        assert.equal(
          sortedReturned[expected - 1],
          expected,
          `Gap detected in returned seqs! Expected ${expected}, got ${sortedReturned[expected - 1]}`
        );
        assert.equal(
          sortedDisk[expected - 1],
          expected,
          `Gap detected in disk seqs! Expected ${expected}, got ${sortedDisk[expected - 1]}`
        );
      }

      // 4. In disk log, sequence numbers must be strictly increasing per physical line
      for (let i = 0; i < diskSeqs.length; i++) {
        assert.equal(
          diskSeqs[i],
          i + 1,
          `Physical line ${i + 1} in board.jsonl has out-of-order seq ${diskSeqs[i]}`
        );
      }

      // 5. Verify state.json headSeq
      const stateRaw = await fs.readFile(path.join(ws.dir, '.swarm', 'state.json'), 'utf8');
      const stateObj = JSON.parse(stateRaw);
      assert.equal(
        stateObj.headSeq,
        CONCURRENCY,
        `state.headSeq must match total messages (${CONCURRENCY}), found ${stateObj.headSeq}`
      );

      // 6. Verify read_board tool retrieves all 55 messages with correct headSeq
      const readRes = await client.callTool('read_board', { limit: 100 });
      assert.equal(readRes.isError, false);
      assert.equal(readRes.data.headSeq, CONCURRENCY);
      assert.equal(readRes.data.messages.length, CONCURRENCY);

    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await suite.test('Concurrency 2: 75 Concurrent Direct postMessage Calls (Library Invocation)', async () => {
    const ws = await createTestWorkspace();
    const swarmDir = path.join(ws.dir, '.swarm');
    try {
      await initState('Stress Test Swarm', 0, undefined, swarmDir);

      const CONCURRENCY = 75;
      const startTime = Date.now();

      // Fire 75 parallel asynchronous postMessage calls
      const promises = Array.from({ length: CONCURRENCY }, (_, i) =>
        postMessage(swarmDir, {
          text: `Direct parallel payload ${i + 1} [hash: ${Math.random().toString(36).slice(2)}]`,
          from: `worker-${(i % 15) + 1}`,
        })
      );

      const messages = await Promise.all(promises);

      // Assert all 75 succeeded and returned valid BoardMessage objects
      assert.equal(messages.length, CONCURRENCY);
      for (let i = 0; i < CONCURRENCY; i++) {
        assert.ok(typeof messages[i].seq === 'number', `Message #${i + 1} has non-number seq`);
      }

      const seqs = messages.map((m) => m.seq);
      assert.equal(new Set(seqs).size, CONCURRENCY, 'Duplicate sequence numbers detected!');

      const sorted = [...seqs].sort((a, b) => a - b);
      for (let i = 0; i < CONCURRENCY; i++) {
        assert.equal(sorted[i], i + 1, `Gap at index ${i}: expected ${i + 1}, got ${sorted[i]}`);
      }

      // Read back from board.jsonl directly
      const diskMessages = await readBoardMessages(swarmDir);
      assert.equal(diskMessages.length, CONCURRENCY);

      for (let i = 0; i < CONCURRENCY; i++) {
        assert.equal(diskMessages[i].seq, i + 1, `Disk message #${i + 1} has seq ${diskMessages[i].seq}`);
      }

      const boardState = await readBoard(swarmDir, { limit: 200 });
      assert.equal(boardState.headSeq, CONCURRENCY);
      assert.equal(boardState.messages.length, CONCURRENCY);
    } finally {
      await ws.cleanup();
    }
  });

  await suite.test('Concurrency 3: 100 Mixed Concurrent Operations (Posts, Reads, Channel Ops)', async () => {
    const ws = await createTestWorkspace();
    const swarmDir = path.join(ws.dir, '.swarm');
    try {
      await initState('Mixed Stress Swarm', 0, undefined, swarmDir);

      const POST_COUNT = 80;
      const READ_COUNT = 15;
      const CHANNEL_COUNT = 5;

      const postPromises = Array.from({ length: POST_COUNT }, (_, i) =>
        postMessage(swarmDir, {
          text: `Mixed post #${i + 1}`,
          from: `worker-${(i % 5) + 1}`,
        })
      );

      const readPromises = Array.from({ length: READ_COUNT }, (_, i) =>
        readBoard(swarmDir, { since: i * 2, limit: 50 })
      );

      const channelPromises = Array.from({ length: CHANNEL_COUNT }, (_, i) =>
        postMessage(swarmDir, {
          text: `Creating channel topic-${i + 1}`,
          from: 'coordinator',
          control: {
            op: 'create',
            channel: `topic-${i + 1}`,
            topic: `Topic channel ${i + 1}`,
            members: ['coordinator', `worker-${i + 1}`],
          },
        })
      );

      // Launch all 100 operations simultaneously
      const [posts, reads, channelOps] = await Promise.all([
        Promise.all(postPromises),
        Promise.all(readPromises),
        Promise.all(channelPromises),
      ]);

      const totalPosts = POST_COUNT + CHANNEL_COUNT; // 85 total posts written
      const allMessages = [...posts, ...channelOps];
      assert.equal(allMessages.length, totalPosts);

      const seqs = allMessages.map((m) => m.seq);
      assert.equal(new Set(seqs).size, totalPosts, 'Duplicate sequence numbers in mixed operations!');

      const sorted = [...seqs].sort((a, b) => a - b);
      for (let i = 0; i < totalPosts; i++) {
        assert.equal(sorted[i], i + 1, `Gap in mixed sequence numbers at ${i + 1}`);
      }

      // Verify readBoard results were non-corrupt
      for (const r of reads) {
        assert.ok(typeof r.headSeq === 'number');
        assert.ok(Array.isArray(r.messages));
      }

      // Final board validation
      const finalBoard = await readBoard(swarmDir, { limit: 200 });
      assert.equal(finalBoard.headSeq, totalPosts);
      assert.equal(finalBoard.messages.length, totalPosts);
    } finally {
      await ws.cleanup();
    }
  });

  // =========================================================================
  // SECTION 2: ADVERSARIAL DOORBELL MENTION PARSING
  // =========================================================================

  await suite.test('Adversarial Mentions 1: Boundary Runes and False-Positive Prevention', async () => {
    // 1. Email-style strings must NOT trigger mention on the domain or username
    assert.equal(namedToken('contact user@company.com for info', 'company'), false);
    assert.equal(namedToken('foo@bar', 'bar'), false);
    assert.equal(namedToken('alice@domain.org', 'domain'), false);
    assert.equal(isMentioned('contact user@company.com for info', 'company'), false);
    assert.equal(isMentioned('foo@bar', 'bar'), false);

    const emailParse = parseMentions('email: alice@domain.com, bob@corp.net');
    assert.deepEqual(emailParse.names, []);
    assert.deepEqual(emailParse.raw, []);

    // 2. Bracketed, parenthesized, quoted mentions MUST trigger cleanly
    assert.equal(namedToken('(@worker)', 'worker'), true);
    assert.equal(namedToken('[@worker]', 'worker'), true);
    assert.equal(namedToken('{@worker}', 'worker'), true);
    assert.equal(namedToken('"@worker"', 'worker'), true);
    assert.equal(namedToken("'@worker'", 'worker'), true);
    assert.equal(namedToken('<@worker>', 'worker'), true);
    assert.equal(isMentioned('Task assigned to (@worker)', 'worker'), true);
    assert.equal(isMentioned('[@worker] review this', 'worker'), true);
    assert.equal(isMentioned('"@worker" check git status', 'worker'), true);

    const bracketParse = parseMentions('Check (@worker) and [@auditor] and {"user": "@lead"}');
    assert.ok(bracketParse.names.includes('worker'));
    assert.ok(bracketParse.names.includes('auditor'));
    assert.ok(bracketParse.names.includes('lead'));

    // 3. Punctuation boundaries at end of mention token
    assert.equal(namedToken('hello @worker!', 'worker'), true);
    assert.equal(namedToken('is that @worker?', 'worker'), true);
    assert.equal(namedToken('calling @worker.', 'worker'), true);
    assert.equal(namedToken('hey @worker, please respond', 'worker'), true);
    assert.equal(namedToken('attention: @worker; please note', 'worker'), true);
    assert.equal(namedToken('@worker: turn starts now', 'worker'), true);

    assert.equal(isMentioned('hello @worker!', 'worker'), true);
    assert.equal(isMentioned('is that @worker?', 'worker'), true);
    assert.equal(isMentioned('calling @worker.', 'worker'), true);
    assert.equal(isMentioned('hey @worker, please respond', 'worker'), true);

    // 4. Underscore and Hyphen boundaries
    // Underscore and hyphen ARE valid NAME_RUNEs.
    // Therefore, _@worker or -@worker has a name rune immediately before @, so it must NOT trigger
    assert.equal(namedToken('prefix_@worker', 'worker'), false);
    assert.equal(namedToken('prefix-@worker', 'worker'), false);
    assert.equal(isMentioned('prefix_@worker', 'worker'), false);
    assert.equal(isMentioned('prefix-@worker', 'worker'), false);

    // And @worker_sub or @worker-node must NOT match "worker" directly
    assert.equal(namedToken('@worker_sub', 'worker'), false);
    assert.equal(namedToken('@worker-node', 'worker'), false);

    // 5. Numeric boundary: 123@worker has digit before @, must NOT trigger
    assert.equal(namedToken('123@worker', 'worker'), false);
    assert.equal(isMentioned('123@worker', 'worker'), false);
    // But "123 @worker" (with space) MUST trigger
    assert.equal(namedToken('123 @worker', 'worker'), true);
    assert.equal(isMentioned('123 @worker', 'worker'), true);

    // 6. Non-name runes immediately preceding @ (symbols that are NOT letters, digits, _, -)
    assert.equal(namedToken('!@worker', 'worker'), true);
    assert.equal(namedToken('?@worker', 'worker'), true);
    assert.equal(namedToken('/@worker', 'worker'), true);
    assert.equal(namedToken('+@worker', 'worker'), true);
    assert.equal(namedToken('=@worker', 'worker'), true);
    assert.equal(namedToken('&@worker', 'worker'), true);
    assert.equal(namedToken('~@worker', 'worker'), true);
    assert.equal(namedToken('*@worker', 'worker'), true);

    assert.equal(isMentioned('!@worker', 'worker'), true);
    assert.equal(isMentioned('?@worker', 'worker'), true);
    assert.equal(isMentioned('*@worker', 'worker'), true);
  });

  await suite.test('Adversarial Mentions 2: Group Prefix Matching (@worker -> worker-1, worker-2, worker-99)', async () => {
    // 1. Group mention @worker must wake numbered worker pool
    assert.equal(named('attention @worker: sync now', 'worker-1'), true);
    assert.equal(named('attention @worker: sync now', 'worker-2'), true);
    assert.equal(named('attention @worker: sync now', 'worker-99'), true);
    assert.equal(named('attention @worker: sync now', 'worker-1000'), true);

    assert.equal(isMentioned('attention @worker: sync now', 'worker-1'), true);
    assert.equal(isMentioned('attention @worker: sync now', 'worker-2'), true);
    assert.equal(isMentioned('attention @worker: sync now', 'worker-99'), true);

    // 2. Direct name matching: @worker matches exact member "worker"
    assert.equal(named('call @worker directly', 'worker'), true);
    assert.equal(isMentioned('call @worker directly', 'worker'), true);

    // 3. Negative cases: group prefix @worker must NOT match arbitrary or differently-named agents
    assert.equal(named('attention @worker: sync now', 'notworker-1'), false);
    assert.equal(named('attention @worker: sync now', 'super-worker-1'), false);
    assert.equal(named('attention @worker: sync now', 'coordinator'), false);
    assert.equal(named('attention @worker: sync now', 'narrator'), false);

    assert.equal(isMentioned('attention @worker: sync now', 'notworker-1'), false);
    assert.equal(isMentioned('attention @worker: sync now', 'super-worker-1'), false);

    // 4. Specific numbered mention @worker-1 must NOT wake worker-2 or worker-99
    assert.equal(named('dispatching task to @worker-1', 'worker-2'), false);
    assert.equal(named('dispatching task to @worker-1', 'worker-99'), false);
    assert.equal(named('dispatching task to @worker-1', 'worker'), false);

    assert.equal(isMentioned('dispatching task to @worker-1', 'worker-2'), false);
    assert.equal(isMentioned('dispatching task to @worker-1', 'worker-99'), false);

    // 5. Specific numbered mention @worker-2 must NOT wake worker-1
    assert.equal(named('task for @worker-2', 'worker-1'), false);
    assert.equal(isMentioned('task for @worker-2', 'worker-1'), false);

    // 6. Multi-digit numbered prefix matching (@agent -> agent-01, agent-123)
    assert.equal(named('ping @agent', 'agent-01'), true);
    assert.equal(named('ping @agent', 'agent-123'), true);
    assert.equal(named('ping @agent-01', 'agent-02'), false);
  });

  await suite.test('Adversarial Mentions 3: Broadcast @all Addressing', async () => {
    // 1. @all matches any member
    assert.equal(isMentioned('@all urgent announcement', 'worker-1'), true);
    assert.equal(isMentioned('@all urgent announcement', 'coordinator'), true);
    assert.equal(isMentioned('@all urgent announcement', 'custom-helper-agent-42'), true);

    // 2. Case insensitivity for @all
    assert.equal(isMentioned('@ALL caps announcement', 'worker-1'), true);
    assert.equal(isMentioned('@All mixed announcement', 'worker-1'), true);
    assert.equal(isMentioned('@aLl weird announcement', 'worker-1'), true);

    // 3. parseMentions records isAll = true
    const p1 = parseMentions('@all update state');
    assert.equal(p1.isAll, true);
    assert.ok(p1.names.includes('all'));
    assert.ok(p1.raw.includes('@all'));

    const p2 = parseMentions('shouting @ALL update state');
    assert.equal(p2.isAll, true);
    assert.ok(p2.names.includes('all'));

    // 4. False-positive protection on @all (e.g. email or boundary)
    assert.equal(isMentioned('send email to test@all.com please', 'worker-1'), false);
    assert.equal(isMentioned('foo@all', 'worker-1'), false);
    assert.equal(isMentioned('not_@all', 'worker-1'), false);
    assert.equal(isMentioned('(@all) in parentheses', 'worker-1'), true);
  });

  await suite.test('Adversarial Mentions 4: Channel Mentions (@#channel, @#main exclusion, archived channel)', async () => {
    // 1. Channel mentions extraction
    const chList1 = channelMentions('Discussion in @#backend and @#frontend');
    assert.ok(chList1.includes('backend'));
    assert.ok(chList1.includes('frontend'));

    // 2. @#main is extracted but ignored by isMentioned
    const chListMain = channelMentions('Notice in @#main channel');
    assert.ok(chListMain.includes('main'));
    // In isMentioned, @#main does NOT wake anyone
    assert.equal(isMentioned('Notice in @#main channel', 'worker-1', ['main']), false);
    assert.equal(isMentioned('Notice in @#main channel', 'coordinator', ['*']), false);

    // 3. Reserved channel mentions @#all and @#here are rejected from channelMentions
    const chListReserved = channelMentions('Testing @#all and @#here channel mentions');
    assert.equal(chListReserved.includes('all'), false, '@#all must not be a valid channel');
    assert.equal(chListReserved.includes('here'), false, '@#here must not be a valid channel');

    // 4. Subscriber vs Non-Subscriber Wakeup on @#dev
    const devSubscribers = ['worker-dev-1', 'worker-dev-2'];
    assert.equal(isMentioned('Briefing @#dev check repo', 'worker-dev-1', ['dev']), true);
    assert.equal(isMentioned('Briefing @#dev check repo', 'worker-other', ['other']), false);
    assert.equal(isMentioned('Briefing @#dev check repo', 'worker-main-only', ['main']), false);

    // Coordinator with wildcard channels ['*'] is woken by @#dev
    assert.equal(isMentioned('Briefing @#dev check repo', 'coordinator', ['*']), true);

    // 5. Archived channel protection: active checker returns false for archived channel
    const activeChecker = (c) => c !== 'archived-channel';
    assert.equal(
      isMentioned('Post to @#archived-channel', 'worker-dev-1', ['archived-channel'], activeChecker),
      false,
      'Archived channel mention must not wake subscribers'
    );
    assert.equal(
      isMentioned('Post to @#live-channel', 'worker-dev-1', ['live-channel'], activeChecker),
      true,
      'Live channel mention must wake subscribers'
    );

    // 6. Boundary checks on channel mentions (foo@#dev must NOT match)
    assert.equal(channelMentions('foo@#dev').includes('dev'), false);
    assert.equal(channelMentions('(@#dev)').includes('dev'), true);
    assert.equal(channelMentions('[@#dev]').includes('dev'), true);
  });

  await suite.test('Adversarial Mentions 5: Unicode Runes and Emoji Prefixes', async () => {
    // 1. Emoji immediately preceding @ symbol (🐝@worker, 🚀@worker, 🎉@worker)
    // Emojis are symbols (\p{So}), NOT NAME_RUNEs (not \p{L}, \p{Nd}, _, -).
    // Therefore, an emoji right before @ acts as a valid boundary!
    assert.equal(namedToken('🐝@worker', 'worker'), true, '🐝@worker must match @worker');
    assert.equal(namedToken('🚀@worker', 'worker'), true, '🚀@worker must match @worker');
    assert.equal(namedToken('🎉@worker', 'worker'), true, '🎉@worker must match @worker');
    assert.equal(isMentioned('🐝@worker buzz buzz', 'worker'), true);
    assert.equal(isMentioned('🚀@worker deploy now', 'worker'), true);

    // 2. Emoji with space before @ symbol
    assert.equal(namedToken('🔥 @worker', 'worker'), true);
    assert.equal(isMentioned('🔥 @worker high priority', 'worker'), true);

    // 3. Cyrillic text before @ symbol (space separated)
    assert.equal(namedToken('Привет @worker как дела', 'worker'), true);
    assert.equal(isMentioned('Привет @worker как дела', 'worker'), true);

    // 4. Accented Latin letters (café@worker vs café @worker)
    // 'é' is \p{L} (Unicode Letter).
    // Thus 'café@worker' has a name rune immediately before @, so it must NOT match!
    assert.equal(namedToken('café@worker', 'worker'), false, 'café@worker must not match');
    assert.equal(isMentioned('café@worker', 'worker'), false, 'café@worker must not trigger');
    // But 'café @worker' (with space) MUST match!
    assert.equal(namedToken('café @worker', 'worker'), true);
    assert.equal(isMentioned('café @worker', 'worker'), true);

    // 5. CJK ideographs (你好@worker vs 你好 @worker)
    // '好' is \p{L} (Unicode Letter).
    // Thus '你好@worker' has a letter immediately before @, so it must NOT match!
    assert.equal(namedToken('你好@worker', 'worker'), false, '你好@worker must not match');
    assert.equal(isMentioned('你好@worker', 'worker'), false, '你好@worker must not trigger');
    // But '你好 @worker' (with space) MUST match!
    assert.equal(namedToken('你好 @worker', 'worker'), true);
    assert.equal(isMentioned('你好 @worker', 'worker'), true);

    // 6. Unicode agent names (@élise, @разработчик)
    const uniParse = parseMentions('Greetings @élise and @разработчик!');
    assert.ok(uniParse.names.includes('élise'));
    assert.ok(uniParse.names.includes('разработчик'));

    assert.equal(namedToken('Greetings @élise!', 'élise'), true);
    assert.equal(namedToken('Greetings @разработчик!', 'разработчик'), true);
    assert.equal(isMentioned('Greetings @élise!', 'élise'), true);
    assert.equal(isMentioned('Greetings @разработчик!', 'разработчик'), true);

    // Group prefix matching with Unicode name: @élise should match élise-1
    assert.equal(named('Hello @élise please check', 'élise-1'), true);
    assert.equal(isMentioned('Hello @élise please check', 'élise-1'), true);
  });

  await suite.test('Adversarial Mentions 6: Mixed Mentions in a Single Post', async () => {
    const complexText = 'System alert: @alice, @bob and @#testing — broadcast to @all for immediate review!';

    const parsed = parseMentions(complexText);
    assert.ok(parsed.names.includes('alice'), 'Should parse @alice');
    assert.ok(parsed.names.includes('bob'), 'Should parse @bob');
    assert.ok(parsed.names.includes('all'), 'Should parse @all');
    assert.ok(parsed.channels.includes('testing'), 'Should parse @#testing');
    assert.equal(parsed.isAll, true, 'isAll must be true');

    // All targeted entities are awakened
    assert.equal(isMentioned(complexText, 'alice'), true);
    assert.equal(isMentioned(complexText, 'bob'), true);
    assert.equal(isMentioned(complexText, 'tester-1', ['testing']), true);
    assert.equal(isMentioned(complexText, 'unrelated-worker', ['other']), true, 'Woken because of @all');

    // Now test without @all
    const selectiveText = 'System alert: @alice, @bob and @#testing for review!';
    const selectiveParsed = parseMentions(selectiveText);
    assert.equal(selectiveParsed.isAll, false);
    assert.equal(isMentioned(selectiveText, 'alice'), true);
    assert.equal(isMentioned(selectiveText, 'bob'), true);
    assert.equal(isMentioned(selectiveText, 'tester-1', ['testing']), true);
    assert.equal(isMentioned(selectiveText, 'unrelated-worker', ['other']), false, 'Must NOT be woken without @all');
  });

});
