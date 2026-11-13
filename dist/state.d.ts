/**
 * Status of an individual agent node in the swarm.
 * Expanded to include Antigravity's native lifecycle states.
 */
export type AgentStatus = "pending" | "running" | "waiting" | "working" | "stopped" | "completed" | "failed" | "killed";
/**
 * Single line diff item (green insertion or red deletion).
 */
export interface AgentDiffItem {
    type: "add" | "del";
    line: string;
    lineNo?: number;
}
/**
 * Concrete tool action executed by an agent in its worktree (Edit, Read, Bash, etc.).
 */
export interface AgentAction {
    type: "edit" | "read" | "bash" | "update" | "delete" | "status";
    target: string;
    detail?: string;
    diffs?: AgentDiffItem[];
    timestamp: number;
}
/**
 * Channel lifecycle operation embedded within a board control message.
 */
export interface BoardMessageControl {
    op: "create" | "subscribe" | "unsubscribe" | "archive";
    channel: string;
    topic?: string;
    members?: string[];
    prev?: Record<string, string[]>;
    next?: Record<string, string[]>;
}
/**
 * Immutable sequence-numbered message logged to the shared message board.
 */
export interface BoardMessage {
    /** Monotonically increasing sequence number (#1, #2, #3, ...) */
    seq: number;
    /** Identifier of the message author (e.g. "coordinator", "parser", "monitor", "system") */
    from: string;
    /** Parsed mention tokens (e.g. ["@coordinator", "@all", "@#ui", "parser"]) */
    to?: string[];
    /** Channel name where this message was posted (defaults to "main") */
    channel: string;
    /** Message text content */
    text: string;
    /** Epoch millisecond timestamp when the message was posted */
    timestamp: number;
    /** Optional channel control payload for channel management operations */
    control?: BoardMessageControl;
    /** Compatibility alias for from (used in Antigravity transcripts) */
    agent?: string;
    /** Optional ISO 8601 formatted string timestamp */
    time?: string;
}
/**
 * Metadata definition for a partitioned topic channel.
 */
export interface ChannelMeta {
    /** Channel name (slug matching /^[a-z][a-z0-9-]{0,23}$/, e.g. "main", "parser", "ui") */
    name: string;
    /** Optional descriptive purpose or topic of the channel */
    topic?: string;
    /** Identifier of the agent or system that created the channel */
    createdBy: string;
    /** Epoch timestamp when the channel was created */
    createdAt: number;
    /** Whether the channel has been archived (archived channels are read-only and wake nobody) */
    archived?: boolean;
    /** List of agent IDs subscribed to this channel. Coordinator/narrator/monitor use ["*"] */
    subscribers: string[];
}
/**
 * Represents a single agent node in the dependency execution DAG.
 */
export interface AgentNode {
    id: string;
    role: string;
    model?: string;
    systemPrompt?: string;
    taskSpec: string;
    dependsOn: string[];
    targetFiles: string[];
    status: AgentStatus;
    worktreePath?: string;
    branchName?: string;
    pid?: number;
    outputSummary?: string;
    actions?: AgentAction[];
    tokens?: number;
    tokPerSec?: number;
    thought?: string;
    verb?: string;
    startedAt?: number;
    completedAt?: number;
    channels?: string[];
    wakeMode?: "mentions" | "all" | "none";
    waitSince?: number;
    lastReadSeq?: number;
    lastPostSeq?: number;
    lastPostTime?: number;
    parentId?: string;
    helperIds?: string[];
    workspace?: "inherit" | "share" | "branch";
}
/**
 * Global swarm state object persisted in .swarm/state.json.
 */
export interface SwarmState {
    mission: string;
    leaderModel?: string;
    maxConcurrency?: number;
    workerCommand?: string;
    parallel?: boolean;
    strictDependencies?: boolean;
    agents: Record<string, AgentNode>;
    blackboard: Record<string, unknown>;
    lockedFiles: Record<string, string>;
    headSeq?: number;
    channels?: Record<string, ChannelMeta>;
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
 * Helper to compute the absolute path to .swarm/board.jsonl.
 */
export declare function getBoardPath(swarmDir?: string): string;
/**
 * Scans .swarm/board.jsonl to find the highest message sequence number.
 * Safely handles missing files, empty files, and torn JSON lines.
 */
export declare function getHighestSeqFromBoard(swarmDir?: string): Promise<number>;
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
export declare function initState(mission: string, maxConcurrency?: number, workerCommand?: string, swarmDir?: string, leaderModel?: string, parallel?: boolean, strictDependencies?: boolean): Promise<SwarmState>;
/**
 * Ensures swarm state is initialized, using double-checked locking to prevent
 * concurrency races when multiple uninitialized callers arrive simultaneously.
 */
export declare function ensureState(swarmDir?: string): Promise<SwarmState>;
/**
 * Reads the current swarm state from .swarm/state.json.
 * Automatically normalizes legacy state files for seamless backward compatibility.
 */
export declare function readState(swarmDir?: string): Promise<SwarmState>;
/**
 * Atomically updates the swarm state using directory-based locking and safe temp-file replacement.
 */
export declare function updateState<T>(mutator: (state: SwarmState) => Promise<T> | T, swarmDir?: string): Promise<T>;
/**
 * Records a real-time tool action (Edit, Read, Bash, Update) executed by an agent.
 */
export declare function recordAgentAction(agentId: string, action: Omit<AgentAction, "timestamp"> & {
    timestamp?: number;
}, swarmDir?: string): Promise<void>;
/**
 * Updates an agent's real-time telemetry (tokens, speed, verb, thought).
 */
export declare function updateAgentProgress(agentId: string, progress: {
    thought?: string;
    verb?: string;
    tokens?: number;
    tokPerSec?: number;
}, swarmDir?: string): Promise<void>;
/**
 * Updates an agent's message board cursor tracking fields (lastReadSeq, waitSince, wakeMode, channels).
 */
export declare function updateAgentCursor(agentId: string, cursor: {
    lastReadSeq?: number;
    waitSince?: number;
    wakeMode?: "mentions" | "all" | "none";
    channels?: string[];
    lastPostSeq?: number;
    lastPostTime?: number;
    status?: AgentStatus;
}, swarmDir?: string): Promise<void>;
/**
 * Ensures a channel exists in the state metadata, creating it if not present.
 */
export declare function ensureChannel(name: string, topic?: string, createdBy?: string, swarmDir?: string): Promise<ChannelMeta>;
export interface ChannelSummary {
    name: string;
    channel: string;
    topic: string;
    createdBy: string;
    createdAt: number;
    archived: boolean;
    subscriberCount: number;
    subscribers: string[];
}
/**
 * Returns a deduplicated list of channel summaries for display or MCP tool output.
 * Ensures 'main' is always present at index 0 and no channel is duplicated.
 */
export declare function getDeduplicatedChannelList(state: SwarmState): ChannelSummary[];
