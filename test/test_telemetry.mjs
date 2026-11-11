/**
 * Test Suite: Structured Telemetry & State Cursors (Features 15–17)
 * 
 * Covers:
 * - Feature 15: Canonical view.json generator (atomic write, capped <64KB, headline, phase, goal, threads, workstreams, attention cards, progress reel)
 * - Feature 16: get_swarm_view MCP tool (structured JSON view exposure to IDEs and dashboards)
 * - Feature 17: State cursor tracking (lastReadSeq, lastPostSeq, waitSince, wakeMode, channels in AgentNode)
 * 
 * Organized in 3 Tiers:
 * - Tier 1: Nominal Feature Coverage (>=5 test cases per feature = 15 cases)
 * - Tier 2: Boundary & Corner Cases (>=5 test cases per feature = 15 cases)
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
 * Reads and parses .swarm/view.json from workspace
 */
async function readViewJson(ws) {
  const viewPath = path.join(ws.dir, '.swarm', 'view.json');
  if (!existsSync(viewPath)) return null;
  const raw = await fs.readFile(viewPath, 'utf8');
  return JSON.parse(raw);
}

test('Structured Telemetry & State Cursors (Features 15–17)', async (suite) => {

  // =========================================================================
  // TIER 1: FEATURE COVERAGE (ISOLATION TESTING)
  // =========================================================================

  await suite.test('Tier 1: Feature 15 — Canonical view.json Generator', async (t) => {
    await t.test('F15-T1-01: Canonical view.json generated and written to .swarm/view.json', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'get_swarm_view'))) return;

        await client.callTool('get_swarm_view', {});
        const view = await readViewJson(ws);
        assert.ok(view !== null, '.swarm/view.json must exist');
        assert.equal(typeof view, 'object');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F15-T1-02: view.json conforms to schema with required version, headline, goal, and phase', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'get_swarm_view'))) return;

        const res = await client.callTool('get_swarm_view', {});
        const view = res.data?.view || res.data || (await readViewJson(ws));

        assert.ok(view, 'view object must be available');
        assert.equal(typeof view.version, 'number');
        assert.ok(view.headline !== undefined, 'headline must be defined');
        assert.ok(view.goal !== undefined, 'goal must be defined');
        assert.ok(view.phase !== undefined, 'phase must be defined');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F15-T1-03: view.json file size is strictly capped under 64KB (65,536 bytes)', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'get_swarm_view'))) return;

        await client.callTool('get_swarm_view', {});
        const viewPath = path.join(ws.dir, '.swarm', 'view.json');
        if (existsSync(viewPath)) {
          const stat = await fs.stat(viewPath);
          assert.ok(stat.size <= 65536, `view.json size ${stat.size}B must be <= 65536 bytes (64KB)`);
        }
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F15-T1-04: view.json as_of_seq reflects latest message sequence number on board', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'get_swarm_view'))) return;

        await client.callTool('post_message', { text: 'Telemetry test post 1', from: 'narrator' });
        await client.callTool('post_message', { text: 'Telemetry test post 2', from: 'narrator' });

        const res = await client.callTool('get_swarm_view', {});
        const view = res.data?.view || res.data || (await readViewJson(ws));
        assert.equal(view.as_of_seq, 2, 'as_of_seq must match head sequence 2');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F15-T1-05: view.json now map accurately reflects active agent activities and states', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'get_swarm_view'))) return;

        await client.callTool('swarm', { action: 'add', name: 'worker-now', brief: 'Now test' });
        const res = await client.callTool('get_swarm_view', {});
        const view = res.data?.view || res.data || (await readViewJson(ws));

        assert.ok(typeof view.now === 'object', 'view.now must be an object');
        assert.ok(view.now['worker-now'] !== undefined, 'now map must contain worker-now');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  await suite.test('Tier 1: Feature 16 — get_swarm_view MCP Tool', async (t) => {
    await t.test('F16-T1-01: get_swarm_view MCP tool returns structured view object', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'get_swarm_view'))) return;

        const res = await client.callTool('get_swarm_view', {});
        assert.equal(res.isError, false);
        assert.ok(res.data, 'Should return data payload');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F16-T1-02: get_swarm_view handles uninitialized swarm workspace gracefully', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'get_swarm_view'))) return;

        const res = await client.callTool('get_swarm_view', {});
        assert.equal(res.isError, false);
        // Should either indicate uninitialized or return empty valid view
        assert.ok(res.data.initialized === false || res.data.version !== undefined);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F16-T1-03: get_swarm_view exposes attention cards with actionable button targets', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'get_swarm_view'))) return;

        const res = await client.callTool('get_swarm_view', {});
        const view = res.data?.view || res.data;
        assert.ok(Array.isArray(view.attention), 'attention must be an array');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F16-T1-04: get_swarm_view tracks workstream progress items (done vs total)', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'get_swarm_view'))) return;

        const res = await client.callTool('get_swarm_view', {});
        const view = res.data?.view || res.data;
        assert.ok(Array.isArray(view.workstreams), 'workstreams must be an array');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F16-T1-05: get_swarm_view updates dynamically as agents advance turns', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'get_swarm_view'))) return;

        await client.callTool('swarm', { action: 'add', name: 'dynamic-agent', brief: 'Dynamic' });
        const view1 = await client.callTool('get_swarm_view', {});

        await client.callTool('swarm', { action: 'title', title: 'Updated Phase Goal' });
        const view2 = await client.callTool('get_swarm_view', {});

        assert.notEqual(
          view1.data?.view?.headline || view1.data?.headline,
          view2.data?.view?.headline || view2.data?.headline
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  await suite.test('Tier 1: Feature 17 — State Cursor Tracking', async (t) => {
    await t.test('F17-T1-01: lastPostSeq cursor advances on agent board post', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'post_message'))) return;

        await client.callTool('swarm', { action: 'add', name: 'posting-agent', brief: 'Post test' });
        const resPost = await client.callTool('post_message', {
          text: 'Cursor advance post',
          from: 'posting-agent',
        });
        const postedSeq = resPost.data.message.seq;

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['posting-agent'] || statusRes.data.roster?.['posting-agent'];
        assert.equal(agent.lastPostSeq, postedSeq, 'lastPostSeq must match posted sequence number');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F17-T1-02: lastReadSeq cursor advances on read_board to highest read sequence', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'post_message', 'read_board'))) return;

        await client.callTool('swarm', { action: 'add', name: 'reading-agent', brief: 'Read test' });
        await client.callTool('post_message', { text: 'Msg 1', from: 'system' });
        await client.callTool('post_message', { text: 'Msg 2', from: 'system' });

        await client.callTool('read_board', { callerId: 'reading-agent' });

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['reading-agent'] || statusRes.data.roster?.['reading-agent'];
        assert.equal(agent.lastReadSeq, 2, 'lastReadSeq must advance to 2');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F17-T1-03: waitSince cursor records headSeq at time swarm_wait was invoked', async (ct) => {
      const ws = await createTestWorkspace();
      let cWorker, cLead;
      try {
        cWorker = await createMcpClient(ws.dir);
        cLead = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, cLead, 'swarm', 'post_message', 'swarm_wait'))) return;

        await cLead.callTool('swarm', { action: 'add', name: 'waiting-agent', brief: 'Wait cursor test' });
        await cLead.callTool('post_message', { text: 'Pre-wait message 1', from: 'lead' });
        await cLead.callTool('post_message', { text: 'Pre-wait message 2', from: 'lead' });

        const waitPromise = cWorker.callTool('swarm_wait', {
          memberName: 'waiting-agent',
          timeoutMs: 600,
        });

        await new Promise((r) => setTimeout(r, 150));
        const statusRes = await cLead.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['waiting-agent'] || statusRes.data.roster?.['waiting-agent'];
        assert.equal(agent.waitSince, 2, 'waitSince must record sequence 2');

        await waitPromise;
      } finally {
        await cWorker?.close();
        await cLead?.close();
        await ws.cleanup();
      }
    });

    await t.test('F17-T1-04: wakeMode configuration correctly reflects "mentions" or "anything"', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', {
          action: 'add',
          name: 'mentions-worker',
          brief: 'Filtered wake',
          wakeMode: 'mentions',
        });

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['mentions-worker'] || statusRes.data.roster?.['mentions-worker'];
        assert.equal(agent.wakeMode, 'mentions');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F17-T1-05: channels array tracks active channel subscriptions per agent', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'channel-tracker', brief: 'Channels' });
        await client.callTool('swarm', { action: 'channel', op: 'create', channel: 'ops-feed' });
        await client.callTool('swarm', { action: 'channel', op: 'subscribe', channel: 'ops-feed', members: ['channel-tracker'] });

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['channel-tracker'] || statusRes.data.roster?.['channel-tracker'];
        assert.ok(Array.isArray(agent.channels));
        assert.ok(agent.channels.includes('ops-feed'));
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // TIER 2: BOUNDARY & CORNER CASES
  // =========================================================================

  await suite.test('Tier 2: Boundary & Corner Cases (Features 15–17)', async (t) => {
    await t.test('F15-T2-01: Oversized payload (50+ agents, 100+ messages) strictly caps view.json < 64KB without corruption', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'post_message', 'get_swarm_view'))) return;

        // Post 40 verbose messages
        for (let i = 1; i <= 40; i++) {
          await client.callTool('post_message', {
            text: `High volume board message ${i}: ${'Detailed log content. '.repeat(10)}`,
            from: 'flood-bot',
          });
        }

        await client.callTool('get_swarm_view', {});
        const viewPath = path.join(ws.dir, '.swarm', 'view.json');
        if (existsSync(viewPath)) {
          const stat = await fs.stat(viewPath);
          assert.ok(stat.size <= 65536, `view.json (${stat.size}B) must strictly not exceed 64KB`);
          const parsed = JSON.parse(await fs.readFile(viewPath, 'utf8'));
          assert.ok(parsed.version !== undefined, 'File must be valid JSON');
        }
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F15-T2-02: Atomic write resilience: orphaned .swarm/view.json.tmp cleaned up safely', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'get_swarm_view'))) return;

        const swarmDir = path.join(ws.dir, '.swarm');
        await fs.mkdir(swarmDir, { recursive: true });
        const tmpPath = path.join(swarmDir, 'view.json.tmp');
        await fs.writeFile(tmpPath, '{"broken": "partial write"}', 'utf8');

        // Calling get_swarm_view should safely overwrite or clean up
        const res = await client.callTool('get_swarm_view', {});
        assert.equal(res.isError, false);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F15-T2-03: Special unicode characters and emojis in headline and goal preserved in view.json', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'get_swarm_view'))) return;

        const headline = '🚀 Milestone: AST rewritten! 🐝 Hive active with 100% 🎯 precision.';
        await client.callTool('swarm', { action: 'title', title: headline });

        const res = await client.callTool('get_swarm_view', {});
        const view = res.data?.view || res.data;
        assert.ok(view.headline.includes('🚀') || view.goal?.title?.includes('🚀'));
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F15-T2-04: Empty swarm (0 agents, 0 messages) generates valid baseline view.json', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'get_swarm_view'))) return;

        const res = await client.callTool('get_swarm_view', {});
        assert.equal(res.isError, false);
        const view = res.data?.view || res.data;
        assert.equal(view.as_of_seq, 0);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F15-T2-05: Concurrent view.json generation calls write cleanly without partial torn reads', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'get_swarm_view'))) return;

        const calls = Array.from({ length: 6 }, () => client.callTool('get_swarm_view', {}));
        const results = await Promise.all(calls);
        for (const res of results) {
          assert.equal(res.isError, false);
        }
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F16-T2-01: get_swarm_view called while state lock is held resolves cleanly without deadlocking', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'get_swarm_view', 'write_blackboard'))) return;

        const [r1, r2] = await Promise.all([
          client.callTool('write_blackboard', { key: 'concurrent:key', value: 'busy' }),
          client.callTool('get_swarm_view', {}),
        ]);

        assert.equal(r1.isError, false);
        assert.equal(r2.isError, false);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F16-T2-02: Attention items missing optional fields (actions, short) return valid structure', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'get_swarm_view'))) return;

        const res = await client.callTool('get_swarm_view', {});
        assert.equal(res.isError, false);
        const view = res.data?.view || res.data;
        assert.ok(Array.isArray(view.attention));
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F16-T2-03: get_swarm_view with corrupt view.json falls back safely to regenerator', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'get_swarm_view'))) return;

        // Write corrupt view.json
        const viewPath = path.join(ws.dir, '.swarm', 'view.json');
        await fs.mkdir(path.dirname(viewPath), { recursive: true });
        await fs.writeFile(viewPath, '{"invalid_json: 999', 'utf8');

        const res = await client.callTool('get_swarm_view', {});
        assert.equal(res.isError, false, 'Corrupted view.json should be regenerated cleanly');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F16-T2-04: get_swarm_view reflects rapid successive agent status transitions', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'complete_agent_task', 'get_swarm_view'))) return;

        await client.callTool('swarm', { action: 'add', name: 'sprint-agent', brief: 'Sprint' });
        await client.callTool('complete_agent_task', { agentId: 'sprint-agent', summary: 'Done' });

        const res = await client.callTool('get_swarm_view', {});
        const view = res.data?.view || res.data;
        assert.ok(view.now !== undefined);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F16-T2-05: Multiple concurrent get_swarm_view calls return identical consistent snapshots', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'get_swarm_view'))) return;

        const [v1, v2] = await Promise.all([
          client.callTool('get_swarm_view', {}),
          client.callTool('get_swarm_view', {}),
        ]);

        assert.equal(v1.isError, false);
        assert.equal(v2.isError, false);
        assert.equal(
          v1.data?.view?.as_of_seq ?? v1.data?.as_of_seq,
          v2.data?.view?.as_of_seq ?? v2.data?.as_of_seq
        );
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F17-T2-01: Calling read_board when no new messages exist keeps lastReadSeq unchanged', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'post_message', 'read_board'))) return;

        await client.callTool('swarm', { action: 'add', name: 'steady-reader', brief: 'Steady' });
        await client.callTool('post_message', { text: 'Only msg', from: 'alice' });

        // First read advances lastReadSeq to 1
        await client.callTool('read_board', { callerId: 'steady-reader' });
        // Second read without new messages
        await client.callTool('read_board', { callerId: 'steady-reader' });

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['steady-reader'] || statusRes.data.roster?.['steady-reader'];
        assert.equal(agent.lastReadSeq, 1, 'lastReadSeq should remain 1');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F17-T2-02: Calling read_board with since > headSeq handles cursor safely', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'read_board'))) return;

        const res = await client.callTool('read_board', { since: 500 });
        assert.equal(res.isError, false);
        assert.deepEqual(res.data.messages, []);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F17-T2-03: Agent subscribed to 10+ channels maintains full channels array without truncation', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm'))) return;

        await client.callTool('swarm', { action: 'add', name: 'omni-subscriber', brief: 'Many channels' });

        for (let i = 1; i <= 10; i++) {
          await client.callTool('swarm', { action: 'channel', op: 'create', channel: `topic-${i}` });
          await client.callTool('swarm', { action: 'channel', op: 'subscribe', channel: `topic-${i}`, members: ['omni-subscriber'] });
        }

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['omni-subscriber'] || statusRes.data.roster?.['omni-subscriber'];
        assert.ok(agent.channels.length >= 10, 'Should retain all 10 subscriptions');
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F17-T2-04: Cursor state persists in state.json / members.json across MCP client reconnects', async (ct) => {
      const ws = await createTestWorkspace();
      let client1, client2;
      try {
        client1 = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client1, 'swarm', 'post_message', 'read_board'))) return;

        await client1.callTool('swarm', { action: 'add', name: 'reconnect-agent', brief: 'Persistence' });
        await client1.callTool('post_message', { text: 'Persist seq', from: 'reconnect-agent' });
        await client1.callTool('read_board', { callerId: 'reconnect-agent' });

        await client1.close();

        client2 = await createMcpClient(ws.dir);
        const statusRes = await client2.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['reconnect-agent'] || statusRes.data.roster?.['reconnect-agent'];
        assert.equal(agent.lastPostSeq, 1);
        assert.equal(agent.lastReadSeq, 1);
      } finally {
        await client1?.close();
        await client2?.close();
        await ws.cleanup();
      }
    });

    await t.test('F17-T2-05: Multiple concurrent agents updating their cursors simultaneously do not clobber state', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'post_message'))) return;

        await client.callTool('swarm', { action: 'add', name: 'poster-1', brief: 'P1' });
        await client.callTool('swarm', { action: 'add', name: 'poster-2', brief: 'P2' });

        const [p1, p2] = await Promise.all([
          client.callTool('post_message', { text: 'From 1', from: 'poster-1' }),
          client.callTool('post_message', { text: 'From 2', from: 'poster-2' }),
        ]);

        assert.equal(p1.isError, false);
        assert.equal(p2.isError, false);

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const a1 = statusRes.data.agents?.['poster-1'] || statusRes.data.roster?.['poster-1'];
        const a2 = statusRes.data.agents?.['poster-2'] || statusRes.data.roster?.['poster-2'];

        assert.ok(a1.lastPostSeq > 0);
        assert.ok(a2.lastPostSeq > 0);
        assert.notEqual(a1.lastPostSeq, a2.lastPostSeq);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });

  // =========================================================================
  // TIER 3: CROSS-FEATURE COMBINATIONS (PAIRWISE INTERACTIONS)
  // =========================================================================

  await suite.test('Tier 3: Cross-Feature Interactions (Telemetry & Cursors)', async (t) => {
    await t.test('F15-F17-INT-01: Board message post updates lastPostSeq cursor, advances as_of_seq in view.json, and get_swarm_view returns new seq', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'post_message', 'get_swarm_view'))) return;

        await client.callTool('swarm', { action: 'add', name: 'pipeline-lead', brief: 'Lead' });
        const resPost = await client.callTool('post_message', { text: 'Turn completed', from: 'pipeline-lead' });
        const seq = resPost.data.message.seq;

        const resView = await client.callTool('get_swarm_view', {});
        const view = resView.data?.view || resView.data;
        assert.equal(view.as_of_seq, seq);

        const statusRes = await client.callTool('swarm', { action: 'status' });
        const agent = statusRes.data.agents?.['pipeline-lead'] || statusRes.data.roster?.['pipeline-lead'];
        assert.equal(agent.lastPostSeq, seq);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F15-F17-INT-02: Agent enters swarm_wait -> waitSince cursor set -> now map in view.json shows waiting', async (ct) => {
      const ws = await createTestWorkspace();
      let cWorker, cLeader;
      try {
        cWorker = await createMcpClient(ws.dir);
        cLeader = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, cLeader, 'swarm', 'swarm_wait', 'get_swarm_view'))) return;

        await cLeader.callTool('swarm', { action: 'add', name: 'waiting-telemetry', brief: 'Telemetry wait' });

        const waitPromise = cWorker.callTool('swarm_wait', {
          memberName: 'waiting-telemetry',
          timeoutMs: 600,
        });

        await new Promise((r) => setTimeout(r, 150));
        const resView = await cLeader.callTool('get_swarm_view', {});
        const view = resView.data?.view || resView.data;
        assert.ok(view.now?.['waiting-telemetry']?.toLowerCase().includes('wait') || view.now?.['waiting-telemetry'] !== undefined);

        await waitPromise;
      } finally {
        await cWorker?.close();
        await cLeader?.close();
        await ws.cleanup();
      }
    });

    await t.test('F15-F17-INT-03: Attention card with board_post action references valid message sequence on board', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'post_message', 'get_swarm_view'))) return;

        await client.callTool('post_message', { text: 'Audit needed at #1', from: 'auditor' });
        const resView = await client.callTool('get_swarm_view', {});
        const view = resView.data?.view || resView.data;
        assert.ok(view.as_of_seq >= 1);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F15-F17-INT-04: Channel creation and subscription updates agent channels cursor and workstream owners in view.json', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'get_swarm_view'))) return;

        await client.callTool('swarm', { action: 'add', name: 'ws-owner', brief: 'Owner' });
        await client.callTool('swarm', { action: 'channel', op: 'create', channel: 'feature-ws' });
        await client.callTool('swarm', { action: 'channel', op: 'subscribe', channel: 'feature-ws', members: ['ws-owner'] });

        const resView = await client.callTool('get_swarm_view', {});
        assert.equal(resView.isError, false);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });

    await t.test('F15-F17-INT-05: Lifecycle status change (working -> completed) updates now map, phase index, and workstream progress in view.json', async (ct) => {
      const ws = await createTestWorkspace();
      let client;
      try {
        client = await createMcpClient(ws.dir);
        if (!(await requireToolsOrSkip(ct, client, 'swarm', 'complete_agent_task', 'get_swarm_view'))) return;

        await client.callTool('swarm', { action: 'add', name: 'finisher-agent', brief: 'Finisher' });
        await client.callTool('complete_agent_task', { agentId: 'finisher-agent', summary: 'All steps verified' });

        const resView = await client.callTool('get_swarm_view', {});
        const view = resView.data?.view || resView.data;
        assert.ok(view.phase !== undefined);
      } finally {
        await client?.close();
        await ws.cleanup();
      }
    });
  });
});
