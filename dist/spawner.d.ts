import { AgentNode, SwarmState } from "./state.js";
/**
 * Checks whether the current working directory is inside a Git repository.
 */
export declare function isGitRepo(cwd?: string): boolean;
/**
 * Checks whether the Git repository has at least one commit (HEAD exists).
 */
export declare function hasGitHead(cwd?: string): boolean;
export declare const hasHeadCommit: typeof hasGitHead;
/**
 * Formats structured task instructions, system prompts, file locks, and blackboard memory
 * into the AGENT_TASK.md task specification.
 */
/**
 * Generates dynamic agent task content customized for the active agent harness.
 */
export declare function generateAgentTaskContent(agent: AgentNode, state: SwarmState, cwd?: string): string;
/**
 * Creates an isolated working directory for an agent.
 * Uses a Git worktree (`git worktree add -B swarm/<agentId>`) if in a Git repo with commits,
 * or falls back to recursively copying workspace files if non-Git or unborn HEAD (Safeguard 3).
 * Injects AGENT_TASK.md into the worktree.
 */
export declare function createWorktree(agentOrId: string | AgentNode, stateOrCwd?: SwarmState | string, customCwd?: string): Promise<string>;
/**
 * DAG Scheduler loop evaluating pending agents in the swarm state.
 * Resolves dependencies, checks file lock collisions (normalized paths - Safeguard 4),
 * gates execution by maxConcurrency, sets agent status to running, locks files,
 * creates worktrees, and spawns background workers if configured.
 */
export declare function tickScheduler(cwd?: string): Promise<void>;
/**
 * Finalizes an agent's task:
 * 1. Cleans AGENT_TASK.md from the worktree before staging (Safeguard 2).
 * 2. In Git repos with HEAD: commits changes with --allow-empty, merges to main (--no-ff),
 *    and deletes the worktree and branch.
 * 3. In non-Git or unborn HEAD repos: copies modified files back to root workspace (Safeguard 3),
 *    and removes the worktree.
 * 4. Releases assigned file locks in state.lockedFiles.
 * 5. Updates agent status to 'completed' and records outputSummary.
 * 6. Invokes tickScheduler() to immediately advance unblocked downstream agents.
 */
export declare function mergeAndComplete(agentId: string, outputSummary?: string, cwd?: string): Promise<void>;
/**
 * Prunes all swarm worktrees and cleans temporary swarm/* branches.
 */
export declare function pruneWorktrees(cwd?: string): Promise<void>;
export interface SpawnAgentOptions {
    name: string;
    role?: string;
    brief?: string;
    taskSpec?: string;
    systemPrompt?: string;
    model?: string;
    parentId?: string;
    fork?: string;
    channels?: string[];
    targetFiles?: string[];
    dependsOn?: string[];
    workspace?: "inherit" | "share" | "branch";
    callerId?: string;
}
export interface KillAgentOptions {
    callerId?: string;
    reason?: string;
}
export interface KillAgentResult {
    success: boolean;
    target: string;
    terminated: string[];
    alreadyKilled?: boolean;
}
/**
 * Spawns or dynamically registers an agent node into the swarm state,
 * supporting hierarchical helpers (parentId/helperIds) and warm context forking (fork: "<member>").
 */
export declare function spawnAgentNode(options: SpawnAgentOptions, cwd?: string): Promise<AgentNode>;
/**
 * Recursively terminates an agent and all child helper subagents in its subtree.
 * Enforces scoped boundaries: helpers cannot kill parents or non-child siblings.
 */
export declare function cascadeKill(agentName: string, options?: KillAgentOptions, cwd?: string): Promise<KillAgentResult>;
/**
 * Runtime model hot-swapping for an agent node.
 * Rejects model changes on terminal agents (killed, completed).
 */
export declare function updateAgentModel(agentName: string, newModel: string, cwd?: string): Promise<AgentNode>;
/**
 * Attaches .on("exit") and .on("error") handlers to child process workers
 * to handle terminal status transitions and cascading cleanup.
 */
export declare function attachProcessLifecycle(child: import("node:child_process").ChildProcess, agentId: string, swarmDir: string, cwd: string): void;
