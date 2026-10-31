/**
 * Tier 5: Adversarial Coverage Hardening
 * 
 * Verifies system robustness against:
 * 1. Pathological inputs across all 6 MCP tools (cycles, self-loops, missing deps, empty IDs, invalid JSON)
 * 2. Race conditions & lock recovery (immediate dead PID eviction, corrupted metadata, high-concurrency contention)
 * 3. Worktree collision resilience (pre-existing worktree directories, pre-existing branches, non-git collisions)
 * 4. Clean git merge edge cases (conflict abort with clean workspace, nested directories, non-git hygiene)
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createTestWorkspace,
  createMcpClient,
  runCli,
  requireCliOrSkip,
} from './harness.mjs';

test('Tier 5 - Adversarial Coverage Hardening', async (t) => {
  if (!requireCliOrSkip(t)) return;

  // =========================================================================
  // 1. Pathological Inputs to All 6 MCP Tools
  // =========================================================================

  await t.test('T5-ADV-01: spawn_swarm handles circular dependencies, self-loops, and missing dependencies', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      // 1.1 Direct circular dependency (A -> B -> A)
      const resCycle = await client.callTool('spawn_swarm', {
        mission: 'Circular Test',
        agents: [
          { id: 'agent-a', role: 'dev', taskSpec: 'Task A', dependsOn: ['agent-b'] },
          { id: 'agent-b', role: 'dev', taskSpec: 'Task B', dependsOn: ['agent-a'] },
        ],
      });
      assert.equal(resCycle.isError, true, 'Direct cycle must trigger error');
      assert.match(resCycle.content[0].text, /Cycle detected/i);

      // 1.2 Self-referencing dependency (A -> A)
      const resSelf = await client.callTool('spawn_swarm', {
        mission: 'Self Loop Test',
        agents: [
          { id: 'agent-self', role: 'dev', taskSpec: 'Self Task', dependsOn: ['agent-self'] },
        ],
      });
      assert.equal(resSelf.isError, true, 'Self-loop must trigger error');
      assert.match(resSelf.content[0].text, /Cycle detected/i);

      // 1.3 Non-existent dependency in initial DAG
      const resMissingDep = await client.callTool('spawn_swarm', {
        mission: 'Missing Dep Test',
        agents: [
          { id: 'agent-1', role: 'dev', taskSpec: 'Task 1', dependsOn: ['ghost-agent'] },
        ],
      });
      assert.equal(resMissingDep.isError, true, 'Missing dependency must trigger error');
      assert.match(resMissingDep.content[0].text, /Dependency agent 'ghost-agent' does not exist/i);

      // 1.4 Agent with omitted/empty ID should auto-generate valid ID
      const resAutoId = await client.callTool('spawn_swarm', {
        mission: 'Auto ID Test',
        agents: [
          { role: 'anonymous-worker', taskSpec: 'Auto ID Task', targetFiles: ['src/auto.js'] },
        ],
      });
      assert.equal(resAutoId.isError, false, 'Omitting agent ID should succeed with generated ID');
      assert.equal(resAutoId.data.success, true);
      assert.equal(resAutoId.data.totalAgents, 1);

      // 1.5 4-node indirect circular dependency (A -> B -> C -> D -> B)
      const resLongCycle = await client.callTool('spawn_swarm', {
        mission: 'Long Cycle Test',
        agents: [
          { id: 'node-a', role: 'dev', taskSpec: 'A', dependsOn: ['node-b'] },
          { id: 'node-b', role: 'dev', taskSpec: 'B', dependsOn: ['node-c'] },
          { id: 'node-c', role: 'dev', taskSpec: 'C', dependsOn: ['node-d'] },
          { id: 'node-d', role: 'dev', taskSpec: 'D', dependsOn: ['node-b'] },
        ],
      });
      assert.equal(resLongCycle.isError, true, 'Multi-node cycle must be rejected');
      assert.match(resLongCycle.content[0].text, /Cycle detected/i);
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T5-ADV-02: add_dynamic_agent rejects uninitialized swarms, missing dependencies, and cycles', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      // 2.1 Call before swarm initialization
      const resUninit = await client.callTool('add_dynamic_agent', {
        role: 'tester',
        taskSpec: 'Test without swarm',
      });
      assert.equal(resUninit.isError, true, 'Calling add_dynamic_agent before init must fail');
      assert.match(resUninit.content[0].text, /Swarm not initialized/i);

      // Initialize swarm with agent-x and agent-y where agent-y depends on agent-x
      await client.callTool('spawn_swarm', {
        mission: 'Dynamic Adversarial',
        agents: [
          { id: 'agent-x', role: 'lead', taskSpec: 'Lead work', targetFiles: ['lead.txt'] },
          { id: 'agent-y', role: 'dev', taskSpec: 'Dev work', dependsOn: ['agent-x'] },
        ],
      });

      // 2.2 Adding agent with non-existent dependency
      const resBadDep = await client.callTool('add_dynamic_agent', {
        role: 'worker',
        taskSpec: 'Bad dependency worker',
        dependsOn: ['phantom-agent-404'],
      });
      assert.equal(resBadDep.isError, true, 'Non-existent dynamic dependency must fail');
      assert.match(resBadDep.content[0].text, /does not exist/i);

      // 2.3 Dynamic agent creating a cycle with existing state:
      // Modifying/injecting agent-x to depend on agent-y creates cycle agent-x -> agent-y -> agent-x
      const resCycle = await client.callTool('add_dynamic_agent', {
        id: 'agent-x',
        role: 'cycle-worker',
        taskSpec: 'Cycle worker',
        dependsOn: ['agent-y'],
      });
      assert.equal(resCycle.isError, true, 'Dynamic cycle must fail');
      assert.match(resCycle.content[0].text, /Cycle detected/i);

      // 2.4 Dynamic agent with empty ID should auto-generate an ID
      const resAuto = await client.callTool('add_dynamic_agent', {
        role: 'auto-specialist',
        taskSpec: 'Dynamic specialist',
        dependsOn: ['agent-x'],
      });
      assert.equal(resAuto.isError, false, 'Dynamic agent with auto-ID should succeed');
      assert.equal(resAuto.data.success, true);
      assert.ok(resAuto.data.agent.id.startsWith('agent-'));
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T5-ADV-03: pull_agent_task handles uninitialized states, non-existent agents, and empty queues', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      // 3.1 Uninitialized pull
      const resUninit = await client.callTool('pull_agent_task', {});
      assert.equal(resUninit.data.success, false);
      assert.match(resUninit.data.message, /not initialized/i);

      // Initialize swarm with 1 agent and complete it
      await client.callTool('spawn_swarm', {
        mission: 'Pull Exhaustion Test',
        agents: [
          { id: 'agent-once', role: 'dev', taskSpec: 'Solo task', targetFiles: ['solo.txt'] },
        ],
      });

      // 3.2 Pull non-existent agent
      const resNonExistent = await client.callTool('pull_agent_task', {
        agentId: 'non-existent-agent-id',
      });
      assert.equal(resNonExistent.isError, true);
      assert.match(resNonExistent.content[0].text, /not found/i);

      // Pull and complete the valid task
      const pullValid = await client.callTool('pull_agent_task', { agentId: 'agent-once' });
      assert.equal(pullValid.data.success, true);

      await client.callTool('complete_agent_task', {
        agentId: 'agent-once',
        summary: 'Done',
      });

      // 3.3 Pull when all tasks are completed
      const pullExhausted = await client.callTool('pull_agent_task', {});
      assert.equal(pullExhausted.data.success, false);
      assert.match(pullExhausted.data.message, /No tasks currently available/i);
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T5-ADV-04: write_blackboard rejects empty keys and accepts complex nested payloads', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);
      await client.callTool('spawn_swarm', { mission: 'Blackboard Test', agents: [] });

      // 4.1 Empty key
      const resEmpty = await client.callTool('write_blackboard', {
        key: '',
        value: 'some value',
      });
      assert.equal(resEmpty.isError, true);
      assert.match(resEmpty.content[0].text, /cannot be empty/i);

      // 4.2 Whitespace-only key
      const resWhitespace = await client.callTool('write_blackboard', {
        key: '    ',
        value: 'some value',
      });
      assert.equal(resWhitespace.isError, true);
      assert.match(resWhitespace.content[0].text, /cannot be empty/i);

      // 4.3 Deeply nested object payload
      const complexData = {
        apiSpec: {
          version: '2.4.0',
          endpoints: [
            { path: '/v1/users', methods: ['GET', 'POST'], auth: true },
            { path: '/v1/health', methods: ['GET'], auth: false },
          ],
        },
        flags: { dryRun: false, retries: 3, nullField: null },
      };

      const resComplex = await client.callTool('write_blackboard', {
        key: 'api_contract_v2',
        value: complexData,
      });
      assert.equal(resComplex.isError, false);
      assert.equal(resComplex.data.success, true);

      const state = await ws.readState();
      assert.deepEqual(state.blackboard['api_contract_v2'], complexData);
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T5-ADV-05: complete_agent_task rejects unknown agents and handles repeated completion gracefully', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);
      await client.callTool('spawn_swarm', {
        mission: 'Completion Test',
        agents: [
          { id: 'agent-comp', role: 'dev', taskSpec: 'Work', targetFiles: ['work.txt'] },
        ],
      });

      // 5.1 Non-existent agent ID
      const resBadId = await client.callTool('complete_agent_task', {
        agentId: 'ghost-agent-xyz',
        summary: 'Done',
      });
      assert.equal(resBadId.isError, true);
      assert.match(resBadId.content[0].text, /not found/i);

      // 5.2 Complete successfully without explicit summary (default fallback)
      const resValid = await client.callTool('complete_agent_task', {
        agentId: 'agent-comp',
      });
      assert.equal(resValid.isError, false);
      assert.equal(resValid.data.status, 'completed');
      assert.equal(resValid.data.summary, 'Task completed');

      // 5.3 Completing an already completed agent: worktree already pruned, updates state idempotently without crash
      const resAgain = await client.callTool('complete_agent_task', {
        agentId: 'agent-comp',
        summary: 'Second attempt',
      });
      assert.equal(resAgain.isError, false, 'Subsequent completion should succeed gracefully');
      assert.equal(resAgain.data.status, 'completed');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T5-ADV-06: get_swarm_status handles uninitialized state and detail flag correctly', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      // 6.1 Uninitialized status
      const resUninit = await client.callTool('get_swarm_status', {});
      assert.equal(resUninit.data.initialized, false);
      assert.match(resUninit.data.message, /not initialized/i);

      // Initialize with detailed agent specs
      await client.callTool('spawn_swarm', {
        mission: 'Detailed Mission',
        agents: [
          {
            id: 'agent-det',
            role: 'architect',
            systemPrompt: 'System instructions here',
            taskSpec: 'Design architecture spec',
            targetFiles: ['arch.md'],
          },
        ],
      });

      // 6.2 Summary mode (detail = false)
      const resSummary = await client.callTool('get_swarm_status', { detail: false });
      assert.equal(resSummary.data.initialized, true);
      assert.equal(resSummary.data.agents[0].systemPrompt, undefined, 'Summary mode should omit systemPrompt');

      // 6.3 Detailed mode (detail = true)
      const resDetail = await client.callTool('get_swarm_status', { detail: true });
      assert.equal(resDetail.data.initialized, true);
      assert.equal(resDetail.data.agents[0].systemPrompt, 'System instructions here', 'Detail mode should include systemPrompt');
      assert.equal(resDetail.data.agents[0].taskSpec, 'Design architecture spec');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T5-ADV-07: Stdio JSON-RPC transport survives malformed non-JSON lines and invalid methods', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);

      // 7.1 Inject malformed non-JSON lines directly into stdin
      client.child.stdin.write('MALFORMED_GARBAGE_PAYLOAD\n');
      client.child.stdin.write('{"unclosed": "json\n');
      client.child.stdin.write('\n');

      // 7.2 Send invalid JSON-RPC method request
      const errRes = await client.sendRequest('non_existent_method_xyz', {});
      assert.ok(errRes.error, 'Invalid method should return JSON-RPC error');

      // 7.3 Verify MCP server remains healthy and responsive to standard tool calls
      const pingRes = await client.callTool('get_swarm_status', {});
      assert.equal(pingRes.isError, false, 'Server must remain operational after invalid input');
      assert.equal(pingRes.data.initialized, false);
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  // =========================================================================
  // 2. Race Conditions & Stale Lock Reclamation
  // =========================================================================

  await t.test('T5-ADV-08: Stale lock with dead PID is reclaimed immediately without waiting 30s timeout', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);
      await client.callTool('spawn_swarm', { mission: 'Dead PID Test', agents: [] });

      // Create lock with fresh timestamp (2 seconds old, age << 30s) but with a dead PID (999999)
      const lockDir = path.join(ws.dir, '.swarm', 'state.lock');
      await fs.mkdir(lockDir, { recursive: true });
      await fs.writeFile(
        path.join(lockDir, 'owner.json'),
        JSON.stringify({ pid: 999999, timestamp: Date.now() - 2000 }),
        'utf8'
      );
      await fs.writeFile(path.join(lockDir, 'pid'), '999999', 'utf8');

      // Measure duration: must reclaim immediately via process.kill(pid, 0) ESRCH detection
      const start = Date.now();
      const res = await client.callTool('write_blackboard', {
        key: 'dead_pid_reclaimed',
        value: true,
      });
      const elapsed = Date.now() - start;

      assert.equal(res.isError, false);
      assert.equal(res.data.success, true);
      assert.ok(elapsed < 4000, `Dead PID lock must be evicted immediately (elapsed: ${elapsed}ms < 4000ms)`);

      const state = await ws.readState();
      assert.equal(state.blackboard.dead_pid_reclaimed, true);
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T5-ADV-09: Corrupted owner metadata falls back to directory mtime for stale lock recovery', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);
      await client.callTool('spawn_swarm', { mission: 'Corrupt Owner Test', agents: [] });

      // Create lock directory containing corrupted JSON in owner.json and garbage in pid
      const lockDir = path.join(ws.dir, '.swarm', 'state.lock');
      await fs.mkdir(lockDir, { recursive: true });
      await fs.writeFile(path.join(lockDir, 'owner.json'), 'CORRUPTED_{INVALID_JSON', 'utf8');
      await fs.writeFile(path.join(lockDir, 'pid'), 'not-a-number', 'utf8');

      // Backdate the directory mtime to 40 seconds ago (> 30s stale threshold)
      const pastTime = new Date(Date.now() - 40000);
      await fs.utimes(lockDir, pastTime, pastTime);

      const res = await client.callTool('write_blackboard', {
        key: 'mtime_fallback_recovered',
        value: 'success',
      });

      assert.equal(res.isError, false);
      assert.equal(res.data.success, true);

      const state = await ws.readState();
      assert.equal(state.blackboard.mtime_fallback_recovered, 'success');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T5-ADV-10: High-concurrency lock contention produces zero stranded temp files and consistent state', async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);
      await client.callTool('spawn_swarm', { mission: 'Concurrency Stress', agents: [] });

      // Fire 12 simultaneous mutations
      const keys = Array.from({ length: 12 }, (_, i) => `stress_key_${i}`);
      const promises = keys.map((k, i) =>
        client.callTool('write_blackboard', { key: k, value: i })
      );

      const results = await Promise.all(promises);
      for (const r of results) {
        assert.equal(r.isError, false, `State mutation must not fail under load: ${JSON.stringify(r)}`);
      }

      // Verify no temporary state files (.swarm/state.json.tmp.*) are stranded
      const swarmEntries = await fs.readdir(path.join(ws.dir, '.swarm'));
      const tmpFiles = swarmEntries.filter((f) => f.includes('state.json.tmp'));
      assert.equal(tmpFiles.length, 0, `No stranded temporary files should remain: ${tmpFiles.join(', ')}`);

      // Verify all 12 keys exist in final state
      const state = await ws.readState();
      for (let i = 0; i < 12; i++) {
        assert.equal(state.blackboard[`stress_key_${i}`], i);
      }
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  // =========================================================================
  // 3. Worktree Collision Resilience
  // =========================================================================

  await t.test('T5-ADV-11: Pre-existing worktree directory on disk is safely pruned and overwritten', async () => {
    const ws = await createTestWorkspace({ isGit: true, initialCommit: true });
    let client;
    try {
      // Pre-create the target worktree path with dirty/rogue files
      const rogueWorktree = path.join(ws.dir, '.swarm', 'worktrees', 'agent-rogue');
      await fs.mkdir(rogueWorktree, { recursive: true });
      await fs.writeFile(path.join(rogueWorktree, 'rogue_file.txt'), 'stale content', 'utf8');

      client = await createMcpClient(ws.dir);

      // Spawn agent targeting the collided worktree name
      const res = await client.callTool('spawn_swarm', {
        mission: 'Rogue Worktree Collision Test',
        agents: [
          {
            id: 'agent-rogue',
            role: 'cleaner',
            taskSpec: 'Overcoming pre-existing worktree',
            targetFiles: ['clean.txt'],
          },
        ],
      });

      assert.equal(res.isError, false);
      assert.equal(res.data.runningAgents.includes('agent-rogue'), true);

      // Verify rogue file was removed and official AGENT_TASK.md was placed
      const agentTaskExists = await fs
        .stat(path.join(rogueWorktree, 'AGENT_TASK.md'))
        .then(() => true)
        .catch(() => false);
      assert.equal(agentTaskExists, true, 'AGENT_TASK.md must be generated in cleaned worktree');

      const rogueFileExists = await fs
        .stat(path.join(rogueWorktree, 'rogue_file.txt'))
        .then(() => true)
        .catch(() => false);
      assert.equal(rogueFileExists, false, 'Pre-existing rogue files must be cleanly pruned');

      // Complete the task cleanly
      const compRes = await client.callTool('complete_agent_task', {
        agentId: 'agent-rogue',
        summary: 'Cleaned and merged',
      });
      assert.equal(compRes.isError, false);
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T5-ADV-12: Pre-existing git branch collision is reset via git worktree add -B', async () => {
    const ws = await createTestWorkspace({ isGit: true, initialCommit: true });
    let client;
    try {
      // Manually create branch swarm/agent-branch-col prior to agent execution
      await ws.runGit(['branch', 'swarm/agent-branch-col']);

      client = await createMcpClient(ws.dir);

      const res = await client.callTool('spawn_swarm', {
        mission: 'Branch Collision Test',
        agents: [
          {
            id: 'agent-branch-col',
            role: 'worker',
            taskSpec: 'Test branch collision overwrite',
            targetFiles: ['test.txt'],
          },
        ],
      });

      assert.equal(res.isError, false);
      assert.equal(res.data.runningAgents.includes('agent-branch-col'), true);

      // Verify the task completes and merges cleanly
      const compRes = await client.callTool('complete_agent_task', {
        agentId: 'agent-branch-col',
        summary: 'Branch collision resolved',
      });
      assert.equal(compRes.isError, false);
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T5-ADV-13: Pre-existing dirty worktree in non-git workspace is cleanly overwritten', async () => {
    const ws = await createTestWorkspace({ isGit: false });
    let client;
    try {
      // Pre-create dirty directory in non-git workspace
      const dirtyDir = path.join(ws.dir, '.swarm', 'worktrees', 'agent-nongit-col');
      await fs.mkdir(dirtyDir, { recursive: true });
      await fs.writeFile(path.join(dirtyDir, 'old_junk.txt'), 'junk', 'utf8');

      client = await createMcpClient(ws.dir);

      const res = await client.callTool('spawn_swarm', {
        mission: 'Non-Git Collision',
        agents: [
          {
            id: 'agent-nongit-col',
            role: 'worker',
            taskSpec: 'Non-git worker',
            targetFiles: ['output.txt'],
          },
        ],
      });

      assert.equal(res.isError, false);
      assert.equal(res.data.runningAgents.includes('agent-nongit-col'), true);

      // AGENT_TASK.md exists
      const taskExists = await fs
        .stat(path.join(dirtyDir, 'AGENT_TASK.md'))
        .then(() => true)
        .catch(() => false);
      assert.equal(taskExists, true);

      const compRes = await client.callTool('complete_agent_task', {
        agentId: 'agent-nongit-col',
        summary: 'Completed non-git',
      });
      assert.equal(compRes.isError, false);
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  // =========================================================================
  // 4. Clean Git Merge Edge Cases
  // =========================================================================

  await t.test('T5-ADV-14: Git merge conflict triggers abort and preserves clean repository state', async () => {
    const ws = await createTestWorkspace({
      isGit: true,
      initialCommit: true,
      files: {
        '.gitignore': '.swarm/\nAGENT_TASK.md\n',
        'shared.txt': 'LINE 1: Initial base content\nLINE 2: Common base\n',
      },
    });

    let client;
    try {
      client = await createMcpClient(ws.dir);

      // Spawn two independent agents targeting different files so both can run concurrently
      await client.callTool('spawn_swarm', {
        mission: 'Merge Conflict Test',
        maxConcurrency: 2,
        agents: [
          { id: 'agent-cf-1', role: 'dev1', taskSpec: 'Edit shared.txt', targetFiles: ['agent1.txt'] },
          { id: 'agent-cf-2', role: 'dev2', taskSpec: 'Conflicting edit', targetFiles: ['agent2.txt'] },
        ],
      });

      const wt1 = path.join(ws.dir, '.swarm', 'worktrees', 'agent-cf-1');
      const wt2 = path.join(ws.dir, '.swarm', 'worktrees', 'agent-cf-2');

      // Agent 1 introduces change to shared.txt
      await fs.writeFile(path.join(wt1, 'shared.txt'), 'LINE 1: Agent 1 modified content\nLINE 2: Common base\n', 'utf8');

      // Agent 2 introduces a conflicting change to the same line in shared.txt
      await fs.writeFile(path.join(wt2, 'shared.txt'), 'LINE 1: Agent 2 conflicting line\nLINE 2: Common base\n', 'utf8');

      // Agent 1 completes and merges first -> cleanly updates main
      const comp1 = await client.callTool('complete_agent_task', {
        agentId: 'agent-cf-1',
        summary: 'Agent 1 update',
      });
      assert.equal(comp1.isError, false);

      // Verify main workspace has Agent 1's content
      const rootShared = await ws.readFile('shared.txt');
      assert.match(rootShared, /Agent 1 modified content/);

      // Agent 2 now attempts to complete -> git merge will fail with conflict!
      const comp2 = await client.callTool('complete_agent_task', {
        agentId: 'agent-cf-2',
        summary: 'Agent 2 update',
      });

      // Must return isError: true with merge error
      assert.equal(comp2.isError, true, 'Merge conflict must return error');
      assert.match(comp2.content[0].text, /Failed to merge branch/i);

      // Verify main workspace has been cleaned by git merge --abort (working directory is clean of merge conflicts)
      const gitStatus = await ws.runGit(['status', '--porcelain']);
      assert.equal(gitStatus.stdout.trim(), '', 'Main workspace must be completely clean (no unresolved merge artifacts)');

      // Verify main workspace shared.txt is intact with Agent 1's content and has NO conflict markers (<<<<<<<)
      const afterConflict = await ws.readFile('shared.txt');
      assert.doesNotMatch(afterConflict, /<<<<<<</, 'No git conflict markers in main repository');
      assert.match(afterConflict, /Agent 1 modified content/);
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T5-ADV-15: Deeply nested directory creation merges cleanly to main repository', async () => {
    const ws = await createTestWorkspace({ isGit: true, initialCommit: true });
    let client;
    try {
      client = await createMcpClient(ws.dir);

      await client.callTool('spawn_swarm', {
        mission: 'Nested Path Test',
        agents: [
          {
            id: 'agent-nested',
            role: 'architect',
            taskSpec: 'Create deep hierarchy',
            targetFiles: ['nested/deep/modules/core/service.js'],
          },
        ],
      });

      const wt = path.join(ws.dir, '.swarm', 'worktrees', 'agent-nested');
      const deepPath = path.join(wt, 'nested', 'deep', 'modules', 'core', 'service.js');
      await fs.mkdir(path.dirname(deepPath), { recursive: true });
      await fs.writeFile(deepPath, 'export const deepService = () => "ok";\n', 'utf8');

      const compRes = await client.callTool('complete_agent_task', {
        agentId: 'agent-nested',
        summary: 'Created nested deep service',
      });
      assert.equal(compRes.isError, false);

      // Verify file exists in main repository
      const existsInRoot = ws.fileExists('nested/deep/modules/core/service.js');
      assert.equal(existsInRoot, true, 'Deeply nested file must exist in main repo after merge');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T5-ADV-16: Non-git fallback modifies existing files, creates new files, and excludes AGENT_TASK.md', async () => {
    const ws = await createTestWorkspace({
      isGit: false,
      files: {
        'existing.txt': 'original content\n',
      },
    });

    let client;
    try {
      client = await createMcpClient(ws.dir);

      await client.callTool('spawn_swarm', {
        mission: 'Non-Git Hygiene Test',
        agents: [
          {
            id: 'agent-nongit-hygiene',
            role: 'editor',
            taskSpec: 'Edit existing and create new',
            targetFiles: ['existing.txt', 'brand_new.txt'],
          },
        ],
      });

      const wt = path.join(ws.dir, '.swarm', 'worktrees', 'agent-nongit-hygiene');

      // Modify existing file
      await fs.writeFile(path.join(wt, 'existing.txt'), 'modified content in non-git\n', 'utf8');
      // Create new file
      await fs.writeFile(path.join(wt, 'brand_new.txt'), 'newly created non-git\n', 'utf8');

      const compRes = await client.callTool('complete_agent_task', {
        agentId: 'agent-nongit-hygiene',
        summary: 'Non-git edits',
      });
      assert.equal(compRes.isError, false);

      // Verify files in workspace root
      const modifiedContent = await ws.readFile('existing.txt');
      assert.equal(modifiedContent, 'modified content in non-git\n');

      const newContent = await ws.readFile('brand_new.txt');
      assert.equal(newContent, 'newly created non-git\n');

      // Verify AGENT_TASK.md was NEVER copied to workspace root
      const taskInRoot = ws.fileExists('AGENT_TASK.md');
      assert.equal(taskInRoot, false, 'AGENT_TASK.md must not be copied to workspace root in non-git fallback');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });
});
