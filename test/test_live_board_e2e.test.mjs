import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { startBoardServer, loadSwarmBoardData, formatBoardTerminal, generateSwarmBoardHtml } from "../dist/board-ui.js";
import { initState, updateState, getSwarmDir } from "../dist/state.js";
import { postMessage } from "../dist/board.js";

test("Swarm Board E2E Live Lifecycle Test", async (t) => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "swarm-live-e2e-"));
  const swarmDir = getSwarmDir(tmpDir);
  let serverInstance = null;

  try {
    // 1. Initialize fresh swarm in temporary directory
    await initState("E2E Live Board Test Mission", 0, undefined, swarmDir, "Gemini 4 Carbon");
    await updateState((s) => {
      s.title = "search and importer packages";
      s.agents["search"] = {
        id: "search",
        name: "search",
        role: "author",
        status: "working",
        model: "Gemini 3.8 Flash",
        targetFiles: ["internal/search/search.go", "internal/search/search_test.go"],
        taskSpec: "implement internal/search package with table-driven tests",
      };
      s.agents["importer"] = {
        id: "importer",
        name: "importer",
        role: "author",
        status: "working",
        model: "Gemini 3.8 Flash",
        targetFiles: ["internal/importer/importer.go"],
        taskSpec: "implement internal/importer package",
      };
      s.agents["verifier"] = {
        id: "verifier",
        name: "verifier",
        role: "read-only verifier",
        status: "waiting",
        model: "Gemini 4 Carbon",
        dependsOn: ["search", "importer"],
      };
      s.agents["monitor"] = {
        id: "monitor",
        name: "monitor",
        role: "stall watchdog",
        status: "waiting",
        model: "Gemini 3.8 Flash Lite",
      };
    }, swarmDir);

    // Post initial directives
    await postMessage(swarmDir, {
      text: "You own internal/search/ (search.go and search_test.go) in /workspace.",
      from: "coordinator",
      to: ["@search"],
    });
    await postMessage(swarmDir, {
      text: "You own internal/importer/ in /workspace.",
      from: "coordinator",
      to: ["@importer"],
    });

    // 2. Start Live Board Server
    const port = 34560 + Math.floor(Math.random() * 500);
    const { server, url } = await startBoardServer({ port, cwd: tmpDir, open: false });
    serverInstance = server;

    await t.test("E2E-01: GET / returns 200 with complete Tailwind HTML", async () => {
      const res = await fetch(url + "/");
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type")?.includes("text/html"), true);
      const text = await res.text();
      assert.ok(text.includes("search and importer packages"));
      assert.ok(text.includes("https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"));
      assert.ok(text.includes("id=\"tab-board\""));
      assert.ok(text.includes("id=\"tab-members\""));
      assert.ok(text.includes("id=\"tab-graph\""));
      assert.ok(text.includes("exportPrReport"));
      assert.ok(text.includes("jumpToMessage"));
      assert.ok(text.includes("timeline-slider"));
    });

    await t.test("E2E-02: GET /api/data returns valid structured swarm data", async () => {
      const res = await fetch(url + "/api/data");
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.title, "search and importer packages");
      assert.equal(data.messages.length, 2);
      assert.equal(data.members.length, 5); // coordinator + 4 agents
      assert.equal(data.messages[0].from, "coordinator");
      assert.deepEqual(data.messages[0].to, ["@search"]);
    });

    await t.test("E2E-03: POST /api/post adds a message and broadcasts live", async () => {
      const postRes = await fetch(url + "/api/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: "internal/search is ready for verification (ref #1).\n• Files added: internal/search/search.go",
          from: "search",
        }),
      });
      assert.equal(postRes.status, 200);
      const postData = await postRes.json();
      assert.equal(postData.success, true);
      assert.equal(postData.message.seq, 3);
      assert.equal(postData.message.from, "search");

      // Verify data refreshed
      const dataRes = await fetch(url + "/api/data");
      const updated = await dataRes.json();
      assert.equal(updated.messages.length, 3);
      assert.equal(updated.messages[2].text.includes("ready for verification"), true);
    });

    await t.test("E2E-04: Terminal board format with live data and filters", async () => {
      const liveData = await loadSwarmBoardData(tmpDir);
      const termOutput = formatBoardTerminal(liveData, { useColor: false });
      assert.ok(termOutput.includes("search and importer packages"));
      assert.ok(termOutput.includes("Posts · 3 total"));
      assert.ok(termOutput.includes("search"));
      assert.ok(termOutput.includes("importer"));
      assert.ok(termOutput.includes("verifier"));

      // Filter by search
      const filtered = formatBoardTerminal(liveData, { useColor: false, filter: "@search" });
      assert.ok(filtered.includes("[filter: @search]"));
    });
  } finally {
    if (serverInstance) {
      await new Promise((resolve) => serverInstance.close(resolve));
    }
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});
