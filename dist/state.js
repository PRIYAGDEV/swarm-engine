import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { detectActiveModelsSync } from "./detector.js";
/**
 * Terminal statuses from which an agent cannot transition back to active work.
 */
export const TERMINAL_AGENT_STATUSES = new Set([
    "completed",
    "failed",
    "killed",
]);
export function isTerminalStatus(status) {
    return TERMINAL_AGENT_STATUSES.has(status);
}
/**
 * Permitted status transitions table.
 */
export const VALID_STATUS_TRANSITIONS = {
    pending: ["working", "running", "waiting", "stopped", "killed"],
    running: ["waiting", "working", "stopped", "completed", "failed", "killed"],
    working: ["waiting", "stopped", "completed", "failed", "killed", "running"],
    waiting: ["working", "running", "stopped", "killed", "failed"],
    stopped: ["working", "running", "killed", "failed"],
    completed: [],
    failed: [],
    killed: [],
};
/**
 * Validates whether a requested status transition is allowed.
 */
export function validateStatusTransition(currentStatus, newStatus) {
    if (currentStatus === newStatus) {
        return { valid: true };
    }
    if (isTerminalStatus(currentStatus)) {
        return {
            valid: false,
            reason: `Illegal state transition: Agent is in terminal state '${currentStatus}' and cannot transition to '${newStatus}'. Terminal states are permanent.`,
        };
    }
    const allowed = VALID_STATUS_TRANSITIONS[currentStatus];
    if (!allowed || !allowed.includes(newStatus)) {
        return {
            valid: false,
            reason: `Illegal state transition: Cannot transition agent from '${currentStatus}' to '${newStatus}'.`,
        };
    }
    return { valid: true };
}
/**
 * Strips leading './' and converts '\' to '/' to ensure file paths
 * normalize reliably across Windows and POSIX systems (Safeguard 4).
 */
export function normalizePath(p) {
    if (!p)
        return "";
    let normalized = p.trim().replace(/\\/g, "/");
    while (normalized.startsWith("../") || normalized.startsWith("./")) {
        normalized = normalized.replace(/^(\.\.?[\/\\])+/, "");
    }
    if (normalized !== "/") {
        normalized = normalized.replace(/\/+$/, "");
    }
    return normalized;
}
/**
 * Automatically ensures .git/info/exclude ignores .swarm and AGENT_TASK.md
 * so git stash -u and git status porcelain do not touch swarm internals.
 */
export async function ensureGitExclude(cwd = process.cwd()) {
    try {
        const gitDir = path.join(cwd, ".git");
        const stat = await fs.stat(gitDir).catch(() => null);
        if (!stat)
            return;
        let infoDir = path.join(gitDir, "info");
        if (!stat.isDirectory()) {
            const gitContent = await fs.readFile(gitDir, "utf8");
            const match = gitContent.match(/gitdir:\s*(.+)/);
            if (match) {
                infoDir = path.join(path.resolve(cwd, match[1].trim()), "info");
            }
            else {
                return;
            }
        }
        await fs.mkdir(infoDir, { recursive: true });
        const excludePath = path.join(infoDir, "exclude");
        let content = "";
        try {
            content = await fs.readFile(excludePath, "utf8");
        }
        catch { }
        const linesToAdd = [];
        if (!content.includes(".swarm")) {
            linesToAdd.push(".swarm", ".swarm/", ".swarm/*");
        }
        if (!content.includes("AGENT_TASK.md")) {
            linesToAdd.push("AGENT_TASK.md");
        }
        if (linesToAdd.length > 0) {
            const prefix = content.length > 0 && !content.endsWith("\n") ? "\n" : "";
            await fs.appendFile(excludePath, prefix + linesToAdd.join("\n") + "\n", "utf8");
        }
    }
    catch { }
}
/**
 * Helper to compute the absolute path to the .swarm directory.
 */
export function getSwarmDir(cwd = process.cwd()) {
    return path.resolve(cwd, ".swarm");
}
/**
 * Helper to compute the absolute path to .swarm/board.jsonl.
 */
export function getBoardPath(swarmDir) {
    return path.join(swarmDir || getSwarmDir(), "board.jsonl");
}
/**
 * Scans .swarm/board.jsonl to find the highest message sequence number.
 * Safely handles missing files, empty files, and torn JSON lines.
 */
