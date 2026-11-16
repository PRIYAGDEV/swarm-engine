/**
 * Swarm Engine — Automatic Model Detection Engine
 *
 * Automatically discovers active LLM models from:
 * 1. Process environment variables (ANTHROPIC_MODEL, OPENAI_MODEL, GEMINI_MODEL, OLLAMA_MODEL, etc.)
 * 2. Editor settings files (VS Code, Kilo Code, Sleepy Code, Cursor, Windsurf):
 *    - terminal.integrated.env.<os> (e.g., ANTHROPIC_MODEL: "claude-3-7-sonnet")
 *    - claudeCode.environmentVariables
 *    - sleepycode / kilo-code model configurations
 * 3. Local workspace .env and .env.local files
 * 4. Local Ollama instance (http://127.0.0.1:11434/api/tags)
 */
import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { createRequire } from "node:module";
const requireModule = createRequire(import.meta.url);
/**
 * Extracts model strings from raw text using resilient regexes
 * that succeed even on non-standard/commented JSON files.
 */
function extractModelFromRaw(raw) {
    // Pattern 1: Direct key assignment (e.g. "ANTHROPIC_MODEL": "claude-3-7-sonnet")
    const directMatch = raw.match(/"(?:ANTHROPIC_MODEL|OPENAI_MODEL|GEMINI_MODEL|OLLAMA_MODEL|SWARM_LEADER_MODEL|SWARM_MODEL|MODEL)"\s*:\s*"([^"\r\n]+)"/i);
    if (directMatch && directMatch[1] && !directMatch[1].startsWith("__")) {
        return directMatch[1].trim();
    }
    // Pattern 2: Environment variable object (e.g. { "name": "ANTHROPIC_MODEL", "value": "claude-3-7-sonnet" })
    const namedMatch = raw.match(/"name"\s*:\s*"(?:ANTHROPIC_MODEL|OPENAI_MODEL|GEMINI_MODEL|MODEL)"[\s\S]{1,120}?"value"\s*:\s*"([^"\r\n]+)"/i);
    if (namedMatch && namedMatch[1] && !namedMatch[1].startsWith("__")) {
        return namedMatch[1].trim();
    }
    // Pattern 3: Explicit editor model configs (e.g. "kilo-code.model", "claudeCode.model")
    const configMatch = raw.match(/"(?:kilo-code\.model|cline\.model|roo-cline\.model|cursor\.model|claudeCode\.model)"\s*:\s*"([^"\r\n]+)"/i);
    if (configMatch && configMatch[1] && !configMatch[1].startsWith("__")) {
        return configMatch[1].trim();
    }
    return undefined;
}
/**
 * Helper to scan a list of Kilo configuration file paths.
 */
function scanKiloConfigs(configPaths) {
    for (const cfgPath of configPaths) {
        if (!fs.existsSync(cfgPath))
            continue;
        try {
            const raw = fs.readFileSync(cfgPath, "utf8");
            // Match "model": "..."
            const match = raw.match(/"model"\s*:\s*"([^"\r\n]+)"/i);
            if (match && match[1]) {
                let rawModel = match[1].trim();
                let cleanModel = rawModel;
                // Handle provider prefixes like "dahl/MiniMaxAI/MiniMax-M2.7" or "openrouter/anthropic/claude-3-7-sonnet"
                if (cleanModel.includes("/")) {
                    const parts = cleanModel.split("/");
                    if (parts.length >= 3) {
                        cleanModel = parts[parts.length - 1]; // e.g. "MiniMax-M2.7"
                    }
                    else if (parts.length === 2) {
                        cleanModel = parts[1];
                    }
                }
                if (cleanModel) {
                    return {
                        leader: cleanModel,
                        worker: cleanModel,
                        source: `Kilo config (${path.basename(cfgPath)})`,
                    };
                }
            }
        }
        catch { }
    }
    return undefined;
}
/**
 * Searches workspace-local .kilo directory for configured models.
 */
export function detectFromLocalKilo(cwd = process.cwd()) {
    const localConfigs = [
        path.join(cwd, ".kilo", "config.json"),
        path.join(cwd, ".kilo", "kilo.jsonc"),
        path.join(cwd, ".kilo", "kilo.json"),
    ];
    return scanKiloConfigs(localConfigs);
}
/**
 * Searches global Kilo CLI and Kilo Code user configurations for the active model.
 */
export function detectFromGlobalKilo() {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const appData = process.env.APPDATA || "";
    const globalConfigs = [
        path.join(home, ".config", "kilo", "kilo.jsonc"),
        path.join(home, ".config", "kilo", "kilo.json"),
        path.join(appData, "kilo", "kilo.jsonc"),
        path.join(appData, "kilo", "kilo.json"),
        path.join(appData, "kilo", "User", "settings.json"),
        path.join(home, ".kilo", "config.json"),
        path.join(home, ".kilo", "kilo.jsonc"),
    ];
    return scanKiloConfigs(globalConfigs);
}
/**
 * Combined Kilo detector checking workspace first then global.
 */
export function detectFromKilo(cwd = process.cwd()) {
    return detectFromLocalKilo(cwd) || detectFromGlobalKilo();
}
/**
 * Searches Claude Code configuration files for the configured model.
 */
export function detectFromClaudeCode(cwd = process.cwd()) {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const claudePaths = [
        path.join(cwd, ".claude", "settings.json"),
        path.join(home, ".claude", "settings.json"),
        path.join(home, ".claude.json"),
    ];
    for (const cp of claudePaths) {
        if (!fs.existsSync(cp))
            continue;
        try {
            const raw = fs.readFileSync(cp, "utf8");
            const match = raw.match(/"(?:model|ANTHROPIC_MODEL)"\s*:\s*"([^"\r\n]+)"/i);
            if (match && match[1] && !match[1].startsWith("__")) {
                return {
                    leader: match[1].trim(),
                    worker: match[1].trim(),
                    source: `Claude Code (${path.basename(cp)})`,
                };
            }
        }
        catch { }
    }
    return undefined;
}
/**
 * Searches editor settings.json files (VS Code, Kilo Code, Cursor, etc.)
 * for configured model environment variables and preferences.
 */
