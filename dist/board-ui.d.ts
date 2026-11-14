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
import { BoardMessage } from "./state.js";
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
export declare function getSampleSwarmBoardData(): SwarmBoardData;
/**
 * Generates the complete, self-contained HTML for the Swarm Board.
 */
export declare function generateSwarmBoardHtml(initialData: SwarmBoardData, options?: {
    liveUrl?: string;
    autoRefresh?: boolean;
}): string;
/**
 * Loads current live SwarmBoardData from .swarm/state.json and .swarm/board.jsonl.
 * If workspace is uninitialized or empty, falls back to the canonical sample board data.
 */
export declare function loadSwarmBoardData(cwd?: string): Promise<SwarmBoardData>;
/**
 * Formats structured SwarmBoardData into an ANSI terminal representation.
 */
export declare function formatBoardTerminal(data: SwarmBoardData): string;
/**
 * Starts a live HTTP web server serving the Swarm Board.
 */
export declare function startBoardServer(options?: {
    port?: number;
    cwd?: string;
    open?: boolean;
}): Promise<{
    server: http.Server;
    url: string;
    port: number;
}>;