export async function getHighestSeqFromBoard(swarmDir) {
    const boardPath = getBoardPath(swarmDir);
    try {
        const content = await fs.readFile(boardPath, "utf8");
        let maxSeq = 0;
        const lines = content.split("\n");
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed)
                continue;
            try {
                const obj = JSON.parse(trimmed);
                if (obj &&
                    typeof obj === "object" &&
                    typeof obj.seq === "number" &&
                    !isNaN(obj.seq) &&
                    obj.seq > maxSeq) {
                    maxSeq = obj.seq;
                }
            }
            catch {
                // Skip torn lines or invalid JSON fragments
            }
        }
        return maxSeq;
    }
    catch {
        return 0;
    }
}
/**
 * Removes .swarm/state.lock with retry to handle transient Windows file locks.
 */
export async function releaseLock(swarmDir) {
    const dir = swarmDir || getSwarmDir();
    const lockPath = path.join(dir, "state.lock");
    for (let attempt = 0; attempt < 5; attempt++) {
        try {
            await fs.rm(lockPath, { recursive: true, force: true });
            return;
        }
        catch (err) {
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
export async function acquireLock(swarmDir, timeoutMs = 10000) {
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
                await fs.writeFile(path.join(lockPath, "owner.json"), JSON.stringify({ pid: process.pid, timestamp: Date.now() }), "utf8");
            }
            catch (writeErr) {
                await fs.rm(lockPath, { recursive: true, force: true }).catch(() => { });
                throw writeErr;
            }
            return async () => {
                await releaseLock(dir);
            };
        }
        catch (err) {
            if (err.code === "EEXIST" || err.code === "EPERM" || err.code === "EACCES") {
                // Collision: check for stale lock
                try {
                    let lockPid;
                    let lockTimestamp;
                    let isCorrupted = false;
                    // 1. Check owner.json
                    try {
                        const ownerPath = path.join(lockPath, "owner.json");
                        const rawOwner = await fs.readFile(ownerPath, "utf8");
                        try {
                            const ownerData = JSON.parse(rawOwner);
                            if (typeof ownerData.pid === "number")
                                lockPid = ownerData.pid;
                            if (typeof ownerData.timestamp === "number")
                                lockTimestamp = ownerData.timestamp;
                        }
                        catch {
                            // owner.json exists on disk but is malformed JSON - treat as corrupted
                            isCorrupted = true;
                        }
                    }
                    catch {
                        // owner.json missing
                    }
                    // 2. Check pid file
                    if (lockPid === undefined && !isCorrupted) {
                        try {
                            const pidPath = path.join(lockPath, "pid");
                            const rawPid = await fs.readFile(pidPath, "utf8");
                            const parsedPid = parseInt(rawPid.trim(), 10);
                            if (!isNaN(parsedPid))
                                lockPid = parsedPid;
                        }
                        catch {
                            // pid file missing
                        }
                    }
                    // 3. Stat directory for mtime
                    let mtimeMs = 0;
                    try {
                        const stat = await fs.stat(lockPath);
                        mtimeMs = stat.mtimeMs;
                    }
                    catch {
                        // Stat failed (directory may have been removed concurrently)
                    }
                    const now = Date.now();
                    const age = lockTimestamp ? now - lockTimestamp : (mtimeMs ? now - mtimeMs : 0);
                    let isProcessDead = false;
                    if (lockPid !== undefined) {
                        try {
                            process.kill(lockPid, 0);
                        }
                        catch (killErr) {
                            if (killErr.code === "ESRCH") {
                                isProcessDead = true;
                            }
                        }
                    }
                    const isStale = isCorrupted || age > 30000 || isProcessDead;
                    if (isStale) {
                        console.error(`[swarm-engine] Reclaiming stale lock at ${lockPath} (pid: ${lockPid}, age: ${age}ms, dead: ${isProcessDead}, corrupted: ${isCorrupted})`);
                        await fs.rm(lockPath, { recursive: true, force: true }).catch(() => { });
                        continue;
                    }
                }
                catch {
                    // If stale inspection fails, fall through to backoff
                }
                // Exponential backoff with random jitter (10ms to 100ms)
                const jitter = Math.floor(Math.random() * 15);
                const sleepTime = Math.min(100, Math.max(10, delay + jitter));
                await new Promise((resolve) => setTimeout(resolve, sleepTime));
                delay = Math.min(100, delay * 2);
            }
            else {
                throw err;
            }
        }
    }
    throw new Error(`Failed to acquire state lock within ${timeoutMs}ms at ${lockPath}`);
}
/**
 * Initializes the swarm state and persists it to .swarm/state.json.
 */