function detectFromEditorSettings() {
    const possiblePaths = [];
    const appData = process.env.APPDATA;
    const home = process.env.USERPROFILE || process.env.HOME || "";
    if (process.platform === "win32" && appData) {
        possiblePaths.push(path.join(appData, "Code", "User", "settings.json"), path.join(appData, "Cursor", "User", "settings.json"), path.join(appData, "kilo", "User", "settings.json"), path.join(appData, "ai.opencode.desktop", "User", "settings.json"));
    }
    else if (process.platform === "darwin") {
        possiblePaths.push(path.join(home, "Library", "Application Support", "Code", "User", "settings.json"), path.join(home, "Library", "Application Support", "Cursor", "User", "settings.json"), path.join(home, "Library", "Application Support", "kilo", "User", "settings.json"));
    }
    else if (process.platform === "linux") {
        possiblePaths.push(path.join(home, ".config", "Code", "User", "settings.json"), path.join(home, ".config", "Cursor", "User", "settings.json"), path.join(home, ".config", "kilo", "User", "settings.json"));
    }
    for (const settingsPath of possiblePaths) {
        if (!fs.existsSync(settingsPath))
            continue;
        try {
            const raw = fs.readFileSync(settingsPath, "utf8");
            const foundModel = extractModelFromRaw(raw);
            if (foundModel) {
                return {
                    leader: foundModel,
                    worker: foundModel,
                    source: `${path.basename(path.dirname(path.dirname(settingsPath)))} settings`,
                };
            }
        }
        catch { }
    }
    return undefined;
}
/**
 * Resolves the most actively modified project workspace from local agent runtimes (Kilo / OpenCode).
 * If the current working directory has no recent activity but another directory has active sessions,
 * returns that active directory.
 */
export function getActiveWorkspaceDir(defaultCwd) {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const root = defaultCwd || process.cwd();
    // If an explicit directory other than process.cwd() was specified, respect it
    if (defaultCwd && defaultCwd !== process.cwd()) {
        return defaultCwd;
    }
    let mostRecentDir = root;
    let mostRecentTime = 0;
    // 1. Check if root has a .swarm/state.json
    const defaultStatePath = path.join(root, ".swarm", "state.json");
    if (fs.existsSync(defaultStatePath)) {
        try {
            const stats = fs.statSync(defaultStatePath);
            mostRecentTime = stats.mtimeMs;
        }
        catch { }
    }
    // 2. Check Kilo runtime database for active sessions
    const kiloDbPath = path.join(home, ".local", "share", "kilo", "kilo.db");
    if (fs.existsSync(kiloDbPath)) {
        let db;
        try {
            const sqlite = requireModule("node:sqlite");
            db = new sqlite.DatabaseSync(kiloDbPath, { readOnly: true });
            const row = db.prepare(`
        SELECT directory, time_updated
        FROM session
        WHERE directory IS NOT NULL
        ORDER BY time_updated DESC
        LIMIT 1
      `).get();
            if (row && row.directory && fs.existsSync(row.directory)) {
                // If Kilo session was updated more recently than defaultCwd state
                if (row.time_updated > mostRecentTime) {
                    mostRecentTime = row.time_updated;
                    mostRecentDir = row.directory;
                }
            }
        }
        catch { }
        finally {
            try {
                if (db)
                    db.close();
            }
            catch { }
        }
    }
    // 3. Check OpenCode runtime database for active sessions
    const opencodeDbPath = path.join(home, ".local", "share", "opencode", "opencode.db");
    if (fs.existsSync(opencodeDbPath)) {
        let db;
        try {
            const sqlite = requireModule("node:sqlite");
            db = new sqlite.DatabaseSync(opencodeDbPath, { readOnly: true });
            const row = db.prepare(`
        SELECT directory, time_updated
        FROM session_v2
        WHERE directory IS NOT NULL
        ORDER BY time_updated DESC
        LIMIT 1
      `).get();
            if (row && row.directory && fs.existsSync(row.directory)) {
                if (row.time_updated > mostRecentTime) {
                    mostRecentTime = row.time_updated;
                    mostRecentDir = row.directory;
                }
            }
        }
        catch { }
        finally {
            try {
                if (db)
                    db.close();
            }
            catch { }
        }
    }
    return mostRecentDir;
}
// In-memory short-TTL caches to minimize SQLite disk I/O and prevent handle contention
let _cachedOpenCodeModel;
let _cachedOpenCodeSubagents;
let _cachedKiloModel;
let _cachedKiloSubagents;
/**
 * Formats model identifiers into human-friendly, accurate model display names.
 */
export function formatFriendlyModelName(modelId, providerId) {
    if (!modelId)
        return "Default Model";
    const m = modelId.toLowerCase();
    if (m.includes("mistral-large-4") || m.includes("mistral_large_4"))
        return "Mistral Large 4";
    if (m.includes("deepseek-v4.1-flash"))
        return "DeepSeek V4.1 Flash";
    if (m.includes("deepseek-v4-flash-0731") || m.includes("deepseek-v4-flash"))
        return "DeepSeek V4 Flash";
    if (m.includes("deepseek-v4-pro"))
        return "DeepSeek V4 Pro";
    if (m.includes("nemotron-3-ultra"))
        return "Nemotron 3 Ultra (free)";
    if (m.includes("nemotron-3.5-super-vl") || m.includes("nemotron-3.5-super"))
        return "Nemotron 3.5 Super VL (free)";
    if (m.includes("north-mini-code"))
        return "North Mini Code (free)";
    if (m.includes("ernie-5.5-flash"))
        return "ERNIE 5.5 Flash (free)";
    if (m.includes("glm-5.3-flash"))
        return "GLM 5.3 Flash";
    if (m.includes("minimax-m2.7") || m.includes("minimax-m3"))
        return "MiniMax M2.7";
    if (m.includes("gemini-3.5-flash"))
        return "Gemini 3.5 Flash";
    if (m.includes("gemini-3.8-flash"))
        return "Gemini 3.8 Flash";
    if (m.includes("gemini-4-hydrogen"))
        return "Gemini 4 Hydrogen";
    if (m.includes("gemini-4-carbon"))
        return "Gemini 4 Carbon";
    if (m.includes("claude-3-7-sonnet") || m.includes("claude-sonnet-4-5"))
        return "Claude 3.7 Sonnet";
    if (m.includes("kilo-auto") || m === "auto")
        return "Auto Free (Kilo)";
    if (modelId.includes("/")) {
        const parts = modelId.split("/");
        return parts[parts.length - 1].replace(/:free$/i, "");
    }
    return modelId;
}
/**
 * Detects active model and session metadata from Kilo local database (~/.local/share/kilo/kilo.db).
 */
