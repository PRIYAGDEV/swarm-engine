/**
 * Challenger Test Suite (Milestone 1, Iteration 2 - Round 2)
 * Empirical Adversarial Stress & Verification Harness
 * 
 * Target Subsystem: Shared Message Board Subsystem (Milestone 1)
 * Focus Areas:
 * 1. Strict Monotonic #seq Allocation under High Asynchronous Concurrency (50–100 calls)
 * 2. headSeq Reseeding from disk on Legacy State Migration (preventing collisions)
 * 3. Channel Slug Validation & Boundary Stress (preventing orphan/corrupt state channels)
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
  requireCliOrSkip,
} from './harness.mjs';

import {
  postMessage,
  readBoard,
  parseMentions,
  getBoardPath,
} from '../dist/board.js';

import {
  initState,
  readState,
  ensureState,
  getHighestSeqFromBoard,
  getDeduplicatedChannelList,
} from '../dist/state.js';

test('Milestone 1 Iteration 2 Challenger Stress Harness', async (suite) => {

  // =========================================================================
  // SECTION 1: STRICT MONOTONIC #seq ALLOCATION UNDER HIGH ASYNCHRONOUS CONCURRENCY
  // =========================================================================
  await suite.test('Focus 1: Strict Monotonic #seq Allocation under 50-100 Concurrent Calls', async (t) => {

    await t.test('1.1 Direct in-process concurrency: 50 concurrent postMessage calls yield strictly contiguous seq 1..50', async () => {
      const ws = await createTestWorkspace();
      try {
        const swarmDir = path.join(ws.dir, '.swarm');
        await initState('Concurrency Stress Swarm', 0, undefined, swarmDir);

        const count = 50;
        const promises = [];

        // Fire 50 asynchronous posts simultaneously
        for (let i = 0; i < count; i++) {
          promises.push(
            postMessage(swarmDir, {
              text: `Concurrent post payload #${i} timestamp=${Date.now()}`,
              from: `worker-${i % 5}`,
            })
          );
        }

        const results = await Promise.all(promises);

        // Assert all 50 resolved successfully
        assert.equal(results.length, count, 'All 50 posts must resolve');

        // Extract and sort sequence numbers
        const seqs = results.map((m) => m.seq).sort((a, b) => a - b);

        // Assert strictly monotonic contiguous sequence 1..50
        for (let i = 0; i < count; i++) {
          assert.equal(
            seqs[i],
            i + 1,
            `Expected sequence number at index ${i} to be ${i + 1}, but got ${seqs[i]}`
          );
        }

        // Assert zero duplicates (Set size must equal count)
        const uniqueSeqs = new Set(seqs);
        assert.equal(uniqueSeqs.size, count, 'Zero duplicate sequence numbers permitted');

        // Assert disk persistence in board.jsonl matches sequence
        const boardPath = path.join(swarmDir, 'board.jsonl');
        const content = await fs.readFile(boardPath, 'utf8');
        const lines = content.trim().split('\n').filter((l) => l.trim().length > 0);
        assert.equal(lines.length, count, 'board.jsonl must contain exactly 50 NDJSON lines');

        const diskSeqs = lines.map((l) => JSON.parse(l).seq);
        for (let i = 0; i < count; i++) {
          assert.equal(diskSeqs[i], i + 1, `Disk log sequence at line ${i} must match ${i + 1}`);
        }

        // Assert state.json headSeq is exactly 50
        const finalState = await readState(swarmDir);
        assert.equal(finalState.headSeq, count, `state.json headSeq must equal ${count}`);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('1.2 MCP stdio concurrency: 60 concurrent post_message tool requests yield strictly contiguous seq 1..60', async () => {
      const ws = await createTestWorkspace();
      let client;
      try {
        const swarmDir = path.join(ws.dir, '.swarm');
        await initState('MCP 60 Concurrency Swarm', 0, undefined, swarmDir);

        client = await createMcpClient(ws.dir);
        const count = 60;
        const promises = [];

        // Spawn 60 concurrent JSON-RPC requests across stdio
        for (let i = 0; i < count; i++) {
          promises.push(
            client.callTool('post_message', {
              text: `MCP Concurrent Request #${i} token=${Math.random()}`,
              channel: 'main',
            })
          );
        }

        const responses = await Promise.all(promises);
        assert.equal(responses.length, count, 'All 60 MCP requests must return');

        for (let i = 0; i < count; i++) {
          assert.equal(
            responses[i].isError,
            false,
            `MCP post_message #${i} failed: ${JSON.stringify(responses[i])}`
          );
          assert.ok(responses[i].data?.seq > 0, `Response #${i} must have positive seq`);
        }

        const seqs = responses.map((r) => r.data.seq).sort((a, b) => a - b);
        for (let i = 0; i < count; i++) {
          assert.equal(seqs[i], i + 1, `Sequence gap or duplicate at index ${i}: got ${seqs[i]}, expected ${i + 1}`);
        }

        assert.equal(new Set(seqs).size, count, 'Zero duplicates among 60 MCP calls');

        // Read board via MCP tool to confirm headSeq and message count
        const readRes = await client.callTool('read_board', { since: 0, limit: 200 });
        assert.equal(readRes.isError, false);
        assert.equal(readRes.data.messages.length, count);
        assert.equal(readRes.data.headSeq, count);

        const stateOnDisk = await ws.readState();
        assert.equal(stateOnDisk.headSeq, count);
      } finally {
        if (client) await client.close();
        await ws.cleanup();
      }
    });

    await t.test('1.3 Multi-channel high concurrency: 75 concurrent posts across 3 channels maintain global sequence monotonicity', async () => {
      const ws = await createTestWorkspace();
      try {
        const swarmDir = path.join(ws.dir, '.swarm');
        await initState('Multi-channel Concurrency', 0, undefined, swarmDir);

        // Pre-create two additional channels
        await postMessage(swarmDir, {
          text: 'Create backend channel',
          control: { op: 'create', channel: 'backend', topic: 'Backend Dev' },
        });
        await postMessage(swarmDir, {
          text: 'Create frontend channel',
          control: { op: 'create', channel: 'frontend', topic: 'Frontend UI' },
        });

        // Current headSeq is 2 (from the 2 channel control messages)
        const baseSeq = 2;
        const perChannel = 25;
        const totalPosts = perChannel * 3; // 75 posts
        const channels = ['main', 'backend', 'frontend'];
        const promises = [];

        for (let i = 0; i < totalPosts; i++) {
          const ch = channels[i % 3];
          promises.push(
            postMessage(swarmDir, {
              text: `Multi-channel post ${i} on ${ch}`,
              channel: ch,
              from: `agent-${ch}`,
            })
          );
        }

        const results = await Promise.all(promises);
        assert.equal(results.length, totalPosts);

        // Combined sequence numbers must be contiguous from baseSeq + 1 to baseSeq + totalPosts
        const seqs = results.map((m) => m.seq).sort((a, b) => a - b);
        for (let i = 0; i < totalPosts; i++) {
          const expected = baseSeq + i + 1;
          assert.equal(seqs[i], expected, `Global monotonic seq mismatch at index ${i}: got ${seqs[i]}, expected ${expected}`);
        }

        // Verify channel filtering isolates channel messages while preserving monotonicity
        const backendBoard = await readBoard(swarmDir, { channel: 'backend', limit: 100 });
        assert.equal(backendBoard.messages.length, perChannel);
        for (const msg of backendBoard.messages) {
          assert.equal(msg.channel, 'backend');
        }

        const frontendBoard = await readBoard(swarmDir, { channel: 'frontend', limit: 100 });
        assert.equal(frontendBoard.messages.length, perChannel);
        for (const msg of frontendBoard.messages) {
          assert.equal(msg.channel, 'frontend');
        }

        const finalState = await readState(swarmDir);
        assert.equal(finalState.headSeq, baseSeq + totalPosts);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('1.4 Interleaved concurrent Reads and Writes: 50 concurrent posts while 50 concurrent readBoard execute simultaneously', async () => {
      const ws = await createTestWorkspace();
      try {
        const swarmDir = path.join(ws.dir, '.swarm');
        await initState('Interleaved Stress Swarm', 0, undefined, swarmDir);

        const writeCount = 50;
        const readCount = 50;

        const writePromises = [];
        const readPromises = [];

        // Launch mixed interleaved writers and readers
        for (let i = 0; i < writeCount; i++) {
          writePromises.push(
            postMessage(swarmDir, {
              text: `Interleaved writer payload #${i}`,
              from: 'writer',
            })
          );
          if (i < readCount) {
            readPromises.push(
              readBoard(swarmDir, { since: 0, limit: 100 })
            );
          }
        }

        const [writeResults, readResults] = await Promise.all([
          Promise.all(writePromises),
          Promise.all(readPromises),
        ]);

        // Writers must all succeed with strictly contiguous 1..50
        assert.equal(writeResults.length, writeCount);
        const seqs = writeResults.map((m) => m.seq).sort((a, b) => a - b);
        for (let i = 0; i < writeCount; i++) {
          assert.equal(seqs[i], i + 1);
        }

        // Readers must all return without throwing errors, and each read valid headSeq
        assert.equal(readResults.length, readCount);
        for (const r of readResults) {
          assert.ok(Array.isArray(r.messages));
          assert.ok(r.headSeq >= 0 && r.headSeq <= writeCount);
        }

        const finalRead = await readBoard(swarmDir, { since: 0, limit: 100 });
        assert.equal(finalRead.messages.length, writeCount);
        assert.equal(finalRead.headSeq, writeCount);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('1.5 High-concurrency 75 direct in-process posts: strictly contiguous seq 1..75 without timeout', async () => {
      const ws = await createTestWorkspace();
      try {
        const swarmDir = path.join(ws.dir, '.swarm');
        await initState('Direct 75 Concurrency Swarm', 0, undefined, swarmDir);

        const count = 75;
        const promises = [];
        for (let i = 0; i < count; i++) {
          promises.push(
            postMessage(swarmDir, {
              text: `Direct burst post #${i}`,
              from: 'burst-worker',
            })
          );
        }

        const results = await Promise.all(promises);
        assert.equal(results.length, count);

        const seqs = results.map((m) => m.seq).sort((a, b) => a - b);
        for (let i = 0; i < count; i++) {
          assert.equal(seqs[i], i + 1, `Direct post at index ${i} must have seq ${i + 1}`);
        }
        assert.equal(new Set(seqs).size, count, 'Zero duplicate sequence numbers among 75 direct posts');

        const finalState = await readState(swarmDir);
        assert.equal(finalState.headSeq, count);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('1.6 100 concurrent posts stress boundary: all committed posts maintain strict monotonic continuity with zero duplicates or gaps', async () => {
      const ws = await createTestWorkspace();
      try {
        const swarmDir = path.join(ws.dir, '.swarm');
        await initState('Direct 100 Stress Boundary Swarm', 0, undefined, swarmDir);

        const count = 100;
        const promises = [];
        for (let i = 0; i < count; i++) {
          promises.push(
            postMessage(swarmDir, {
              text: `Stress 100 burst post #${i}`,
              from: 'stress-worker',
            })
          );
        }

        const outcomes = await Promise.allSettled(promises);
        const fulfilled = outcomes.filter((o) => o.status === 'fulfilled').map((o) => o.value);
        const rejected = outcomes.filter((o) => o.status === 'rejected').map((o) => o.reason);

        // At least 75-100 posts must fulfill within the 10000ms lock window
        assert.ok(fulfilled.length >= 75, `Expected at least 75 fulfilled posts, got ${fulfilled.length}`);

        // Any rejected posts must be due to the 10000ms lock timeout, not corruption
        for (const rej of rejected) {
          assert.ok(
            rej.message.includes('Failed to acquire state lock within'),
            `Unexpected error reason: ${rej.message}`
          );
        }

        // The committed sequence numbers must be strictly contiguous from 1 to fulfilled.length
        const committedSeqs = fulfilled.map((m) => m.seq).sort((a, b) => a - b);
        for (let i = 0; i < fulfilled.length; i++) {
          assert.equal(
            committedSeqs[i],
            i + 1,
            `Committed seq mismatch at index ${i}: got ${committedSeqs[i]}, expected ${i + 1}`
          );
        }
        assert.equal(
          new Set(committedSeqs).size,
          fulfilled.length,
          'Zero duplicate sequence numbers among committed posts'
        );

        // Confirm board.jsonl on disk matches committed count exactly
        const board = await readBoard(swarmDir, { since: 0, limit: 200 });
        assert.equal(board.messages.length, fulfilled.length);
        assert.equal(board.headSeq, fulfilled.length);
      } finally {
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // SECTION 2: headSeq RESEEDING FROM DISK ON LEGACY STATE MIGRATION
  // =========================================================================
  await suite.test('Focus 2: headSeq Reseeding on Legacy State Migration', async (t) => {

    await t.test('2.1 Legacy state without headSeq property: reseeds from board.jsonl and prevents seq collisions', async () => {
      const ws = await createTestWorkspace();
      try {
        const swarmDir = path.join(ws.dir, '.swarm');
        await fs.mkdir(swarmDir, { recursive: true });

        // Simulate legacy pre-existing board.jsonl containing 5 messages (seq 1..5)
        const legacyMessages = [];
        for (let i = 1; i <= 5; i++) {
          legacyMessages.push(
            JSON.stringify({
              seq: i,
              from: 'legacy-agent',
              agent: 'legacy-agent',
              channel: 'main',
              text: `Legacy historical message #${i}`,
              timestamp: Date.now() - 10000 + i * 1000,
              time: new Date().toISOString(),
            })
          );
        }
        await fs.writeFile(path.join(swarmDir, 'board.jsonl'), legacyMessages.join('\n') + '\n', 'utf8');

        // Simulate legacy state.json without headSeq property
        const legacyState = {
          mission: 'Legacy Migration Test Swarm',
          maxConcurrency: 0,
          parallel: true,
          strictDependencies: false,
          agents: {},
          blackboard: {},
          lockedFiles: {},
          channels: {
            main: {
              name: 'main',
              topic: 'Default',
              createdBy: 'system',
              createdAt: Date.now() - 20000,
              archived: false,
              subscribers: ['*'],
            },
          },
        };
        await fs.writeFile(path.join(swarmDir, 'state.json'), JSON.stringify(legacyState, null, 2), 'utf8');

        // Test getHighestSeqFromBoard directly
        const maxOnDisk = await getHighestSeqFromBoard(swarmDir);
        assert.equal(maxOnDisk, 5, 'getHighestSeqFromBoard must detect highest seq 5');

        // Test readState migration reseeding
        const reseededState = await readState(swarmDir);
        assert.equal(reseededState.headSeq, 5, 'readState must reseed state.headSeq to 5');

        // Post 5 new messages sequentially
        const newResults = [];
        for (let i = 0; i < 5; i++) {
          const res = await postMessage(swarmDir, {
            text: `Post after migration #${i}`,
            from: 'new-agent',
          });
          newResults.push(res);
        }

        // Assert new sequence numbers are 6..10
        const newSeqs = newResults.map((m) => m.seq);
        assert.deepEqual(newSeqs, [6, 7, 8, 9, 10], 'New posts must allocate seq 6..10 without colliding with 1..5');

        // Read entire board to verify total 10 contiguous messages
        const fullBoard = await readBoard(swarmDir, { since: 0, limit: 50 });
        assert.equal(fullBoard.messages.length, 10, 'Full board must contain 10 messages');
        assert.equal(fullBoard.headSeq, 10, 'Board headSeq must be 10');
        const allSeqs = fullBoard.messages.map((m) => m.seq);
        assert.deepEqual(allSeqs, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('2.2 Non-contiguous / sparse sequence numbers in legacy board: reseeds to Math.max', async () => {
      const ws = await createTestWorkspace();
      try {
        const swarmDir = path.join(ws.dir, '.swarm');
        await fs.mkdir(swarmDir, { recursive: true });

        // Non-contiguous sequence with gaps: 1, 2, 42
        const sparseLines = [
          JSON.stringify({ seq: 1, text: 'First', channel: 'main', from: 'a', timestamp: Date.now() }),
          JSON.stringify({ seq: 2, text: 'Second', channel: 'main', from: 'a', timestamp: Date.now() }),
          JSON.stringify({ seq: 42, text: 'Jump to 42', channel: 'main', from: 'a', timestamp: Date.now() }),
        ];
        await fs.writeFile(path.join(swarmDir, 'board.jsonl'), sparseLines.join('\n') + '\n', 'utf8');

        // Legacy state with headSeq: 0
        const legacyState = {
          mission: 'Sparse Sequence Test',
          headSeq: 0,
          channels: {},
        };
        await fs.writeFile(path.join(swarmDir, 'state.json'), JSON.stringify(legacyState, null, 2), 'utf8');

        const state = await readState(swarmDir);
        assert.equal(state.headSeq, 42, 'headSeq must reseed to highest detected seq (42)');

        // Next post must allocate 43
        const nextMsg = await postMessage(swarmDir, {
          text: 'Next message after 42',
          from: 'b',
        });
        assert.equal(nextMsg.seq, 43, 'Next post must allocate seq: 43');
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('2.3 Torn truncated JSON line at EOF during reseeding: skips torn line and protects against fusion', async () => {
      const ws = await createTestWorkspace();
      try {
        const swarmDir = path.join(ws.dir, '.swarm');
        await fs.mkdir(swarmDir, { recursive: true });

        // 3 valid lines (seq 1..3) + 1 truncated un-terminated fragment without trailing newline
        const validLines = [
          JSON.stringify({ seq: 1, text: 'msg 1', channel: 'main', from: 'a', timestamp: Date.now() }),
          JSON.stringify({ seq: 2, text: 'msg 2', channel: 'main', from: 'a', timestamp: Date.now() }),
          JSON.stringify({ seq: 3, text: 'msg 3', channel: 'main', from: 'a', timestamp: Date.now() }),
        ];
        const tornFragment = '{"seq": 4, "text": "torn fragment unclosed';
        const fileContent = validLines.join('\n') + '\n' + tornFragment; // NO trailing newline!

        await fs.writeFile(path.join(swarmDir, 'board.jsonl'), fileContent, 'utf8');

        // Reseed should safely skip the torn fragment and find maxSeq = 3
        const maxSeq = await getHighestSeqFromBoard(swarmDir);
        assert.equal(maxSeq, 3, 'Reseeding must skip torn line fragment and report maxSeq: 3');

        // Post new message: torn line guard must prepend newline to prevent fusion
        const post = await postMessage(swarmDir, {
          text: 'New clean post after torn fragment',
          from: 'resilient-agent',
        });

        assert.equal(post.seq, 4, 'Post must receive seq: 4');

        // Read raw file content to confirm newline separated the torn fragment from the new JSON
        const rawContent = await fs.readFile(path.join(swarmDir, 'board.jsonl'), 'utf8');
        assert.ok(
          rawContent.includes('torn fragment unclosed\n{"seq":4'),
          'Torn fragment must be isolated from new post by prepended newline'
        );

        // readBoard must parse cleanly without crash
        const board = await readBoard(swarmDir, { since: 0, limit: 10 });
        assert.equal(board.messages.length, 4, 'Valid messages 1, 2, 3, 4 parsed cleanly');
        assert.equal(board.headSeq, 4);
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('2.4 High-concurrency burst immediately following legacy migration: 50 concurrent posts start at seq 21', async () => {
      const ws = await createTestWorkspace();
      try {
        const swarmDir = path.join(ws.dir, '.swarm');
        await fs.mkdir(swarmDir, { recursive: true });

        // 20 pre-existing historical messages
        const historical = [];
        for (let i = 1; i <= 20; i++) {
          historical.push(
            JSON.stringify({
              seq: i,
              text: `Historical #${i}`,
              channel: 'main',
              from: 'hist',
              timestamp: Date.now() - 50000 + i * 1000,
            })
          );
        }
        await fs.writeFile(path.join(swarmDir, 'board.jsonl'), historical.join('\n') + '\n', 'utf8');

        // Legacy state.json without headSeq
        await fs.writeFile(
          path.join(swarmDir, 'state.json'),
          JSON.stringify({ mission: 'Burst Test', channels: {} }, null, 2),
          'utf8'
        );

        // Fire 50 concurrent posts simultaneously immediately
        const burstCount = 50;
        const promises = [];
        for (let i = 0; i < burstCount; i++) {
          promises.push(
            postMessage(swarmDir, {
              text: `Burst message #${i}`,
              from: `burst-agent-${i}`,
            })
          );
        }

        const results = await Promise.all(promises);
        assert.equal(results.length, burstCount);

        const seqs = results.map((m) => m.seq).sort((a, b) => a - b);
        for (let i = 0; i < burstCount; i++) {
          const expected = 20 + i + 1;
          assert.equal(seqs[i], expected, `Burst seq mismatch at index ${i}: got ${seqs[i]}, expected ${expected}`);
        }

        // Verify zero duplicates and zero overlap with 1..20
        assert.equal(new Set(seqs).size, burstCount);
        assert.ok(seqs[0] > 20, 'No collisions with pre-existing 1..20');

        const finalState = await readState(swarmDir);
        assert.equal(finalState.headSeq, 70);
      } finally {
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // SECTION 3: CHANNEL SLUG VALIDATION & BOUNDARY STRESS
  // =========================================================================
  await suite.test('Focus 3: Channel Slug Validation & Boundary Stress (Zero Orphan State Channels)', async (t) => {

    // Strictly invalid slugs that violate CHANNEL_NAME_REGEX = /^[a-z][a-z0-9-]{0,23}$/
    // and RESERVED_CHANNELS (main, all, here), regardless of lowercasing or trimming:
    const STRICTLY_INVALID_SLUGS = [
      // Internal spaces (cannot be trimmed away)
      'dev ops',
      'team alpha',
      'test channel 1',
      // Special symbols and punctuation
      'dev_ops', // underscore invalid (regex allows only [a-z0-9-])
      'dev.ops',
      'dev@ops',
      '#dev',
      'dev/prod',
      'dev!ops',
      'dev$team',
      // Non-lowercase-letter start
      '123channel',
      '-dev',
      '_dev',
      '0alpha',
      // Length violations (> 24 chars: regex allows max 24: ^[a-z][a-z0-9-]{0,23}$)
      'a'.repeat(25),
      'abcdefghijklmnopqrstuvwxyz', // 26 chars
      // Reserved channel names (cannot be created or targeted as normal custom channels)
      'all',
      'here',
    ];

    await t.test('3.1 Direct postMessage strictly rejects invalid channel slugs and creates NO orphan channels in state.json', async () => {
      const ws = await createTestWorkspace();
      try {
        const swarmDir = path.join(ws.dir, '.swarm');
        await initState('Channel Validation Swarm', 0, undefined, swarmDir);

        for (const badSlug of STRICTLY_INVALID_SLUGS) {
          await assert.rejects(
            async () => {
              await postMessage(swarmDir, {
                text: `Attempting post to invalid channel '${badSlug}'`,
                channel: badSlug,
              });
            },
            (err) => {
              assert.ok(err instanceof Error, `Must throw Error for slug '${badSlug}'`);
              assert.ok(
                err.message.includes('Invalid channel name') ||
                err.message.includes('not be reserved'),
                `Error message for '${badSlug}' should indicate invalid channel name: ${err.message}`
              );
              return true;
            },
            `postMessage must reject invalid slug '${badSlug}'`
          );
        }

        // Crucial empirical check: verify state.json has NO orphan or illegal channels
        const state = await readState(swarmDir);
        const channelKeys = Object.keys(state.channels || {});
        assert.deepEqual(
          channelKeys,
          ['main'],
          `state.channels must contain strictly ['main'], but found: ${JSON.stringify(channelKeys)}`
        );
      } finally {
        await ws.cleanup();
      }
    });

    await t.test('3.2 MCP post_message tool strictly rejects invalid slugs without modifying state.channels', async () => {
      const ws = await createTestWorkspace();
      let client;
      try {
        const swarmDir = path.join(ws.dir, '.swarm');
        await initState('MCP Channel Validation Swarm', 0, undefined, swarmDir);
        client = await createMcpClient(ws.dir);

        for (const badSlug of STRICTLY_INVALID_SLUGS) {
          const res = await client.callTool('post_message', {
            text: `Post via MCP to '${badSlug}'`,
            channel: badSlug,
          });

          assert.equal(
            res.isError,
            true,
            `MCP post_message should report isError: true for invalid slug '${badSlug}', got: ${JSON.stringify(res)}`
          );

          const errorText = res.content?.[0]?.text || '';
          assert.ok(
            errorText.includes('Invalid channel name') || errorText.includes('reserved'),
            `Error text should mention invalid channel name for '${badSlug}': ${errorText}`
          );
        }

        // Verify state.channels remains pristine
        const state = await ws.readState();
        assert.deepEqual(
          Object.keys(state.channels || {}),
          ['main'],
          'No orphan channels should exist in state.json after MCP rejection'
        );
      } finally {
        if (client) await client.close();
        await ws.cleanup();
      }
    });

    await t.test('3.3 MCP swarm tool (action: channel, op: create) strictly rejects invalid slugs, uppercase, and reserved names', async () => {
      const ws = await createTestWorkspace();
      let client;
      try {
        const swarmDir = path.join(ws.dir, '.swarm');
        await initState('MCP Swarm Create Validation', 0, undefined, swarmDir);
        client = await createMcpClient(ws.dir);

        // Include uppercase and reserved 'main' for swarm op: create
        const createInvalidSlugs = ['main', 'DevOps', 'Backend', ...STRICTLY_INVALID_SLUGS];

        for (const badSlug of createInvalidSlugs) {
          const res = await client.callTool('swarm', {
            action: 'channel',
            op: 'create',
            channel: badSlug,
            topic: `Topic for ${badSlug}`,
          });

          assert.equal(
            res.isError,
            true,
            `swarm channel create should return isError: true for '${badSlug}', got: ${JSON.stringify(res)}`
          );

          const errorText = res.content?.[0]?.text || '';
          assert.ok(
            errorText.includes('Invalid channel name') ||
            errorText.includes('Cannot create reserved channel') ||
            errorText.includes('already exists'),
            `Expected invalid or reserved error for '${badSlug}', got: ${errorText}`
          );
        }

        // Verify state.channels only contains 'main'
        const state = await ws.readState();
        assert.deepEqual(Object.keys(state.channels || {}), ['main']);
      } finally {
        if (client) await client.close();
        await ws.cleanup();
      }
    });

    await t.test('3.4 Exact Boundary Verification: valid slugs at boundary limits are accepted and operate correctly', async () => {
      const ws = await createTestWorkspace();
      let client;
      try {
        const swarmDir = path.join(ws.dir, '.swarm');
        await initState('Boundary Slug Swarm', 0, undefined, swarmDir);
        client = await createMcpClient(ws.dir);

        const VALID_BOUNDARY_SLUGS = [
          'a',                        // Exactly 1 char minimum
          'z',                        // Single letter 'z'
          'a-b',                      // Hyphen in middle
          'a-1-b',                    // Hyphens and digits
          'a123',                     // Digits after start
          'a' + 'b'.repeat(23),       // Exactly 24 chars maximum
        ];

        for (const validSlug of VALID_BOUNDARY_SLUGS) {
          // 1. Create channel
          const createRes = await client.callTool('swarm', {
            action: 'channel',
            op: 'create',
            channel: validSlug,
            topic: `Boundary topic for ${validSlug}`,
          });
          assert.equal(createRes.isError, false, `Failed to create valid boundary slug '${validSlug}': ${JSON.stringify(createRes)}`);

          // 2. Post to channel
          const postRes = await client.callTool('post_message', {
            text: `Hello from boundary channel #${validSlug}`,
            channel: validSlug,
          });
          assert.equal(postRes.isError, false, `Failed to post to valid boundary slug '${validSlug}': ${JSON.stringify(postRes)}`);
        }

        // Verify channel list via swarm op: "list"
        const listRes = await client.callTool('swarm', {
          action: 'channel',
          op: 'list',
        });
        assert.equal(listRes.isError, false);
        const listedNames = listRes.data.channels.map((c) => c.name);

        assert.equal(listedNames[0], 'main', "First channel must be 'main'");
        for (const validSlug of VALID_BOUNDARY_SLUGS) {
          assert.ok(listedNames.includes(validSlug), `Channel list must include '${validSlug}'`);
        }

        // Deduplication check: every channel in list must be unique
        assert.equal(new Set(listedNames).size, listedNames.length, 'Channel list must be strictly deduplicated');
      } finally {
        if (client) await client.close();
        await ws.cleanup();
      }
    });

    await t.test('3.5 Channel Archive & Read-Only Enforcement: archived channel rejects further posts', async () => {
      const ws = await createTestWorkspace();
      let client;
      try {
        const swarmDir = path.join(ws.dir, '.swarm');
        await initState('Archive Enforcement Swarm', 0, undefined, swarmDir);
        client = await createMcpClient(ws.dir);

        // 1. Create a valid channel
        const createRes = await client.callTool('swarm', {
          action: 'channel',
          op: 'create',
          channel: 'alpha-release',
          topic: 'Alpha release discussions',
        });
        assert.equal(createRes.isError, false);

        // 2. Post while active -> succeeds
        const postRes1 = await client.callTool('post_message', {
          text: 'Message before archiving',
          channel: 'alpha-release',
        });
        assert.equal(postRes1.isError, false);

        // 3. Archive channel
        const archiveRes = await client.callTool('swarm', {
          action: 'channel',
          op: 'archive',
          channel: 'alpha-release',
        });
        assert.equal(archiveRes.isError, false);

        // 4. Post after archiving -> must be rejected
        const postRes2 = await client.callTool('post_message', {
          text: 'Message after archiving',
          channel: 'alpha-release',
        });
        assert.equal(postRes2.isError, true, 'Posting to archived channel must be rejected with isError: true');
        assert.ok(
          postRes2.content?.[0]?.text.includes('archived and read-only'),
          `Expected archived error message, got: ${postRes2.content?.[0]?.text}`
        );

        // 5. Direct in-process postMessage to archived channel must also reject
        await assert.rejects(
          async () => {
            await postMessage(swarmDir, {
              text: 'Direct post to archived channel',
              channel: 'alpha-release',
            });
          },
          /archived and read-only/
        );
      } finally {
        if (client) await client.close();
        await ws.cleanup();
      }
    });

    await t.test('3.6 Casing and whitespace normalization characterization: postMessage auto-normalizes casing and whitespace', async () => {
      const ws = await createTestWorkspace();
      try {
        const swarmDir = path.join(ws.dir, '.swarm');
        await initState('Normalization Test Swarm', 0, undefined, swarmDir);

        // Case 1: Uppercase in postMessage is auto-lowercased to 'devops'
        const msg1 = await postMessage(swarmDir, {
          text: 'Posting to DevOps with uppercase',
          channel: 'DevOps',
        });
        assert.equal(msg1.channel, 'devops', 'postMessage normalizes DevOps to devops');

        // Case 2: Leading/trailing whitespace is auto-trimmed
        const msg2 = await postMessage(swarmDir, {
          text: 'Posting to trimmed channel',
          channel: '  ops  ',
        });
        assert.equal(msg2.channel, 'ops', 'postMessage normalizes whitespace to ops');

        // Verify state.channels contains only the clean normalized names
        const state = await readState(swarmDir);
        const names = Object.keys(state.channels || {});
        assert.ok(names.includes('devops'));
        assert.ok(names.includes('ops'));
        assert.ok(!names.includes('DevOps'));
        assert.ok(!names.includes('  ops  '));
      } finally {
        await ws.cleanup();
      }
    });
  });

});
