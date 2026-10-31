import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createTestWorkspace,
} from "./harness.mjs";
import {
  initState,
  readState,
  recordAgentAction,
  updateAgentProgress,
} from "../dist/state.js";
import {
  executeRead,
  executeEdit,
  executeBash,
  runAgentWorker,
} from "../dist/runner.js";
import { tickScheduler } from "../dist/spawner.js";

test("Tier 6 - Fable Multi-Agent Execution & Live Actions", async (t) => {
  let ws;

  t.beforeEach(async () => {
    ws = await createTestWorkspace({ isGit: true, initialCommit: true });
  });

  t.afterEach(async () => {
    if (ws && ws.cleanup) await ws.cleanup();
  });

  await t.test("T6-ACT-01: recordAgentAction updates state with live Edit and diffs", async () => {
    const swarmDir = path.join(ws.dir, ".swarm");
    await initState("Test Fable Actions", 4, undefined, swarmDir);

    const { updateState } = await import("../dist/state.js");
    await updateState((s) => {
      s.agents["agent-qwen"] = {
        id: "agent-qwen",
        role: "refactor_specialist",
        model: "qwen3-coder:30b",
        taskSpec: "Fix lint errors in aiCoach.ts",
        dependsOn: [],
        targetFiles: ["src/coach/aiCoach.ts"],
        status: "running",
      };
    }, swarmDir);

    await recordAgentAction(
      "agent-qwen",
      {
        type: "edit",
        target: "src/coach/aiCoach.ts",
        detail: "Updated 2 lines",
        diffs: [
          { type: "del", line: "let reps = 0", lineNo: 140 },
          { type: "add", line: "const reps = 0", lineNo: 68 },
        ],
      },
      swarmDir
    );

    const state = await readState(swarmDir);
    const agent = state.agents["agent-qwen"];
    assert.equal(agent.actions?.length, 1);
    assert.equal(agent.actions[0].type, "edit");
    assert.equal(agent.actions[0].target, "src/coach/aiCoach.ts");
    assert.equal(agent.actions[0].diffs?.length, 2);
    assert.equal(agent.actions[0].diffs[0].type, "del");
    assert.equal(agent.actions[0].diffs[1].type, "add");
  });

  await t.test("T6-ACT-02: updateAgentProgress records token throughput and poetic verbs", async () => {
    const swarmDir = path.join(ws.dir, ".swarm");
    await initState("Test Fable Progress", 4, undefined, swarmDir);

    const { updateState } = await import("../dist/state.js");
    await updateState((s) => {
      s.agents["agent-opus"] = {
        id: "agent-opus",
        role: "scene_designer",
        model: "claude opus",
        taskSpec: "add candlelight to table 9",
        dependsOn: [],
        targetFiles: ["scene/candles.ts"],
        status: "running",
      };
    }, swarmDir);

    await updateAgentProgress(
      "agent-opus",
      {
        verb: "Whispering...",
        thought: "Adjusting flame illumination",
        tokens: 110100,
        tokPerSec: 64,
      },
      swarmDir
    );

    const state = await readState(swarmDir);
    const agent = state.agents["agent-opus"];
    assert.equal(agent.verb, "Whispering...");
    assert.equal(agent.thought, "Adjusting flame illumination");
    assert.equal(agent.tokens, 110100);
    assert.equal(agent.tokPerSec, 64);
  });

  await t.test("T6-ACT-03: executeRead, executeEdit, and executeBash record live actions in worktree", async () => {
    const swarmDir = path.join(ws.dir, ".swarm");
    await initState("Test Tool Execution", 4, undefined, swarmDir);

    const worktreeDir = path.join(swarmDir, "worktrees", "agent-worker");
    await fs.mkdir(worktreeDir, { recursive: true });

    const { updateState } = await import("../dist/state.js");
    await updateState((s) => {
      s.agents["agent-worker"] = {
        id: "agent-worker",
        role: "coder",
        model: "llama3.1:8b",
        taskSpec: "Refactor plan.ts",
        dependsOn: [],
        targetFiles: ["src/plan.ts"],
        status: "running",
        worktreePath: worktreeDir,
      };
    }, swarmDir);

    // 1. Edit
    await executeEdit(worktreeDir, "src/plan.ts", "export const plan = true;\n", "agent-worker", swarmDir);

    // 2. Read
    const readRes = await executeRead(worktreeDir, "src/plan.ts", "agent-worker", swarmDir);
    assert.equal(readRes.lineCount, 2);

    // 3. Bash
    const bashRes = await executeBash(worktreeDir, "node -e \"console.log('11 passed')\"", "agent-worker", swarmDir);
    assert.equal(bashRes.exitCode, 0);

    const state = await readState(swarmDir);
    const agent = state.agents["agent-worker"];
    assert.equal(agent.actions?.length, 3);
    assert.equal(agent.actions[0].type, "edit");
    assert.equal(agent.actions[1].type, "read");
    assert.equal(agent.actions[2].type, "bash");
    assert.ok(agent.actions[2].detail.includes("passed"));
  });

  await t.test("T6-ACT-04: runAgentWorker executes autonomous task, generates diff, and completes", async () => {
    const swarmDir = path.join(ws.dir, ".swarm");
    await initState("Test Autonomous Worker", 4, undefined, swarmDir);

    const { updateState } = await import("../dist/state.js");
    await updateState((s) => {
      s.agents["worker-auto"] = {
        id: "worker-auto",
        role: "worker",
        model: "gemma3:1b",
        taskSpec: "Generate greeting module",
        dependsOn: [],
        targetFiles: ["src/greet.ts"],
        status: "pending",
      };
    }, swarmDir);

    // Schedule agent to allocate worktree
    await tickScheduler(ws.dir);

    let state = await readState(swarmDir);
    assert.equal(state.agents["worker-auto"].status, "running");

    // Run autonomous worker
    await runAgentWorker("worker-auto", ws.dir);

    state = await readState(swarmDir);
    assert.equal(state.agents["worker-auto"].status, "completed");
  });
});