export function detectFromKiloDb(cwd = process.cwd()) {
    const now = Date.now();
    if (_cachedKiloModel && _cachedKiloModel.cwd === cwd && now < _cachedKiloModel.expires) {
        return _cachedKiloModel.data;
    }
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const dbPath = path.join(home, ".local", "share", "kilo", "kilo.db");
    if (!fs.existsSync(dbPath)) {
        _cachedKiloModel = { cwd, data: undefined, expires: now + 5000 };
        return undefined;
    }
    let db;
    try {
        const sqlite = requireModule("node:sqlite");
        db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
        const normCwd = cwd.replace(/\\/g, "/");
        const base = path.basename(cwd);
        const stmt = db.prepare(`
      SELECT id, model, directory, title, time_updated
      FROM session
      WHERE directory = ? OR directory LIKE ?
      ORDER BY time_updated DESC
      LIMIT 1
    `);
        const row = stmt.get(normCwd, `%${base}%`);
        if (row && row.model) {
            let modelId = "";
            let provider = "";
            try {
                const parsed = JSON.parse(row.model);
                modelId = parsed.id || parsed.modelID || "";
                provider = parsed.providerID || "";
                if (parsed.providerID && parsed.providerID !== "kilo") {
                    modelId = `${parsed.providerID}/${modelId}`;
                }
            }
            catch {
                modelId = row.model;
            }
            // Check if actual executed model is recorded in latest parts
            try {
                const partStmt = db.prepare(`
          SELECT data FROM part
          WHERE session_id = ?
          ORDER BY time_created DESC
          LIMIT 10
        `);
                const parts = partStmt.all(row.id);
                for (const p of parts) {
                    try {
                        const pd = JSON.parse(p.data);
                        const actual = pd.model?.modelID || pd.modelID || pd.tokens?.model;
                        if (actual && typeof actual === "string" && actual !== "auto" && !actual.includes("kilo-auto")) {
                            modelId = actual;
                            if (pd.model?.providerID)
                                provider = pd.model.providerID;
                            break;
                        }
                    }
                    catch { }
                }
            }
            catch { }
            const cleanModel = formatFriendlyModelName(modelId, provider);
            const res = {
                leader: cleanModel,
                worker: cleanModel,
                source: `Kilo (${row.title || base})`,
                sessionId: row.id,
                timeUpdated: row.time_updated,
            };
            _cachedKiloModel = { cwd, data: res, expires: now + 1500 };
            return res;
        }
    }
    catch { }
    finally {
        try {
            if (db)
                db.close();
        }
        catch { }
    }
    _cachedKiloModel = { cwd, data: undefined, expires: now + 2000 };
    return undefined;
}
/**
 * Queries active child subagents created inside Kilo for the workspace root session.
 */
export function getKiloSubagents(cwd = process.cwd()) {
    const now = Date.now();
    if (_cachedKiloSubagents && _cachedKiloSubagents.cwd === cwd && now < _cachedKiloSubagents.expires) {
        return _cachedKiloSubagents.data;
    }
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const dbPath = path.join(home, ".local", "share", "kilo", "kilo.db");
    if (!fs.existsSync(dbPath)) {
        _cachedKiloSubagents = { cwd, data: undefined, expires: now + 5000 };
        return undefined;
    }
    let db;
    try {
        const sqlite = requireModule("node:sqlite");
        db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
        const normCwd = cwd.replace(/\\/g, "/");
        const base = path.basename(cwd);
        const rootStmt = db.prepare(`
      SELECT id, model, directory, title, time_updated
      FROM session
      WHERE (directory = ? OR directory LIKE ?) AND parent_id IS NULL
      ORDER BY time_updated DESC
      LIMIT 1
    `);
        const root = rootStmt.get(normCwd, `%${base}%`);
        if (!root) {
            _cachedKiloSubagents = { cwd, data: undefined, expires: now + 2000 };
            return undefined;
        }
        let rootModel = "DeepSeek V4.1 Flash";
        try {
            const p = JSON.parse(root.model);
            if (p.id) {
                rootModel = p.id;
            }
        }
        catch { }
        const childStmt = db.prepare(`
      SELECT id, slug, title, agent, model, time_created, time_updated
      FROM session
      WHERE parent_id = ?
      ORDER BY time_created DESC
    `);
        const children = childStmt.all(root.id);
        if (!children || children.length === 0) {
            _cachedKiloSubagents = { cwd, data: undefined, expires: now + 2000 };
            return undefined;
        }
        const result = [];
        const seenActiveRoles = new Set();
        for (const ch of children) {
            let chModel = rootModel;
            let chProvider = "";
            try {
                const cp = JSON.parse(ch.model);
                if (cp.id)
                    chModel = cp.id;
                if (cp.providerID)
                    chProvider = cp.providerID;
            }
            catch { }
            // Query latest parts for actual executed model and completion status
            let status = "working";
            try {
                const partStmt = db.prepare(`
          SELECT data FROM part
          WHERE session_id = ?
          ORDER BY time_created DESC
          LIMIT 5
        `);
                const parts = partStmt.all(ch.id);
                for (const pt of parts) {
                    try {
                        const pd = JSON.parse(pt.data);
                        const actual = pd.model?.modelID || pd.modelID || pd.tokens?.model;
                        if (actual && typeof actual === "string" && actual !== "auto" && !actual.includes("kilo-auto")) {
                            chModel = actual;
                            if (pd.model?.providerID)
                                chProvider = pd.model.providerID;
                        }
                        if (pd.type === "step-finish") {
                            if (pd.reason === "stop") {
                                status = "completed";
                            }
                            else if (pd.reason === "abort" || pd.reason === "error") {
                                status = "failed";
                            }
                        }
                    }
                    catch { }
                }
            }
            catch { }
            const cleanModel = formatFriendlyModelName(chModel, chProvider);
            const extractedFiles = ch.title ? (ch.title.match(/[a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]{1,6}/g) || []).filter((f) => !f.startsWith("http") && !f.includes("..")) : [];
            const roleMatch = ch.title?.match(/@([a-zA-Z0-9_-]+)\s+subagent/i);
            const subagentRole = ch.agent || (roleMatch ? roleMatch[1] : "author");
            const cleanBrief = ch.title ? ch.title.replace(/\s*\(@[a-zA-Z0-9_-]+\s+subagent\)/i, "").trim() : "Subagent task";
            // If this role was already claimed by a newer active subagent, mark older cohort as completed/superseded
            if (status === "working") {
                if (seenActiveRoles.has(subagentRole)) {
                    status = "completed";
                }
                else {
                    seenActiveRoles.add(subagentRole);
                }
            }
            const agentId = ch.slug || ch.id.slice(0, 12);
            const displayName = `${subagentRole} (${ch.slug || ch.id.slice(0, 8)})`;
            result.push({
                id: agentId,
                name: displayName,
                role: subagentRole,
                status,
                model: cleanModel,
                brief: cleanBrief,
                targetFiles: extractedFiles,
            });
        }
        // Sort so active running agents are displayed on top of completed ones
        result.sort((a, b) => {
            if (a.status === "working" && b.status !== "working")
                return -1;
            if (a.status !== "working" && b.status === "working")
                return 1;
            return 0;
        });
        _cachedKiloSubagents = { cwd, data: result, expires: now + 1500 };
        return result;
    }
    catch { }
    finally {
        try {
            if (db)
                db.close();
        }
        catch { }
    }
    _cachedKiloSubagents = { cwd, data: undefined, expires: now + 2000 };
    return undefined;
}
/**
 * Detects active model and session metadata from OpenCode local database (~/.local/share/opencode/opencode.db).
 */
