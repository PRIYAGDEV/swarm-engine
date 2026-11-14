import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  getModelTierForRole,
  detectProviderFamily,
  mapTierToProviderModel,
  resolveModelForRole,
  getQuotaFallbackModel,
  getAvailableModels,
  detectFromAntigravity,
} from '../dist/detector.js';
import { initState, updateState, readState } from '../dist/state.js';
import { spawnAgentNode } from '../dist/spawner.js';

test('Teamwork-Parity Model Resolution & Antigravity Tier Alignment', async (suite) => {
  // TEST 1: Role-to-Tier Mapping (Teamwork Archetypes)
  await suite.test('T-MOD-01: Correctly maps Teamwork archetypes to standard model tiers', () => {
    // Monitor / Narrator -> flash_lite
    assert.equal(getModelTierForRole('stall_monitor', 'monitor', 'Watch for stalls'), 'flash_lite');
    assert.equal(getModelTierForRole('narrator', 'narrator', 'Maintain overview'), 'flash_lite');
    assert.equal(getModelTierForRole('watchdog', 'heartbeat', 'Periodic ping'), 'flash_lite');

    // Lead / Architect / Coordinator / Planner / Security -> pro
    assert.equal(getModelTierForRole('system_architect', 'architect', 'Design system architecture'), 'pro');
    assert.equal(getModelTierForRole('coordinator', 'lead', 'Decompose tasks'), 'pro');
    assert.equal(getModelTierForRole('security_auditor', 'sec-1', 'Audit security boundaries'), 'pro');
    assert.equal(getModelTierForRole('planner', 'planner', 'Task milestones'), 'pro');
    assert.equal(getModelTierForRole('challenger', 'critic', 'Review trade-offs'), 'pro');

    // Verifier / Tester -> flash
    assert.equal(getModelTierForRole('verifier', 'qa', 'Run test suites'), 'flash');
    assert.equal(getModelTierForRole('syntax_checker', 'linter', 'Lint files'), 'flash');

    // Workers / Coders -> flash
    assert.equal(getModelTierForRole('worker', 'parser', 'Implement AST parser'), 'flash');
    assert.equal(getModelTierForRole('deepcoder', 'backend', 'Implement endpoints'), 'flash');
    assert.equal(getModelTierForRole('developer', 'frontend', 'Build React UI'), 'flash');
  });

  // TEST 2: Provider Family Detection
  await suite.test('T-MOD-02: Identifies provider families correctly', () => {
    assert.equal(detectProviderFamily('gemini-3.8-flash'), 'gemini');
    assert.equal(detectProviderFamily('gemini-4-carbon'), 'gemini');
    assert.equal(detectProviderFamily('claude-3-7-sonnet'), 'anthropic');
    assert.equal(detectProviderFamily('gpt-4o'), 'openai');
    assert.equal(detectProviderFamily('qwen-2.5-coder'), 'ollama');
    assert.equal(detectProviderFamily('MiniMax-M2.7'), 'generic');
  });

  // TEST 3: Dynamic Model Resolution by Role (Gemini Family)
  await suite.test('T-MOD-03: Resolves Teamwork roles to Gemini models under Gemini leader', () => {
    const leader = 'gemini-3.8-flash';

    // Architect gets Pro
    const archModel = resolveModelForRole({
      role: 'system_architect',
      leaderModel: leader,
      name: 'architect',
    });
    assert.equal(archModel, 'gemini-3.8-pro');

    // Coder gets Flash
    const coderModel = resolveModelForRole({
      role: 'worker',
      leaderModel: leader,
      name: 'coder',
    });
    assert.equal(coderModel, 'gemini-3.8-flash');

    // Monitor gets Flash-Lite
    const monModel = resolveModelForRole({
      role: 'stall_monitor',
      leaderModel: leader,
      name: 'monitor',
    });
    assert.equal(monModel, 'gemini-3.8-flash-lite');
  });

  // TEST 4: Dynamic Model Resolution with Gemini 4 Carbon
  await suite.test('T-MOD-04: Preserves Gemini 4 Carbon for reasoning roles when active', () => {
    const carbonLeader = 'gemini-4-carbon';

    const archModel = resolveModelForRole({
      role: 'system_architect',
      leaderModel: carbonLeader,
      name: 'architect',
    });
    assert.equal(archModel, 'gemini-4-carbon');

    const coderModel = resolveModelForRole({
      role: 'worker',
      leaderModel: carbonLeader,
      name: 'worker-1',
    });
    assert.equal(coderModel, 'gemini-3.8-flash');

    const monModel = resolveModelForRole({
      role: 'monitor',
      leaderModel: carbonLeader,
      name: 'monitor',
    });
    assert.equal(monModel, 'gemini-3.8-flash-lite');
  });

  // TEST 5: Dynamic Model Resolution under Anthropic/Claude
  await suite.test('T-MOD-05: Resolves Teamwork roles under Claude leader', () => {
    const claudeLeader = 'claude-3-7-sonnet';

    assert.equal(
      resolveModelForRole({ role: 'architect', leaderModel: claudeLeader }),
      'claude-3-7-sonnet'
    );
    assert.equal(
      resolveModelForRole({ role: 'worker', leaderModel: claudeLeader }),
      'claude-3-5-sonnet'
    );
    assert.equal(
      resolveModelForRole({ role: 'monitor', leaderModel: claudeLeader }),
      'claude-3-5-haiku'
    );
  });

  // TEST 5B: Zero-Compromise Quality Mode
  await suite.test('T-MOD-05B: Quality profile "quality" runs coders on full leader model without downgrade', () => {
    const carbonLeader = 'gemini-4-carbon';
    const claudeLeader = 'claude-3-7-sonnet';

    // Under Carbon in quality mode, worker gets Carbon directly (no downgrade to Flash)
    assert.equal(
      resolveModelForRole({ role: 'worker', leaderModel: carbonLeader, qualityProfile: 'quality' }),
      'gemini-4-carbon'
    );
    assert.equal(
      resolveModelForRole({ role: 'verifier', leaderModel: carbonLeader, qualityProfile: 'quality' }),
      'gemini-4-carbon'
    );

    // Under Claude in quality mode, worker gets Claude 3.7 Sonnet directly
    assert.equal(
      resolveModelForRole({ role: 'worker', leaderModel: claudeLeader, qualityProfile: 'quality' }),
      'claude-3-7-sonnet'
    );

    // Operational monitor still uses flash-lite to avoid token waste on stall pings
    assert.equal(
      resolveModelForRole({ role: 'stall_monitor', leaderModel: carbonLeader, qualityProfile: 'quality' }),
      'gemini-3.8-flash-lite'
    );
  });

  // TEST 6: Explicit Model & Tier Overrides
  await suite.test('T-MOD-06: Respects explicit requested models and tier keywords', () => {
    const leader = 'gemini-3.8-flash';

    // Explicit tier "pro"
    assert.equal(
      resolveModelForRole({ requestedModel: 'pro', leaderModel: leader, role: 'worker' }),
      'gemini-3.8-pro'
    );
    // Explicit tier "flash_lite"
    assert.equal(
      resolveModelForRole({ requestedModel: 'flash_lite', leaderModel: leader, role: 'architect' }),
      'gemini-3.8-flash-lite'
    );
    // Explicit verbatim model
    assert.equal(
      resolveModelForRole({ requestedModel: 'deepseek-coder-v2', leaderModel: leader }),
      'deepseek-coder-v2'
    );
    // "inherit" returns leader model
    assert.equal(
      resolveModelForRole({ requestedModel: 'inherit', leaderModel: 'gemini-4-carbon' }),
      'gemini-4-carbon'
    );
  });

  // TEST 7: Fork and Helper Model Inheritance
  await suite.test('T-MOD-07: Clones source/parent model for forks and helpers', () => {
    // Fork from worker with custom model
    const forkModel = resolveModelForRole({
      fork: 'source-node',
      sourceModel: 'claude-3-5-sonnet',
      role: 'worker',
      leaderModel: 'gemini-3.8-flash',
    });
    assert.equal(forkModel, 'claude-3-5-sonnet');

    // Helper inherits parent's model
    const helperModel = resolveModelForRole({
      parentId: 'parent-node',
      sourceModel: 'gemini-4-carbon',
      role: 'helper',
      leaderModel: 'gemini-3.8-flash',
    });
    assert.equal(helperModel, 'gemini-4-carbon');
  });

  // TEST 8: Quota Failover Rotation (HTTP 429)
  await suite.test('T-MOD-08: Rotates to correct fallback models on quota exhaustion', () => {
    // Gemini / Carbon hierarchy
    assert.equal(getQuotaFallbackModel('gemini-4-carbon'), 'gemini-3.8-pro');
    assert.equal(getQuotaFallbackModel('gemini-3.8-pro'), 'gemini-3.8-flash');
    assert.equal(getQuotaFallbackModel('gemini-3.8-flash'), 'gemini-3.8-flash-lite');

    // Claude hierarchy
    assert.equal(getQuotaFallbackModel('claude-3-7-sonnet'), 'claude-3-5-sonnet');
    assert.equal(getQuotaFallbackModel('claude-3-5-sonnet'), 'claude-3-5-haiku');

    // OpenAI hierarchy
    assert.equal(getQuotaFallbackModel('gpt-4o'), 'gpt-4o-mini');

    // Tier fallback
    assert.equal(getQuotaFallbackModel('pro'), 'flash');
    assert.equal(getQuotaFallbackModel('flash'), 'flash_lite');
  });

  // TEST 9: Model Catalog & Discovery
  await suite.test('T-MOD-09: getAvailableModels includes tiers and modern models', () => {
    const list = getAvailableModels('gemini-4-carbon');
    assert.ok(list.includes('gemini-4-carbon'));
    assert.ok(list.includes('gemini-3.8-pro'));
    assert.ok(list.includes('gemini-3.8-flash'));
    assert.ok(list.includes('gemini-3.8-flash-lite'));
    assert.ok(list.includes('inherit'));
    assert.ok(list.includes('pro'));
    assert.ok(list.includes('flash'));
    assert.ok(list.includes('flash_lite'));
  });

  // TEST 10: End-to-End Spawning with Automatic Role Resolution
  await suite.test('T-MOD-10: spawnAgent auto-assigns Teamwork model tiers when model is omitted', async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'swarm-teamwork-models-'));
    const swarmDir = path.join(tmpDir, '.swarm');

    try {
      await initState('Teamwork model test mission', 0, undefined, swarmDir, 'gemini-3.8-flash');

      // 1. Spawn Architect -> should automatically resolve to gemini-3.8-pro
      const arch = await spawnAgentNode({
        name: 'chief-architect',
        role: 'system_architect',
        brief: 'Architectural blueprints',
      }, tmpDir);
      assert.equal(arch.model, 'gemini-3.8-pro');

      // 2. Spawn Coder -> should automatically resolve to gemini-3.8-flash
      const coder = await spawnAgentNode({
        name: 'parser-coder',
        role: 'worker',
        brief: 'AST parser implementation',
      }, tmpDir);
      assert.equal(coder.model, 'gemini-3.8-flash');

      // 3. Spawn Monitor -> should automatically resolve to gemini-3.8-flash-lite
      const mon = await spawnAgentNode({
        name: 'stall-watcher',
        role: 'stall_monitor',
        brief: 'Stall watch',
      }, tmpDir);
      assert.equal(mon.model, 'gemini-3.8-flash-lite');

      // 4. Spawn Helper under Architect -> should inherit Architect's model (gemini-3.8-pro)
      const helper = await spawnAgentNode({
        name: 'arch-helper',
        parentId: 'chief-architect',
        brief: 'Sub-schema review',
      }, tmpDir);
      assert.equal(helper.model, 'gemini-3.8-pro');

    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });
});
