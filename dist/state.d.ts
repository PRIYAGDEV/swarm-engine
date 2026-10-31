/**
 * Status of an individual agent node in the swarm.
 */
export type AgentStatus = "pending" | "running" | "completed" | "failed";
/**
 * Represents a single agent node in the dependency execution DAG.
 */
export interface AgentNode {
    id: string;
    role: string;
    systemPrompt?: string;
    taskSpec: string;
    dependsOn: string[];
    targetFiles: string[];
    status: AgentStatus;
    worktreePath?: string;
    branchName?: string;
    pid?: number;
    outputSummary?: string;
}
/**
 * Global swarm state object persisted in .swarm/state.json.
 */
export interface SwarmState {
    mission: string;
    maxConcurrency: number;
    workerCommand?: string;
    agents: Record<string, AgentNode>;
    blackboard: Record<string, unknown>;
    lockedFiles: Record<string, string>;
}
/**
 * Strips leading './' and converts '\' to '/' to ensure file paths
 * normalize reliably across Windows and POSIX systems (Safeguard 4).
 */
export declare function normalizePath(p: string): string;
/**
 * Helper to compute the absolute path to the .swarm directory.
 */
export declare function getSwarmDir(cwd?: string): string;
/**
 * Removes .swarm/state.lock with retry to handle transient Windows file locks.
 */
export declare function releaseLock(swarmDir?: string): Promise<void>;
/**
 * Acquires a directory-based atomic lock (.swarm/state.lock) using fs.mkdir.
 * Includes jittered exponential backoff and stale lock reclamation (>30s or dead PID).
 */
export declare function acquireLock(swarmDir?: string, timeoutMs?: number): Promise<() => Promise<void>>;
/**
 * Initializes the swarm state and persists it to .swarm/state.json.
 */
export declare function initState(mission: string, maxConcurrency?: number, workerCommand?: string, swarmDir?: string): Promise<SwarmState>;
/**
 * Reads the current swarm state from .swarm/state.json.
 * Throws specific error if not initialized.
 */
export declare function readState(swarmDir?: string): Promise<SwarmState>;
/**
 * Atomically updates the swarm state using directory-based locking and safe temp-file replacement.
 */
export declare function updateState<T>(mutator: (state: SwarmState) => Promise<T> | T, swarmDir?: string): Promise<T>;
