#!/usr/bin/env node

/**
 * Swarm Engine Programmatic Automated Verification Suite
 * Milestone 3: Verification of Packaging, Multi-Environment Sync, MCP Schemas, and 15-20+ Subagent Scaling
 *
 * Implements the 3-Pillar Verification Architecture:
 * Pillar 1: Multi-Environment Skill Structure Verification
 * Pillar 2: MCP Tool Schema & Arbitrary Scaling Verification
 * Pillar 3: Live Dry-Run & Multi-Agent Execution (15-20+ Subagents)
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import {
  createTestWorkspace,
  createMcpClient,
  runCli,
  PROJECT_ROOT,
  CLI_PATH,
  isCliBuilt,
} from './harness.mjs';
import { getTargetEnvironments } from '../scripts/sync_skills.mjs';

const REQUIRED_SECTIONS = [
  '## ⚡ When to Use This Skill',
  '## 👥 Unbounded Subagent Deployment (5 to 20+ Parallel Agents)',
  '## 🚀 Autonomous Agent Workflow (CLI-First)',
  '## 🛠️ MCP Tools Reference',
  '## 🛡️ Key Architectural Guarantees',
  '## 🔄 Get Shit Done (GSD) Workflow Integration',
];

const REQUIRED_REFERENCES = [
  'architecture.md',
  'cli_reference.md',
  'mcp_reference.md',
  'subagent_patterns.md',
];

/**
 * Validates YAML frontmatter, 6 required sections, and content substance of a SKILL.md file.
 */
function validateSkillMarkdown(skillPath) {
  assert.ok(fs.existsSync(skillPath), `SKILL.md must exist at ${skillPath}`);
  const content = fs.readFileSync(skillPath, 'utf8');

  // 1. YAML frontmatter validation
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  assert.ok(fmMatch, `SKILL.md at ${skillPath} must have YAML frontmatter enclosed in ---`);
  const fm = fmMatch[1];

  assert.match(fm, /name:\s*swarm-engine/, `Frontmatter must declare 'name: swarm-engine'`);
  assert.match(fm, /license:\s*MIT/, `Frontmatter must declare 'license: MIT'`);
  assert.match(fm, /version:\s*1\.0\.0/, `Frontmatter must declare 'version: 1.0.0'`);
  assert.match(fm, /author:\s*PRIYAGDEV/, `Frontmatter must declare 'author: PRIYAGDEV'`);
  assert.match(fm, /description:/, `Frontmatter must declare a description`);

  // Ensure description is substantive
  const descMatch = fm.match(/description:\s*(?:\||>|-)?\r?\n([\s\S]*?)(?:\r?\n\w+:|$)/);
  if (descMatch) {
    assert.ok(descMatch[1].trim().length > 30, `Description in frontmatter must be substantive`);
  }

  // 2. 6 Required sections
  for (const section of REQUIRED_SECTIONS) {
    assert.ok(
      content.includes(section),
      `SKILL.md at ${skillPath} is missing required section: '${section}'`
    );
  }
}

/**
 * Validates modular reference documents in references/
 */
function validateReferences(dirPath) {
  const refDir = path.join(dirPath, 'references');
  assert.ok(fs.existsSync(refDir), `references/ directory must exist at ${refDir}`);

  for (const refFile of REQUIRED_REFERENCES) {
    const fullPath = path.join(refDir, refFile);
    assert.ok(fs.existsSync(fullPath), `Reference document references/${refFile} must exist at ${fullPath}`);
    const stats = fs.statSync(fullPath);
    assert.ok(
      stats.size >= 500,
      `Reference document references/${refFile} must be substantive (got ${stats.size} bytes, expected >= 500)`
    );
  }
}

/**
 * Validates example JSON configuration
 */
function validateExamples(dirPath) {
  const examplePath = path.join(dirPath, 'examples', 'unbounded_swarm_example.json');
  if (fs.existsSync(examplePath)) {
    const raw = fs.readFileSync(examplePath, 'utf8');
    const parsed = JSON.parse(raw);
    assert.equal(parsed.maxConcurrency, 0, `Example must declare maxConcurrency: 0 (unlimited)`);
    assert.ok(
      Array.isArray(parsed.agents) && parsed.agents.length >= 15,
      `Example must contain at least 15 specialized agents (found ${parsed.agents?.length})`
    );
  }
}

