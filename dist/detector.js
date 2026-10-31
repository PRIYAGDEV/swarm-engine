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
        catch {
            // Ignore read errors on settings
        }
    }
    return undefined;
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
    // 1. Process environment variables
    const envLeader = process.env.SWARM_LEADER_MODEL ||
        process.env.LEADER_MODEL ||
        process.env.ANTHROPIC_MODEL ||
        process.env.OPENAI_MODEL ||
        process.env.GEMINI_MODEL;
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
    // 2. Editor settings (VS Code / Kilo Code / Cursor / Sleepy Code)
    const fromEditor = detectFromEditorSettings();
    if (fromEditor && (fromEditor.leader || fromEditor.worker)) {
        return {
            leaderModel: fromEditor.leader || fromEditor.worker,
            workerModel: fromEditor.worker || fromEditor.leader,
            source: fromEditor.source,
        };
    }
    // 3. Workspace .env files
    const fromWorkspace = detectFromWorkspaceEnv(cwd);
    if (fromWorkspace && (fromWorkspace.leader || fromWorkspace.worker)) {
        return {
            leaderModel: fromWorkspace.leader || fromWorkspace.worker,
            workerModel: fromWorkspace.worker || fromWorkspace.leader,
            source: fromWorkspace.source,
        };
    }
    return {};
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
