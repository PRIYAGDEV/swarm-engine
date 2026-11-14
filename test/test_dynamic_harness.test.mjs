import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  detectAgentHarness,
  generateDynamicAgentTask,
  resolveWorkerCommandForHarness,
  buildWorkerEnvForHarness,
} from '../dist/harness.js';
import { getSwarmStatusSummary } from '../dist/state.js';

test('Dynamic Worker Adaptation According to Agent Harness', async (suite) => {
  // TEST 1: Harness Detection
  await suite.test('T-HAR-01: Detects active agent harness from environment and markers', async () => {
    const origEnv = { ...process.env };
    try {
      // 1. Antigravity harness
      process.env.ANTIGRAVITY_AGENT = '1';
      delete process.env.CLAUDE_CODE;
      delete process.env.KILO_SESSION;
      const agHarness = detectAgentHarness();
      assert.equal(agHarness.type, 'antigravity');
      assert.equal(agHarness.capabilities.nativeSubagents, true);
      assert.equal(agHarness.capabilities.sharedMessageBoard, true);

      // 2. Claude Code harness
      delete process.env.ANTIGRAVITY_AGENT;
      delete process.env.ANTIGRAVITY_APP_DATA_DIR;
      delete process.env.ANTIGRAVITY_CONVERSATION_ID;
      process.env.CLAUDE_CODE = '1';
      const claudeHarness = detectAgentHarness();
      assert.equal(claudeHarness.type, 'claude-code');

      // 3. Kilo harness
      delete process.env.CLAUDE_CODE;
      process.env.KILO_SESSION = '1';
      const kiloHarness = detectAgentHarness();
      assert.equal(kiloHarness.type, 'kilo');

      // 4. Roo/Cline harness
      delete process.env.KILO_SESSION;
      process.env.ROO_MODE = 'code';
      const rooHarness = detectAgentHarness();
      assert.equal(rooHarness.type, 'roo-cline');

    } finally {
      process.env = origEnv;
    }
  });

  // TEST 2: Dynamic AGENT_TASK.md Construction per Harness
  await suite.test('T-HAR-02: Generates harness-specific AGENT_TASK.md instructions', async () => {
    const origEnv = { ...process.env };
    const mockAgent = {
      id: 'worker-db',
      role: 'database_engineer',
      model: 'gemini-4-carbon',
      taskSpec: 'Migrate users table and create indexes',
      targetFiles: ['src/db/users.ts'],
      workspace: 'share',
    };
    const mockState = {
      mission: 'Core schema refactoring',
      blackboard: { schemaVersion: '2.4.0' },
    };

    try {
      // 1. Antigravity task instructions
      process.env.ANTIGRAVITY_AGENT = '1';
      delete process.env.CLAUDE_CODE;
      delete process.env.KILO_SESSION;
      const agTask = generateDynamicAgentTask(mockAgent, mockState);
      assert.ok(agTask.includes('Google Antigravity'));
      assert.ok(agTask.includes('Antigravity Swarm Protocol'));
      assert.ok(agTask.includes('post_message'));
      assert.ok(agTask.includes('swarm_wait'));
      assert.ok(agTask.includes('worker-db'));
      assert.ok(agTask.includes('schemaVersion'));

      // 2. Claude Code task instructions
      delete process.env.ANTIGRAVITY_AGENT;
      delete process.env.ANTIGRAVITY_APP_DATA_DIR;
      delete process.env.ANTIGRAVITY_CONVERSATION_ID;
      process.env.CLAUDE_CODE = '1';
      const claudeTask = generateDynamicAgentTask(mockAgent, mockState);
      assert.ok(claudeTask.includes('Claude Code'));
      assert.ok(claudeTask.includes('Claude Code Execution Protocol'));
      assert.ok(claudeTask.includes('worker-db'));

      // 3. Kilo Code task instructions
      delete process.env.CLAUDE_CODE;
      process.env.KILO_SESSION = '1';
      const kiloTask = generateDynamicAgentTask(mockAgent, mockState);
      assert.ok(kiloTask.includes('Kilo Code'));
      assert.ok(kiloTask.includes('Kilo Code Execution Protocol'));
      assert.ok(kiloTask.includes('worker-db'));

    } finally {
      process.env = origEnv;
    }
  });

  // TEST 3: Dynamic Worker Environment Variables per Harness
  await suite.test('T-HAR-03: Injects harness-specific environment variables for spawned workers', async () => {
    const origEnv = { ...process.env };
    const mockAgent = {
      id: 'worker-auth',
      role: 'security_auditor',
      model: 'claude-3-7-sonnet',
      worktreePath: 'C:/temp/worktree-auth',
    };
    const mockState = { mission: 'Auth hardening' };

    try {
      // Antigravity harness env
      process.env.ANTIGRAVITY_AGENT = '1';
      process.env.ANTIGRAVITY_APP_DATA_DIR = 'C:/antigravity';
      delete process.env.CLAUDE_CODE;
      const agEnv = buildWorkerEnvForHarness(mockAgent, mockState);
      assert.equal(agEnv.SWARM_HARNESS, 'antigravity');
      assert.equal(agEnv.SWARM_AGENT_ID, 'worker-auth');
      assert.equal(agEnv.ANTIGRAVITY_AGENT, '1');
      assert.equal(agEnv.GEMINI_MODEL, 'claude-3-7-sonnet');

      // Claude Code harness env
      delete process.env.ANTIGRAVITY_AGENT;
      delete process.env.ANTIGRAVITY_APP_DATA_DIR;
      delete process.env.ANTIGRAVITY_CONVERSATION_ID;
      process.env.CLAUDE_CODE = '1';
      const claudeEnv = buildWorkerEnvForHarness(mockAgent, mockState);
      assert.equal(claudeEnv.SWARM_HARNESS, 'claude-code');
      assert.equal(claudeEnv.CLAUDE_CODE, '1');
      assert.equal(claudeEnv.ANTHROPIC_MODEL, 'claude-3-7-sonnet');

    } finally {
      process.env = origEnv;
    }
  });

  // TEST 4: Dynamic Worker Command Resolution
  await suite.test('T-HAR-04: Resolves worker execution command dynamically per harness and overrides', async () => {
    const mockAgent = { id: 'worker-test', role: 'tester', model: 'gemini-3.8-flash' };
    const mockState = { mission: 'Test' };

    // Explicit state workerCommand always takes precedence
    const customCmd = resolveWorkerCommandForHarness(mockAgent, { ...mockState, workerCommand: 'custom-runner run' });
    assert.equal(customCmd, 'custom-runner run');

    // Auto-run enabled generates node worker command in standalone/antigravity
    const origAutoRun = process.env.SWARM_AUTO_RUN;
    try {
      process.env.SWARM_AUTO_RUN = '1';
      const autoCmd = resolveWorkerCommandForHarness(mockAgent, mockState);
      assert.ok(autoCmd && autoCmd.includes('worker worker-test'));
    } finally {
      process.env.SWARM_AUTO_RUN = origAutoRun;
    }
  });

  // TEST 5: Status Snapshot Reflects Active Harness
  await suite.test('T-HAR-05: getSwarmStatusSummary includes active harness type', async () => {
    const origEnv = { ...process.env };
    try {
      process.env.ANTIGRAVITY_AGENT = '1';
      const summary = getSwarmStatusSummary({
        mission: 'Harness status verification',
        agents: {},
      });
      assert.equal(summary.harness, 'antigravity');
      assert.equal(summary.action, 'status');
    } finally {
      process.env = origEnv;
    }
  });
});
