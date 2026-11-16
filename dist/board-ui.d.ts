/**
 * Swarm Board UI Generator
 *
 * Generates an interactive, responsive HTML UI and Terminal TUI matching Google Antigravity
 * & Teamwork Swarm split-view side pane and wide dashboard.
 *
 * Key Optimizations & Usability Features:
 * - 100% Dynamic & Universal: Auto-adapts to ANY swarm, ANY number of workers, and ANY task
 * - Dynamic SVG Topology DAG: Computes node coordinates, directed communication links, and active pulses
 * - Dynamic Filter Chips: Automatically generated from active swarm member roster
 * - Dynamic Avatar Colors: Deterministic vibrant color hashing across 8 palette families
 * - 3 Primary Tabs: Board <count>, Members <count>, Graph
 * - Live status indicator (● Live) with animated pulse
 * - Clickable Cross-Reference Links (ref #1, ref #5, #6) that smooth-scroll and highlight target posts
 * - Click-to-copy file path & command chips with instant floating toast confirmations
 * - One-click "Export PR Markdown Report" compiling verification passes, diffs, and audit trail
 * - Density Switcher (Comfortable vs Compact) and Width Switcher (Side-Pane vs Wide Canvas)
 * - Interactive Timeline Scrubber in the Graph view with step-by-step node/edge illumination & playback
 * - Direct member card quick-actions ("💬 Message @agent") prefilling composer
 * - Complete Terminal TUI viewer with keyboard navigation (j/k, p, c, f, tab, enter, esc)
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
    peakTokPerSec?: number;
    avgTokPerSec?: number;
    reasoningTokens?: number;
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
 * Returns default sample data matching the official Antigravity linkshelf swarm lifecycle.
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
 * Formats structured SwarmBoardData into the exact Antigravity Terminal TUI representation.
 * Reproduces the official layout from https://antigravity.google/docs/swarm/ (Image 2).
 */
export declare function formatBoardTerminal(data: SwarmBoardData, options?: {
    selectedIndex?: number;
    follow?: boolean;
    width?: number;
    useColor?: boolean;
    filter?: string;
}): string;
/**
 * Runs the interactive terminal TUI Swarm Board.
 */
export declare function runInteractiveTerminalBoard(options?: {
    cwd?: string;
    initialFollow?: boolean;
}): Promise<void>;
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
/**
 * Formats live token generation speed and throughput metrics into an aligned terminal table.
 */
export declare function formatSpeedTable(data: SwarmBoardData, options?: {
    useColor?: boolean;
}): string;
