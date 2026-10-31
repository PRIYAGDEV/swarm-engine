/**
 * Swarm Engine — Autonomous Multi-Agent Worker Runner
 *
 * Implements the live agent execution loop matching Fable 5.1:
 * - Executes tool calls inside the agent's isolated worktree:
 *   ● Edit(path) -> produces live +/- code diffs with line numbers
 *   ● Bash(command) -> runs shell commands, captures test output ("29 passed", "built in 10.1s")
 *   ● Read(path) -> reads target files ("Read 159 lines")
 * - Streams live action logs and token telemetry to the Fable TUI dashboard
 * - Connects to Ollama (qwen3-coder, llama3.1, gemma3) or API providers when available,
 *   with an autonomous task execution engine for local/offline environments
 * - Upon completion, automatically merges worktree and unblocks downstream DAG agents
 */
export interface WorkerRunOptions {
    cwd?: string;
    maxTurns?: number;
    provider?: "ollama" | "api" | "auto";
}
/**
 * Executes a Read tool call in the worktree.
 */
export declare function executeRead(worktreePath: string, filePath: string, agentId: string, swarmDir?: string): Promise<{
    content: string;
    lineCount: number;
}>;
/**
 * Executes an Edit / Update tool call in the worktree and captures real diffs.
 */
export declare function executeEdit(worktreePath: string, filePath: string, newContent: string, agentId: string, swarmDir?: string): Promise<{
    success: boolean;
    additions: number;
    deletions: number;
}>;
/**
 * Executes a Bash tool call in the worktree (e.g. npm test, tsc, rm).
 */
export declare function executeBash(worktreePath: string, command: string, agentId: string, swarmDir?: string): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
}>;
/**
 * Runs an autonomous worker loop for a specific agent.
 */
export declare function runAgentWorker(agentId: string, cwd?: string, options?: WorkerRunOptions): Promise<void>;
/**
 * Runs all active agents in a swarm concurrently up to maxConcurrency.
 */
export declare function runSwarmLoop(cwd?: string, onProgress?: () => void): Promise<void>;