async function runVerification() {
  console.log('================================================================================');
  console.log('SWARM ENGINE PROGRAMMATIC VERIFICATION SUITE');
  console.log('Automated Multi-Environment Packaging, MCP Schemas, and Scaling Verification');
  console.log('================================================================================\n');

  const startTime = Date.now();
  let passedChecks = 0;
  let totalChecks = 0;

  async function step(name, fn) {
    totalChecks++;
    process.stdout.write(`[STEP ${totalChecks}] ${name}... `);
    const stepStart = Date.now();
    try {
      await fn();
      const elapsed = Date.now() - stepStart;
      console.log(`✓ PASS (${elapsed}ms)`);
      passedChecks++;
    } catch (err) {
      console.log(`✗ FAIL`);
      console.error(`\n[ERROR in STEP ${totalChecks}]: ${err.message}`);
      if (err.stack) console.error(err.stack);
      console.error('\n');
      throw err;
    }
  }

  // Pre-condition check: ensure dist/index.js is built
  assert.ok(isCliBuilt(), `Swarm Engine CLI must be compiled at ${CLI_PATH}. Run 'npm run build' first.`);

  // ===========================================================================
  // PILLAR 1: Multi-Environment Skill Structure Verification
  // ===========================================================================
  console.log('--- PILLAR 1: Multi-Environment Skill Structure Verification ---');

  await step('Verify canonical repository skill (skills/swarm-engine)', async () => {
    const canonicalDir = path.join(PROJECT_ROOT, 'skills', 'swarm-engine');
    const skillMdPath = path.join(canonicalDir, 'SKILL.md');

    validateSkillMarkdown(skillMdPath);
    validateReferences(canonicalDir);
    validateExamples(canonicalDir);

    // Verify scripts in canonical package
    assert.ok(fs.existsSync(path.join(canonicalDir, 'scripts', 'verify_skill.mjs')));
    assert.ok(fs.existsSync(path.join(canonicalDir, 'scripts', 'sync_skills.mjs')));
  });

  await step('Verify synchronized target AI agent environments', async () => {
    const targets = getTargetEnvironments();
    const verifiedEnvironments = [];

    for (const target of targets) {
      const exists = fs.existsSync(target.targetDir);

      if (target.required || exists) {
        assert.ok(
          exists,
          `Required target skill environment must exist at ${target.targetDir} (${target.name})`
        );

        const skillMd = path.join(target.targetDir, 'SKILL.md');
        validateSkillMarkdown(skillMd);
        validateReferences(target.targetDir);
        validateExamples(target.targetDir);

        verifiedEnvironments.push(target.name);
      }
    }

    // Must have verified at least Antigravity, Claude Code, and Kilo CLI
    assert.ok(
      verifiedEnvironments.includes('Global Antigravity (Gemini)'),
      'Global Antigravity (Gemini) skill must be verified'
    );
    assert.ok(
      verifiedEnvironments.includes('Claude Code'),
      'Claude Code skill must be verified'
    );
    assert.ok(
      verifiedEnvironments.includes('Kilo CLI'),
      'Kilo CLI skill must be verified'
    );

    console.log(`\n      [Audited ${verifiedEnvironments.length} environments: ${verifiedEnvironments.join(', ')}]`);
  });

  // ===========================================================================
  // PILLAR 2: MCP Tool Schema & Arbitrary Scaling Verification
  // ===========================================================================
  console.log('\n--- PILLAR 2: MCP Tool Schema & Arbitrary Scaling Verification ---');

  const schemaWs = await createTestWorkspace({ isGit: false });
  try {
    let mcpClient = await createMcpClient(schemaWs.dir);

    await step('Inspect MCP tools/list over stdio JSON-RPC', async () => {
      const tools = await mcpClient.listTools();
      assert.ok(Array.isArray(tools) && tools.length >= 6, `Expected at least 6 MCP tools, got ${tools?.length}`);

      const toolNames = tools.map((t) => t.name);
      assert.ok(toolNames.includes('spawn_swarm'), 'MCP server must register spawn_swarm tool');
      assert.ok(toolNames.includes('add_dynamic_agent'), 'MCP server must register add_dynamic_agent tool');
      assert.ok(toolNames.includes('pull_agent_task'), 'MCP server must register pull_agent_task tool');
      assert.ok(toolNames.includes('write_blackboard'), 'MCP server must register write_blackboard tool');
      assert.ok(toolNames.includes('complete_agent_task'), 'MCP server must register complete_agent_task tool');
      assert.ok(toolNames.includes('get_swarm_status'), 'MCP server must register get_swarm_status tool');
    });

    await step('Verify spawn_swarm unbounded schema & decomposition guidance', async () => {
      const tools = await mcpClient.listTools();
      const spawnTool = tools.find((t) => t.name === 'spawn_swarm');
      assert.ok(spawnTool, 'spawn_swarm tool must be found in tools/list');

      const props = spawnTool.inputSchema?.properties;
      assert.ok(props, 'spawn_swarm must define inputSchema.properties');

      // 1. Unbounded agents array without maxItems cap
      const agentsProp = props.agents;
      assert.ok(agentsProp, 'spawn_swarm must define agents property');
      assert.equal(agentsProp.type, 'array', 'agents property must be of type array');
      assert.equal(
        agentsProp.maxItems,
        undefined,
        `agents property must have NO maxItems cap (found ${agentsProp.maxItems})`
      );

      // 2. maxConcurrency defaults to 0 (unlimited/infinite concurrency)
      const maxConcProp = props.maxConcurrency;
      assert.ok(maxConcProp, 'spawn_swarm must define maxConcurrency property');
      assert.equal(maxConcProp.default, 0, 'maxConcurrency must default to 0 (unlimited)');
      assert.match(
        maxConcProp.description || '',
        /unlimited|infinite/i,
        'maxConcurrency description must mention unlimited/infinite concurrency'
      );

      // 3. Schema descriptions explicitly encourage decomposing missions into 5 to 20+ specialized subagents
      const toolDesc = spawnTool.description || '';
      const agentsDesc = agentsProp.description || '';
      const combinedDesc = `${toolDesc} ${agentsDesc}`;

      assert.match(
        combinedDesc,
        /5[,\s\-to]+20\+|5\s*to\s*20\+/i,
        'spawn_swarm description must explicitly encourage decomposing missions into 5 to 20+ specialized subagents'
      );
      assert.match(
        combinedDesc,
        /zero queuing/i,
        'spawn_swarm description must explicitly guarantee zero queuing'
      );
      assert.match(
        combinedDesc,
        /infinite concurrency|unlimited/i,
        'spawn_swarm description must highlight infinite concurrency / unlimited workers'
      );
    });

    await step('Verify add_dynamic_agent on-the-fly scaling & parameter guidance', async () => {
      const tools = await mcpClient.listTools();
      const dynamicTool = tools.find((t) => t.name === 'add_dynamic_agent');
      assert.ok(dynamicTool, 'add_dynamic_agent tool must be found in tools/list');

      const toolDesc = dynamicTool.description || '';
      assert.match(
        toolDesc,
        /dynamically inject|on-the-fly/i,
        'add_dynamic_agent description must indicate dynamic mid-execution injection'
      );
      assert.match(
        toolDesc,
        /20\+/i,
        'add_dynamic_agent description must mention scaling to 20+ agents'
      );
      assert.match(
        toolDesc,
        /zero queuing/i,
        'add_dynamic_agent description must guarantee zero queuing'
      );

      const props = dynamicTool.inputSchema?.properties;
      assert.ok(props, 'add_dynamic_agent must define inputSchema.properties');

      // Parameter schemas provide prompt decomposition and non-overlapping targetFiles guidance
      assert.ok(props.role, 'add_dynamic_agent must define role parameter');
      assert.match(
        props.role.description || '',
        /non-overlapping targetFiles|specialization/i,
        'role parameter description must provide specialization / non-overlapping targetFiles guidance'
      );

      assert.ok(props.taskSpec, 'add_dynamic_agent must define taskSpec parameter');
      assert.match(
        props.taskSpec.description || '',
        /prompt decomposition|scope|targetFiles/i,
        'taskSpec parameter description must provide prompt decomposition guidance'
      );

      assert.ok(props.targetFiles, 'add_dynamic_agent must define targetFiles parameter');
      assert.ok(props.dependsOn, 'add_dynamic_agent must define dependsOn parameter');
    });

    await mcpClient.close();
  } finally {
    await schemaWs.cleanup();
  }

  // ===========================================================================
  // PILLAR 3: Live Dry-Run & Multi-Agent Execution (15-20+ Subagents)
  // ===========================================================================
  console.log('\n--- PILLAR 3: Live Dry-Run & Multi-Agent Execution (15-20+ Subagents) ---');

  const execWs = await createTestWorkspace({ isGit: true, initialCommit: true });
  let execMcpClient = null;

  try {
    await step('CLI init with --concurrency 0 creates .swarm and AGENTS.md', async () => {
      const initResult = await runCli(
        ['init', 'Unbounded Scaling Test', '--concurrency', '0'],
        { cwd: execWs.dir }
      );
      assert.equal(initResult.exitCode, 0, `CLI init failed: ${initResult.stderr}`);

      assert.ok(execWs.fileExists('.swarm'), '.swarm directory must be created');
      assert.ok(execWs.fileExists('.swarm/worktrees'), '.swarm/worktrees directory must be created');
      assert.ok(execWs.fileExists('.swarm/state.json'), '.swarm/state.json must be created');
      assert.ok(execWs.fileExists('AGENTS.md'), 'AGENTS.md instruction guide must be generated in root');

      const agentsMd = await execWs.readFile('AGENTS.md');
      assert.ok(
        agentsMd.includes('# Swarm Engine — Agent Coordination Protocol'),
        'AGENTS.md must contain standard protocol header'
      );
      assert.ok(
        agentsMd.includes('maxConcurrency'),
        'AGENTS.md must reference maxConcurrency'
      );
    });

    await step('CLI status --json confirms maxConcurrency === 0 (unlimited)', async () => {
      const statusResult = await runCli(['status', '--json'], { cwd: execWs.dir });
      assert.equal(statusResult.exitCode, 0, `CLI status --json failed: ${statusResult.stderr}`);

      let stateJson;
      try {
        stateJson = JSON.parse(statusResult.stdout);
      } catch (e) {
        throw new Error(`Failed to parse CLI status --json stdout as JSON: ${e.message}`);
      }

      assert.equal(stateJson.mission, 'Unbounded Scaling Test', 'Mission should match init argument');
      assert.equal(stateJson.maxConcurrency, 0, 'maxConcurrency must be 0 (unlimited concurrency)');
      assert.deepEqual(Object.keys(stateJson.agents || {}), [], 'Initial agents should be empty');
    });

    // Start MCP server against initialized workspace
    execMcpClient = await createMcpClient(execWs.dir);

    // 15 Specialized initial agents across distinct architectural roles and non-overlapping files
    const INITIAL_15_AGENTS = [
      { id: 'worker-01-architect', role: 'system_architect', file: 'src/types/models.ts' },
      { id: 'worker-02-dbschema', role: 'db_schema_engineer', file: 'src/db/schema.sql' },
      { id: 'worker-03-migration', role: 'migration_runner', file: 'src/db/migrations/001_init.sql' },
      { id: 'worker-04-authroute', role: 'auth_route_builder', file: 'src/api/routes/auth.ts' },
      { id: 'worker-05-userroute', role: 'user_route_builder', file: 'src/api/routes/users.ts' },
      { id: 'worker-06-orders', role: 'order_service_dev', file: 'src/services/orders.ts' },
      { id: 'worker-07-payments', role: 'payment_processor', file: 'src/services/payments.ts' },
      { id: 'worker-08-notify', role: 'notification_engine', file: 'src/services/notifications.ts' },
      { id: 'worker-09-cache', role: 'redis_cache_layer', file: 'src/cache/redis.ts' },
      { id: 'worker-10-queue', role: 'background_queue', file: 'src/queue/worker.ts' },
      { id: 'worker-11-frontend', role: 'frontend_ui_builder', file: 'src/ui/Dashboard.tsx' },
      { id: 'worker-12-tests', role: 'unit_test_author', file: 'test/unit/services.test.ts' },
      { id: 'worker-13-security', role: 'security_auditor', file: 'src/security/audit.ts' },
      { id: 'worker-14-docs', role: 'api_doc_writer', file: 'docs/openapi.yaml' },
      { id: 'worker-15-devops', role: 'infra_engineer', file: 'infra/docker-compose.yml' },
    ];

    await step('MCP spawn_swarm with 15 specialized subagents: immediate parallel execution (0 queuing)', async () => {
      const agentsPayload = INITIAL_15_AGENTS.map((a) => ({
        id: a.id,
        role: a.role,
        taskSpec: `Implement specialized capability for ${a.role} with discrete boundaries`,
        targetFiles: [a.file],
        dependsOn: [],
      }));

      const res = await execMcpClient.callTool('spawn_swarm', {
        mission: 'Unbounded Scaling Verification (15 Initial Agents)',
        maxConcurrency: 0,
        parallel: true,
        agents: agentsPayload,
      });

      assert.equal(res.isError, false, `spawn_swarm returned error: ${JSON.stringify(res)}`);
      assert.ok(res.data, 'Expected JSON data response from spawn_swarm');
      assert.equal(res.data.success, true, 'spawn_swarm must return success: true');
      assert.equal(res.data.maxConcurrency, 0, 'maxConcurrency must remain 0');
      assert.equal(res.data.totalAgents, 15, 'totalAgents must be 15');
      assert.equal(
        res.data.runningAgents.length,
        15,
        `Expected all 15 agents to be immediately running (got ${res.data.runningAgents.length})`
      );
      assert.equal(
        res.data.pendingAgents.length,
        0,
        `Expected zero queuing (pendingAgents: 0, got ${res.data.pendingAgents.length})`
      );
    });

    await step('Audit on-disk presence of 15 isolated worktrees, AGENT_TASK.md, and file locks', async () => {
      const state = await execWs.readState();
      assert.ok(state, 'State file .swarm/state.json must exist');
      assert.equal(state.maxConcurrency, 0);

      // Verify locked files
      const lockedFiles = Array.isArray(state.lockedFiles)
        ? state.lockedFiles
        : Object.keys(state.lockedFiles || {});
      assert.equal(
        lockedFiles.length,
        15,
        `All 15 target files must be atomically locked (got ${lockedFiles.length})`
      );

      // Verify each agent worktree on disk
      for (const a of INITIAL_15_AGENTS) {
        const agentState = state.agents[a.id];
        assert.ok(agentState, `Agent ${a.id} must exist in state.agents`);
        assert.equal(agentState.status, 'running', `Agent ${a.id} must be running`);
        assert.ok(agentState.worktreePath, `Agent ${a.id} must have worktreePath set`);

        const wtRelPath = path.join('.swarm', 'worktrees', a.id);
        assert.ok(execWs.fileExists(wtRelPath), `Worktree directory on disk must exist: ${wtRelPath}`);

        const taskMdRelPath = path.join(wtRelPath, 'AGENT_TASK.md');
        assert.ok(
          execWs.fileExists(taskMdRelPath),
          `AGENT_TASK.md must exist in worktree: ${taskMdRelPath}`
        );

        const taskMdContent = await execWs.readFile(taskMdRelPath);
        assert.ok(
          taskMdContent.includes(a.id),
          `AGENT_TASK.md for ${a.id} must contain agent ID`
        );
        assert.ok(
          taskMdContent.includes(a.role),
          `AGENT_TASK.md for ${a.id} must contain agent role`
        );
      }
    });

    const DYNAMIC_3_AGENTS = [
      { id: 'worker-16-telemetry', role: 'telemetry_engineer', file: 'src/telemetry/metrics.ts' },
      { id: 'worker-17-chaos', role: 'chaos_tester', file: 'test/chaos/fault_injection.ts' },
      { id: 'worker-18-perf', role: 'perf_optimizer', file: 'bench/benchmark.ts' },
    ];

    await step('Inject 3 dynamic agents via add_dynamic_agent (total 18 agents, zero queuing)', async () => {
      for (const d of DYNAMIC_3_AGENTS) {
        const res = await execMcpClient.callTool('add_dynamic_agent', {
          id: d.id,
          role: d.role,
          taskSpec: `Dynamically added task slice for ${d.role}`,
          targetFiles: [d.file],
          dependsOn: [],
        });

        assert.equal(res.isError, false, `add_dynamic_agent failed for ${d.id}: ${JSON.stringify(res)}`);
        assert.equal(res.data.scheduled, true, `Dynamic agent ${d.id} must be immediately scheduled`);
        assert.equal(res.data.agent.status, 'running', `Dynamic agent ${d.id} must have status running`);

        // Check worktree immediately created
        const wtRelPath = path.join('.swarm', 'worktrees', d.id);
        assert.ok(execWs.fileExists(wtRelPath), `Worktree for dynamic agent ${d.id} must exist on disk`);
        assert.ok(
          execWs.fileExists(path.join(wtRelPath, 'AGENT_TASK.md')),
          `AGENT_TASK.md must exist for dynamic agent ${d.id}`
        );
      }

      // Verify status reflects 18 total running agents
      const statusRes = await execMcpClient.callTool('get_swarm_status', { detail: true });
      assert.equal(statusRes.isError, false);
      const totalCount = statusRes.data.summary?.total ?? statusRes.data.agents?.length;
      const runningCount = statusRes.data.summary?.running ?? statusRes.data.agents?.filter((a) => a.status === 'running').length;
      const pendingCount = statusRes.data.summary?.pending ?? statusRes.data.agents?.filter((a) => a.status === 'pending').length;
      assert.equal(totalCount, 18, 'Total agents must reach 18');
      assert.equal(runningCount, 18, 'Running agents must reach 18 (zero queuing)');
      assert.equal(pendingCount, 0, 'Pending agents must remain 0');
    });

    await step('Test shared blackboard write_blackboard and verify context propagation', async () => {
      const sharedContract = {
        protocol: 'gRPC-JSON-RPC',
        version: 'v2.4.0',
        authType: 'Bearer-JWT',
        subagentScale: 18,
      };

      const writeRes = await execMcpClient.callTool('write_blackboard', {
        key: 'global_system_contract',
        value: sharedContract,
      });

      assert.equal(writeRes.isError, false, `write_blackboard returned error: ${JSON.stringify(writeRes)}`);
      assert.equal(writeRes.data.success, true);
      assert.equal(writeRes.data.key, 'global_system_contract');

      // Verify state updated
      const state = await execWs.readState();
      assert.ok(state.blackboard.global_system_contract, 'Blackboard must contain global_system_contract');
      assert.equal(state.blackboard.global_system_contract.version, 'v2.4.0');

      // Verify context propagation into AGENT_TASK.md across running worktrees
      const sampleWorktrees = ['worker-01-architect', 'worker-10-queue', 'worker-18-perf'];
      for (const agId of sampleWorktrees) {
        const taskMdPath = path.join('.swarm', 'worktrees', agId, 'AGENT_TASK.md');
        assert.ok(execWs.fileExists(taskMdPath), `AGENT_TASK.md must exist for ${agId}`);
        const taskMd = await execWs.readFile(taskMdPath);
        assert.ok(
          taskMd.includes('global_system_contract'),
          `AGENT_TASK.md in ${agId} must reflect blackboard key 'global_system_contract'`
        );
        assert.ok(
          taskMd.includes('v2.4.0'),
          `AGENT_TASK.md in ${agId} must reflect propagated blackboard value 'v2.4.0'`
        );
      }
    });

    await step('Execute complete_agent_task with file modification: assert --no-ff merge and AGENT_TASK.md deletion', async () => {
      const testAgentId = 'worker-01-architect';
      const modifiedFile = 'src/types/models.ts';

      // 1. Write concrete implementation inside agent's worktree
      const wtFile = path.join(execWs.dir, '.swarm', 'worktrees', testAgentId, modifiedFile);
      await fsp.mkdir(path.dirname(wtFile), { recursive: true });
      const authoredCode = `// Generated by worker-01-architect\nexport interface SystemArchitecture {\n  version: string;\n  maxConcurrency: number;\n  activeSubagents: number;\n}\n`;
      await fsp.writeFile(wtFile, authoredCode, 'utf8');

      // 2. Complete agent task
      const compRes = await execMcpClient.callTool('complete_agent_task', {
        agentId: testAgentId,
        summary: 'Implemented base SystemArchitecture model interface',
      });

      assert.equal(compRes.isError, false, `complete_agent_task failed: ${JSON.stringify(compRes)}`);
      assert.equal(compRes.data.success, true);
      assert.equal(compRes.data.status, 'completed');

      // 3. Assert root repository on main branch received the merged file
      const rootMergedFile = path.join(execWs.dir, modifiedFile);
      assert.ok(fs.existsSync(rootMergedFile), `Modified file ${modifiedFile} must exist in root repository`);
      const rootMergedContent = await fsp.readFile(rootMergedFile, 'utf8');
      assert.ok(
        rootMergedContent.includes('SystemArchitecture'),
        `Root repository must contain merged SystemArchitecture content`
      );

      // 4. Assert worktree directory is pruned from disk
      const wtDir = path.join(execWs.dir, '.swarm', 'worktrees', testAgentId);
      assert.ok(!fs.existsSync(wtDir), `Worktree directory ${wtDir} must be pruned upon completion`);

      // 5. Assert AGENT_TASK.md was NOT committed to git history (Safeguard 2)
      const { stdout: gitLogNames } = await execWs.runGit(['log', '--name-only']);
      assert.ok(
        !gitLogNames.includes('AGENT_TASK.md'),
        'AGENT_TASK.md must NEVER pollute git log history (Safeguard 2)'
      );

      // 6. Assert git history shows a clean --no-ff merge commit
      const { stdout: gitLog } = await execWs.runGit(['log', '-n', '5', '--oneline']);
      assert.match(
        gitLog,
        /Merge branch 'swarm\/worker-01-architect'/,
        `Git log must reflect clean --no-ff merge: ${gitLog}`
      );

      // 7. Verify state shows agent completed and lock released
      const state = await execWs.readState();
      assert.equal(state.agents[testAgentId].status, 'completed');
      const lockedFiles = Array.isArray(state.lockedFiles)
        ? state.lockedFiles
        : Object.keys(state.lockedFiles || {});
      assert.ok(
        !lockedFiles.includes(modifiedFile),
        `Lock on ${modifiedFile} must be released after completion`
      );
    });

    await step('CLI reset --hard tears down all remaining worktrees and restores clean state', async () => {
      // Close MCP client to release handles before reset
      await execMcpClient.close();
      execMcpClient = null;

      const resetResult = await runCli(['reset', '--hard'], { cwd: execWs.dir });
      assert.equal(resetResult.exitCode, 0, `CLI reset --hard failed: ${resetResult.stderr}`);

      // Verify worktrees directory is cleared
      const wtParent = path.join(execWs.dir, '.swarm', 'worktrees');
      if (fs.existsSync(wtParent)) {
        const remainingWts = fs.readdirSync(wtParent);
        assert.equal(
          remainingWts.length,
          0,
          `Expected 0 remaining worktrees after reset --hard (found: ${remainingWts.join(', ')})`
        );
      }

      // Verify state is clean
      const state = await execWs.readState();
      assert.deepEqual(Object.keys(state.agents || {}), [], 'All agents must be cleared in state');
      const locks = Array.isArray(state.lockedFiles)
        ? state.lockedFiles
        : Object.keys(state.lockedFiles || {});
      assert.equal(locks.length, 0, 'All locks must be cleared');
      assert.equal(state.maxConcurrency, 0, 'maxConcurrency must remain 0');
    });

  } finally {
    if (execMcpClient) {
      try {
        await execMcpClient.close();
      } catch {}
    }
    await execWs.cleanup();
  }

  // ===========================================================================
  // SUMMARY BANNER
  // ===========================================================================
  const totalElapsed = Date.now() - startTime;
  console.log('\n================================================================================');
  console.log(`ALL VERIFICATION PILLARS PASSED SUCCESSFULLY! (${passedChecks}/${totalChecks} checks in ${totalElapsed}ms)`);
  console.log('✓ Pillar 1: Multi-Environment Skill Structure Verification');
  console.log('✓ Pillar 2: MCP Tool Schema & Arbitrary Scaling Verification');
  console.log('✓ Pillar 3: Live Dry-Run & Multi-Agent Execution (15-20+ Subagents)');
  console.log('================================================================================\n');

  return true;
}

// Execute when invoked directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  runVerification()
    .then(() => {
      process.exit(0);
    })
    .catch((err) => {
      console.error('\n*** PROGRAMMATIC VERIFICATION SUITE FAILED ***\n');
      console.error(err);
      process.exit(1);
    });
}

export { runVerification };
