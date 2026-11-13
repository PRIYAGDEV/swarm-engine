import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { EventEmitter } from "node:events";
import { getSwarmDir, getBoardPath as getStateBoardPath, acquireLock, updateState, readState, initState, ensureState, } from "./state.js";
// ============================================================================
// Constants and Interfaces
// ============================================================================
export const MAIN_CHANNEL = "main";
export const ALL_CHANNELS = "*";
// ============================================================================
// Mention & Doorbell Parsing Engine
// ============================================================================
const NAME_RUNE = /[\p{L}\p{Nd}_-]/u;
export const CHANNEL_NAME_REGEX = /^[a-z][a-z0-9-]{0,23}$/;
export const RESERVED_CHANNELS = new Set(["main", "all", "here"]);
export function namedToken(lowerText, lowerName) {
    if (!lowerName)
        return false;
    for (let i = lowerText.indexOf("@"); i >= 0; i = lowerText.indexOf("@", i + 1)) {
        if (i > 0) {
            const before = [...lowerText.slice(Math.max(0, i - 2), i)].pop();
            if (before && NAME_RUNE.test(before))
                continue;
        }
        if (!lowerText.startsWith(lowerName, i + 1))
            continue;
        const j = i + 1 + lowerName.length;
        if (j >= lowerText.length)
            return true;
        const nextChar = String.fromCodePoint(lowerText.codePointAt(j));
        if (!NAME_RUNE.test(nextChar))
            return true;
    }
    return false;
}
export function named(lowerText, lowerName) {
    if (namedToken(lowerText, lowerName))
        return true;
    // Prefix matching: If name is worker-1, worker-2, check @worker
    const m = lowerName.match(/^(.+)-\d+$/);
    return m ? namedToken(lowerText, m[1]) : false;
}
export function channelMentions(text) {
    const lower = String(text || "").toLowerCase();
    const out = [];
    for (let i = lower.indexOf("@#"); i >= 0; i = lower.indexOf("@#", i + 1)) {
        if (i > 0) {
            const before = [...lower.slice(Math.max(0, i - 2), i)].pop();
            if (before && NAME_RUNE.test(before))
                continue;
        }
        let j = i + 2;
        while (j < lower.length) {
            const r = String.fromCodePoint(lower.codePointAt(j));
            if (!NAME_RUNE.test(r))
                break;
            j += r.length;
        }
        const name = lower.slice(i + 2, j);
        if ((name === MAIN_CHANNEL ||
            (CHANNEL_NAME_REGEX.test(name) && !RESERVED_CHANNELS.has(name))) &&
            !out.includes(name)) {
            out.push(name);
        }
    }
    return out;
}
export function parseMentions(text) {
    const str = String(text || "");
    const names = [];
    const raw = [];
    let isAll = false;
    const chMentions = channelMentions(text);
    for (let i = 0; i < str.length; i++) {
        if (str[i] === "@") {
            if (i > 0) {
                const before = [...str.slice(Math.max(0, i - 2), i)].pop();
                if (before && NAME_RUNE.test(before))
                    continue;
            }
            if (str[i + 1] === "#")
                continue;
            let j = i + 1;
            while (j < str.length) {
                const r = String.fromCodePoint(str.codePointAt(j));
                if (!NAME_RUNE.test(r))
                    break;
                j += r.length;
            }
            if (j > i + 1) {
                const rawToken = str.slice(i + 1, j);
                const lowerToken = rawToken.toLowerCase();
                raw.push("@" + rawToken);
                if (lowerToken === "all") {
                    isAll = true;
                    if (!names.includes("all")) {
                        names.push("all");
                    }
                }
                else {
                    if (!names.includes(rawToken) && !names.includes(lowerToken)) {
                        names.push(rawToken);
                    }
                }
            }
        }
    }
    for (const ch of chMentions) {
        raw.push("@#" + ch);
    }
    return { raw, names, channels: chMentions, isAll };
}
export function isMentioned(text, memberName, memberChannels = [], active) {
    const lower = String(text || "").toLowerCase();
    const lowerName = String(memberName || "").toLowerCase();
    // 1. Direct name match or numbered prefix match
    if (named(lower, lowerName))
        return true;
    // 2. Broadcast @all
    if (namedToken(lower, "all"))
        return true;
    // 3. Channel mention: @#channel wakes all subscribers of that active channel
    const chMentions = channelMentions(text);
    const allChannels = memberChannels.includes(ALL_CHANNELS);
    for (const c of chMentions) {
        if (c === MAIN_CHANNEL)
            continue; // @#main calls nobody
        if ((allChannels || memberChannels.includes(c)) && (!active || active(c))) {
            return true;
        }
    }
    return false;
}
// ============================================================================
// Channel Visibility & Routing Engine
// ============================================================================
export function effectiveChannels(role, assignedChannels, name) {
    if (Array.isArray(assignedChannels) && assignedChannels.length > 0) {
        return assignedChannels;
    }
    const r = (role || "").toLowerCase();
    const n = (name || "").toLowerCase();
    if (r === "coordinator" || r === "narrator" || r === "monitor" || n === "coordinator") {
        return [ALL_CHANNELS];
    }
    if (/^(?:narrator|monitor)(?:-\d+)?$/.test(n)) {
        return [ALL_CHANNELS];
    }
    return [MAIN_CHANNEL];
}
export function getMemberChannels(state, memberName, channelFilter) {
    const agent = state?.agents?.[memberName];
    const role = memberName === "coordinator" ? "coordinator" : agent?.role;
    const list = new Set(effectiveChannels(role, agent?.channels, memberName));
    if (state?.channels) {
        const lowerName = memberName.toLowerCase();
        for (const [chName, meta] of Object.entries(state.channels)) {
            if (meta.subscribers && Array.isArray(meta.subscribers)) {
                if (meta.subscribers.some((s) => s.toLowerCase() === lowerName || s === "*")) {
                    list.add(chName);
                }
            }
        }
    }
    if (channelFilter && channelFilter !== ALL_CHANNELS) {
        list.add(channelFilter);
    }
    return Array.from(list);
}
export function seesIn(name, channels, msg, active) {
    const ch = (msg.channel || MAIN_CHANNEL).toLowerCase();
    const from = (msg.from || msg.agent || "").toLowerCase();
    const lowerName = (name || "").toLowerCase();
    if (ch === MAIN_CHANNEL || from === lowerName) {
        return true;
    }
    if (channels.includes(ALL_CHANNELS) || channels.includes(ch)) {
        return true;
    }
    return isMentioned(msg.text, name, channels, active);
}
export const countsUnread = (msg) => !msg.control;
// ============================================================================
// Persistence & Torn-Line Recovery Engine
// ============================================================================
export function getBoardPath(swarmDir) {
    return getStateBoardPath(swarmDir);
}
export function parseBoardLog(text) {
    const messages = [];
    const lines = (text || "").split("\n");
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            const obj = JSON.parse(trimmed);
            if (obj && typeof obj === "object" && typeof obj.seq === "number") {
                const from = obj.from || obj.agent || "unknown";
                const ts = typeof obj.timestamp === "number"
                    ? obj.timestamp
                    : obj.time
                        ? new Date(obj.time).getTime()
                        : Date.now();
                const timeStr = typeof obj.time === "string" ? obj.time : new Date(ts).toISOString();
                const mentions = parseMentions(obj.text || "");
                messages.push({
                    seq: obj.seq,
                    from,
                    agent: obj.agent || from,
                    to: Array.isArray(obj.to)
                        ? obj.to
                        : mentions.raw.length > 0
                            ? mentions.raw
                            : undefined,
                    channel: obj.channel || MAIN_CHANNEL,
                    text: typeof obj.text === "string" ? obj.text : "",
                    timestamp: ts,
                    time: timeStr,
                    control: obj.control,
                });
            }
        }
        catch {
            // Ignored: Torn line or incomplete append skipped cleanly
        }
    }
    return messages;
}
export async function readBoardMessages(swarmDir) {
    const boardPath = getBoardPath(swarmDir);
    try {
        const content = await fs.readFile(boardPath, "utf8");
        return parseBoardLog(content);
    }
    catch (err) {
        if (err.code === "ENOENT")
            return [];
        throw err;
    }
}
export async function recoverBoardLog(swarmDir) {
    const dir = swarmDir || getSwarmDir();
    const boardPath = getBoardPath(dir);
    const release = await acquireLock(dir);
    try {
        const raw = await fs.readFile(boardPath, "utf8");
        const valid = parseBoardLog(raw);
        const cleanLines = valid.map((m) => JSON.stringify(m)).join("\n") + (valid.length > 0 ? "\n" : "");
        await fs.writeFile(boardPath, cleanLines, "utf8");
        return valid;
    }
    catch (err) {
        if (err.code === "ENOENT")
            return [];
        throw err;
    }
    finally {
        await release();
    }
}
// ============================================================================
// In-Memory Event Dispatcher for Zero-Token Sleep
// ============================================================================
export class BoardEventBus extends EventEmitter {
    emitPost(swarmDir, message) {
        this.emit("post", { swarmDir: path.resolve(swarmDir), message });
    }
    onPost(handler) {
        this.on("post", handler);
        return () => this.off("post", handler);
    }
}
export const boardEventBus = new BoardEventBus();
boardEventBus.setMaxListeners(200);
// ============================================================================
// High-Level Board API Implementations
// ============================================================================
export async function postMessage(stateOrDir, swarmDirOrOpts, maybeOpts) {
    let stateRef;
    let dir = getSwarmDir();
    let opts;
    if (typeof stateOrDir === "string") {
        dir = stateOrDir;
        opts = swarmDirOrOpts || { text: "" };
    }
    else if (stateOrDir && typeof stateOrDir === "object" && "mission" in stateOrDir) {
        stateRef = stateOrDir;
        if (typeof swarmDirOrOpts === "string") {
            dir = swarmDirOrOpts;
            opts = maybeOpts || { text: "" };
        }
        else {
            opts = swarmDirOrOpts || { text: "" };
        }
    }
    else {
        opts = stateOrDir || { text: "" };
    }
    const rawText = opts.text;
    if (!rawText || typeof rawText !== "string" || rawText.trim() === "") {
        throw new Error("Message text cannot be empty or whitespace-only.");
    }
    const boardPath = getBoardPath(dir);
    await fs.mkdir(dir, { recursive: true });
    // Auto-initialize state cleanly if state.json does not exist yet (thread-safe double-checked lock)
    await ensureState(dir);
    const release = await acquireLock(dir);
    try {
        const statePath = path.join(dir, "state.json");
        const state = await readState(dir);
        const channel = (opts.channel || MAIN_CHANNEL).trim().toLowerCase();
        // Validate channel name and check archived channel
        if (channel !== MAIN_CHANNEL && !opts.control) {
            if (!CHANNEL_NAME_REGEX.test(channel) || RESERVED_CHANNELS.has(channel)) {
                throw new Error(`Invalid channel name '${channel}'. Must match ${CHANNEL_NAME_REGEX} and not be reserved.`);
            }
            if (state.channels && state.channels[channel]?.archived) {
                throw new Error(`Channel '#${channel}' is archived and read-only.`);
            }
        }
        // Monotonic sequence allocation
        state.headSeq = (state.headSeq || 0) + 1;
        const seq = state.headSeq;
        const from = opts.from || "coordinator";
        const mentions = parseMentions(rawText);
        const now = Date.now();
        const message = {
            seq,
            from,
            agent: from,
            to: mentions.raw.length > 0 ? mentions.raw : undefined,
            channel,
            text: rawText,
            timestamp: now,
            time: new Date(now).toISOString(),
            control: opts.control,
        };
        // Attach mention arrays to message object for easy access
        message.mentions = mentions.names;
        message.channelMentions = mentions.channels;
        message.broadcast = mentions.isAll;
        // Handle channel control operations
        if (opts.control) {
            if (!state.channels)
                state.channels = {};
            const c = opts.control;
            if (c.op === "create") {
                if (!CHANNEL_NAME_REGEX.test(c.channel) || RESERVED_CHANNELS.has(c.channel)) {
                    throw new Error(`Invalid channel name '${c.channel}'. Must match ${CHANNEL_NAME_REGEX} and not be reserved.`);
                }
                if (state.channels[c.channel] && !state.channels[c.channel].archived) {
                    throw new Error(`Channel '#${c.channel}' already exists.`);
                }
                state.channels[c.channel] = {
                    name: c.channel,
                    topic: c.topic || "",
                    createdBy: from,
                    createdAt: now,
                    archived: false,
                    subscribers: c.members && c.members.length > 0 ? Array.from(new Set(c.members)) : [from],
                };
            }
            else if (c.op === "subscribe") {
                const ch = state.channels[c.channel];
                if (!ch) {
                    throw new Error(`Channel '#${c.channel}' does not exist.`);
                }
                if (ch.archived) {
                    throw new Error(`Channel '#${c.channel}' is archived.`);
                }
                if (c.members && c.members.length > 0) {
                    const set = new Set([...ch.subscribers, ...c.members]);
                    ch.subscribers = Array.from(set);
                    for (const m of c.members) {
                        const agent = state.agents?.[m];
                        if (agent) {
                            if (!agent.channels)
                                agent.channels = [MAIN_CHANNEL];
                            if (!agent.channels.includes(c.channel))
                                agent.channels.push(c.channel);
                        }
                    }
                }
            }
            else if (c.op === "unsubscribe") {
                const ch = state.channels[c.channel];
                if (!ch) {
                    throw new Error(`Channel '#${c.channel}' does not exist.`);
                }
                if (c.members && c.members.length > 0) {
                    ch.subscribers = ch.subscribers.filter((s) => !c.members.includes(s));
                    for (const m of c.members) {
                        const agent = state.agents?.[m];
                        if (agent && agent.channels) {
                            agent.channels = agent.channels.filter((chName) => chName !== c.channel);
                        }
                    }
                }
            }
            else if (c.op === "archive") {
                if (c.channel === MAIN_CHANNEL) {
                    throw new Error("Cannot archive the main channel.");
                }
                const ch = state.channels[c.channel];
                if (!ch) {
                    throw new Error(`Channel '#${c.channel}' does not exist.`);
                }
                if (ch.archived) {
                    throw new Error(`Channel '#${c.channel}' is already archived.`);
                }
                ch.archived = true;
            }
        }
        else {
            // Normal post: ensure channel exists in metadata if not main
            if (channel !== MAIN_CHANNEL) {
                if (!state.channels)
                    state.channels = {};
                if (!state.channels[channel]) {
                    state.channels[channel] = {
                        name: channel,
                        topic: "",
                        createdBy: from,
                        createdAt: now,
                        archived: false,
                        subscribers: [from],
                    };
                }
            }
        }
        // Update agent's cursor
        if (state.agents && state.agents[from]) {
            state.agents[from].lastPostSeq = seq;
            state.agents[from].lastPostTime = now;
        }
        // Protect against fusing into an un-terminated torn line fragment
        let prefix = "";
        try {
            const handle = await fs.open(boardPath, "r");
            try {
                const stat = await handle.stat();
                if (stat.size > 0) {
                    const buf = Buffer.alloc(1);
                    await handle.read(buf, 0, 1, stat.size - 1);
                    if (buf[0] !== 0x0a) {
                        prefix = "\n";
                    }
                }
            }
            finally {
                await handle.close();
            }
        }
        catch (err) {
            if (err.code !== "ENOENT")
                throw err;
        }
        // Append to board.jsonl
        const line = prefix + JSON.stringify(message) + "\n";
        await fs.appendFile(boardPath, line, "utf8");
        // Write state atomically with retry
        const tmpId = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
        const tmpPath = path.join(dir, `state.json.tmp.${tmpId}`);
        await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), "utf8");
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
        // Sync caller's state reference if provided
        if (stateRef) {
            Object.assign(stateRef, state);
        }
        // Emit event immediately
        boardEventBus.emitPost(dir, message);
        return message;
    }
    finally {
        await release();
    }
}
export async function readBoard(stateOrDir, swarmDirOrOpts, maybeOpts) {
    let state;
    let dir = getSwarmDir();
    let opts = {};
    if (!stateOrDir) {
        if (typeof swarmDirOrOpts === "string") {
            dir = swarmDirOrOpts;
            opts = maybeOpts || {};
        }
        else {
            opts = swarmDirOrOpts || {};
        }
    }
    else if (typeof stateOrDir === "string") {
        if (typeof swarmDirOrOpts === "string") {
            dir = swarmDirOrOpts;
            opts = maybeOpts || {};
        }
        else {
            dir = stateOrDir;
            opts = swarmDirOrOpts || {};
        }
    }
    else if (typeof stateOrDir === "object" && "mission" in stateOrDir) {
        state = stateOrDir;
        if (typeof swarmDirOrOpts === "string") {
            dir = swarmDirOrOpts;
            opts = maybeOpts || {};
        }
        else {
            opts = swarmDirOrOpts || {};
        }
    }
    else {
        opts = stateOrDir || {};
    }
    if (!state) {
        try {
            state = await readState(dir);
        }
        catch {
            // Swarm not initialized or empty
        }
    }
    const allMessages = await readBoardMessages(dir);
    const headSeq = allMessages.length > 0
        ? allMessages[allMessages.length - 1].seq
        : state?.headSeq || 0;
    // If since is negative, treat as 0
    const since = typeof opts.since === "number" && opts.since > 0 ? opts.since : 0;
    let activeChecker;
    if (state?.channels) {
        activeChecker = (c) => {
            const meta = state?.channels?.[c];
            return !meta || !meta.archived;
        };
    }
    let filtered = allMessages.filter((m) => m.seq > since);
    if (opts.channel) {
        const ch = opts.channel.toLowerCase();
        if (ch !== ALL_CHANNELS) {
            filtered = filtered.filter((m) => (m.channel || MAIN_CHANNEL).toLowerCase() === ch);
        }
    }
    else if (opts.memberName || opts.member) {
        const memberName = opts.memberName || opts.member;
        const channels = getMemberChannels(state, memberName);
        filtered = filtered.filter((m) => seesIn(memberName, channels, m, activeChecker));
    }
    // Handle limit
    if (opts.limit !== undefined) {
        if (opts.limit <= 0) {
            filtered = [];
        }
        else if (filtered.length > opts.limit) {
            filtered = filtered.slice(-opts.limit);
        }
    }
    const res = {
        messages: filtered,
        headSeq,
    };
    if (opts.status) {
        const members = {};
        if (state?.agents) {
            for (const [id, a] of Object.entries(state.agents)) {
                members[id] = {
                    role: a.role,
                    status: a.status,
                    wakeMode: a.wakeMode || "mentions",
                    waitSince: a.waitSince,
                    lastReadSeq: a.lastReadSeq,
                    lastPostSeq: a.lastPostSeq,
                    channels: getMemberChannels(state, id),
                };
            }
        }
        members["coordinator"] = {
            role: "coordinator",
            status: "working",
            wakeMode: "all",
            channels: [ALL_CHANNELS],
        };
        res.members = members;
        res.roster = members;
        res.channels = state?.channels ? Object.values(state.channels) : [];
    }
    return res;
}
export async function swarmWait(stateOrDir, swarmDirOrOpts, maybeOpts) {
    let state;
    let dir = getSwarmDir();
    let opts = {};
    if (!stateOrDir) {
        if (typeof swarmDirOrOpts === "string") {
            dir = swarmDirOrOpts;
            opts = maybeOpts || {};
        }
        else {
            opts = swarmDirOrOpts || {};
        }
    }
    else if (typeof stateOrDir === "string") {
        if (typeof swarmDirOrOpts === "string") {
            dir = swarmDirOrOpts;
            opts = maybeOpts || {};
        }
        else {
            dir = stateOrDir;
            opts = swarmDirOrOpts || {};
        }
    }
    else if (typeof stateOrDir === "object" && "mission" in stateOrDir) {
        state = stateOrDir;
        if (typeof swarmDirOrOpts === "string") {
            dir = swarmDirOrOpts;
            opts = maybeOpts || {};
        }
        else {
            opts = swarmDirOrOpts || {};
        }
    }
    else {
        opts = stateOrDir || {};
    }
    if (!state) {
        try {
            state = await readState(dir);
        }
        catch {
            state = await initState("Default Swarm Mission", 0, undefined, dir);
        }
    }
    const memberName = opts.memberName || opts.member || "coordinator";
    const since = typeof opts.since === "number" && opts.since > 0 ? opts.since : 0;
    const channelFilter = opts.channel
        ? String(opts.channel).toLowerCase()
        : undefined;
    const mentionsOnly = opts.mentionsOnly !== false && opts.mentions_only !== false;
    const rawTimeout = opts.timeoutMs !== undefined ? opts.timeoutMs : 30000;
    const channels = getMemberChannels(state, memberName, channelFilter);
    const isActive = (c) => {
        const meta = state?.channels?.[c];
        return !meta || !meta.archived;
    };
    const messageQualifies = (msg) => {
        if (msg.seq <= since)
            return false;
        if (channelFilter && channelFilter !== ALL_CHANNELS) {
            if ((msg.channel || MAIN_CHANNEL).toLowerCase() !== channelFilter) {
                return false;
            }
        }
        if (mentionsOnly) {
            return isMentioned(msg.text, memberName, channels, isActive);
        }
        return seesIn(memberName, channels, msg, isActive);
    };
    // 1. Synchronous Pre-check: Check if matching messages already exist on the board
    const existing = await readBoardMessages(dir);
    const headSeq = existing.length > 0 ? existing[existing.length - 1].seq : state.headSeq || 0;
    const matching = existing.filter(messageQualifies);
    if (matching.length > 0) {
        return {
            messages: matching,
            headSeq,
            timedOut: false,
        };
    }
    // Immediate return if timeout <= 0 and no unread matching messages exist
    if (rawTimeout <= 0) {
        return {
            messages: [],
            headSeq,
            timedOut: true,
        };
    }
    // 2. Mark agent parked in state
    try {
        await updateState((s) => {
            const ag = s.agents?.[memberName];
            if (ag) {
                ag.status = "waiting";
                ag.waitSince = since;
                ag.wakeMode = mentionsOnly ? "mentions" : "all";
            }
        }, dir);
    }
    catch { }
    // 3. Suspend turn: Wait for in-memory event or file modification fallback
    return new Promise((resolve) => {
        let resolved = false;
        let timer = null;
        let pollInterval = null;
        let unsub = null;
        const cleanup = async (revertStatus) => {
            if (resolved)
                return;
            resolved = true;
            if (timer)
                clearTimeout(timer);
            if (pollInterval)
                clearInterval(pollInterval);
            if (unsub)
                unsub();
            if (revertStatus) {
                try {
                    await updateState((s) => {
                        const ag = s.agents?.[memberName];
                        if (ag && ag.status === "waiting") {
                            ag.status = "working";
                            delete ag.waitSince;
                        }
                    }, dir);
                }
                catch { }
            }
        };
        // Layer 1: In-memory EventBus listener (<1ms unblock)
        unsub = boardEventBus.onPost(async (evt) => {
            if (path.resolve(evt.swarmDir) !== path.resolve(dir))
                return;
            if (messageQualifies(evt.message)) {
                await cleanup(true);
                resolve({
                    messages: [evt.message],
                    headSeq: evt.message.seq,
                    timedOut: false,
                });
            }
        });
        // Layer 2: Cross-process fallback poller (25ms)
        let lastKnownSize = 0;
        let lastKnownMtime = 0;
        try {
            const st = fsSync.statSync(getBoardPath(dir));
            lastKnownSize = st.size;
            lastKnownMtime = st.mtimeMs;
        }
        catch { }
        pollInterval = setInterval(async () => {
            try {
                const boardPath = getBoardPath(dir);
                const stat = await fs.stat(boardPath);
                if (stat.size !== lastKnownSize || stat.mtimeMs !== lastKnownMtime) {
                    lastKnownSize = stat.size;
                    lastKnownMtime = stat.mtimeMs;
                    const freshMsgs = await readBoardMessages(dir);
                    const freshMatching = freshMsgs.filter(messageQualifies);
                    if (freshMatching.length > 0) {
                        await cleanup(true);
                        const latestHead = freshMsgs[freshMsgs.length - 1]?.seq || headSeq;
                        resolve({
                            messages: freshMatching,
                            headSeq: latestHead,
                            timedOut: false,
                        });
                    }
                }
            }
            catch { }
        }, 25);
        // Timeout
        timer = setTimeout(async () => {
            await cleanup(true);
            const currentMsgs = await readBoardMessages(dir);
            const latestHead = currentMsgs.length > 0 ? currentMsgs[currentMsgs.length - 1].seq : headSeq;
            resolve({
                messages: [],
                headSeq: latestHead,
                timedOut: true,
            });
        }, rawTimeout);
    });
}
