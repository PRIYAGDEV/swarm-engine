import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  getSampleSwarmBoardData,
  generateSwarmBoardHtml,
  loadSwarmBoardData,
  formatBoardTerminal,
} from "../dist/board-ui.js";
import { createTestWorkspace, createMcpClient } from "./harness.mjs";
import { initState, updateState, getSwarmDir } from "../dist/state.js";
import { postMessage } from "../dist/board.js";

const execFileAsync = promisify(execFile);

test("Swarm Board UI — Google Antigravity & Carbon Parity", async (t) => {
  await t.test("T-BRD-01: Sample board data accurately mirrors linkshelf screenshot", () => {
    const data = getSampleSwarmBoardData();
    assert.equal(data.title, "stats and dedupe packages");
    assert.equal(data.isLive, true);
    assert.equal(data.messages.length, 8);
    assert.equal(data.members.length, 5);

    // Verify messages match screenshot (posts #1 to #8)
    assert.equal(data.messages[0].from, "coordinator");
    assert.deepEqual(data.messages[0].to, ["@dedupe", "@stats", "@verifier"]);
    assert.ok(data.messages[0].text.includes("internal/stats/"));
    assert.ok(data.messages[1].text.includes("internal/dedupe/"));
    assert.ok(data.messages[2].text.includes("read-only verifier"));
    assert.ok(data.messages[3].text.includes("stall monitor"));
    assert.ok(data.messages[4].text.includes("internal/stats is ready for verification"));
    assert.ok(data.messages[5].text.includes("internal/dedupe is ready for verification"));
    assert.ok(data.messages[6].text.includes("Full repo verification passed cleanly"));
    assert.ok(data.messages[7].text.includes("[done] Added internal/stats"));

    // Verify members match screenshot
    const memberNames = data.members.map((m) => m.name);
    assert.ok(memberNames.includes("coordinator"));
    assert.ok(memberNames.includes("stats"));
    assert.ok(memberNames.includes("dedupe"));
    assert.ok(memberNames.includes("verifier"));
    assert.ok(memberNames.includes("monitor"));
  });

  await t.test("T-BRD-02: generateSwarmBoardHtml produces self-contained Tailwind UI with 3 tabs", () => {
    const data = getSampleSwarmBoardData();
    const html = generateSwarmBoardHtml(data);

    // Gstatic Tailwind CSS inclusion
    assert.ok(html.includes("https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"));

    // 3 Primary Tabs
    assert.ok(html.includes('id="tab-board"'));
    assert.ok(html.includes('id="tab-members"'));
    assert.ok(html.includes('id="tab-graph"'));

    // Live Badge
    assert.ok(html.includes("Live"));
    assert.ok(html.includes("pulse-dot"));

    // Search and filter container
    assert.ok(html.includes('id="search-input"'));
    assert.ok(html.includes('id="filter-btn"'));

    // Visual SVG DAG
    assert.ok(html.includes('id="dag-svg"'));
    assert.ok(html.includes('id="dag-nodes"'));
    assert.ok(html.includes('id="dag-edges"'));

    // Formatted text and mentions
    assert.ok(html.includes("formatMessageText"));
    assert.ok(html.includes("mention-chip"));
    assert.ok(html.includes("code-chip"));
  });

  await t.test("T-BRD-03: loadSwarmBoardData dynamically reads live swarm state and messages", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "swarm-board-test-"));
    const swarmDir = getSwarmDir(tmpDir);

    try {
      await initState("Custom Board Mission", 0, undefined, swarmDir, "Gemini 4 Carbon");
      await updateState((s) => {
        s.title = "Custom Live Swarm";
        s.agents["worker-alpha"] = {
          id: "worker-alpha",
          role: "author",
          status: "working",
          model: "Gemini 3.8 Flash",
          targetFiles: ["src/alpha.ts"],
          taskSpec: "Implement alpha module",
        };
      }, swarmDir);

      await postMessage(swarmDir, {
        text: "You own src/alpha.ts @worker-alpha",
        from: "coordinator",
      });

      const data = await loadSwarmBoardData(tmpDir);
      assert.equal(data.title, "Custom Live Swarm");
      assert.equal(data.messages.length, 1);
      assert.equal(data.messages[0].from, "coordinator");
      assert.ok(data.messages[0].text.includes("src/alpha.ts"));

      const alphaMember = data.members.find((m) => m.id === "worker-alpha");
      assert.ok(alphaMember);
      assert.equal(alphaMember.status, "working");
      assert.deepEqual(alphaMember.targetFiles, ["src/alpha.ts"]);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  await t.test("T-BRD-04: formatBoardTerminal outputs clean aligned terminal view matching Image 2", () => {
    const data = getSampleSwarmBoardData();
    const term = formatBoardTerminal(data, { useColor: false });

    assert.ok(term.includes('Swarm board "stats and dedupe packages"'));
    assert.ok(term.includes("posts · [follow: on]"));
    assert.ok(term.includes("Roster · 5 members"));
    assert.ok(term.includes("Posts · 8 total"));
    assert.ok(term.includes("Message ·"));
    assert.ok(term.includes("tab switch pane · enter hide message · space expand · p filter · f follow"));
    assert.ok(term.includes("coordinator"));
    assert.ok(term.includes("stats"));
    assert.ok(term.includes("dedupe"));
    assert.ok(term.includes("verifier"));
    assert.ok(term.includes("monitor"));
  });

  await t.test("T-BRD-05: CLI subcommand 'swarm-engine board --html' exports board HTML", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "swarm-cli-board-"));
    const outHtml = path.join(tmpDir, "exported_board.html");

    try {
      const cliPath = path.resolve("./dist/index.js");
      const { stdout } = await execFileAsync(process.execPath, [cliPath, "board", "--html", outHtml], {
        cwd: tmpDir,
      });

      assert.ok(stdout.includes("✓ Swarm Board HTML exported to:"));
      const exists = await fs
        .access(outHtml)
        .then(() => true)
        .catch(() => false);
      assert.equal(exists, true);

      const content = await fs.readFile(outHtml, "utf8");
      assert.ok(content.includes("stats and dedupe packages"));
      assert.ok(content.includes("https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"));
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  await t.test("T-BRD-06: MCP tool 'get_swarm_board' returns structured board and HTML payload", async () => {
    const ws = await createTestWorkspace();
    let client;
    try {
      client = await createMcpClient(ws.dir);
      const res = await client.callTool("get_swarm_board", { exportHtml: false, includeHtml: true });
      assert.ok(res.content && res.content[0]);
      const parsed = JSON.parse(res.content[0].text);

      assert.equal(parsed.success, true);
      assert.ok(parsed.title);
      assert.ok(parsed.messages.length > 0);
      assert.ok(parsed.members.length > 0);
      assert.ok(parsed.html && parsed.html.includes("https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"));
    } finally {
      if (client) await client.close();
      await ws.cleanup();
    }
  });

  await t.test("T-BRD-07: Advanced interactive usability features in board HTML", () => {
    const data = getSampleSwarmBoardData();
    const html = generateSwarmBoardHtml(data);

    // Interactive cross-reference links
    assert.ok(html.includes("jumpToMessage"));
    assert.ok(html.includes("ref-chip"));
    assert.ok(html.includes("highlightPulse"));

    // File path & command copy chips and floating toasts
    assert.ok(html.includes("copySnippet"));
    assert.ok(html.includes("file-chip"));
    assert.ok(html.includes("cmd-chip"));
    assert.ok(html.includes("showToast"));

    // PR Markdown Export generator & modal
    assert.ok(html.includes("exportPrReport"));
    assert.ok(html.includes("pr-modal"));
    assert.ok(html.includes("downloadPrReport"));

    // Density and layout mode toggles
    assert.ok(html.includes("toggleDensity"));
    assert.ok(html.includes("toggleLayoutMode"));
    assert.ok(html.includes("compact-mode"));
    assert.ok(html.includes("wide-mode"));

    // Interactive graph scrubber and timeline
    assert.ok(html.includes("timeline-slider"));
    assert.ok(html.includes("toggleScrubberPlay"));
    assert.ok(html.includes("scrubber-callout"));
    assert.ok(html.includes("edge-active"));
  });

  await t.test("T-BRD-08: formatBoardTerminal supports filter presets and active filter indicators", () => {
    const data = getSampleSwarmBoardData();
    const unfiltered = formatBoardTerminal(data, { useColor: false });
    assert.ok(unfiltered.includes("Posts · 8 total"));

    const filtered = formatBoardTerminal(data, { useColor: false, filter: "@stats" });
    assert.ok(filtered.includes("[filter: @stats]"));
    assert.ok(filtered.includes("internal/stats"));
  });
});
