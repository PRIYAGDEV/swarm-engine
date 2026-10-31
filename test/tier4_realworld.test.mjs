/**
 * Tier 4: Real-World Workflows
 * 
 * Verifies end-to-end multi-agent production workflows:
 * - Multi-agent sequential refactoring across multiple source files
 * - Parallel feature addition with blackboard coordination and clean git merges
 * - Resilience and recovery under process interruption
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  createTestWorkspace,
  createMcpClient,
  runCli,
  requireCliOrSkip,
} from './harness.mjs';

test('Tier 4 - Real-World Multi-Agent Workflows', async (t) => {
  if (!requireCliOrSkip(t)) return;

  await t.test('T4-E2E-01: Multi-Agent sequential refactoring with clean git history', async () => {
    // Initial workspace with miniature project
    const ws = await createTestWorkspace({
      isGit: true,
      initialCommit: true,
      files: {
        'src/types.js': 'export const UserRole = { ADMIN: "admin" };\n',
        'src/db.js': 'import { UserRole } from "./types.js";\nexport function getRoles() { return Object.values(UserRole); }\n',
        'src/server.js': 'import { getRoles } from "./db.js";\nconsole.log(getRoles());\n',
      },
    });

    let client;
    try {
      client = await createMcpClient(ws.dir);

      // Spawn 3-agent refactoring swarm:
      // Agent 1: Update types
      // Agent 2: Update db (depends on Agent 1)
      // Agent 3: Update server (depends on Agent 2)
      const spawnRes = await client.callTool('spawn_swarm', {
        mission: 'Add GUEST role and audit logging across stack',
        maxConcurrency: 2,
        agents: [
          {
            id: 'agent-types',
            role: 'type_architect',
            taskSpec: 'Add GUEST role to UserRole in src/types.js',
            dependsOn: [],
            targetFiles: ['src/types.js'],
          },
          {
            id: 'agent-db',
            role: 'db_developer',
            taskSpec: 'Add checkRole() helper in src/db.js',
            dependsOn: ['agent-types'],
            targetFiles: ['src/db.js'],
          },
          {
            id: 'agent-server',
            role: 'api_developer',
            taskSpec: 'Add /roles endpoint in src/server.js',
            dependsOn: ['agent-db'],
            targetFiles: ['src/server.js'],
          },
        ],
      });

      assert.equal(spawnRes.isError, false);

      // --- PHASE 1: Agent 1 (types) ---
      const pull1 = await client.callTool('pull_agent_task', { agentId: 'agent-types' });
      assert.equal(pull1.data.success, true);
      const worktree1 = pull1.data.worktreePath;

      // Edit src/types.js in Agent 1's worktree
      const typesFile = path.join(worktree1, 'src', 'types.js');
      await fs.writeFile(
        typesFile,
        'export const UserRole = { ADMIN: "admin", GUEST: "guest" };\n',
        'utf8'
      );

      // Complete Agent 1
      const comp1 = await client.callTool('complete_agent_task', {
        agentId: 'agent-types',
        summary: 'Added GUEST role to UserRole',
      });
      assert.equal(comp1.isError, false);

      // Verify root repo received types change
      const rootTypes = await ws.readFile('src/types.js');
      assert.ok(rootTypes.includes('GUEST: "guest"'), 'Root types.js must reflect Agent 1 changes');

      // --- PHASE 2: Agent 2 (db) ---
      const pull2 = await client.callTool('pull_agent_task', { agentId: 'agent-db' });
      assert.equal(pull2.data.success, true);
      const worktree2 = pull2.data.worktreePath;

      // Edit src/db.js in Agent 2's worktree (which should have inherited types.js)
      const dbFile = path.join(worktree2, 'src', 'db.js');
      await fs.writeFile(
        dbFile,
        'import { UserRole } from "./types.js";\nexport function getRoles() { return Object.values(UserRole); }\nexport function isGuest(role) { return role === UserRole.GUEST; }\n',
        'utf8'
      );

      // Complete Agent 2
      const comp2 = await client.callTool('complete_agent_task', {
        agentId: 'agent-db',
        summary: 'Added isGuest helper to db.js',
      });
      assert.equal(comp2.isError, false);

      // Verify root repo received db change
      const rootDb = await ws.readFile('src/db.js');
      assert.ok(rootDb.includes('isGuest'), 'Root db.js must reflect Agent 2 changes');

      // --- PHASE 3: Agent 3 (server) ---
      const pull3 = await client.callTool('pull_agent_task', { agentId: 'agent-server' });
      assert.equal(pull3.data.success, true);
      const worktree3 = pull3.data.worktreePath;

      // Edit src/server.js in Agent 3's worktree
      const serverFile = path.join(worktree3, 'src', 'server.js');
      await fs.writeFile(
        serverFile,
        'import { getRoles, isGuest } from "./db.js";\nexport function handleRequest() { return getRoles(); }\n',
        'utf8'
      );

      // Complete Agent 3
      const comp3 = await client.callTool('complete_agent_task', {
        agentId: 'agent-server',
        summary: 'Added handleRequest to server.js',
      });
      assert.equal(comp3.isError, false);

      // --- FINAL AUDIT ---
      // 1. All root files updated
      const finalServer = await ws.readFile('src/server.js');
      assert.ok(finalServer.includes('handleRequest'));

      // 2. State verification
      const state = await ws.readState();
      assert.equal(state.agents['agent-types'].status, 'completed');
      assert.equal(state.agents['agent-db'].status, 'completed');
      assert.equal(state.agents['agent-server'].status, 'completed');

      // 3. Locked files must be completely clear
      const locks = Array.isArray(state.lockedFiles)
        ? state.lockedFiles
        : Object.keys(state.lockedFiles || {});
      assert.equal(locks.length, 0, 'All locks must be cleared upon task completion');

      // 4. Git history check: no AGENT_TASK.md pollution
      const { stdout: gitLog } = await ws.runGit(['log', '--name-only']);
      assert.ok(!gitLog.includes('AGENT_TASK.md'), 'AGENT_TASK.md must not appear in git log');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T4-E2E-02: Parallel feature addition with blackboard coordination', async () => {
    const ws = await createTestWorkspace({
      isGit: true,
      initialCommit: true,
      files: {
        'src/index.js': '// Main entry\n',
      },
    });

    let client;
    try {
      client = await createMcpClient(ws.dir);

      // Spawn 2 parallel agents modifying disjoint files
      await client.callTool('spawn_swarm', {
        mission: 'Build UI components with shared design tokens',
        maxConcurrency: 2,
        agents: [
          {
            id: 'agent-button',
            role: 'ui_dev',
            taskSpec: 'Create Button component',
            targetFiles: ['src/Button.js'],
          },
          {
            id: 'agent-card',
            role: 'ui_dev',
            taskSpec: 'Create Card component',
            targetFiles: ['src/Card.js'],
          },
        ],
      });

      // Write design tokens to blackboard
      await client.callTool('write_blackboard', {
        key: 'theme_tokens',
        value: { primaryColor: '#0066cc', borderRadius: '4px' },
      });

      // Pull both tasks
      const pullButton = await client.callTool('pull_agent_task', { agentId: 'agent-button' });
      const pullCard = await client.callTool('pull_agent_task', { agentId: 'agent-card' });

      assert.equal(pullButton.data.success, true);
      assert.equal(pullCard.data.success, true);

      // Both agents make edits in their respective worktrees
      await fs.writeFile(
        path.join(pullButton.data.worktreePath, 'src', 'Button.js'),
        'export function Button() { return "<button style=\'border-radius: 4px\'>Click</button>"; }\n',
        'utf8'
      );

      await fs.writeFile(
        path.join(pullCard.data.worktreePath, 'src', 'Card.js'),
        'export function Card() { return "<div style=\'color: #0066cc\'>Content</div>"; }\n',
        'utf8'
      );

      // Both agents complete
      const compButton = await client.callTool('complete_agent_task', {
        agentId: 'agent-button',
        summary: 'Button created',
      });
      const compCard = await client.callTool('complete_agent_task', {
        agentId: 'agent-card',
        summary: 'Card created',
      });

      assert.equal(compButton.isError, false);
      assert.equal(compCard.isError, false);

      // Verify both files exist in root repo
      assert.ok(ws.fileExists('src/Button.js'), 'Button.js should be merged into root');
      assert.ok(ws.fileExists('src/Card.js'), 'Card.js should be merged into root');

      // Verify blackboard retains tokens
      const state = await ws.readState();
      assert.equal(state.blackboard.theme_tokens.primaryColor, '#0066cc');
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });

  await t.test('T4-E2E-03: Swarm reset cleans dirty worktrees and restores clean state', async () => {
    const ws = await createTestWorkspace({ isGit: true, initialCommit: true });
    let client;
    try {
      client = await createMcpClient(ws.dir);

      await client.callTool('spawn_swarm', {
        mission: 'Interruption & Recovery Test',
        agents: [
          {
            id: 'agent-crashed',
            role: 'worker',
            taskSpec: 'Long task interrupted',
            targetFiles: ['src/dirty.txt'],
          },
        ],
      });

      // Close client simulating crash/exit
      await client.close();
      client = null;

      // Verify worktree exists
      assert.ok(
        ws.fileExists('.swarm/worktrees/agent-crashed'),
        'Worktree should exist before reset'
      );

      // Run swarm-engine reset CLI
      const { exitCode, stdout } = await runCli(['reset', '--hard'], { cwd: ws.dir });
      assert.equal(exitCode, 0, 'CLI reset should succeed');

      // Verify worktrees directory is removed/pruned
      assert.ok(
        !ws.fileExists('.swarm/worktrees/agent-crashed'),
        'Worktree should be cleaned up by reset'
      );

      // Verify state is clean
      const state = await ws.readState();
      assert.deepEqual(Object.keys(state.agents || {}), []);
      const locks = Array.isArray(state.lockedFiles)
        ? state.lockedFiles
        : Object.keys(state.lockedFiles || {});
      assert.equal(locks.length, 0);
    } finally {
      await client?.close();
      await ws.cleanup();
    }
  });
});
