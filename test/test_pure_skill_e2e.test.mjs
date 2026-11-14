/**
 * End-to-End Pure Skill Swarm Test
 *
 * Verifies that Swarm Engine functions strictly as a pure AI Agent Skill:
 * 1. Automatic User Model Inheritance (Coders get Gemini 4 Carbon without downgrade; Monitor gets flash_lite).
 * 2. Parallel Author Worktrees (workspace: "share") with zero file collisions.
 * 3. Shared Message Board coordination via post_message, doorbell mentions (@name), and read_board.
 * 4. Safe clean git merge (--no-ff) and worktree pruning.
 * 5. Pure skill execution without any external TUI or terminal dashboard.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import {
  createTestWorkspace,
  createMcpClient,
  requireCliOrSkip,
} from './harness.mjs';

test('Pure Agent Skill - End-to-End Swarm Parity Test', async (t) => {
  if (!requireCliOrSkip(t)) return;

  await t.test('SKILL-01: Pure skill workflow with automatic model inheritance, board messaging, and worktree isolation', async () => {
    // 1. Create a clean git workspace with initial baseline project
    const ws = await createTestWorkspace({
      isGit: true,
      initialCommit: true,
      files: {
        'package.json': JSON.stringify({ name: 'my-service', version: '1.0.0' }, null, 2),
        'README.md': '# My Service\n',
      },
    });

    let client;
    const prevModel = process.env.SWARM_LEADER_MODEL;

    try {
      // Simulate user's active session running on Gemini 4 Carbon
      process.env.SWARM_LEADER_MODEL = 'gemini-4-carbon';

      client = await createMcpClient(ws.dir);

      // STEP 1: Coordinator initializes the swarm mission via native swarm tool
      const titleRes = await client.callTool('swarm', {
        action: 'title',
        title: 'Migrate schema and implement controller endpoints',
      });
      assert.equal(titleRes.isError, false, 'swarm title action must succeed');

      // STEP 2: Coordinator adds technical worker (schema-author) with workspace: share
      // Leaving model off must AUTOMATICALLY inherit gemini-4-carbon per Teamwork parity
      const addSchemaRes = await client.callTool('swarm', {
        action: 'add',
        name: 'schema-author',
        role: 'database_engineer',
        workspace: 'share',
        brief: 'Create prisma/schema.prisma with User and AuditLog models.',
      });
      assert.equal(addSchemaRes.isError, false, 'add schema-author must succeed');
      const schemaData = JSON.parse(addSchemaRes.content[0].text);
      assert.equal(schemaData.model, 'gemini-4-carbon', 'schema-author must automatically inherit gemini-4-carbon');

      // STEP 3: Coordinator adds second parallel worker (controller-dev) with workspace: share
      const addCtrlRes = await client.callTool('swarm', {
        action: 'add',
        name: 'controller-dev',
        role: 'api_developer',
        workspace: 'share',
        brief: 'Implement src/controllers/user.controller.ts with CRUD endpoints.',
      });
      assert.equal(addCtrlRes.isError, false, 'add controller-dev must succeed');
      const ctrlData = JSON.parse(addCtrlRes.content[0].text);
      assert.equal(ctrlData.model, 'gemini-4-carbon', 'controller-dev must automatically inherit gemini-4-carbon');

      // STEP 4: Coordinator adds stall monitor (monitor)
      // Monitor must AUTOMATICALLY use flash_lite to avoid token waste
      const addMonRes = await client.callTool('swarm', {
        action: 'add',
        name: 'monitor',
        role: 'stall_monitor',
        workspace: 'inherit',
        brief: 'Watch for stalls. Post only on @coordinator [stall].',
      });
      assert.equal(addMonRes.isError, false, 'add monitor must succeed');
      const monData = JSON.parse(addMonRes.content[0].text);
      assert.equal(monData.model, 'gemini-3.8-flash-lite', 'monitor must automatically use gemini-3.8-flash-lite');

      // STEP 5: Verify status shows workers waiting with correct inherited models
      const statusRes = await client.callTool('swarm', { action: 'status' });
      assert.equal(statusRes.isError, false);
      const statusData = JSON.parse(statusRes.content[0].text);
      assert.equal(statusData.members['schema-author'].model, 'gemini-4-carbon');
      assert.equal(statusData.members['controller-dev'].model, 'gemini-4-carbon');
      assert.equal(statusData.members['monitor'].model, 'gemini-3.8-flash-lite');

      // STEP 6: Execute worker 1 task in its isolated worktree
      const pull1 = await client.callTool('pull_agent_task', { agentId: 'schema-author' });
      assert.equal(pull1.data.success, true);
      const wt1 = pull1.data.worktreePath;
      assert.ok(wt1, 'schema-author must have an isolated worktree path');

      // Worker 1 writes schema.prisma inside its worktree
      const schemaDir = path.join(wt1, 'prisma');
      await fs.mkdir(schemaDir, { recursive: true });
      await fs.writeFile(
        path.join(schemaDir, 'schema.prisma'),
        'model User { id String @id }\nmodel AuditLog { id String @id }\n',
        'utf8'
      );

      // Worker 1 posts completion to shared board
      const post1 = await client.callTool('post_message', {
        from: 'schema-author',
        text: '@coordinator [done] schema.prisma authored with User and AuditLog models',
      });
      assert.equal(post1.isError, false);

      // Complete Worker 1 (commits and merges cleanly with --no-ff)
      const comp1 = await client.callTool('complete_agent_task', {
        agentId: 'schema-author',
        summary: 'Added User and AuditLog prisma schemas',
      });
      if (comp1.isError) {
        console.error('comp1 error text:', comp1.content?.[0]?.text);
      }
      assert.equal(comp1.isError, false);

      // STEP 7: Execute worker 2 task in parallel in its separate worktree
      const pull2 = await client.callTool('pull_agent_task', { agentId: 'controller-dev' });
      assert.equal(pull2.data.success, true);
      const wt2 = pull2.data.worktreePath;
      assert.ok(wt2, 'controller-dev must have an isolated worktree path');

      // Worker 2 writes user.controller.ts
      const ctrlDir = path.join(wt2, 'src', 'controllers');
      await fs.mkdir(ctrlDir, { recursive: true });
      await fs.writeFile(
        path.join(ctrlDir, 'user.controller.ts'),
        'export class UserController {\n  async getUsers() { return []; }\n  async createUser() { return {}; }\n}\n',
        'utf8'
      );

      // Worker 2 posts completion to board
      const post2 = await client.callTool('post_message', {
        from: 'controller-dev',
        text: '@coordinator [done] user.controller.ts implemented with UserController class',
      });
      assert.equal(post2.isError, false);

      // Complete Worker 2
      const comp2 = await client.callTool('complete_agent_task', {
        agentId: 'controller-dev',
        summary: 'Added UserController with CRUD methods',
      });
      assert.equal(comp2.isError, false);

      // STEP 8: Coordinator reads message board
      const boardRes = await client.callTool('read_board', { since: 0 });
      assert.equal(boardRes.isError, false);
      const parsedBoard = JSON.parse(boardRes.content[0].text);
      assert.ok(parsedBoard.messages && parsedBoard.messages.length >= 2, 'Board must contain at least the 2 worker completion posts');
      const boardFull = boardRes.content[0].text;
      assert.ok(boardFull.includes('schema.prisma authored'), 'Board must contain schema-author post');
      assert.ok(boardFull.includes('user.controller.ts implemented'), 'Board must contain controller-dev post');

      // STEP 9: Verify root workspace has received both files cleanly merged with zero collisions!
      const rootSchema = await ws.readFile('prisma/schema.prisma');
      assert.ok(rootSchema.includes('model User'), 'Root repo must have merged schema.prisma');

      const rootCtrl = await ws.readFile('src/controllers/user.controller.ts');
      assert.ok(rootCtrl.includes('class UserController'), 'Root repo must have merged user.controller.ts');

      // STEP 10: Land swarm cleanly
      const killSchema = await client.callTool('swarm', { action: 'kill', name: 'schema-author' });
      assert.equal(killSchema.isError, false);

      const killCtrl = await client.callTool('swarm', { action: 'kill', name: 'controller-dev' });
      assert.equal(killCtrl.isError, false);

      const killMon = await client.callTool('swarm', { action: 'kill', name: 'monitor' });
      assert.equal(killMon.isError, false);

    } finally {
      if (prevModel !== undefined) {
        process.env.SWARM_LEADER_MODEL = prevModel;
      } else {
        delete process.env.SWARM_LEADER_MODEL;
      }
      if (client) {
        await client.close();
      }
      await ws.cleanup();
    }
  });

  await t.test('SKILL-02: Zero-worktree direct workspace workflow matching Antigravity Teamwork & Swarm', async () => {
    const ws = await createTestWorkspace({
      isGit: true,
      initialCommit: true,
      files: {
        'package.json': JSON.stringify({ name: 'zero-worktree-service', version: '1.0.0' }, null, 2),
      },
    });

    let client;
    try {
      client = await createMcpClient(ws.dir);

      // STEP 1: Coordinator initializes mission
      const titleRes = await client.callTool('swarm', {
        action: 'title',
        title: 'Zero worktree teamwork parity test',
      });
      assert.equal(titleRes.isError, false);

      // STEP 2: Add worker 1 WITHOUT workspace parameter (defaults to inherit - 0 worktrees)
      const add1 = await client.callTool('swarm', {
        action: 'add',
        name: 'backend-dev',
        role: 'backend',
        brief: 'Create src/backend.ts with core API logic',
      });
      assert.equal(add1.isError, false);
      const data1 = JSON.parse(add1.content[0].text);
      assert.equal(data1.agent.workspace, 'inherit', 'Workspace must default to inherit (zero worktrees)');

      // STEP 3: Add worker 2 WITHOUT workspace parameter (defaults to inherit - 0 worktrees)
      const add2 = await client.callTool('swarm', {
        action: 'add',
        name: 'frontend-dev',
        role: 'frontend',
        brief: 'Create src/frontend.ts with client UI logic',
      });
      assert.equal(add2.isError, false);
      const data2 = JSON.parse(add2.content[0].text);
      assert.equal(data2.agent.workspace, 'inherit', 'Workspace must default to inherit (zero worktrees)');

      // STEP 4: Confirm .swarm/worktrees directory does NOT exist on disk!
      assert.equal(ws.fileExists('.swarm/worktrees'), false, '.swarm/worktrees directory must NOT exist');

      // STEP 5: Worker 1 pulls task and executes directly in workspace
      const pull1 = await client.callTool('pull_agent_task', { agentId: 'backend-dev' });
      assert.equal(pull1.data.success, true);
      assert.equal(pull1.data.worktreePath, ws.dir, 'Worker 1 executes directly in workspace root');

      await ws.writeFile('src/backend.ts', 'export const api = { version: "v1" };\n');
      await client.callTool('post_message', {
        from: 'backend-dev',
        text: '@coordinator [done] src/backend.ts implemented directly in workspace',
      });
      const comp1 = await client.callTool('complete_agent_task', { agentId: 'backend-dev' });
      assert.equal(comp1.isError, false);

      // STEP 6: Worker 2 pulls task and executes directly in workspace
      const pull2 = await client.callTool('pull_agent_task', { agentId: 'frontend-dev' });
      assert.equal(pull2.data.success, true);
      assert.equal(pull2.data.worktreePath, ws.dir, 'Worker 2 executes directly in workspace root');

      await ws.writeFile('src/frontend.ts', 'export const ui = { theme: "dark" };\n');
      await client.callTool('post_message', {
        from: 'frontend-dev',
        text: '@coordinator [done] src/frontend.ts implemented directly in workspace',
      });
      const comp2 = await client.callTool('complete_agent_task', { agentId: 'frontend-dev' });
      assert.equal(comp2.isError, false);

      // STEP 7: Verify .swarm/worktrees was NEVER created on disk throughout the entire lifecycle!
      assert.equal(ws.fileExists('.swarm/worktrees'), false, '.swarm/worktrees directory must NEVER exist in default mode');

      // STEP 8: Verify both files exist directly in the root workspace
      assert.ok(ws.fileExists('src/backend.ts'), 'src/backend.ts must exist directly in workspace');
      assert.ok(ws.fileExists('src/frontend.ts'), 'src/frontend.ts must exist directly in workspace');

      // STEP 9: Read message board and verify posts
      const boardRes = await client.callTool('read_board', { since: 0 });
      assert.equal(boardRes.isError, false);
      const parsedBoard = JSON.parse(boardRes.content[0].text);
      assert.ok(parsedBoard.messages.length >= 2, 'Board must contain worker completion posts');

      // STEP 10: Cleanly terminate workers
      const kill1 = await client.callTool('swarm', { action: 'kill', name: 'backend-dev' });
      assert.equal(kill1.isError, false);
      const kill2 = await client.callTool('swarm', { action: 'kill', name: 'frontend-dev' });
      assert.equal(kill2.isError, false);

    } finally {
      if (client) {
        await client.close();
      }
      await ws.cleanup();
    }
  });
});