export async function initState(mission, maxConcurrency = 0, workerCommand, swarmDir, leaderModel, parallel = true, strictDependencies = false) {
    const dir = swarmDir || getSwarmDir();
    await fs.mkdir(dir, { recursive: true });
    await ensureGitExclude(path.dirname(dir));
    const detected = detectActiveModelsSync(path.dirname(dir));
    const now = Date.now();
    const maxSeq = await getHighestSeqFromBoard(dir);
    const initialState = {
        mission,
        leaderModel: leaderModel || detected.leaderModel || undefined,
        maxConcurrency: maxConcurrency !== undefined ? maxConcurrency : 0, // 0 = infinite / unlimited
        workerCommand,
        parallel: parallel !== false,
        strictDependencies: strictDependencies === true,
        agents: {},
        blackboard: {},
        lockedFiles: {},
        headSeq: maxSeq,
        channels: {
            main: {
                name: "main",
                topic: "Default swarm coordination channel",
                createdBy: "system",
                createdAt: now,
                archived: false,
                subscribers: ["*"],
            },
        },
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
            }
            catch (renameErr) {
                if (attempt === 4)
                    throw renameErr;
                await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
            }
        }
        // Ensure board.jsonl exists cleanly without truncating existing content
        const boardPath = path.join(dir, "board.jsonl");
        try {
            await fs.access(boardPath);
        }
        catch {
            await fs.writeFile(boardPath, "", "utf8");
        }
        return initialState;
    }
    finally {
        await releaseLock(dir);
    }
}
/**
 * Ensures swarm state is initialized, using double-checked locking to prevent
 * concurrency races when multiple uninitialized callers arrive simultaneously.
 */
export async function ensureState(swarmDir) {
    const dir = swarmDir || getSwarmDir();
    try {
        return await readState(dir);
    }
    catch {
        await acquireLock(dir);
        try {
            try {
                return await readState(dir);
            }
            catch {
                await ensureGitExclude(path.dirname(dir));
                const detected = detectActiveModelsSync(path.dirname(dir));
                const now = Date.now();
                const maxSeq = await getHighestSeqFromBoard(dir);
                const initialState = {
                    mission: "Default Swarm Mission",
                    leaderModel: detected.leaderModel || undefined,
                    maxConcurrency: 0,
                    parallel: true,
                    strictDependencies: false,
                    agents: {},
                    blackboard: {},
                    lockedFiles: {},
                    headSeq: maxSeq,
                    channels: {
                        main: {
                            name: "main",
                            topic: "Default swarm coordination channel",
                            createdBy: "system",
                            createdAt: now,
                            archived: false,
                            subscribers: ["*"],
                        },
                    },
                };
                const statePath = path.join(dir, "state.json");
                const tmpId = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
                const tmpPath = path.join(dir, `state.json.tmp.${tmpId}`);
                await fs.writeFile(tmpPath, JSON.stringify(initialState, null, 2), "utf8");
                for (let attempt = 0; attempt < 5; attempt++) {
                    try {
                        await fs.rename(tmpPath, statePath);
                        break;
                    }
                    catch (renameErr) {
                        if (attempt === 4)
                            throw renameErr;
                        await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
                    }
                }
                const boardPath = path.join(dir, "board.jsonl");
                try {
                    await fs.access(boardPath);
                }
                catch {
                    await fs.writeFile(boardPath, "", "utf8");
                }
                return initialState;
            }
        }
        finally {
            await releaseLock(dir);
        }
    }
}
/**
 * Reads the current swarm state from .swarm/state.json.
 * Automatically normalizes legacy state files for seamless backward compatibility.
 */