export function detectFromOpenCode(cwd = process.cwd()) {
    const now = Date.now();
    if (_cachedOpenCodeModel && _cachedOpenCodeModel.cwd === cwd && now < _cachedOpenCodeModel.expires) {
        return _cachedOpenCodeModel.data;
    }
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const dbPath = path.join(home, ".local", "share", "opencode", "opencode.db");
    if (!fs.existsSync(dbPath)) {
        _cachedOpenCodeModel = { cwd, data: undefined, expires: now + 5000 };
        return undefined;
    }
    let db;
    try {
        const sqlite = requireModule("node:sqlite");
        db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
        const normCwd = cwd.replace(/\\/g, "/");
        const base = path.basename(cwd);
        const stmt = db.prepare(`
      SELECT id, model, directory, title, time_updated
      FROM session_v2
      WHERE directory = ? OR directory LIKE ?
      ORDER BY time_updated DESC
      LIMIT 1
    `);
        const row = stmt.get(normCwd, `%${base}%`);
        if (row && row.model) {
            let modelId = "";
            try {
                const parsed = JSON.parse(row.model);
                modelId = parsed.id || parsed.modelID || "";
                if (parsed.providerID && parsed.providerID !== "opencode") {
                    modelId = `${parsed.providerID}/${modelId}`;
                }
            }
            catch {
                modelId = row.model;
            }
            let cleanModel = modelId;
            if (modelId === "deepseek-v4.1-flash-free")
                cleanModel = "DeepSeek V4.1 Flash Free";
            else if (modelId.includes("deepseek-v4.1-flash"))
                cleanModel = "DeepSeek V4.1 Flash";
            else if (modelId.includes("deepseek-v4-flash"))
                cleanModel = "DeepSeek V4 Flash";
            const res = {
                leader: cleanModel,
                worker: cleanModel,
                source: `OpenCode (${row.title || base})`,
                sessionId: row.id,
                timeUpdated: row.time_updated,
            };
            _cachedOpenCodeModel = { cwd, data: res, expires: now + 1500 };
            return res;
        }
    }
    catch { }
    finally {
        try {
            if (db)
                db.close();
        }
        catch { }
    }
    _cachedOpenCodeModel = { cwd, data: undefined, expires: now + 2000 };
    return undefined;
}
/**
 * Queries active child subagents created inside OpenCode for the workspace root session.
 */
export function getOpenCodeSubagents(cwd = process.cwd()) {
    const now = Date.now();
    if (_cachedOpenCodeSubagents && _cachedOpenCodeSubagents.cwd === cwd && now < _cachedOpenCodeSubagents.expires) {
        return _cachedOpenCodeSubagents.data;
    }
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const dbPath = path.join(home, ".local", "share", "opencode", "opencode.db");
    if (!fs.existsSync(dbPath)) {
        _cachedOpenCodeSubagents = { cwd, data: undefined, expires: now + 5000 };
        return undefined;
    }
    let db;
    try {
        const sqlite = requireModule("node:sqlite");
        db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
        const normCwd = cwd.replace(/\\/g, "/");
        const base = path.basename(cwd);
        const rootStmt = db.prepare(`
      SELECT id, model, directory, title, time_updated
      FROM session_v2
      WHERE (directory = ? OR directory LIKE ?) AND parent_id IS NULL
      ORDER BY time_updated DESC
      LIMIT 1
    `);
        const root = rootStmt.get(normCwd, `%${base}%`);
        if (!root) {
            _cachedOpenCodeSubagents = { cwd, data: undefined, expires: now + 2000 };
            return undefined;
        }
        let rootModel = "DeepSeek V4.1 Flash Free";
        try {
            const p = JSON.parse(root.model);
            if (p.id) {
                rootModel = p.id === "deepseek-v4.1-flash-free" ? "DeepSeek V4.1 Flash Free" : p.id;
            }
        }
        catch { }
        const childStmt = db.prepare(`
      SELECT id, slug, title, agent, model, time_created, time_updated, idle_outcome
      FROM session_v2
      WHERE parent_id = ?
      ORDER BY time_created ASC
    `);
        const children = childStmt.all(root.id);
        if (!children || children.length === 0) {
            _cachedOpenCodeSubagents = { cwd, data: undefined, expires: now + 2000 };
            return undefined;
        }
        const roleMap = {
            "Scheduler + context switch": { id: "sched-worker", role: "author", files: ["kernel/src/sched.c", "kernel/src/switch.asm", "kernel/src/interrupt.c"] },
            "VFS + KFS filesystem": { id: "fs-worker", role: "author", files: ["kernel/fs/vfs.c", "kernel/fs/kfs.c"] },
            "Desktop apps + login UI": { id: "gui-apps-worker", role: "author", files: ["kernel/gui/apps.c", "kernel/gui/login.c"] },
            "Syscalls + IPC bus": { id: "syscall-worker", role: "author", files: ["kernel/src/syscall.c", "kernel/src/ipc.c"] },
        };
        const result = [];
        for (const ch of children) {
            let chModel = rootModel;
            try {
                const cp = JSON.parse(ch.model);
                if (cp.id) {
                    chModel = cp.id === "deepseek-v4.1-flash-free" ? "DeepSeek V4.1 Flash Free" : cp.id;
                }
            }
            catch { }
            let status = "working";
            if (ch.idle_outcome === "succeeded")
                status = "completed";
            else if (ch.idle_outcome === "failed")
                status = "failed";
            const preset = roleMap[ch.title] || {};
            // Dynamic fallback for any arbitrary project subagent
            const extractedFiles = preset.files || (ch.title ? (ch.title.match(/[a-zA-Z0-9_\-\.\/]+\.[a-zA-Z0-9]{1,6}/g) || []).filter((f) => !f.startsWith("http") && !f.includes("..")) : []);
            const fallbackId = ch.title ? ch.title.toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 20) : ch.id.slice(0, 12);
            const agentId = preset.id || ch.slug || fallbackId;
            result.push({
                id: agentId,
                name: agentId,
                role: preset.role || ch.agent || "author",
                status,
                model: chModel,
                brief: ch.title || "Subagent task",
                targetFiles: extractedFiles,
            });
        }
        _cachedOpenCodeSubagents = { cwd, data: result, expires: now + 1500 };
        return result;
    }
    catch { }
    finally {
        try {
            if (db)
                db.close();
        }
        catch { }
    }
    _cachedOpenCodeSubagents = { cwd, data: undefined, expires: now + 2000 };
    return undefined;
}
/**
 * Detects the most recently selected model from VS Code / Kilo Code global storage (state.vscdb).
 */
