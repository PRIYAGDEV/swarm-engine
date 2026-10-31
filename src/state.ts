import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Status of an individual agent node in the swarm.
 */
export type AgentStatus = "pending" | "running" | "completed" | "failed";

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
}

/**
 * Global swarm state object persisted in .swarm/state.json.
 */
export interface SwarmState {
  mission: string;
  leaderModel?: string;
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
export function normalizePath(p: string): string {
  if (!p) return "";
  let normalized = p.trim().replace(/\\/g, "/");
  normalized = normalized.replace(/^(\.\/)+/, "");
  if (normalized !== "/") {
    normalized = normalized.replace(/\/+$/, "");
  }
  return normalized;
}

/**
 * Helper to compute the absolute path to the .swarm directory.
 */
export function getSwarmDir(cwd: string = process.cwd()): string {
  return path.resolve(cwd, ".swarm");
}

/**
 * Removes .swarm/state.lock with retry to handle transient Windows file locks.
 */
export async function releaseLock(swarmDir?: string): Promise<void> {
  const dir = swarmDir || getSwarmDir();
  const lockPath = path.join(dir, "state.lock");

  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      await fs.rm(lockPath, { recursive: true, force: true });
      return;
    } catch (err) {
      if (attempt === 4) {
        console.error(`[swarm-engine] Failed to release lock at ${lockPath}:`, err);
        return;
      }
      await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
    }
  }
}

/**
 * Acquires a directory-based atomic lock (.swarm/state.lock) using fs.mkdir.
 * Includes jittered exponential backoff and stale lock reclamation (>30s or dead PID).
 */
export async function acquireLock(
  swarmDir?: string,
  timeoutMs: number = 10000
): Promise<() => Promise<void>> {
  const dir = swarmDir || getSwarmDir();
  const lockPath = path.join(dir, "state.lock");
  const startTime = Date.now();
  let delay = 10;

  // Ensure parent .swarm directory exists
  await fs.mkdir(dir, { recursive: true });

  while (Date.now() - startTime < timeoutMs) {
    try {
      await fs.mkdir(lockPath);

      // Lock acquired. Record owner metadata (both pid file and owner.json)
      try {
        await fs.writeFile(path.join(lockPath, "pid"), process.pid.toString(), "utf8");
        await fs.writeFile(
          path.join(lockPath, "owner.json"),
          JSON.stringify({ pid: process.pid, timestamp: Date.now() }),
          "utf8"
        );
      } catch (writeErr) {
        await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
        throw writeErr;
      }

      return async () => {
        await releaseLock(dir);
      };
    } catch (err: any) {
      if (err.code === "EEXIST" || err.code === "EPERM" || err.code === "EACCES") {
        // Collision: check for stale lock
        try {
          let lockPid: number | undefined;
          let lockTimestamp: number | undefined;

          // 1. Check owner.json
          try {
            const ownerPath = path.join(lockPath, "owner.json");
            const rawOwner = await fs.readFile(ownerPath, "utf8");
            const ownerData = JSON.parse(rawOwner);
            if (typeof ownerData.pid === "number") lockPid = ownerData.pid;
            if (typeof ownerData.timestamp === "number") lockTimestamp = ownerData.timestamp;
          } catch {
            // owner.json missing or invalid
          }

          // 2. Check pid file
          if (lockPid === undefined) {
            try {
              const pidPath = path.join(lockPath, "pid");
              const rawPid = await fs.readFile(pidPath, "utf8");
              const parsedPid = parseInt(rawPid.trim(), 10);
              if (!isNaN(parsedPid)) lockPid = parsedPid;
            } catch {
              // pid file missing
            }
          }

          // 3. Stat directory for mtime
          let mtimeMs = 0;
          try {
            const stat = await fs.stat(lockPath);
            mtimeMs = stat.mtimeMs;
          } catch {
            // Stat failed (directory may have been removed concurrently)
          }

          const now = Date.now();
          const age = lockTimestamp ? now - lockTimestamp : (mtimeMs ? now - mtimeMs : 0);

          let isProcessDead = false;
          if (lockPid !== undefined) {
            try {
              process.kill(lockPid, 0);
            } catch (killErr: any) {
              if (killErr.code === "ESRCH") {
                isProcessDead = true;
              }
            }
          }

          const isStale = age > 30000 || isProcessDead;
          if (isStale) {
            console.error(
              `[swarm-engine] Reclaiming stale lock at ${lockPath} (pid: ${lockPid}, age: ${age}ms, dead: ${isProcessDead})`
            );
            await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
            continue;
          }
        } catch {
          // If stale inspection fails, fall through to backoff
        }

        // Exponential backoff with random jitter (10ms to 100ms)
        const jitter = Math.floor(Math.random() * 15);
        const sleepTime = Math.min(100, Math.max(10, delay + jitter));
        await new Promise((resolve) => setTimeout(resolve, sleepTime));
        delay = Math.min(100, delay * 2);
      } else {
        throw err;
      }
    }
  }

  throw new Error(`Failed to acquire state lock within ${timeoutMs}ms at ${lockPath}`);
}