export async function readState(swarmDir) {
    const dir = swarmDir || getSwarmDir();
    const statePath = path.join(dir, "state.json");
    try {
        const content = await fs.readFile(statePath, "utf8");
        const state = JSON.parse(content);
        // --- Automatic Backward-Compatibility Migration ---
        // Reseed headSeq from board.jsonl if missing or 0 to prevent sequence collisions
        if (typeof state.headSeq !== "number" || isNaN(state.headSeq) || state.headSeq <= 0) {
            const maxSeq = await getHighestSeqFromBoard(dir);
            state.headSeq = Math.max(state.headSeq || 0, maxSeq);
        }
        if (!state.channels || typeof state.channels !== "object") {
            state.channels = {
                main: {
                    name: "main",
                    topic: "Default swarm coordination channel",
                    createdBy: "system",
                    createdAt: Date.now(),
                    archived: false,
                    subscribers: ["*"],
                },
            };
        }
        else {
            // Deduplicate channel dictionary keys and normalize case variations
            const normalizedChannels = {};
            for (const [rawKey, meta] of Object.entries(state.channels)) {
                if (!meta || typeof meta !== "object")
                    continue;
                const normKey = (meta.name || rawKey).trim().toLowerCase();
                if (!normKey)
                    continue;
                const subscribers = Array.isArray(meta.subscribers)
                    ? Array.from(new Set(meta.subscribers.map((s) => String(s).trim())))
                    : [];
                if (!normalizedChannels[normKey]) {
                    normalizedChannels[normKey] = {
                        name: normKey,
                        topic: meta.topic || "",
                        createdBy: meta.createdBy || "system",
                        createdAt: typeof meta.createdAt === "number" ? meta.createdAt : Date.now(),
                        archived: Boolean(meta.archived),
                        subscribers,
                    };
                }
                else {
                    const existing = normalizedChannels[normKey];
                    existing.subscribers = Array.from(new Set([...existing.subscribers, ...subscribers]));
                    if (!existing.topic && meta.topic)
                        existing.topic = meta.topic;
                }
            }
            if (!normalizedChannels["main"]) {
                normalizedChannels["main"] = {
                    name: "main",
                    topic: "Default swarm coordination channel",
                    createdBy: "system",
                    createdAt: Date.now(),
                    archived: false,
                    subscribers: ["*"],
                };
            }
            state.channels = normalizedChannels;
        }
        if (!state.blackboard || typeof state.blackboard !== "object") {
            state.blackboard = {};
        }
        if (!state.lockedFiles || typeof state.lockedFiles !== "object") {
            state.lockedFiles = {};
        }
        if (!state.agents || typeof state.agents !== "object") {
            state.agents = {};
        }
        if (state.mission && !state.title) {
            state.title = state.mission;
        }
        else if (state.title && !state.mission) {
            state.mission = state.title;
        }
        state.roster = state.agents;
        if (!state.killedAgents || !Array.isArray(state.killedAgents)) {
            state.killedAgents = [];
        }
        // Normalize individual agent nodes
        for (const agent of Object.values(state.agents)) {
            if (!agent.name && agent.id) {
                agent.name = agent.id;
            }
            if (!agent.brief && agent.taskSpec) {
                agent.brief = agent.taskSpec;
            }
            if (!agent.helperIds || !Array.isArray(agent.helperIds)) {
                agent.helperIds = [];
            }
            if (!agent.status) {
                agent.status = "working";
            }
            if (!agent.channels || !Array.isArray(agent.channels)) {
                agent.channels = ["main"];
            }
            else {
                const uniqueChannels = Array.from(new Set(agent.channels
                    .filter((c) => typeof c === "string" && c.trim().length > 0)
                    .map((c) => c.trim().toLowerCase())));
                if (!uniqueChannels.includes("main")) {
                    uniqueChannels.unshift("main");
                }
                agent.channels = uniqueChannels;
            }
            if (!agent.wakeMode) {
                agent.wakeMode = "mentions";
            }
            if (typeof agent.lastReadSeq !== "number") {
                agent.lastReadSeq = 0;
            }
        }
        return state;
    }
    catch (err) {
        if (err.code === "ENOENT") {
            throw new Error("Swarm state has not been initialized. Run 'swarm-engine init' or 'spawn_swarm' first.");
        }
        throw err;
    }
}
/**
 * Atomically updates the swarm state using directory-based locking and safe temp-file replacement.
 */