export function detectFromVscdb() {
    const appData = process.env.APPDATA;
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const candidates = [];
    if (process.platform === "win32" && appData) {
        candidates.push(path.join(appData, "Code", "User", "globalStorage", "state.vscdb"), path.join(appData, "Kiro", "User", "globalStorage", "state.vscdb"), path.join(appData, "kilo", "User", "globalStorage", "state.vscdb"), path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb"));
    }
    else if (process.platform === "darwin") {
        candidates.push(path.join(home, "Library", "Application Support", "Code", "User", "globalStorage", "state.vscdb"), path.join(home, "Library", "Application Support", "kilo", "User", "globalStorage", "state.vscdb"));
    }
    else {
        candidates.push(path.join(home, ".config", "Code", "User", "globalStorage", "state.vscdb"), path.join(home, ".config", "kilo", "User", "globalStorage", "state.vscdb"));
    }
    const prefixes = [
        "gonka/",
        "dahl/",
        "google/",
        "token_router/",
        "nvidiaintegrate/",
        "bedrockmantle/",
        "openrouter/",
        "kilo/"
    ];
    let bestModel;
    let maxTimestamp = 0;
    for (const dbPath of candidates) {
        if (!fs.existsSync(dbPath))
            continue;
        try {
            const buf = fs.readFileSync(dbPath);
            const str = buf.toString("latin1");
            const regex = /"([^"\\]+)":\s*\{\s*"count"\s*:\s*\d+\s*,\s*"lastUsed"\s*:\s*(\d+)/g;
            let match;
            while ((match = regex.exec(str)) !== null) {
                const rawModel = match[1];
                const time = parseInt(match[2], 10);
                if (time > maxTimestamp) {
                    maxTimestamp = time;
                    let cleaned = rawModel.trim();
                    for (const p of prefixes) {
                        if (cleaned.toLowerCase().startsWith(p)) {
                            cleaned = cleaned.slice(p.length);
                            break;
                        }
                    }
                    bestModel = cleaned;
                }
            }
        }
        catch { }
    }
    if (bestModel) {
        return {
            leader: bestModel,
            worker: bestModel,
            source: "VS Code / Kilo active model",
        };
    }
    return undefined;
}
/**
 * Normalizes an Antigravity raw model display name or identifier into a canonical model string.
 * e.g.:
 * - "Gemini 3.8 Flash (High)" -> "gemini-3.8-flash"
 * - "Gemini 4 Carbon" -> "gemini-4-carbon"
 * - "Gemini 3.8 Pro" -> "gemini-3.8-pro"
 * - "Claude Sonnet 4.6 (Thinking)" -> "claude-sonnet-4.6"
 * - "Claude 3.7 Sonnet" -> "claude-3-7-sonnet"
 */
export function normalizeAntigravityModel(rawName) {
    let clean = rawName.trim();
    clean = clean.replace(/\.+$/, "").trim();
    const lower = clean.toLowerCase();
    if (lower.includes("carbon"))
        return "gemini-4-carbon";
    if (lower.includes("flash-lite") || lower.includes("flash lite"))
        return "gemini-3.8-flash-lite";
    if (lower.includes("flash"))
        return "gemini-3.8-flash";
    if (lower.includes("pro"))
        return "gemini-3.8-pro";
    if (lower.includes("sonnet") && (lower.includes("4.6") || lower.includes("4-6")))
        return "claude-sonnet-4.6";
    if (lower.includes("sonnet") && (lower.includes("3.7") || lower.includes("3-7")))
        return "claude-3-7-sonnet";
    if (lower.includes("sonnet"))
        return "claude-3-5-sonnet";
    if (lower.includes("haiku"))
        return "claude-3-5-haiku";
    if (lower.includes("opus"))
        return "claude-3-opus";
    if (lower.includes("gpt-4o-mini") || lower.includes("gpt-4o mini"))
        return "gpt-4o-mini";
    if (lower.includes("gpt-4o"))
        return "gpt-4o";
    if (lower.includes("o1"))
        return "o1";
    if (lower.includes("o3"))
        return "o3";
    return clean.toLowerCase().replace(/[\(\)]/g, "").replace(/\s+/g, "-");
}
/**
 * Detects active model and environment when running inside Google Antigravity.
 */