/**
 * Initializes the swarm state and persists it to .swarm/state.json.
 */
export async function initState(
  mission: string,
  maxConcurrency: number = 4,
  workerCommand?: string,
  swarmDir?: string,
  leaderModel?: string
): Promise<SwarmState> {
  const dir = swarmDir || getSwarmDir();
  await fs.mkdir(dir, { recursive: true });

  const initialState: SwarmState = {
    mission,
    leaderModel: leaderModel || process.env.SWARM_LEADER_MODEL || undefined,
    maxConcurrency,
    workerCommand,
    agents: {},
    blackboard: {},
    lockedFiles: {},
  };

  await acquireLock(dir);
  try {
    const statePath = path.join(dir, "state.json");
    const tmpId = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
    const tmpPath = path.join(dir, `state.json.tmp.${tmpId}`);

    await fs.writeFile(tmpPath, JSON.stringify(initialState, null, 2), "utf8");

    let renamed = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.rename(tmpPath, statePath);
        renamed = true;
        break;
      } catch (renameErr) {
        if (attempt === 4) throw renameErr;
        await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
      }
    }

    return initialState;
  } finally {
    await releaseLock(dir);
  }
}

/**
 * Reads the current swarm state from .swarm/state.json.
 * Throws specific error if not initialized.
 */
export async function readState(swarmDir?: string): Promise<SwarmState> {
  const dir = swarmDir || getSwarmDir();
  const statePath = path.join(dir, "state.json");
  try {
    const content = await fs.readFile(statePath, "utf8");
    return JSON.parse(content) as SwarmState;
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(
        "Swarm state has not been initialized. Run 'swarm-engine init' or 'spawn_swarm' first."
      );
    }
    throw err;
  }
}

/**
 * Atomically updates the swarm state using directory-based locking and safe temp-file replacement.
 */
export async function updateState<T>(
  mutator: (state: SwarmState) => Promise<T> | T,
  swarmDir?: string
): Promise<T> {
  const dir = swarmDir || getSwarmDir();
  await acquireLock(dir);
  try {
    const state = await readState(dir);
    const result = await mutator(state);

    const statePath = path.join(dir, "state.json");
    const tmpId = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
    const tmpPath = path.join(dir, `state.json.tmp.${tmpId}`);

    await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), "utf8");

    let renamed = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.rename(tmpPath, statePath);
        renamed = true;
        break;
      } catch (renameErr) {
        if (attempt === 4) throw renameErr;
        await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
      }
    }

    return result;
  } finally {
    await releaseLock(dir);
  }
}

/**
 * Records a real-time tool action (Edit, Read, Bash, Update) executed by an agent.
 */
export async function recordAgentAction(
  agentId: string,
  action: Omit<AgentAction, "timestamp"> & { timestamp?: number },
  swarmDir?: string
): Promise<void> {
  const dir = swarmDir || getSwarmDir();
  await updateState((state) => {
    const agent = state.agents[agentId];
    if (!agent) return;
    if (!agent.actions) agent.actions = [];
    agent.actions.push({
      ...action,
      timestamp: action.timestamp || Date.now(),
    });
    // Retain the last 15 actions to keep state concise
    if (agent.actions.length > 15) {
      agent.actions = agent.actions.slice(-15);
    }
  }, dir);
}

/**
 * Updates an agent's real-time telemetry (tokens, speed, verb, thought).
 */
export async function updateAgentProgress(
  agentId: string,
  progress: {
    thought?: string;
    verb?: string;
    tokens?: number;
    tokPerSec?: number;
  },
  swarmDir?: string
): Promise<void> {
  const dir = swarmDir || getSwarmDir();
  await updateState((state) => {
    const agent = state.agents[agentId];
    if (!agent) return;
    if (progress.thought !== undefined) agent.thought = progress.thought;
    if (progress.verb !== undefined) agent.verb = progress.verb;
    if (progress.tokens !== undefined) agent.tokens = progress.tokens;
    if (progress.tokPerSec !== undefined) agent.tokPerSec = progress.tokPerSec;
  }, dir);
}


