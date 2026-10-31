/**
 * Swarm Engine — Interactive Multi-Agent Terminal TUI (Fable-inspired Dashboard)
 *
 * Replicates the high-density visual aesthetic of Fable 5.1 by @programmergrind:
 * - Top lead orchestrator card with mission telemetry, worker models, and dispatch stream
 * - 2-column rounded card grid with embedded border headers (* agent-id ─── model/role)
 * - Real-time action stream:
 *   ● Edit(path) -> produces live +/- code diffs with line numbers (red deletions, green additions)
 *   ● Bash(command) -> displays test output ("29 passed", "built in 10.1s", "0 errors")
 *   ● Read(path) -> displays file line counts ("Read 159 lines")
 * - Dynamic agent activity ticker (Whispering, Seating, Courting, Pruning, Simmering, Shipping)
 * - Live token throughput (e.g. ": Pruning... (5s · 61 tok/s · 293)" or "● Whispering... (↓ 110.1k)")
 * - Bottom tmux/status bar ([swarm-engine] 0:agents* 1:lead ● X/N done · +add -del lines)
 */
import { type SwarmState, type AgentNode } from "./state.js";
export declare const c: {
    reset: string;
    bold: string;
    dim: string;
    italic: string;
    underline: string;
    inverse: string;
    black: string;
    red: string;
    green: string;
    yellow: string;
    blue: string;
    magenta: string;
    cyan: string;
    white: string;
    gray: string;
    brightRed: string;
    brightGreen: string;
    brightYellow: string;
    brightBlue: string;
    brightMagenta: string;
    brightCyan: string;
    brightWhite: string;
    bgBlack: string;
    bgRed: string;
    bgGreen: string;
    bgYellow: string;
    bgBlue: string;
    bgMagenta: string;
    bgCyan: string;
    bgDarkGray: string;
};
/**
 * Strips ANSI codes to accurately measure printed visual string lengths.
 */
export declare function stripAnsi(str: string): string;
/**
 * Formats a duration in milliseconds to human-readable "Xh Ym Zs" or "Xs".
 */
export declare function formatDuration(ms: number): string;
/**
 * Formats token counts nicely (e.g., 142000 -> "142.0k", 1250000 -> "1.25M").
 */
export declare function formatTokens(num: number): string;
export interface WorktreeTelemetry {
    changedFilesCount: number;
    additions: number;
    deletions: number;
    modifiedFiles: string[];
    diffSnippets: {
        type: "add" | "del";
        line: string;
        lineNo?: number;
    }[];
    recentAction: string;
    subDetail: string;
    taskSnippet?: string;
    estimatedTokens: number;
}
/**
 * Inspects a worktree directory to extract real-time git diff statistics,
 * actual +/- code diff lines, and active agent operations.
 */
export declare function inspectWorktree(worktreePath?: string): WorktreeTelemetry;
/**
 * Renders a single Fable-style agent card matching Image 1 & Image 2:
 * ╭ * opus-1 ─────────────────────── claude opus ╮
 * │   └ Read 159 lines                            │
 * │ ● Update(scene/candles.ts)                    │
 * │   + glow = 0.8                                │
 * │ ● Whispering... (↓ 110.1k)                    │
 * ╰───────────────────────────────────────────────╯
 */
export declare function renderAgentCard(agent: AgentNode, width: number, telemetry: WorktreeTelemetry, index: number, sessionStartTime: number): string[];
/**
 * Main dashboard render function. Generates the exact Fable 5.1 layout.
 */
export declare function renderDashboard(state: SwarmState, cwd?: string, startTime?: number): Promise<string>;