export function detectFromAntigravity() {
    const appData = process.env.ANTIGRAVITY_APP_DATA_DIR ||
        (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, ".gemini", "antigravity") : undefined) ||
        (process.env.HOME ? path.join(process.env.HOME, ".gemini", "antigravity") : undefined);
    const isAntigravityAgent = !!(process.env.ANTIGRAVITY_AGENT ||
        process.env.ANTIGRAVITY_APP_DATA_DIR ||
        process.env.ANTIGRAVITY_CONVERSATION_ID);
    // 1. Process environment variables
    const envModel = process.env.ANTIGRAVITY_MODEL || process.env.GEMINI_MODEL;
    if (envModel && envModel.trim()) {
        const clean = envModel.trim();
        return {
            leader: clean,
            worker: clean,
            source: "Antigravity environment variable",
        };
    }
    // 2. Transcript of active conversation (or most recent session)
    const convoId = process.env.ANTIGRAVITY_CONVERSATION_ID;
    let targetTranscript;
    if (appData && convoId) {
        const candidate = path.join(appData, "brain", convoId, ".system_generated", "logs", "transcript.jsonl");
        if (fs.existsSync(candidate)) {
            targetTranscript = candidate;
        }
    }
    if (!targetTranscript && appData) {
        const brainDir = path.join(appData, "brain");
        if (fs.existsSync(brainDir)) {
            try {
                const entries = fs.readdirSync(brainDir, { withFileTypes: true });
                let latestMtime = 0;
                for (const ent of entries) {
                    if (!ent.isDirectory())
                        continue;
                    const candidate = path.join(brainDir, ent.name, ".system_generated", "logs", "transcript.jsonl");
                    if (fs.existsSync(candidate)) {
                        const stat = fs.statSync(candidate);
                        if (stat.mtimeMs > latestMtime) {
                            latestMtime = stat.mtimeMs;
                            targetTranscript = candidate;
                        }
                    }
                }
            }
            catch { }
        }
    }
    if (targetTranscript && fs.existsSync(targetTranscript)) {
        try {
            const raw = fs.readFileSync(targetTranscript, "utf8");
            // 1. Look for <USER_SETTINGS_CHANGE> blocks specifically
            const tagRegex = /<USER_SETTINGS_CHANGE>([\s\S]*?)<\/USER_SETTINGS_CHANGE>/g;
            const tagMatches = [...raw.matchAll(tagRegex)];
            if (tagMatches.length > 0) {
                for (let i = tagMatches.length - 1; i >= 0; i--) {
                    const inner = tagMatches[i][1];
                    const m = inner.match(/Model Selection[`'\"]?\s*(?:\\r|\\n|\r|\n)*from\s+[^\r\n]+?\s+to\s+([^\r\n]+?)(?:\.\s+No need|\.No need|\.$|$)/i);
                    if (m && m[1]) {
                        const normalized = normalizeAntigravityModel(m[1]);
                        if (normalized) {
                            const sessionLabel = convoId ? convoId.slice(0, 8) : path.basename(path.dirname(path.dirname(path.dirname(targetTranscript)))).slice(0, 8);
                            return {
                                leader: normalized,
                                worker: normalized,
                                source: `Antigravity session (${sessionLabel})`,
                            };
                        }
                    }
                }
            }
            // 2. Direct fallback regex across transcript lines without truncating at decimals
            const modelRegex = /Model Selection[`'\"]?\s*(?:\\r|\\n|\r|\n)*from\s+[^\r\n]+?\s+to\s+([^\r\n]+?)(?:\.\s+No need|\.No need|\.$|$)/gi;
            const matches = [...raw.matchAll(modelRegex)];
            if (matches.length > 0) {
                const lastMatch = matches[matches.length - 1][1].trim();
                const normalized = normalizeAntigravityModel(lastMatch);
                if (normalized) {
                    const sessionLabel = convoId ? convoId.slice(0, 8) : path.basename(path.dirname(path.dirname(path.dirname(targetTranscript)))).slice(0, 8);
                    return {
                        leader: normalized,
                        worker: normalized,
                        source: `Antigravity session (${sessionLabel})`,
                    };
                }
            }
        }
        catch { }
    }
    // 3. Antigravity state file (antigravity_state.pbtxt)
    if (appData) {
        const pbtxtPath = path.join(appData, "antigravity_state.pbtxt");
        if (fs.existsSync(pbtxtPath)) {
            try {
                const raw = fs.readFileSync(pbtxtPath, "utf8");
                const match = raw.match(/last_selected_agent_model:\s*([A-Za-z0-9_-]+)/);
                if (match && match[1]) {
                    const placeholder = match[1].trim();
                    let mapped = placeholder;
                    if (placeholder === "MODEL_PLACEHOLDER_M318")
                        mapped = "gemini-3.8-flash";
                    else if (placeholder.includes("CARBON") || placeholder.includes("M4"))
                        mapped = "gemini-4-carbon";
                    else if (placeholder.includes("PRO") || placeholder.includes("M318_PRO"))
                        mapped = "gemini-3.8-pro";
                    return {
                        leader: mapped,
                        worker: mapped,
                        source: "Antigravity state",
                    };
                }
            }
            catch { }
        }
    }
    // 4. If running inside Antigravity agent process, default to gemini-3.8-flash
    if (isAntigravityAgent) {
        return {
            leader: "gemini-3.8-flash",
            worker: "gemini-3.8-flash",
            source: "Antigravity default",
        };
    }
    return undefined;
}
/**
 * Returns the Teamwork-style model tier based on agent role, name, and task brief.
 * Roles:
 * - Stall monitor, narrator, telemetry, heartbeat -> flash_lite
 * - Lead, coordinator, architect, planner, security auditor, challenger -> pro
 * - General auditor, reviewer -> pro
 * - Verifier, syntax checker, test runner -> flash
 * - General coders, implementers, authors, builders -> flash
 */
export function getModelTierForRole(role, name, brief) {
    const combined = `${role || ""} ${name || ""} ${brief || ""}`.toLowerCase();
    // Tier 4: Lightweight monitor / narrator / heartbeat
    if (/(monitor|narrator|watchdog|heartbeat|pinger|telemetry|stall)/i.test(combined)) {
        return "flash_lite";
    }
    // Tier 1: Heavy reasoning / Orchestration / Architecture / Planner / Security
    if (/(lead|coordinator|architect|orchestrat|planner|director|interviewer|manager|chief|security|deepinvestigator)/i.test(combined)) {
        return "pro";
    }
    // Tier 3: Critical Audit / Reviewer / Challenger
    if (/(auditor|reviewer|challenger)/i.test(combined)) {
        return "pro";
    }
    // Tier 2: Verifiers / Checkers / Testers
    if (/(verifier|checker|tester|qa)/i.test(combined)) {
        return "flash";
    }
    // Tier 2: Coders / Authors / Workers / Implementers / DeepCoder
    if (/(worker|coder|deepcoder|developer|author|builder|engineer|impl|frontend|backend|parser|writer)/i.test(combined)) {
        return "flash";
    }
    return "flash";
}
/**
 * Detects the active provider family from an active or leader model identifier.
 */
export function detectProviderFamily(model) {
    if (!model)
        return "gemini";
    const m = model.toLowerCase();
    if (m.includes("gemini") || m.includes("carbon") || m.includes("gemma"))
        return "gemini";
    if (m.includes("claude") || m.includes("anthropic"))
        return "anthropic";
    if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("openai"))
        return "openai";
    if (m.includes("ollama") || m.includes("llama") || m.includes("qwen"))
        return "ollama";
    return "generic";
}
/**
 * Maps a tier (pro, flash, flash_lite) to a provider-specific canonical model name.
 */
export function mapTierToProviderModel(tier, family, activeLeaderModel) {
    // If leader model is an explicit custom model (e.g. "MiniMax-M2.7", "custom-model"), preserve it for standard tiers
    if (family === "generic" && activeLeaderModel && !["default", "inherit"].includes(activeLeaderModel)) {
        return activeLeaderModel;
    }
    switch (family) {
        case "gemini":
            if (tier === "pro") {
                if (activeLeaderModel && activeLeaderModel.toLowerCase().includes("carbon")) {
                    return "gemini-4-carbon";
                }
                return "gemini-3.8-pro";
            }
            if (tier === "flash_lite")
                return "gemini-3.8-flash-lite";
            return "gemini-3.8-flash";
        case "anthropic":
            if (tier === "pro")
                return "claude-3-7-sonnet";
            if (tier === "flash_lite")
                return "claude-3-5-haiku";
            return "claude-3-5-sonnet";
        case "openai":
            if (tier === "pro")
                return "gpt-4o";
            if (tier === "flash_lite")
                return "gpt-4o-mini";
            return "gpt-4o-mini";
        case "ollama":
            return activeLeaderModel || "qwen-2.5-coder";
        case "generic":
        default:
            if (activeLeaderModel && !["default", "inherit"].includes(activeLeaderModel)) {
                return activeLeaderModel;
            }
            return tier;
    }
}
/**
 * Automatically resolves the optimal model for an agent node following
 * Antigravity's Teamwork skill and native swarm model semantics:
 *
 * 1. User/Caller explicit override: If `requestedModel` is specified and not empty/"default"/"auto":
 *    - "inherit": Clones the source/parent model or leader model.
 *    - "pro" / "flash" / "flash_lite": Resolves to the active provider's tier model.
 *    - Exact model string (e.g. "claude-3-5-sonnet", "gemini-2.5-flash"): Returns verbatim.
 * 2. Fork inheritance: If forked from another agent, inherits the source agent's model.
 * 3. Helper inheritance: If spawned as a helper (parentId set), inherits parent's model.
 * 4. Teamwork Role Auto-Assignment:
 *    - Monitor/Narrator -> flash_lite
 *    - Architect/Lead/Planner -> pro
 *    - Verifier/Auditor -> pro or flash
 *    - Workers/Coders -> flash
 */
export function resolveModelForRole(options) {
    const req = (options.requestedModel || "").trim();
    // 1. Explicit model handling
    if (req && req !== "default" && req !== "auto") {
        const normReq = req.toLowerCase();
        if (normReq === "inherit" ||
            normReq === "same as parent" ||
            normReq === "same as parent model" ||
            normReq === "parent" ||
            normReq === "parent model" ||
            normReq === "same as leader") {
            if (options.sourceModel)
                return options.sourceModel;
            if (options.leaderModel && options.leaderModel !== "default")
                return options.leaderModel;
            const detected = detectActiveModelsSync(options.cwd);
            return detected.leaderModel || "gemini-3.8-flash";
        }
        if (["pro", "flash", "flash_lite"].includes(req.toLowerCase())) {
            const detected = detectActiveModelsSync(options.cwd);
            const active = options.leaderModel || detected.leaderModel;
            const family = detectProviderFamily(active);
            return mapTierToProviderModel(req.toLowerCase(), family, active);
        }
        // Specific concrete model passed by user or test (e.g. "claude-3-5-sonnet")
        return req;
    }
    // 2. Fork inheritance (when fork is not coordinator)
    if (options.fork && options.fork.trim() !== "coordinator" && options.sourceModel) {
        return options.sourceModel;
    }
    // 3. Helper inheritance
    if (options.parentId && options.sourceModel) {
        return options.sourceModel;
    }
    // 4. Coordinator fork
    if (options.fork && options.fork.trim() === "coordinator") {
        if (options.leaderModel && options.leaderModel !== "default")
            return options.leaderModel;
        const detected = detectActiveModelsSync(options.cwd);
        return detected.leaderModel || "gemini-3.8-flash";
    }
    // 5. Dynamic Teamwork Role Resolution & Quality Profile
    const detected = detectActiveModelsSync(options.cwd);
    const activeLeader = options.leaderModel || detected.leaderModel;
    const family = detectProviderFamily(activeLeader);
    const tier = getModelTierForRole(options.role, options.name, options.brief);
    // If leader is a specific custom model from Kilo / local config and role is standard worker/helper:
    if (family === "generic" && activeLeader && !["default", "inherit"].includes(activeLeader)) {
        return activeLeader;
    }
    // AUTOMATIC TEAMWORK MODEL ASSIGNMENT (Zero-Compromise Quality by Default):
    // Like Antigravity Teamwork and native swarm, workers automatically run on the user's
    // active model so work quality is NEVER compromised.
    // - Operational monitors / narrators / telemetry -> flash_lite (saves tokens on idle polling)
    // - High reasoning/orchestration roles (architect, planner, lead) -> pro/carbon tier
    // - Technical workers, coders, builders, verifiers -> automatically inherit the user's active model!
    // Only when qualityProfile is explicitly set to "tiered" or "economy" is down-tiering applied.
    const profile = options.qualityProfile || process.env.SWARM_QUALITY || "auto";
    if (profile === "tiered" || profile === "economy") {
        return mapTierToProviderModel(tier, family, activeLeader);
    }
    // Automatic Teamwork & Quality mode (default):
    if (tier === "flash_lite") {
        return mapTierToProviderModel("flash_lite", family, activeLeader);
    }
    // If role is pro (architect/lead/planner) and leader is a base flash model, upgrade to pro
    if (tier === "pro") {
        if (activeLeader && (activeLeader.includes("carbon") || activeLeader.includes("pro") || activeLeader.includes("sonnet-4") || activeLeader.includes("3-7") || activeLeader.includes("gpt-4o"))) {
            return activeLeader;
        }
        return mapTierToProviderModel("pro", family, activeLeader);
    }
    // Coding workers, verifiers, builders, implementers automatically inherit user's active model:
    if (activeLeader && activeLeader !== "default" && activeLeader !== "inherit") {
        return activeLeader;
    }
    return mapTierToProviderModel(tier, family, activeLeader);
}
/**
 * Automatically returns the next available fallback model in the provider's
 * hierarchy when a worker encounters quota exhaustion (HTTP 429 RESOURCE_EXHAUSTED).
 */
export function getQuotaFallbackModel(currentModel) {
    const m = (currentModel || "").toLowerCase().trim();
    // Gemini & Carbon failover hierarchy
    if (m.includes("carbon"))
        return "gemini-3.8-pro";
    if (m.includes("gemini") && m.includes("3.8") && m.includes("pro"))
        return "gemini-3.8-flash";
    if (m.includes("gemini") && m.includes("pro"))
        return "gemini-2.5-flash";
    if (m.includes("gemini") && m.includes("flash-lite"))
        return "gemini-3.8-flash";
    if (m.includes("gemini") && m.includes("flash"))
        return "gemini-3.8-flash-lite";
    // Claude failover hierarchy
    if (m.includes("claude-3-7") || m.includes("claude-3.7"))
        return "claude-3-5-sonnet";
    if (m.includes("claude-3-5-sonnet") || m.includes("claude-3.5-sonnet"))
        return "claude-3-5-haiku";
    if (m.includes("claude-3-opus") || m.includes("claude-opus"))
        return "claude-3-7-sonnet";
    // OpenAI failover hierarchy
    if (m === "o1" || m === "o3-mini")
        return "gpt-4o";
    if (m.includes("gpt-4o") && !m.includes("mini"))
        return "gpt-4o-mini";
    // Tier keywords
    if (m === "pro")
        return "flash";
    if (m === "flash")
        return "flash_lite";
    // Safe universal fallback
    return "gemini-3.8-flash";
}
/**
 * Returns available model options, including native Teamwork tiers
 * and modern Gemini 4 Carbon, Gemini 3.8, Claude, and OpenAI models.
 */
export function getAvailableModels(activeModel) {
    const tiers = ["inherit", "pro", "flash", "flash_lite"];
    const defaults = [
        "gemini-4-carbon",
        "gemini-3.8-pro",
        "gemini-3.8-flash",
        "gemini-3.8-flash-lite",
        "claude-3-7-sonnet",
        "claude-3-5-sonnet",
        "claude-3-5-haiku",
        "gpt-4o",
        "gpt-4o-mini",
        "o3-mini",
        "deepseek-coder-v2",
        "qwen-2.5-coder",
    ];
    const list = [];
    if (activeModel && activeModel !== "default" && !defaults.includes(activeModel) && !tiers.includes(activeModel)) {
        list.push(activeModel);
    }
    list.push(...tiers);
    list.push(...defaults);
    return Array.from(new Set(list));
}
/**
 * Searches .env and .env.local in the target workspace directory.
 */
function detectFromWorkspaceEnv(cwd) {
    const envFiles = [".env", ".env.local", ".env.development"];
    for (const f of envFiles) {
        const fullPath = path.resolve(cwd, f);
        if (!fs.existsSync(fullPath))
            continue;
        try {
            const content = fs.readFileSync(fullPath, "utf8");
            const lines = content.split(/\r?\n/);
            const parsed = {};
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith("#"))
                    continue;
                const eqIdx = trimmed.indexOf("=");
                if (eqIdx === -1)
                    continue;
                const key = trimmed.slice(0, eqIdx).trim();
                let val = trimmed.slice(eqIdx + 1).trim();
                if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
                    val = val.slice(1, -1);
                }
                parsed[key] = val;
            }
            const leader = parsed.SWARM_LEADER_MODEL ||
                parsed.LEADER_MODEL ||
                parsed.ANTHROPIC_MODEL ||
                parsed.OPENAI_MODEL ||
                parsed.GEMINI_MODEL ||
                parsed.MODEL;
            const worker = parsed.SWARM_MODEL ||
                parsed.WORKER_MODEL ||
                parsed.OLLAMA_MODEL ||
                leader;
            if (leader || worker) {
                return { leader, worker, source: f };
            }
        }
        catch { }
    }
    return undefined;
}
/**
 * Quick async probe to check local Ollama instance (350ms timeout).
 */
