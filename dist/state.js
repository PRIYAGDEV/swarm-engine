import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { detectActiveModelsSync } from "./detector.js";
/**
 * Strips leading './' and converts '\' to '/' to ensure file paths
 * normalize reliably across Windows and POSIX systems (Safeguard 4).
 */
export function normalizePath(p) {
    if (!p)
        return "";
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
                    // 1. Check owner.json
                    try {
                        const ownerPath = path.join(lockPath, "owner.json");
                        const rawOwner = await fs.readFile(ownerPath, "utf8");
                        const ownerData = JSON.parse(rawOwner);
                        if (typeof ownerData.pid === "number")
                            lockPid = ownerData.pid;
                        if (typeof ownerData.timestamp === "number")
                            lockTimestamp = ownerData.timestamp;
                    }
                    catch {
                        // owner.json missing or invalid
                    }
                    // 2. Check pid file
                    if (lockPid === undefined) {
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
                    const isStale = age > 30000 || isProcessDead;
                    if (isStale) {
                        console.error(`[swarm-engine] Reclaiming stale lock at ${lockPath} (pid: ${lockPid}, age: ${age}ms, dead: ${isProcessDead})`);
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
        // Normalize individual agent nodes
        for (const agent of Object.values(state.agents)) {
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
