/**
 * Swarm Board UI Generator
 *
 * Generates an interactive, responsive HTML UI matching Google Antigravity & Carbon
 * official Swarm split-view side pane (https://antigravity.google/docs/swarm/).
 *
 * Features:
 * - 3 Primary Tabs: Board <count>, Members <count>, Graph
 * - Live status indicator (● Live) with animated pulse
 * - Instant real-time search & filter bar
 * - Exact message styling: avatar, @sender → @recipients, #seq · time, path code-chips
 * - Members roster with status dots (🟢 working, 🟡 waiting, ⚪ completed), models, files
 * - Interactive SVG DAG / communication graph & timeline
 * - Tailwind CSS via official https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js
 * - Antigravity CSS semantic tokens with standalone dark/light fallbacks
 */

import http from "node:http";
import path from "node:path";
import fs from "node:fs/promises";
import { SwarmState, getSwarmDir, readState, BoardMessage } from "./state.js";
import { readBoardMessages, postMessage, boardEventBus } from "./board.js";

function escapeHtml(str: string | undefined): string {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export interface SwarmBoardMember {
  id: string;
  name: string;
  role: string;
  status: "pending" | "running" | "working" | "waiting" | "completed" | "failed" | "killed";
  model?: string;
  targetFiles?: string[];
  taskSpec?: string;
  brief?: string;
  dependsOn?: string[];
  tokens?: number;
  tokPerSec?: number;
  poeticVerb?: string;
}

export interface SwarmBoardData {
  title: string;
  isLive: boolean;
  workspacePath?: string;
  messages: BoardMessage[];
  members: SwarmBoardMember[];
  headSeq: number;
}

/**
 * Returns default sample data matching the official Antigravity linkshelf swarm screenshot.
 */
export function getSampleSwarmBoardData(): SwarmBoardData {
  return {
    title: "stats and dedupe packages",
    isLive: true,
    workspacePath: "/Users/alex/linkshelf",
    headSeq: 8,
    members: [
      {
        id: "coordinator",
        name: "coordinator",
        role: "Coordinator 👑",
        status: "working",
        model: "Gemini 4 Carbon",
        brief: "Orchestrating packages and reviewing final results.",
        tokens: 14200,
        tokPerSec: 64,
      },
      {
        id: "stats",
        name: "stats",
        role: "author",
        status: "working",
        model: "Gemini 3.8 Flash",
        targetFiles: ["internal/stats/stats.go", "internal/stats/stats_test.go"],
        brief: "implementing internal/stats (ByTag and ByDomain bookmark counters) with table-driven tests.",
        tokens: 8430,
        tokPerSec: 112,
        poeticVerb: "Counting tags...",
      },
      {
        id: "dedupe",
        name: "dedupe",
        role: "author",
        status: "working",
        model: "Gemini 3.8 Flash",
        targetFiles: ["internal/dedupe/dedupe.go", "internal/dedupe/dedupe_test.go"],
        brief: "implementing internal/dedupe (URL normalization and duplicate group detection) with table-driven tests.",
        tokens: 9150,
        tokPerSec: 108,
        poeticVerb: "Normalizing URLs...",
      },
      {
        id: "verifier",
        name: "verifier",
        role: "read-only verifier",
        status: "waiting",
        model: "Gemini 4 Carbon",
        targetFiles: [],
        dependsOn: ["stats", "dedupe"],
        brief: "waiting for both authors to finish, then running go test ./... and go vet ./... and reviewing all diffs before reporting back.",
        tokens: 2400,
        tokPerSec: 0,
        poeticVerb: "Standing by...",
      },
      {
        id: "monitor",
        name: "monitor",
        role: "stall watchdog",
        status: "waiting",
        model: "Gemini 3.8 Flash Lite",
        brief: "watching the board to prevent stalls. Load the swarm_monitor skill and follow it. Post only to break a stall.",
        tokens: 950,
        tokPerSec: 0,
        poeticVerb: "Monitoring heartbeat...",
      },
    ],
    messages: [
      {
        seq: 1,
        from: "coordinator",
        to: ["@dedupe", "@stats", "@verifier"],
        channel: "main",
        text: "You own internal/stats/ (internal/stats/stats.go and internal/stats/stats_test.go) in /Users/alex/linkshelf (module example.com/linkshelf, Go 1.22, standard library only).",
        time: "2:24 PM",
        timestamp: Date.now() - 120000,
      },
      {
        seq: 2,
        from: "coordinator",
        to: ["@dedupe", "@stats", "@verifier"],
        channel: "main",
        text: "You own internal/dedupe/ (internal/dedupe/dedupe.go and internal/dedupe/dedupe_test.go) in /Users/alex/linkshelf (module example.com/linkshelf, Go 1.22, standard library only).",
        time: "2:24 PM",
        timestamp: Date.now() - 110000,
      },
      {
        seq: 3,
        from: "coordinator",
        to: ["@dedupe", "@stats", "@verifier"],
        channel: "main",
        text: "You are the read-only verifier for /Users/alex/linkshelf. Do NOT create, edit, or delete any files.",
        time: "2:24 PM",
        timestamp: Date.now() - 100000,
      },
      {
        seq: 4,
        from: "coordinator",
        to: ["@monitor"],
        channel: "main",
        text: "You are this swarm's stall monitor. Load the swarm_monitor skill and follow it. Post only to break a stall.",
        time: "2:24 PM",
        timestamp: Date.now() - 90000,
      },
      {
        seq: 5,
        from: "stats",
        to: ["@verifier"],
        channel: "main",
        text: "internal/stats is ready for verification (ref #1).\n• Files added: internal/stats/stats.go, internal/stats/stats_test.go",
        time: "2:28 PM",
        timestamp: Date.now() - 60000,
      },
      {
        seq: 6,
        from: "dedupe",
        to: ["@verifier"],
        channel: "main",
        text: "internal/dedupe is ready for verification (ref #2).\n• Files added: internal/dedupe/dedupe.go, internal/dedupe/dedupe_test.go",
        time: "2:29 PM",
        timestamp: Date.now() - 50000,
      },
      {
        seq: 7,
        from: "verifier",
        to: ["@coordinator"],
        channel: "main",
        text: "Full repo verification passed cleanly (ref #5, #6).\n\nCommands & Test Output:\n• go test -count=1 -v ./... — all tests in internal/stats and internal/dedupe pass.\n• go vet ./... and gofmt -l . — clean with zero warnings or formatting issues.\n• Diff review confirmed only the 4 expected files were added.",
        time: "2:30 PM",
        timestamp: Date.now() - 30000,
      },
      {
        seq: 8,
        from: "coordinator",
        to: [],
        channel: "main",
        text: "[done] Added internal/stats and internal/dedupe packages with table-driven tests; go test ./... and diff review passed.",
        time: "2:31 PM",
        timestamp: Date.now() - 10000,
      },
    ],
  };
}

/**
 * Generates the complete, self-contained HTML for the Swarm Board.
 */
export function generateSwarmBoardHtml(initialData: SwarmBoardData, options?: { liveUrl?: string; autoRefresh?: boolean }): string {
  const jsonStr = JSON.stringify(initialData).replace(/</g, "\\u003c").replace(/>/g, "\\u003e");
  const liveUrl = options?.liveUrl || "";
  const autoRefresh = options?.autoRefresh ?? Boolean(liveUrl);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(initialData.title)} — Swarm Board</title>
  <script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>
  <style>
    :root {
      --background: #131314;
      --card: #1e1f20;
      --card-border: #2e3135;
      --foreground: #e3e3e3;
      --muted-foreground: #8e9196;
      --border: #282a2c;
      --primary: #8ab4f8;
      --primary-foreground: #041e49;
      --success: #81c995;
      --warning: #fdd663;
      --error: #f28b82;
      --input: #1a1b1d;
    }
    body {
      background-color: var(--background, #131314);
      color: var(--foreground, #e3e3e3);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      overflow-x: hidden;
      -webkit-font-smoothing: antialiased;
    }
    /* Custom subtle scrollbar */
    ::-webkit-scrollbar {
      width: 6px;
      height: 6px;
    }
    ::-webkit-scrollbar-track {
      background: transparent;
    }
    ::-webkit-scrollbar-thumb {
      background: #2e3135;
      border-radius: 3px;
    }
    ::-webkit-scrollbar-thumb:hover {
      background: #444746;
    }
    .pulse-dot {
      box-shadow: 0 0 0 0 rgba(129, 201, 149, 0.7);
      animation: pulse-ring 2s infinite cubic-bezier(0.4, 0, 0.6, 1);
    }
    @keyframes pulse-ring {
      0% {
        box-shadow: 0 0 0 0 rgba(129, 201, 149, 0.7);
      }
      70% {
        box-shadow: 0 0 0 6px rgba(129, 201, 149, 0);
      }
      100% {
        box-shadow: 0 0 0 0 rgba(129, 201, 149, 0);
      }
    }
    .tab-btn.active {
      color: var(--foreground, #ffffff);
      border-bottom: 2px solid var(--primary, #8ab4f8);
    }
    .code-chip {
      background: rgba(255, 255, 255, 0.08);
      color: #cbd5e1;
      padding: 1px 5px;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 0.8125rem;
    }
    .mention-chip {
      color: #93c5fd;
      font-weight: 500;
    }
  </style>
</head>
<body class="bg-[var(--background,#131314)] text-[var(--foreground,#e3e3e3)] min-h-screen flex flex-col antialiased select-none">

  <!-- Top Sticky Header matching Antigravity Swarm Side Pane -->
  <header class="sticky top-0 z-30 bg-[var(--background,#131314)] border-b border-[var(--border,#282a2c)] px-4 pt-3 pb-0">
    <div class="flex items-center justify-between pb-2.5">
      <div class="flex items-center gap-2 overflow-hidden">
        <h1 id="swarm-title" class="text-sm font-semibold text-[var(--foreground,#f1f5f9)] tracking-tight truncate">
          ${escapeHtml(initialData.title)}
        </h1>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <span id="live-badge" class="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--success,#81c995)] bg-[rgba(129,201,149,0.12)] px-2 py-0.5 rounded-full">
          <span class="w-1.5 h-1.5 rounded-full bg-[var(--success,#81c995)] pulse-dot"></span>
          Live
        </span>
        <button id="refresh-btn" title="Refresh Board" class="text-[var(--muted-foreground,#8e9196)] hover:text-[var(--foreground,#ffffff)] p-1 rounded transition-colors">
          <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
        </button>
      </div>
    </div>

    <!-- 3 Navigation Tabs: Board <count>, Members <count>, Graph -->
    <div class="flex items-center gap-6 text-xs font-medium border-t border-[rgba(255,255,255,0.04)] pt-2.5">
      <button id="tab-board" onclick="switchTab('board')" class="tab-btn active pb-2 flex items-center gap-1.5 text-[var(--muted-foreground,#8e9196)] hover:text-[var(--foreground,#e3e3e3)] transition-colors">
        <span>Board</span>
        <span id="board-count-pill" class="text-[11px] font-normal text-[var(--muted-foreground,#8e9196)]">${initialData.messages.length}</span>
      </button>
      <button id="tab-members" onclick="switchTab('members')" class="tab-btn pb-2 flex items-center gap-1.5 text-[var(--muted-foreground,#8e9196)] hover:text-[var(--foreground,#e3e3e3)] transition-colors">
        <span>Members</span>
        <span id="members-count-pill" class="text-[11px] font-normal text-[var(--muted-foreground,#8e9196)]">${initialData.members.length}</span>
      </button>
      <button id="tab-graph" onclick="switchTab('graph')" class="tab-btn pb-2 flex items-center gap-1.5 text-[var(--muted-foreground,#8e9196)] hover:text-[var(--foreground,#e3e3e3)] transition-colors">
        <span>Graph</span>
      </button>
    </div>
  </header>

  <!-- Search & Filter Bar (shown on Board & Members tabs) -->
  <div id="search-container" class="px-4 py-2.5 bg-[var(--background,#131314)] border-b border-[var(--border,#282a2c)]">
    <div class="relative flex items-center">
      <div class="absolute inset-y-0 left-0 pl-2.5 flex items-center pointer-events-none text-[var(--muted-foreground,#8e9196)]">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      </div>
      <input
        type="text"
        id="search-input"
        placeholder="Search"
        class="w-full bg-[var(--input,#1e1f20)] text-xs text-[var(--foreground,#e3e3e3)] pl-8 pr-8 py-1.5 rounded-md border border-[var(--border,#2e3135)] focus:border-[var(--primary,#8ab4f8)] focus:outline-none transition-colors placeholder-[var(--muted-foreground,#666)]"
      />
      <button id="filter-btn" title="Filter options" class="absolute inset-y-0 right-0 pr-2.5 flex items-center text-[var(--muted-foreground,#8e9196)] hover:text-[var(--foreground,#e3e3e3)]">
        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
        </svg>
      </button>
    </div>
    <!-- Quick filter chips -->
    <div id="filter-chips" class="hidden flex-wrap gap-1.5 mt-2 pt-2 border-t border-[var(--border,#282a2c)] text-[11px]">
      <span class="text-[var(--muted-foreground,#8e9196)] py-0.5">Filter by:</span>
      <button onclick="applyFilter('')" class="filter-chip px-2 py-0.5 rounded bg-[var(--card,#1e1f20)] text-[var(--foreground,#fff)] border border-[var(--card-border,#333)]">All</button>
      <button onclick="applyFilter('@coordinator')" class="filter-chip px-2 py-0.5 rounded bg-[var(--card,#1e1f20)] text-[var(--muted-foreground,#8e9196)] hover:text-white">@coordinator</button>
      <button onclick="applyFilter('@stats')" class="filter-chip px-2 py-0.5 rounded bg-[var(--card,#1e1f20)] text-[var(--muted-foreground,#8e9196)] hover:text-white">@stats</button>
      <button onclick="applyFilter('@dedupe')" class="filter-chip px-2 py-0.5 rounded bg-[var(--card,#1e1f20)] text-[var(--muted-foreground,#8e9196)] hover:text-white">@dedupe</button>
      <button onclick="applyFilter('@verifier')" class="filter-chip px-2 py-0.5 rounded bg-[var(--card,#1e1f20)] text-[var(--muted-foreground,#8e9196)] hover:text-white">@verifier</button>
    </div>
  </div>

  <!-- Main View Area -->
  <main class="flex-1 overflow-y-auto px-4 py-3">

    <!-- TAB 1: BOARD VIEW -->
    <section id="view-board" class="space-y-4">
      <div id="messages-list" class="space-y-4">
        <!-- Rendered dynamically -->
      </div>
      <div id="board-empty" class="hidden text-center py-12 text-xs text-[var(--muted-foreground,#8e9196)]">
        No board messages matching your filter.
      </div>
    </section>

    <!-- TAB 2: MEMBERS VIEW -->
    <section id="view-members" class="hidden space-y-3">
      <div id="members-list" class="space-y-2.5">
        <!-- Rendered dynamically -->
      </div>
    </section>

    <!-- TAB 3: GRAPH VIEW -->
    <section id="view-graph" class="hidden flex flex-col gap-3">
      <div class="flex items-center justify-between text-xs text-[var(--muted-foreground,#8e9196)] pb-1">
        <span>Swarm Topology & Communication DAG</span>
        <span class="text-[11px] font-mono">Live Sync</span>
      </div>
      <div class="relative w-full h-[360px] bg-[var(--input,#18191a)] rounded-lg border border-[var(--card-border,#2e3135)] overflow-hidden flex items-center justify-center">
        <svg id="dag-svg" class="w-full h-full" viewBox="0 0 600 360">
          <defs>
            <marker id="arrow" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#4b5563" />
            </marker>
            <marker id="arrow-active" viewBox="0 0 10 10" refX="22" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#8ab4f8" />
            </marker>
          </defs>
          <g id="dag-edges"></g>
          <g id="dag-nodes"></g>
        </svg>
      </div>

      <!-- Graph Activity Timeline -->
      <div class="bg-[var(--card,#1e1f20)] p-3 rounded-lg border border-[var(--card-border,#2e3135)] text-xs space-y-2">
        <div class="font-medium text-[var(--foreground,#e3e3e3)] flex items-center justify-between">
          <span>Interaction Sequence</span>
          <span class="text-[11px] text-[var(--muted-foreground,#8e9196)] font-mono">4 messages</span>
        </div>
        <div id="timeline-flow" class="space-y-1.5 text-[11px] font-mono text-[var(--muted-foreground,#8e9196)]">
          <!-- Rendered dynamically -->
        </div>
      </div>
    </section>

  </main>

  <!-- Bottom Quick Post Bar (Simulator & Control) -->
  <footer class="p-3 bg-[var(--background,#131314)] border-t border-[var(--border,#282a2c)] flex items-center gap-2">
    <div class="w-6 h-6 rounded-full bg-[rgba(138,180,248,0.15)] text-[var(--primary,#8ab4f8)] flex items-center justify-center text-[10px] font-bold">
      an
    </div>
    <input
      type="text"
      id="quick-post-input"
      placeholder="Post message (@name to wake, @all to broadcast)..."
      class="flex-1 bg-[var(--input,#1e1f20)] text-xs text-[var(--foreground,#e3e3e3)] px-3 py-1.5 rounded-md border border-[var(--border,#2e3135)] focus:border-[var(--primary,#8ab4f8)] focus:outline-none placeholder-[var(--muted-foreground,#666)]"
      onkeydown="if(event.key==='Enter') quickPostMessage()"
    />
    <button onclick="quickPostMessage()" class="px-2.5 py-1.5 bg-[var(--primary,#8ab4f8)] hover:bg-[#a8c7fa] text-[var(--primary-foreground,#041e49)] text-xs font-medium rounded-md transition-colors">
      Post
    </button>
  </footer>

  <script>
    // Injected initial state
    let swarmData = ${jsonStr};
    let activeTab = "board";
    let filterQuery = "";
    const liveEndpoint = "${liveUrl}";

    function escapeHtml(str) {
      if (!str) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function formatMessageText(text) {
      if (!text) return "";
      let escaped = escapeHtml(text);

      // Handle [done] badge
      escaped = escaped.replace(/^\[done\]/g, '<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-[rgba(129,201,149,0.2)] text-[var(--success,#81c995)] mr-1.5 align-middle border border-[rgba(129,201,149,0.3)]">[done]</span>');

      // Highlight @mentions: @coordinator, @stats, @dedupe, @verifier, @monitor, @all
      escaped = escaped.replace(/@([a-zA-Z0-9_-]+)/g, '<span class="mention-chip">@$1</span>');

      // Highlight paths and code blocks: internal/stats/, stats.go, /Users/..., go test ./...
      escaped = escaped.replace(/(\\b(?:[a-zA-Z0-9_.-]+\\/[a-zA-Z0-9_.-]+|[a-zA-Z0-9_-]+\\.[a-z]{1,4}|go (?:test|vet) [^ \\n]+)\\b)/g, '<span class="code-chip">$1</span>');

      // Handle expandable disclosure for "Commands & Test Output"
      if (escaped.includes("Commands &amp; Test Output:")) {
        const parts = escaped.split("Commands &amp; Test Output:");
        const intro = parts[0];
        const details = parts[1] || "";
        return intro + \`
          <details class="mt-2 text-xs">
            <summary class="cursor-pointer text-[var(--primary,#8ab4f8)] hover:underline font-medium select-none flex items-center gap-1">
              <span>Commands &amp; Test Output</span>
            </summary>
            <div class="mt-1 pl-3 py-1 border-l-2 border-[var(--border,#2e3135)] text-[var(--muted-foreground,#9ca3af)] space-y-1 font-mono text-[11px]">
              \${details.trim().split('\\n').map(l => '<div>' + l + '</div>').join('')}
            </div>
          </details>
        \`;
      }

      // Handle line breaks
      escaped = escaped.replace(/\\n/g, '<br/>');

      return escaped;
    }

    function switchTab(tab) {
      activeTab = tab;
      document.querySelectorAll(".tab-btn").forEach(el => el.classList.remove("active"));
      document.getElementById("tab-" + tab).classList.add("active");

      document.getElementById("view-board").classList.add("hidden");
      document.getElementById("view-members").classList.add("hidden");
      document.getElementById("view-graph").classList.add("hidden");

      document.getElementById("view-" + tab).classList.remove("hidden");

      const searchContainer = document.getElementById("search-container");
      if (tab === "graph") {
        searchContainer.classList.add("hidden");
        renderGraph();
      } else {
        searchContainer.classList.remove("hidden");
        if (tab === "board") renderBoard();
        if (tab === "members") renderMembers();
      }
    }

    function renderBoard() {
      const container = document.getElementById("messages-list");
      const emptyState = document.getElementById("board-empty");
      container.innerHTML = "";

      const query = filterQuery.toLowerCase().trim();
      const messages = (swarmData.messages || []).filter(msg => {
        if (!query) return true;
        const textMatch = (msg.text || "").toLowerCase().includes(query);
        const fromMatch = (msg.from || "").toLowerCase().includes(query.replace("@", ""));
        const toMatch = (msg.to || []).some(t => t.toLowerCase().includes(query));
        return textMatch || fromMatch || toMatch;
      });

      document.getElementById("board-count-pill").textContent = (swarmData.messages || []).length;

      if (messages.length === 0) {
        emptyState.classList.remove("hidden");
        return;
      }
      emptyState.classList.add("hidden");

      messages.forEach(msg => {
        const item = document.createElement("div");
        item.className = "flex items-start gap-3 text-xs leading-relaxed group";

        // Left Avatar matching Antigravity multi-agent colored "an" badge
        const avatar = document.createElement("div");
        const avatarColorMap = {
          coordinator: "bg-[#f59e0b]/20 text-[#fbbf24] border border-[#f59e0b]/40",
          stats: "bg-[#a855f7]/20 text-[#c084fc] border border-[#a855f7]/40",
          dedupe: "bg-[#10b981]/20 text-[#34d399] border border-[#10b981]/40",
          verifier: "bg-[#3b82f6]/20 text-[#60a5fa] border border-[#3b82f6]/40",
          monitor: "bg-[#ec4899]/20 text-[#f472b6] border border-[#ec4899]/40",
        };
        const colorClass = avatarColorMap[msg.from] || "bg-[rgba(255,255,255,0.08)] text-[var(--muted-foreground,#8e9196)] border border-white/10";
        avatar.className = \`w-6 h-6 rounded-full \${colorClass} flex items-center justify-center font-medium text-[10px] shrink-0 mt-0.5\`;
        avatar.textContent = "an";

        // Right Content
        const content = document.createElement("div");
        content.className = "flex-1 min-w-0";

        // Header Line: @sender → @targets ... #seq · time
        const header = document.createElement("div");
        header.className = "flex items-center justify-between gap-2 pb-1 text-[11px]";

        const targets = Array.isArray(msg.to) && msg.to.length > 0 ? msg.to.join(" ") : "";
        const targetsHtml = targets
          ? ' <span class="text-[var(--muted-foreground,#8e9196)] font-normal">→</span> <span class="text-[var(--foreground,#e3e3e3)] font-medium">' + escapeHtml(targets) + '</span>'
          : '';

        header.innerHTML = \`
          <div class="truncate">
            <span class="font-semibold text-[var(--foreground,#f1f5f9)]">@\${escapeHtml(msg.from)}</span>\${targetsHtml}
          </div>
          <div class="text-[var(--muted-foreground,#8e9196)] shrink-0 font-mono text-[11px]">
            #\${msg.seq} · \${msg.time || "now"}
          </div>
        \`;

        // Body Text
        const body = document.createElement("div");
        body.className = "text-[var(--foreground,#d1d5db)] text-xs break-words";
        body.innerHTML = formatMessageText(msg.text);

        content.appendChild(header);
        content.appendChild(body);
        item.appendChild(avatar);
        item.appendChild(content);
        container.appendChild(item);
      });
    }

    function renderMembers() {
      const container = document.getElementById("members-list");
      container.innerHTML = "";

      const query = filterQuery.toLowerCase().trim();
      const members = (swarmData.members || []).filter(m => {
        if (!query) return true;
        return m.name.toLowerCase().includes(query.replace("@", "")) ||
               m.role.toLowerCase().includes(query) ||
               (m.brief || "").toLowerCase().includes(query);
      });

      document.getElementById("members-count-pill").textContent = (swarmData.members || []).length;

      members.forEach(member => {
        const card = document.createElement("div");
        card.className = "p-3 rounded-lg bg-[var(--card,#1e1f20)] border border-[var(--card-border,#2e3135)] text-xs flex flex-col gap-2 transition hover:border-[#444746]";

        let statusColor = "bg-[var(--success,#81c995)]";
        let statusText = "Working";
        if (member.status === "waiting") {
          statusColor = "bg-[var(--warning,#fdd663)]";
          statusText = "Standing By";
        } else if (member.status === "completed" || member.status === "killed") {
          statusColor = "bg-[var(--muted-foreground,#8e9196)]";
          statusText = member.status === "completed" ? "Done" : "Retired";
        }

        const files = (member.targetFiles || []).map(f => '<span class="code-chip">' + escapeHtml(f) + '</span>').join(" ");

        card.innerHTML = \`
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full \${statusColor}"></span>
              <span class="font-semibold text-[var(--foreground,#ffffff)]">@\${escapeHtml(member.name)}</span>
              <span class="text-[11px] text-[var(--muted-foreground,#8e9196)]">(\${escapeHtml(member.role)})</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="text-[10px] font-mono px-2 py-0.5 rounded bg-[rgba(255,255,255,0.06)] text-[var(--primary,#8ab4f8)]">
                \${escapeHtml(member.model || "Gemini 4 Carbon")}
              </span>
            </div>
          </div>
          <div class="text-[var(--foreground,#d1d5db)] text-[11px] leading-relaxed">
            \${escapeHtml(member.brief || member.taskSpec || "No task spec provided")}
          </div>
          \${files ? '<div class="flex items-center gap-1.5 flex-wrap pt-1">' + files + '</div>' : ''}
          <div class="flex items-center justify-between text-[10px] text-[var(--muted-foreground,#8e9196)] pt-1 border-t border-[rgba(255,255,255,0.05)]">
            <span>\${member.poeticVerb || statusText}</span>
            <span class="font-mono">\${member.tokens ? member.tokens.toLocaleString() + ' tok' : ''} \${member.tokPerSec ? '· ' + member.tokPerSec + ' tok/s' : ''}</span>
          </div>
        \`;

        container.appendChild(card);
      });
    }

    function renderGraph() {
      const edgesGroup = document.getElementById("dag-edges");
      const nodesGroup = document.getElementById("dag-nodes");
      const timelineGroup = document.getElementById("timeline-flow");

      edgesGroup.innerHTML = "";
      nodesGroup.innerHTML = "";
      timelineGroup.innerHTML = "";

      // Layout geometry for the 5 agents
      const positions = {
        coordinator: { x: 300, y: 50, label: "@coordinator", role: "Queen Bee 👑", color: "#8ab4f8" },
        stats: { x: 120, y: 180, label: "@stats", role: "Stats Author", color: "#81c995" },
        dedupe: { x: 300, y: 180, label: "@dedupe", role: "Dedupe Author", color: "#81c995" },
        verifier: { x: 210, y: 300, label: "@verifier", role: "Verifier", color: "#fdd663" },
        monitor: { x: 480, y: 180, label: "@monitor", role: "Watchdog", color: "#f28b82" }
      };

      // Draw edges
      const links = [
        { from: "coordinator", to: "stats" },
        { from: "coordinator", to: "dedupe" },
        { from: "coordinator", to: "verifier" },
        { from: "coordinator", to: "monitor" },
        { from: "stats", to: "verifier" },
        { from: "dedupe", to: "verifier" }
      ];

      links.forEach(link => {
        const p1 = positions[link.from];
        const p2 = positions[link.to];
        if (!p1 || !p2) return;

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const dx = p2.x - p1.x;
        const dy = p2.y - p1.y;
        const cx1 = p1.x + dx * 0.2;
        const cy1 = p1.y + dy * 0.8;
        const cx2 = p1.x + dx * 0.8;
        const cy2 = p1.y + dy * 0.2;

        path.setAttribute("d", \`M \${p1.x} \${p1.y} C \${cx1} \${cy1}, \${cx2} \${cy2}, \${p2.x} \${p2.y}\`);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", "#374151");
        path.setAttribute("stroke-width", "2");
        path.setAttribute("stroke-dasharray", "4 4");
        path.setAttribute("marker-end", "url(#arrow)");
        edgesGroup.appendChild(path);
      });

      // Draw nodes
      Object.entries(positions).forEach(([key, pos]) => {
        const g = document.createElementNS("http://www.w3.org/2000/svg", "g");
        g.setAttribute("class", "cursor-pointer");
        g.onclick = () => {
          filterQuery = pos.label;
          document.getElementById("search-input").value = pos.label;
          switchTab("board");
        };

        const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        circle.setAttribute("cx", pos.x);
        circle.setAttribute("cy", pos.y);
        circle.setAttribute("r", "20");
        circle.setAttribute("fill", "#1e1f20");
        circle.setAttribute("stroke", pos.color);
        circle.setAttribute("stroke-width", "2.5");

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", pos.x);
        text.setAttribute("y", pos.y + 4);
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("fill", "#f3f4f6");
        text.setAttribute("font-size", "10");
        text.setAttribute("font-weight", "bold");
        text.textContent = key === "coordinator" ? "👑" : key.slice(0, 2).toUpperCase();

        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        label.setAttribute("x", pos.x);
        label.setAttribute("y", pos.y + 34);
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("fill", "#9ca3af");
        label.setAttribute("font-size", "11");
        label.setAttribute("font-weight", "500");
        label.textContent = pos.label;

        g.appendChild(circle);
        g.appendChild(text);
        g.appendChild(label);
        nodesGroup.appendChild(g);
      });

      // Render interactions timeline
      (swarmData.messages || []).forEach(msg => {
        const item = document.createElement("div");
        item.className = "flex items-center justify-between py-1 border-b border-[rgba(255,255,255,0.03)]";
        const targets = Array.isArray(msg.to) ? msg.to.join(", ") : "all";
        item.innerHTML = \`
          <span class="text-[var(--foreground,#e3e3e3)]">#\${msg.seq} · @\${msg.from} → \${escapeHtml(targets)}</span>
          <span class="text-[var(--muted-foreground,#8e9196)]">\${msg.time || "2:24 PM"}</span>
        \`;
        timelineGroup.appendChild(item);
      });
    }

    function applyFilter(query) {
      filterQuery = query;
      document.getElementById("search-input").value = query;
      if (activeTab === "board") renderBoard();
      if (activeTab === "members") renderMembers();
    }

    function quickPostMessage() {
      const input = document.getElementById("quick-post-input");
      const text = input.value.trim();
      if (!text) return;

      const mentions = [];
      const match = text.match(/@([a-zA-Z0-9_-]+)/g);
      if (match) mentions.push(...match);

      const newMsg = {
        seq: (swarmData.messages.length + 1),
        from: "coordinator",
        to: mentions.length > 0 ? mentions : undefined,
        channel: "main",
        text: text,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        timestamp: Date.now()
      };

      swarmData.messages.push(newMsg);
      input.value = "";
      renderBoard();
      document.getElementById("board-count-pill").textContent = swarmData.messages.length;

      // Send to server if liveEndpoint is active
      if (liveEndpoint) {
        fetch(liveEndpoint + "/api/post", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, from: "coordinator" })
        }).catch(err => console.error("Post error:", err));
      }
    }

    // Event Listeners
    document.getElementById("search-input").addEventListener("input", (e) => {
      filterQuery = e.target.value;
      if (activeTab === "board") renderBoard();
      if (activeTab === "members") renderMembers();
    });

    document.getElementById("filter-btn").addEventListener("click", () => {
      document.getElementById("filter-chips").classList.toggle("hidden");
    });

    document.getElementById("refresh-btn").addEventListener("click", () => {
      if (liveEndpoint) {
        fetch(liveEndpoint + "/api/data")
          .then(res => res.json())
          .then(data => {
            swarmData = data;
            document.getElementById("swarm-title").textContent = data.title;
            if (activeTab === "board") renderBoard();
            if (activeTab === "members") renderMembers();
            if (activeTab === "graph") renderGraph();
          })
          .catch(err => console.error("Refresh error:", err));
      } else {
        renderBoard();
      }
    });

    // Initial render
    renderBoard();
  </script>
</body>
</html>
`;
}

/**
 * Loads current live SwarmBoardData from .swarm/state.json and .swarm/board.jsonl.
 * If workspace is uninitialized or empty, falls back to the canonical sample board data.
 */
export async function loadSwarmBoardData(cwd?: string): Promise<SwarmBoardData> {
  const swarmDir = getSwarmDir(cwd);
  let state: SwarmState | undefined;
  let messages: BoardMessage[] = [];

  try {
    state = await readState(swarmDir);
  } catch {}

  try {
    messages = await readBoardMessages(swarmDir);
  } catch {}

  if (!state && messages.length === 0) {
    return getSampleSwarmBoardData();
  }

  const members: SwarmBoardMember[] = [];

  // Always include coordinator
  members.push({
    id: "coordinator",
    name: "coordinator",
    role: "Coordinator 👑",
    status: "working",
    model: state?.leaderModel || "Gemini 4 Carbon",
    brief: state?.mission || "Swarm coordinator",
  });

  if (state?.agents) {
    for (const [id, agent] of Object.entries(state.agents)) {
      let status: SwarmBoardMember["status"] = "working";
      if (agent.status === "waiting") status = "waiting";
      else if (agent.status === "completed") status = "completed";
      else if (agent.status === "killed") status = "killed";
      else if (agent.status === "failed") status = "failed";
      else if (agent.status === "pending") status = "pending";

      members.push({
        id,
        name: agent.name || id,
        role: agent.role || "worker",
        status,
        model: agent.model || "Gemini 3.8 Flash",
        targetFiles: agent.targetFiles,
        taskSpec: agent.taskSpec,
        brief: agent.brief || agent.taskSpec,
        dependsOn: agent.dependsOn,
        tokens: agent.tokens,
        tokPerSec: agent.tokPerSec,
        poeticVerb: (agent as any).poeticVerb,
      });
    }
  }

  const title = state?.title || state?.mission || "Swarm Engine Board";

  return {
    title,
    isLive: true,
    workspacePath: cwd || process.cwd(),
    messages: messages.length > 0 ? messages : getSampleSwarmBoardData().messages,
    members: members.length > 1 ? members : getSampleSwarmBoardData().members,
    headSeq: state?.headSeq || messages.length || 4,
  };
}

/**
 * Formats structured SwarmBoardData into the exact Antigravity Terminal TUI representation.
 * Reproduces the official layout from https://antigravity.google/docs/swarm/ (Image 2).
 */
export function formatBoardTerminal(
  data: SwarmBoardData,
  options?: { selectedIndex?: number; follow?: boolean; width?: number; useColor?: boolean }
): string {
  const useColor = options?.useColor ?? true;
  const width = options?.width || (process.stdout?.columns ? Math.min(process.stdout.columns, 92) : 88);
  const follow = options?.follow ?? true;
  const messages = data.messages || [];
  const members = data.members || [];

  const defaultSel = messages.length > 0 ? messages.length - 1 : 0;
  const selIdx = options?.selectedIndex !== undefined ? Math.max(0, Math.min(options.selectedIndex, messages.length - 1)) : defaultSel;
  const selectedMsg = messages[selIdx] || { seq: 0, from: "coordinator", time: "now", text: "(no messages)" };

  const c = useColor
    ? {
        reset: "\x1b[0m",
        bold: "\x1b[1m",
        dim: "\x1b[2m",
        cyan: "\x1b[36m",
        brightCyan: "\x1b[96m",
        green: "\x1b[32m",
        brightGreen: "\x1b[92m",
        yellow: "\x1b[33m",
        white: "\x1b[37m",
        brightWhite: "\x1b[97m",
        gray: "\x1b[90m",
      }
    : {
        reset: "",
        bold: "",
        dim: "",
        cyan: "",
        brightCyan: "",
        green: "",
        brightGreen: "",
        yellow: "",
        white: "",
        brightWhite: "",
        gray: "",
      };

  const hr = c.gray + "─".repeat(width) + c.reset;
  const lines: string[] = [];

  // 1. Header Line
  const followText = follow ? c.green + "[follow: on]" + c.reset : c.gray + "[follow: off]" + c.reset;
  lines.push(
    `${c.bold}${c.brightCyan}Swarm board "${data.title}"${c.reset} ${c.gray}·${c.reset} ${c.white}${messages.length} posts${c.reset} ${c.gray}·${c.reset} ${followText}`
  );
  lines.push(hr);

  // 2. Roster Section
  const waitingCount = members.filter((m) => m.status === "waiting").length;
  const leaderModel = members[0]?.model || "Gemini 4 Carbon (Medium)";
  lines.push(
    `${c.bold}${c.white}Roster${c.reset} ${c.gray}·${c.reset} ${c.white}${members.length} members, ${waitingCount} waiting${c.reset} ${c.gray}·${c.reset} ${c.gray}all on ${leaderModel}${c.reset}`
  );

  for (const m of members) {
    let dot = `${c.green}● working${c.reset}`;
    if (m.status === "waiting") {
      dot = `${c.gray}○ waiting${c.reset}`;
    } else if (m.status === "completed" || m.status === "killed") {
      dot = `${c.gray}◌ done   ${c.reset}`;
    }
    const extra = m.id === "coordinator" ? `  ${c.gray}posted just now${c.reset}` : "";
    lines.push(`  • ${m.name.padEnd(13)} ${dot}${extra}`);
  }
  lines.push(hr);

  // 3. Posts Section
  lines.push(`${c.bold}${c.white}Posts${c.reset} ${c.gray}·${c.reset} ${c.white}${messages.length} total${c.reset}`);

  if (messages.length === 0) {
    lines.push(`  ${c.gray}(no posts on board)${c.reset}`);
  } else {
    // Show up to 10 latest or window around selected
    const startIdx = Math.max(0, Math.min(selIdx - 3, Math.max(0, messages.length - 8)));
    const endIdx = Math.min(messages.length, startIdx + 8);

    for (let i = startIdx; i < endIdx; i++) {
      const msg = messages[i];
      const isSel = i === selIdx;
      const marker = isSel ? `${c.brightCyan}>${c.reset}` : " ";
      const seqStr = `#${msg.seq}`.padEnd(3);
      const timeStr = (msg.time || "now").padEnd(5);
      const fromStr = (msg.from || "coord").padEnd(11);
      const targets = Array.isArray(msg.to) && msg.to.length > 0 ? msg.to.join(" ") : "";
      const targetStr = targets ? targets.padEnd(13) : "".padEnd(13);

      let textSnippet = (msg.text || "").replace(/\r?\n/g, " ");
      const maxSnippet = Math.max(20, width - 42);
      if (textSnippet.length > maxSnippet) {
        textSnippet = textSnippet.slice(0, maxSnippet - 3) + "...";
      }

      if (isSel) {
        lines.push(
          `${marker} ${c.brightCyan}${seqStr}${c.reset}  ${c.gray}${timeStr}${c.reset} ${c.bold}${c.white}${fromStr}${c.reset} ${c.cyan}${targetStr}${c.reset} ${c.brightWhite}${textSnippet}${c.reset}`
        );
      } else {
        lines.push(
          `${marker} ${c.gray}${seqStr}${c.reset}  ${c.gray}${timeStr}${c.reset} ${c.white}${fromStr}${c.reset} ${c.gray}${targetStr}${c.reset} ${c.gray}${textSnippet}${c.reset}`
        );
      }
    }
  }
  lines.push(hr);

  // 4. Message Detail Section
  lines.push(
    `${c.bold}${c.white}Message${c.reset} ${c.gray}·${c.reset} ${c.white}#${selectedMsg.seq} ${selectedMsg.from}${c.reset} ${c.gray}·${c.reset} ${c.gray}${selectedMsg.time || "now"}${c.reset}`
  );
  const msgBody = (selectedMsg.text || "").split("\n").map((line) => line).join("\n");
  lines.push(c.white + msgBody + c.reset);
  lines.push(hr);

  // 5. Footer & Shortcuts
  const curPos = messages.length > 0 ? selIdx + 1 : 0;
  lines.push(
    `${c.gray}Post ${curPos}/${messages.length} (seq #${selectedMsg.seq} by ${selectedMsg.from} at ${selectedMsg.time || "now"}, just now)${c.reset}`
  );
  lines.push(
    `${c.brightCyan}tab${c.reset} ${c.gray}switch pane ·${c.reset} ${c.brightCyan}enter${c.reset} ${c.gray}hide message ·${c.reset} ${c.brightCyan}space${c.reset} ${c.gray}expand ·${c.reset} ${c.brightCyan}p${c.reset} ${c.gray}filter ·${c.reset} ${c.brightCyan}f${c.reset} ${c.gray}follow ·${c.reset} ${c.brightCyan}z${c.reset} ${c.gray}zoom ·${c.reset} ${c.brightCyan}esc${c.reset} ${c.gray}back${c.reset}`
  );

  return lines.join("\n");
}

/**
 * Runs the interactive terminal TUI Swarm Board.
 */
export async function runInteractiveTerminalBoard(options?: {
  cwd?: string;
  initialFollow?: boolean;
}): Promise<void> {
  const cwd = options?.cwd || process.cwd();
  let follow = options?.initialFollow ?? true;
  let selectedIndex = -1;
  let running = true;

  const cleanup = () => {
    running = false;
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
        process.stdin.pause();
      } catch {}
    }
    process.stdout.write("\x1b[?25h\n"); // show cursor
  };

  const render = async () => {
    if (!running) return;
    const data = await loadSwarmBoardData(cwd);
    if (follow || selectedIndex === -1) {
      selectedIndex = Math.max(0, data.messages.length - 1);
    } else {
      selectedIndex = Math.max(0, Math.min(selectedIndex, data.messages.length - 1));
    }

    const output = formatBoardTerminal(data, {
      selectedIndex,
      follow,
      useColor: true,
    });

    process.stdout.write("\x1b[?25l\x1b[H\x1b[2J" + output + "\n");
  };

  await render();

  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.setEncoding("utf8");

      process.stdin.on("data", async (key: string) => {
        if (key === "\u0003" || key === "q" || key === "\u001b") {
          cleanup();
          process.exit(0);
        } else if (key === "\u001b[A" || key === "k") {
          // Arrow Up
          follow = false;
          selectedIndex = Math.max(0, selectedIndex - 1);
          await render();
        } else if (key === "\u001b[B" || key === "j") {
          // Arrow Down
          const data = await loadSwarmBoardData(cwd);
          selectedIndex = Math.min(data.messages.length - 1, selectedIndex + 1);
          if (selectedIndex === data.messages.length - 1) follow = true;
          await render();
        } else if (key === "f") {
          // Toggle follow
          follow = !follow;
          await render();
        } else if (key === "r") {
          await render();
        }
      });
    } catch {}
  }

  // Periodic poll & event listener
  const interval = setInterval(async () => {
    if (!running) {
      clearInterval(interval);
      return;
    }
    await render();
  }, 2000);

  boardEventBus.onPost(async () => {
    if (running) await render();
  });

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
}

/**
 * Starts a live HTTP web server serving the Swarm Board.
 */
export async function startBoardServer(options?: {
  port?: number;
  cwd?: string;
  open?: boolean;
}): Promise<{ server: http.Server; url: string; port: number }> {
  const port = options?.port || 3456;
  const cwd = options?.cwd || process.cwd();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === "/") {
      try {
        const data = await loadSwarmBoardData(cwd);
        const html = generateSwarmBoardHtml(data, { liveUrl: `http://localhost:${port}` });
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "text/plain" });
        res.end("Error loading board: " + (err.message || String(err)));
      }
      return;
    }

    if (url.pathname === "/api/data") {
      try {
        const data = await loadSwarmBoardData(cwd);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(data));
      } catch (err: any) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: err.message || String(err) }));
      }
      return;
    }

    if (url.pathname === "/api/post" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", async () => {
        try {
          const parsed = JSON.parse(body || "{}");
          const text = parsed.text;
          const from = parsed.from || "coordinator";
          if (!text) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Text is required" }));
            return;
          }
          const swarmDir = getSwarmDir(cwd);
          const state = await readState(swarmDir).catch(() => undefined);
          const msg = await postMessage(state || swarmDir, swarmDir, { text, from });
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, message: msg }));
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message || String(err) }));
        }
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(port, () => resolve());
    server.on("error", reject);
  });

  const finalUrl = `http://localhost:${port}`;

  if (options?.open) {
    try {
      const { exec } = await import("node:child_process");
      const openCmd = process.platform === "win32" ? "start" : process.platform === "darwin" ? "open" : "xdg-open";
      exec(`${openCmd} ${finalUrl}`).unref();
    } catch {}
  }

  return { server, url: finalUrl, port };
}