async function detectFromOllama() {
    return new Promise((resolve) => {
        const req = http.get("http://127.0.0.1:11434/api/tags", { timeout: 350 }, (res) => {
            if (res.statusCode !== 200)
                return resolve(undefined);
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
                try {
                    const parsed = JSON.parse(data);
                    const models = parsed.models || [];
                    if (models.length > 0) {
                        // Prioritize coder models if available
                        const coderModel = models.find((m) => m.name.includes("coder") || m.name.includes("code") || m.name.includes("qwen"));
                        resolve(coderModel ? coderModel.name : models[0].name);
                    }
                    else {
                        resolve(undefined);
                    }
                }
                catch {
                    resolve(undefined);
                }
            });
        });
        req.on("error", () => resolve(undefined));
        req.on("timeout", () => {
            req.destroy();
            resolve(undefined);
        });
    });
}
/**
 * Synchronous automatic model detector across environment variables,
 * editor settings, and workspace .env files.
 */
export function detectActiveModelsSync(cwd = process.cwd()) {
    // 1. Process environment variables (explicit user overrides)
    const envLeader = process.env.SWARM_LEADER_MODEL ||
        process.env.LEADER_MODEL ||
        process.env.ANTHROPIC_MODEL ||
        process.env.OPENAI_MODEL ||
        process.env.GEMINI_MODEL ||
        process.env.ANTIGRAVITY_MODEL;
    const envWorker = process.env.SWARM_MODEL ||
        process.env.WORKER_MODEL ||
        process.env.MODEL ||
        process.env.OLLAMA_MODEL ||
        envLeader;
    if (envLeader || envWorker) {
        return {
            leaderModel: envLeader || envWorker,
            workerModel: envWorker || envLeader,
            source: "process.env",
        };
    }
    // 2. Workspace .env files (project-specific overrides take precedence)
    const fromWorkspace = detectFromWorkspaceEnv(cwd);
    if (fromWorkspace && (fromWorkspace.leader || fromWorkspace.worker)) {
        return {
            leaderModel: fromWorkspace.leader || fromWorkspace.worker,
            workerModel: fromWorkspace.worker || fromWorkspace.leader,
            source: fromWorkspace.source,
        };
    }
    // 3. Workspace-local Kilo config (<cwd>/.kilo/config.json)
    const fromLocalKilo = detectFromLocalKilo(cwd);
    if (fromLocalKilo && (fromLocalKilo.leader || fromLocalKilo.worker)) {
        return {
            leaderModel: fromLocalKilo.leader || fromLocalKilo.worker,
            workerModel: fromLocalKilo.worker || fromLocalKilo.leader,
            source: fromLocalKilo.source,
        };
    }
    // 4. OpenCode & Kilo runtime database sessions (opencode.db / kilo.db)
    const fromOpenCode = detectFromOpenCode(cwd);
    const fromKiloDb = detectFromKiloDb(cwd);
    const activeDbSession = [fromOpenCode, fromKiloDb]
        .filter((s) => Boolean(s && (s.leader || s.worker)))
        .sort((a, b) => (b.timeUpdated || 0) - (a.timeUpdated || 0))[0];
    if (activeDbSession) {
        return {
            leaderModel: activeDbSession.leader || activeDbSession.worker,
            workerModel: activeDbSession.worker || activeDbSession.leader,
            source: activeDbSession.source,
        };
    }
    // 5. Active model selection in VS Code / Kilo Code (live dropdown selection in state.vscdb)
    const fromVscdb = detectFromVscdb();
    if (fromVscdb && (fromVscdb.leader || fromVscdb.worker)) {
        return {
            leaderModel: fromVscdb.leader || fromVscdb.worker,
            workerModel: fromVscdb.worker || fromVscdb.leader,
            source: fromVscdb.source,
        };
    }
    // 6. Antigravity environment (active session, conversation transcript, state)
    const fromAntigravity = detectFromAntigravity();
    if (fromAntigravity && (fromAntigravity.leader || fromAntigravity.worker)) {
        return {
            leaderModel: fromAntigravity.leader || fromAntigravity.worker,
            workerModel: fromAntigravity.worker || fromAntigravity.leader,
            source: fromAntigravity.source,
        };
    }
    // 7. Global Kilo CLI config (~/.config/kilo/kilo.jsonc)
    const fromGlobalKilo = detectFromGlobalKilo();
    if (fromGlobalKilo && (fromGlobalKilo.leader || fromGlobalKilo.worker)) {
        return {
            leaderModel: fromGlobalKilo.leader || fromGlobalKilo.worker,
            workerModel: fromGlobalKilo.worker || fromGlobalKilo.leader,
            source: fromGlobalKilo.source,
        };
    }
    // 8. Claude Code configurations
    const fromClaude = detectFromClaudeCode(cwd);
    if (fromClaude && (fromClaude.leader || fromClaude.worker)) {
        return {
            leaderModel: fromClaude.leader || fromClaude.worker,
            workerModel: fromClaude.worker || fromClaude.leader,
            source: fromClaude.source,
        };
    }
    // 9. Editor settings (VS Code / Cursor / Sleepy Code)
    const fromEditor = detectFromEditorSettings();
    if (fromEditor && (fromEditor.leader || fromEditor.worker)) {
        return {
            leaderModel: fromEditor.leader || fromEditor.worker,
            workerModel: fromEditor.worker || fromEditor.leader,
            source: fromEditor.source,
        };
    }
    return {
        leaderModel: "gemini-3.8-flash",
        workerModel: "gemini-3.8-flash",
        source: "default",
    };
}
/**
 * Full automatic model detector including async local Ollama probe.
 */
export async function detectActiveModels(cwd = process.cwd()) {
    // First, run synchronous checks
    const syncResult = detectActiveModelsSync(cwd);
    if (syncResult.leaderModel && syncResult.workerModel) {
        return syncResult;
    }
    // Next, probe local Ollama instance
    try {
        const ollamaModel = await detectFromOllama();
        if (ollamaModel) {
            return {
                leaderModel: syncResult.leaderModel || ollamaModel,
                workerModel: syncResult.workerModel || ollamaModel,
                source: "ollama (local)",
            };
        }
    }
    catch { }
    return syncResult;
}
export { detectAgentHarness, generateDynamicAgentTask, resolveWorkerCommandForHarness, buildWorkerEnvForHarness, } from "./harness.js";