export async function updateState(mutator, swarmDir) {
    const dir = swarmDir || getSwarmDir();
    await acquireLock(dir);
    try {
        let state;
        try {
            state = await readState(dir);
        }
        catch {
            const detected = detectActiveModelsSync(path.dirname(dir));
            state = {
                mission: "Default Swarm Mission",
                leaderModel: detected.leaderModel || undefined,
                maxConcurrency: 0,
                parallel: true,
                strictDependencies: false,
                agents: {},
                blackboard: {},
                lockedFiles: {},
                headSeq: 0,
                channels: {
                    main: {
                        name: "main",
                        topic: "Default swarm coordination channel",
                        createdBy: "system",
                        createdAt: Date.now(),
                        archived: false,
                        subscribers: ["*"],
                    },
                },
            };
        }
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
            }
            catch (renameErr) {
                if (attempt === 4)
                    throw renameErr;
                await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
            }
        }
        return result;
    }
    finally {
        await releaseLock(dir);
    }
}
/**
 * Records a real-time tool action (Edit, Read, Bash, Update) executed by an agent.
 */
export async function recordAgentAction(agentId, action, swarmDir) {
    const dir = swarmDir || getSwarmDir();
    await updateState((state) => {
        const agent = state.agents[agentId];
        if (!agent)
            return;
        if (!agent.actions)
            agent.actions = [];
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
export async function updateAgentProgress(agentId, progress, swarmDir) {
    const dir = swarmDir || getSwarmDir();
    await updateState((state) => {
        const agent = state.agents[agentId];
        if (!agent)
            return;
        if (progress.thought !== undefined)
            agent.thought = progress.thought;
        if (progress.verb !== undefined)
            agent.verb = progress.verb;
        if (progress.tokens !== undefined)
            agent.tokens = progress.tokens;
        if (progress.tokPerSec !== undefined)
            agent.tokPerSec = progress.tokPerSec;
    }, dir);
}
/**
 * Updates an agent's message board cursor tracking fields (lastReadSeq, waitSince, wakeMode, channels).
 */
export async function updateAgentCursor(agentId, cursor, swarmDir) {
    const dir = swarmDir || getSwarmDir();
    await updateState((state) => {
        const agent = state.agents[agentId];
        if (!agent)
            return;
        if (cursor.lastReadSeq !== undefined)
            agent.lastReadSeq = cursor.lastReadSeq;
        if (cursor.waitSince !== undefined)
            agent.waitSince = cursor.waitSince;
        if (cursor.wakeMode !== undefined)
            agent.wakeMode = cursor.wakeMode;
        if (cursor.channels !== undefined)
            agent.channels = cursor.channels;
        if (cursor.lastPostSeq !== undefined)
            agent.lastPostSeq = cursor.lastPostSeq;
        if (cursor.lastPostTime !== undefined)
            agent.lastPostTime = cursor.lastPostTime;
        if (cursor.status !== undefined)
            agent.status = cursor.status;
    }, dir);
}
/**
 * Ensures a channel exists in the state metadata, creating it if not present.
 */
export async function ensureChannel(name, topic, createdBy = "system", swarmDir) {
    const dir = swarmDir || getSwarmDir();
    return await updateState((state) => {
        if (!state.channels)
            state.channels = {};
        const normName = name.trim().toLowerCase();
        if (state.channels[normName]) {
            return state.channels[normName];
        }
        const meta = {
            name: normName,
            topic,
            createdBy,
            createdAt: Date.now(),
            archived: false,
            subscribers: [createdBy],
        };
        state.channels[normName] = meta;
        return meta;
    }, dir);
}
/**
 * Returns a deduplicated list of channel summaries for display or MCP tool output.
 * Ensures 'main' is always present at index 0 and no channel is duplicated.
 */
export function getDeduplicatedChannelList(state) {
    const seen = new Set();
    const list = [];
    const mainMeta = state.channels?.["main"];
    list.push({
        name: "main",
        channel: "main",
        topic: mainMeta?.topic || "Universal swarm coordination channel",
        createdBy: mainMeta?.createdBy || "system",
        createdAt: mainMeta?.createdAt || 0,
        archived: Boolean(mainMeta?.archived),
        subscriberCount: Object.keys(state.agents || {}).length + 1,
        subscribers: ["coordinator", ...Object.keys(state.agents || {})],
    });
    seen.add("main");
    for (const c of Object.values(state.channels || {})) {
        const norm = (c.name || "").trim().toLowerCase();
        if (!norm || seen.has(norm))
            continue;
        seen.add(norm);
        list.push({
            name: norm,
            channel: norm,
            topic: c.topic || "",
            createdBy: c.createdBy,
            createdAt: c.createdAt,
            archived: Boolean(c.archived),
            subscriberCount: (c.subscribers || []).length,
            subscribers: c.subscribers || [],
        });
    }
    return list;
}
/**
 * Recursively collects all descendant helper agent IDs under a parent agent.
 */
export function getDescendantHelperIds(state, parentId) {
    const result = [];
    const queue = [parentId];
    const visited = new Set([parentId]);
    while (queue.length > 0) {
        const current = queue.shift();
        for (const [id, agent] of Object.entries(state.agents || {})) {
            if (agent.parentId === current && !visited.has(id)) {
                visited.add(id);
                result.push(id);
                queue.push(id);
            }
        }
    }
    return result;
}
/**
 * Checks whether targetId is a descendant in the hierarchical subtree of rootId.
 */
export function isDescendantHelper(state, rootId, targetId) {
    if (rootId === targetId)
        return true;
    let curr = state.agents?.[targetId]?.parentId;
    const visited = new Set();
    while (curr && !visited.has(curr)) {
        if (curr === rootId)
            return true;
        visited.add(curr);
        curr = state.agents?.[curr]?.parentId;
    }
    return false;
}
/**
 * Determines whether callerId has authorization to terminate targetId.
 * Scoped boundary rules:
 * - "coordinator", "system", or unset caller: global authority.
 * - Self-termination (callerId === targetId): permitted.
 * - Hierarchical parent/ancestor terminating child/descendant: permitted.
 * - Sibling or child attempting to terminate ancestor or non-descendant: rejected.
 */
export function canTerminateAgent(state, callerId, targetId) {
    if (!targetId) {
        return { allowed: false, reason: "Target agent ID is required" };
    }
    if (!callerId || callerId === "coordinator" || callerId === "system") {
        return { allowed: true };
    }
    if (callerId === targetId) {
        return { allowed: true };
    }
    if (isDescendantHelper(state, callerId, targetId)) {
        return { allowed: true };
    }
    return {
        allowed: false,
        reason: `Permission denied: Agent '${callerId}' is not authorized to terminate '${targetId}' (target is not in caller's hierarchical subtree).`,
    };
}
/**
 * Atomically transitions an agent's lifecycle status with validation and metadata recording.
 */
export async function transitionAgentStatus(agentId, newStatus, meta, swarmDir) {
    const dir = swarmDir || getSwarmDir();
    return await updateState((state) => {
        const agent = state.agents[agentId];
        if (!agent) {
            throw new Error(`Agent '${agentId}' not found in swarm state.`);
        }
        const check = validateStatusTransition(agent.status, newStatus);
        if (!check.valid) {
            throw new Error(check.reason);
        }
        agent.status = newStatus;
        if (newStatus === "working" && !agent.startedAt) {
            agent.startedAt = Date.now();
        }
        if (newStatus === "completed") {
            agent.completedAt = Date.now();
            agent.endedAt = Date.now();
        }
        if (newStatus === "killed") {
            agent.killed = true;
            agent.endedAt = Date.now();
            if (meta?.terminationReason)
                agent.terminationReason = meta.terminationReason;
        }
        if (newStatus === "failed") {
            agent.endedAt = Date.now();
            if (meta?.error)
                agent.error = meta.error;
            if (meta?.terminationReason)
                agent.terminationReason = meta.terminationReason;
        }
        if (meta?.exitCode !== undefined)
            agent.exitCode = meta.exitCode;
        return agent;
    }, dir);
}
/**
 * Terminates an agent and cascades termination to all recursive descendant helpers.
 * Checks caller permissions and releases file locks.
 */
export async function terminateAgent(agentId, options, swarmDir) {
    const dir = swarmDir || getSwarmDir();
    return await updateState((state) => {
        const target = state.agents[agentId];
        if (!target) {
            throw new Error(`Agent '${agentId}' not found.`);
        }
        if (target.status === "killed" || target.killed === true) {
            throw new Error(`Agent '${agentId}' is already killed.`);
        }
        const perm = canTerminateAgent(state, options?.callerId, agentId);
        if (!perm.allowed) {
            throw new Error(perm.reason || "Permission denied");
        }
        const descendants = getDescendantHelperIds(state, agentId);
        const killList = [agentId, ...descendants];
        const now = Date.now();
        for (const id of killList) {
            const ag = state.agents[id];
            if (!ag)
                continue;
            if (ag.pid) {
                try {
                    process.kill(ag.pid, "SIGTERM");
                }
                catch { }
            }
            ag.status = "killed";
            ag.killed = true;
            ag.endedAt = now;
            ag.terminationReason =
                id === agentId
                    ? options?.reason || "Terminated by swarm management kill"
                    : `Cascading termination: parent '${agentId}' was killed`;
            // Release locks owned by this agent
            if (state.lockedFiles) {
                if (Array.isArray(state.lockedFiles)) {
                    // array guard
                }
                else {
                    for (const [file, assigned] of Object.entries(state.lockedFiles)) {
                        if (assigned === id) {
                            delete state.lockedFiles[file];
                        }
                    }
                }
            }
        }
        return {
            success: true,
            killed: killList,
        };
    }, dir);
}
/**
 * Hot-swaps an agent's model identifier while preserving conversation context,
 * memory, status, and file locks.
 */
export async function modelHotSwap(agentId, newModel, swarmDir) {
    const dir = swarmDir || getSwarmDir();
    const trimmed = (newModel || "").trim();
    if (!trimmed) {
        throw new Error("Model identifier cannot be empty.");
    }
    return await updateState((state) => {
        const agent = state.agents[agentId];
        if (!agent) {
            throw new Error(`Agent '${agentId}' not found in swarm state.`);
        }
        if (agent.status === "killed" || agent.killed === true || agent.status === "completed" || agent.status === "failed") {
            throw new Error(`Cannot change model of terminal agent '${agentId}' (status: ${agent.status}).`);
        }
        agent.model = trimmed;
        return agent;
    }, dir);
}
/**
 * Computes a standardized summary snapshot of swarm state for status queries.
 */
export function getSwarmStatusSummary(state) {
    const agents = state.agents || {};
    const counts = {
        waiting: 0,
        working: 0,
        stopped: 0,
        completed: 0,
        failed: 0,
        killed: 0,
        total: Object.keys(agents).length,
    };
    const roster = {};
    for (const [id, a] of Object.entries(agents)) {
        const st = a.status || "working";
        if (st === "waiting")
            counts.waiting++;
        else if (st === "working" || st === "running")
            counts.working++;
        else if (st === "stopped")
            counts.stopped++;
        else if (st === "completed")
            counts.completed++;
        else if (st === "failed")
            counts.failed++;
        else if (st === "killed" || a.killed)
            counts.killed++;
        roster[id] = {
            id: a.id,
            name: a.name || a.id,
            role: a.role,
            status: a.status,
            model: a.model,
            brief: a.brief || a.taskSpec,
            taskSpec: a.taskSpec,
            parentId: a.parentId,
            helperIds: a.helperIds || [],
            forkedFrom: a.forkedFrom,
            workspace: a.workspace || "inherit",
            channels: a.channels || ["main"],
            wakeMode: a.wakeMode || "mentions",
            waitSince: a.waitSince,
            lastReadSeq: a.lastReadSeq || 0,
            lastPostSeq: a.lastPostSeq,
            thought: a.thought,
            verb: a.verb,
            tokens: a.tokens,
            tokPerSec: a.tokPerSec,
            killed: Boolean(a.killed || a.status === "killed"),
            startedAt: a.startedAt,
            completedAt: a.completedAt,
            endedAt: a.endedAt,
        };
    }
    const channels = getDeduplicatedChannelList(state);
    return {
        success: true,
        action: "status",
        mission: state.mission,
        title: state.title || state.mission,
        headSeq: state.headSeq || 0,
        leaderModel: state.leaderModel,
        maxConcurrency: state.maxConcurrency ?? 0,
        totalAgents: counts.total,
        counts,
        summary: counts,
        agents: state.agents,
        roster,
        members: roster,
        channels,
        blackboard: state.blackboard || {},
        lockedFiles: state.lockedFiles || {},
    };
}
