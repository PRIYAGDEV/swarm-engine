/**
 * Tier 1: Feature Coverage (Isolation Testing)
 * 
 * Tests each of the 6 MCP tools and 5 CLI commands in isolation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTestWorkspace,
  createMcpClient,
  runCli,
  requireCliOrSkip,
} from './harness.mjs';

test('Tier 1 - MCP Tools in Isolation', async (t) => {
  if (!requireCliOrSkip(t)) return;

  await t.test('T1-MCP-01: spawn_swarm initializes swarm and schedules initial agents', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      const res = await client.callTool('spawn_swarm', {
        mission: 'Build authentication service',
        maxConcurrency: 2,
        agents: [
          {
            id: 'agent-auth',
            role: 'backend_developer',
            taskSpec: 'Implement src/auth.js',
            targetFiles: ['src/auth.js'],
          },
          {
            id: 'agent-db',
            role: 'database_engineer',
            taskSpec: 'Implement src/db.js',
            targetFiles: ['src/db.js'],
          },
        ],
      });

      assert.equal(res.isError, false, `Tool call should not error: ${JSON.stringify(res)}`);
      assert.ok(res.data, 'Tool should return structured response data');
      assert.equal(res.data.success, true);
      assert.equal(res.data.totalAgents, 2);

      const state = await ws.readState();
      assert.ok(state, 'State file .swarm/state.json should exist');
      assert.equal(state.mission, 'Build authentication service');
      assert.ok(state.agents['agent-auth']);
      assert.ok(state.agents['agent-db']);
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T1-MCP-02: add_dynamic_agent adds an on-the-fly agent', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      // Initial spawn
      await client.callTool('spawn_swarm', {
        mission: 'API Development',
        agents: [
          {
            id: 'agent-base',
            role: 'developer',
            taskSpec: 'Setup base API',
            targetFiles: ['src/api.js'],
          },
        ],
      });

      // Dynamically add a second agent
      const dynRes = await client.callTool('add_dynamic_agent', {
        role: 'security_reviewer',
        taskSpec: 'Audit src/security.js',
        dependsOn: ['agent-base'],
        targetFiles: ['src/security.js'],
      });

      assert.equal(dynRes.isError, false);
      assert.equal(dynRes.data.success, true);
      assert.ok(dynRes.data.agent, 'Should return created agent node');
      assert.equal(dynRes.data.agent.role, 'security_reviewer');

      const state = await ws.readState();
      const dynAgent = Object.values(state.agents).find((a) => a.role === 'security_reviewer');
      assert.ok(dynAgent, 'Dynamic agent should be recorded in state');
      assert.deepEqual(dynAgent.dependsOn, ['agent-base']);
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T1-MCP-03: pull_agent_task claims and inspects ready task', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      await client.callTool('spawn_swarm', {
        mission: 'Inspect Task Test',
        agents: [
          {
            id: 'agent-pull-1',
            role: 'worker',
            systemPrompt: 'Be concise.',
            taskSpec: 'Create src/worker.js',
            targetFiles: ['src/worker.js'],
          },
        ],
      });

      const pullRes = await client.callTool('pull_agent_task', {
        agentId: 'agent-pull-1',
      });

      assert.equal(pullRes.isError, false);
      assert.equal(pullRes.data.success, true);
      assert.equal(pullRes.data.agentId, 'agent-pull-1');
      assert.equal(pullRes.data.role, 'worker');
      assert.equal(pullRes.data.systemPrompt, 'Be concise.');
      assert.equal(pullRes.data.taskSpec, 'Create src/worker.js');
      assert.ok(pullRes.data.worktreePath, 'Should provide worktreePath');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T1-MCP-04: pull_agent_task gracefully handles no available tasks', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      await client.callTool('spawn_swarm', {
        mission: 'Empty Pull Test',
        agents: [],
      });

      const pullRes = await client.callTool('pull_agent_task', {});
      // Should return clean response indicating no tasks, without crashing
      assert.ok(pullRes.data !== null);
      assert.equal(pullRes.data.success, false);
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T1-MCP-05: write_blackboard stores primitive and structured entries', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      await client.callTool('spawn_swarm', {
        mission: 'Blackboard Test',
        agents: [],
      });

      const strRes = await client.callTool('write_blackboard', {
        key: 'api_version',
        value: 'v2.1.0',
      });
      assert.equal(strRes.isError, false);
      assert.equal(strRes.data.success, true);
      assert.equal(strRes.data.key, 'api_version');

      const objRes = await client.callTool('write_blackboard', {
        key: 'db_schema',
        value: { table: 'users', primaryKey: 'id' },
      });
      assert.equal(objRes.isError, false);
      assert.equal(objRes.data.success, true);
      assert.ok(objRes.data.allKeys.includes('api_version'));
      assert.ok(objRes.data.allKeys.includes('db_schema'));

      const state = await ws.readState();
      assert.equal(state.blackboard.api_version, 'v2.1.0');
      assert.deepEqual(state.blackboard.db_schema, { table: 'users', primaryKey: 'id' });
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T1-MCP-06: complete_agent_task transitions agent to completed', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      await client.callTool('spawn_swarm', {
        mission: 'Completion Test',
        agents: [
          {
            id: 'agent-comp-1',
            role: 'feature_dev',
            taskSpec: 'Add feature file',
            targetFiles: ['src/feature.js'],
          },
        ],
      });

      // Pull to ensure it's in running status
      const pull = await client.callTool('pull_agent_task', { agentId: 'agent-comp-1' });
      assert.equal(pull.data.success, true);

      // Now complete
      const compRes = await client.callTool('complete_agent_task', {
        agentId: 'agent-comp-1',
        summary: 'Feature implementation completed successfully',
      });

      assert.equal(compRes.isError, false);
      assert.equal(compRes.data.success, true);
      assert.equal(compRes.data.status, 'completed');

      const state = await ws.readState();
      assert.equal(state.agents['agent-comp-1'].status, 'completed');
      assert.equal(state.agents['agent-comp-1'].outputSummary, 'Feature implementation completed successfully');
      // Target files should be unlocked
      const locked = Array.isArray(state.lockedFiles)
        ? state.lockedFiles
        : Object.keys(state.lockedFiles || {});
      assert.ok(!locked.includes('src/feature.js'), 'File lock should be released');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T1-MCP-07: get_swarm_status returns snapshot of swarm state', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      await client.callTool('spawn_swarm', {
        mission: 'Status Snapshot Test',
        agents: [
          {
            id: 'agent-snap-1',
            role: 'worker',
            taskSpec: 'Worker task',
            targetFiles: ['src/worker.js'],
          },
        ],
      });

      const statusRes = await client.callTool('get_swarm_status', { detail: true });
      assert.equal(statusRes.isError, false);
      assert.ok(statusRes.data);
      assert.equal(statusRes.data.mission, 'Status Snapshot Test');
      assert.ok(statusRes.data.summary);
      assert.equal(statusRes.data.summary.total, 1);
      assert.ok(Array.isArray(statusRes.data.agents));
      assert.equal(statusRes.data.agents[0].id, 'agent-snap-1');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });
});

test('Tier 1 - CLI Subcommands in Isolation', async (t) => {
  if (!requireCliOrSkip(t)) return;

  await t.test('T1-CLI-01: swarm-engine init creates .swarm, AGENTS.md, and .gitignore', async () => {
    const ws = await createTestWorkspace({ isGit: true, initialCommit: true });
    try {
      const { stdout, stderr, exitCode } = await runCli(['init', 'Init Test Mission'], {
        cwd: ws.dir,
      });

      assert.equal(exitCode, 0, `init should succeed: ${stderr}`);
      assert.ok(ws.fileExists('.swarm/state.json'), '.swarm/state.json must be created');
      assert.ok(ws.fileExists('AGENTS.md'), 'AGENTS.md instruction file must be created');
      assert.ok(ws.fileExists('.gitignore'), '.gitignore must be created');

      const gitignore = await ws.readFile('.gitignore');
      assert.ok(gitignore.includes('.swarm/'), '.gitignore must contain .swarm/');
      assert.ok(gitignore.includes('AGENT_TASK.md'), '.gitignore must contain AGENT_TASK.md');

      // Check stdout contains MCP client config
      assert.ok(
        stdout.includes('mcpServers') || stdout.includes('swarm-engine'),
        'CLI init stdout should contain MCP client config snippet'
      );
    } finally {
      await ws.cleanup();
    }
  });

  await t.test('T1-CLI-02: swarm-engine status renders formatted table', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      // First initialize swarm with an agent via MCP or init
      client = await createMcpClient(ws.dir);
      await client.callTool('spawn_swarm', {
        mission: 'Table Render Mission',
        agents: [
          {
            id: 'agent-tbl',
            role: 'designer',
            taskSpec: 'Design mockup',
            targetFiles: ['src/design.css'],
          },
        ],
      });
      await client.close();
      client = null;

      const { stdout, exitCode } = await runCli(['status'], { cwd: ws.dir });
      assert.equal(exitCode, 0);
      assert.ok(stdout.includes('Table Render Mission'), 'Status table should show mission');
      assert.ok(stdout.includes('agent-tbl'), 'Status table should list agent ID');
      assert.ok(stdout.includes('designer'), 'Status table should list role');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T1-CLI-03: swarm-engine status --json outputs parseable JSON', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);
      await client.callTool('spawn_swarm', {
        mission: 'JSON Output Mission',
        agents: [
          {
            id: 'agent-json',
            role: 'tester',
            taskSpec: 'Test spec',
          },
        ],
      });
      await client.close();
      client = null;

      const { stdout, exitCode } = await runCli(['status', '--json'], { cwd: ws.dir });
      assert.equal(exitCode, 0);

      const parsed = JSON.parse(stdout.trim());
      assert.equal(parsed.mission, 'JSON Output Mission');
      assert.ok(parsed.agents['agent-json']);
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T1-CLI-04: swarm-engine reset clears worktrees and resets state', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);
      await client.callTool('spawn_swarm', {
        mission: 'Reset Mission',
        agents: [
          {
            id: 'agent-reset-1',
            role: 'worker',
            taskSpec: 'Do something',
          },
        ],
      });
      await client.close();
      client = null;

      const { exitCode } = await runCli(['reset', '--hard'], { cwd: ws.dir });
      assert.equal(exitCode, 0);

      const state = await ws.readState();
      assert.ok(state, 'state.json should exist after reset');
      assert.deepEqual(Object.keys(state.agents || {}), [], 'Agents should be reset to empty');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T1-CLI-05: swarm-engine mcp stdio handshake & Safeguard 1 verification', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      // Verify tools list
      const tools = await client.listTools();
      assert.ok(Array.isArray(tools), 'Should return tools array');
      const toolNames = tools.map((t) => t.name);

      assert.ok(toolNames.includes('spawn_swarm'));
      assert.ok(toolNames.includes('add_dynamic_agent'));
      assert.ok(toolNames.includes('pull_agent_task'));
      assert.ok(toolNames.includes('write_blackboard'));
      assert.ok(toolNames.includes('complete_agent_task'));
      assert.ok(toolNames.includes('get_swarm_status'));

      // Safeguard 1: stdout must contain ONLY valid newline-delimited JSON-RPC!
      const rawStdout = client.getStdoutRaw();
      const lines = rawStdout.split('\n').filter((l) => l.trim().length > 0);
      for (const line of lines) {
        assert.doesNotThrow(
          () => JSON.parse(line),
          `Every line on stdout must be valid JSON-RPC frame (Safeguard 1 violated by: ${line})`
        );
      }
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });
});
