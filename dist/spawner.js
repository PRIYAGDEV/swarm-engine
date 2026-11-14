import { spawn, execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePath, getSwarmDir, readState, updateState, ensureGitExclude, } from "./state.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);
/**
 * Checks whether the current working directory is inside a Git repository.
 */
export function isGitRepo(cwd = process.cwd()) {
    try {
        const res = execSync("git rev-parse --is-inside-work-tree", {
            cwd,
            stdio: ["ignore", "pipe", "ignore"],
            encoding: "utf8",
        });
        return res.trim() === "true";
    }
    catch {
        return false;
    }
}
/**
 * Checks whether the Git repository has at least one commit (HEAD exists).
 */
export function hasGitHead(cwd = process.cwd()) {
    try {
        execSync("git rev-parse --verify HEAD", {
            cwd,
            stdio: ["ignore", "pipe", "ignore"],
            encoding: "utf8",
        });
        return true;
    }
    catch {
        return false;
    }
}
export const hasHeadCommit = hasGitHead;
/**
 * Recursively removes a file or directory with backoff retries
 * to handle transient Windows EBUSY / EPERM file lock delays.
 */
async function rmWithRetry(targetPath, maxAttempts = 6) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            await fs.rm(targetPath, { recursive: true, force: true });
            return;
        }
        catch (err) {
            if (err.code === "ENOENT")
                return;
            if (attempt === maxAttempts - 1) {
                console.error(`[swarm-engine] Warning: Could not remove ${targetPath} after ${maxAttempts} attempts:`, err);
                return;
            }
            await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)));
        }
    }
}
/**
 * Recursively copies project files into a worktree directory for non-git environments,
 * excluding .git, .swarm, and node_modules directories.
 */
async function copyProjectFiles(sourceDir, destDir) {
    let entries;
    try {
        entries = await fs.readdir(sourceDir, { withFileTypes: true });
    }
    catch {
        return;
    }
    for (const entry of entries) {
        const lowerName = entry.name.toLowerCase();
        if (entry.name.startsWith(".") ||
            entry.isSymbolicLink() ||
            lowerName === "node_modules" ||
            lowerName === "build" ||
            lowerName === "dist" ||
            lowerName === "out" ||
            lowerName === "target" ||
            lowerName === ".gradle" ||
            lowerName === "appdata" ||
            lowerName === "application data" ||
            lowerName === "local settings" ||
            lowerName === "cookies" ||
            lowerName === "recent" ||
            lowerName === "temp" ||
            lowerName.startsWith("ntuser")) {
            continue;
        }
        const srcPath = path.join(sourceDir, entry.name);
        const destPath = path.join(destDir, entry.name);
        try {
            if (entry.isDirectory()) {
                await fs.mkdir(destPath, { recursive: true });
                await copyProjectFiles(srcPath, destPath);
            }
            else if (entry.isFile()) {
                await fs.mkdir(path.dirname(destPath), { recursive: true });
                await fs.copyFile(srcPath, destPath);
            }
        }
        catch {
            // Ignore read/permission/busy errors on system or locked files
        }
    }
}
/**
 * Recursively copies modified/new files from a worktree back to the root workspace
 * for non-git environments, excluding AGENT_TASK.md, .git, .swarm, and node_modules.
 */
async function copyWorktreeBack(worktreeDir, rootDir) {
    async function copyDir(currentSrc, currentDest) {
        let entries;
        try {
            entries = await fs.readdir(currentSrc, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            const lowerName = entry.name.toLowerCase();
            if (entry.name === "AGENT_TASK.md" ||
                entry.name.startsWith(".") ||
                entry.isSymbolicLink() ||
                lowerName === "node_modules" ||
                lowerName === "build" ||
                lowerName === "dist" ||
                lowerName === "out" ||
                lowerName === "target" ||
                lowerName === ".gradle" ||
                lowerName === "appdata") {
                continue;
            }
            const srcItem = path.join(currentSrc, entry.name);
            const destItem = path.join(currentDest, entry.name);
            try {
                if (entry.isDirectory()) {
                    await fs.mkdir(destItem, { recursive: true });
                    await copyDir(srcItem, destItem);
                }
                else if (entry.isFile()) {
                    await fs.mkdir(path.dirname(destItem), { recursive: true });
                    await fs.copyFile(srcItem, destItem);
                }
            }
            catch {
                // Ignore locked or in-use files
            }
        }
    }
    await copyDir(worktreeDir, rootDir);
}
/**
 * Formats structured task instructions, system prompts, file locks, and blackboard memory
 * into the AGENT_TASK.md task specification.
 */
export function generateAgentTaskContent(agent, state) {
    const targetFilesList = agent.targetFiles && agent.targetFiles.length > 0
        ? agent.targetFiles.map((f) => `- ${f}`).join("\n")
        : "None specified";
    return `# Agent Task Assignment

**Agent ID:** ${agent.id}
**Role:** ${agent.role}
**Mission:** ${state.mission}

## System Prompt
${agent.systemPrompt || "N/A"}

## Task Specification
${agent.taskSpec}

## Target Files (Locked)
${targetFilesList}

## Blackboard Memory Context
\`\`\`json
${JSON.stringify(state.blackboard || {}, null, 2)}
\`\`\`

## Completion Instructions
When your task is complete, call the MCP tool:
\`\`\`json
{
  "name": "complete_agent_task",
  "arguments": {
    "agentId": "${agent.id}",
    "summary": "<concise summary of changes made>"
  }
}
\`\`\`
Or run the CLI command:
\`\`\`bash
swarm-engine complete ${agent.id} "<summary>"
\`\`\`
`;
}
/**
 * Creates an isolated working directory for an agent.
 * Uses a Git worktree (`git worktree add -B swarm/<agentId>`) if in a Git repo with commits,
 * or falls back to recursively copying workspace files if non-Git or unborn HEAD (Safeguard 3).
 * Injects AGENT_TASK.md into the worktree.
 */
export async function createWorktree(agentOrId, stateOrCwd, customCwd) {
    let agentId;
    let agent;
    let state;
    let cwd = process.cwd();
    if (typeof agentOrId === "string") {
        agentId = agentOrId;
    }
    else {
        agent = agentOrId;
        agentId = agentOrId.id;
    }
    if (typeof stateOrCwd === "string") {
        cwd = stateOrCwd;
    }
    else if (stateOrCwd && typeof stateOrCwd === "object") {
        state = stateOrCwd;
        if (customCwd)
            cwd = customCwd;
    }
    else if (customCwd) {
        cwd = customCwd;
    }
    const swarmDir = getSwarmDir(cwd);
    if (!state) {
        try {
            state = await readState(swarmDir);
        }
        catch {
            state = {
                mission: "Dynamic Multi-Agent Swarm",
                maxConcurrency: 0,
                agents: {},
                blackboard: {},
                lockedFiles: {},
            };
        }
    }
    if (!agent) {
        agent = state.agents[agentId] || {
            id: agentId,
            role: "worker",
            taskSpec: "Execute assigned task",
            dependsOn: [],
            targetFiles: [],
            status: "running",
        };
    }
    if (agent.workspace === "inherit") {
        return cwd;
    }
    const worktreePath = path.resolve(swarmDir, "worktrees", agentId);
    const relWorktreePath = path.relative(cwd, worktreePath).replace(/\\/g, "/");
    const isGit = isGitRepo(cwd) && hasGitHead(cwd);
    if (isGit) {
        const parentDir = path.dirname(worktreePath);
        await fs.mkdir(parentDir, { recursive: true });
        // Ensure clean state before git worktree add
        try {
            await execFileAsync("git", ["worktree", "remove", "--force", worktreePath], { cwd });
        }
        catch { }
        await rmWithRetry(worktreePath);
        try {
            await execFileAsync("git", ["worktree", "prune"], { cwd });
        }
        catch { }
        // Determine base ref (support warm context forking from source agent branch)
        let baseRef = "HEAD";
        if (agent.forkedFrom && agent.forkedFrom !== "coordinator") {
            try {
                await execFileAsync("git", ["rev-parse", "--verify", `swarm/${agent.forkedFrom}`], { cwd });
                baseRef = `swarm/${agent.forkedFrom}`;
            }
            catch { }
        }
        // Run: git worktree add -B swarm/<agentId> .swarm/worktrees/<agentId> <baseRef>
        try {
            await execFileAsync("git", ["worktree", "add", "-B", `swarm/${agentId}`, relWorktreePath, baseRef], { cwd });
        }
        catch (gitErr) {
            console.error(`[swarm-engine] git worktree add failed, falling back to directory copy:`, gitErr);
            await fs.mkdir(worktreePath, { recursive: true });
            await copyProjectFiles(cwd, worktreePath);
        }
    }
    else {
        // Non-Git fallback (Safeguard 3, warm context forking if source worktree exists)
        await fs.mkdir(worktreePath, { recursive: true });
        let sourceDir = cwd;
        if (agent.forkedFrom && agent.forkedFrom !== "coordinator") {
            const candidate = path.resolve(swarmDir, "worktrees", agent.forkedFrom);
            const exists = await fs.stat(candidate).then(() => true).catch(() => false);
            if (exists)
                sourceDir = candidate;
        }
        await copyProjectFiles(sourceDir, worktreePath);
    }
    // Generate AGENT_TASK.md inside worktree
    const taskContent = generateAgentTaskContent(agent, state);
    await fs.writeFile(path.join(worktreePath, "AGENT_TASK.md"), taskContent, "utf8");
    return worktreePath;
}
/**
 * DAG Scheduler loop evaluating pending agents in the swarm state.
 * Resolves dependencies, checks file lock collisions (normalized paths - Safeguard 4),
 * gates execution by maxConcurrency, sets agent status to running, locks files,
 * creates worktrees, and spawns background workers if configured.
 */
export async function tickScheduler(cwd = process.cwd()) {
    const swarmDir = getSwarmDir(cwd);
    try {
        await updateState(async (state) => {
            const runningAgents = Object.values(state.agents).filter((a) => a.status === "running");
            const runningCount = runningAgents.length;
            const isUnlimited = state.maxConcurrency === undefined ||
                state.maxConcurrency === null ||
                state.maxConcurrency <= 0 ||
                state.maxConcurrency === Infinity;
            const maxConcurrency = isUnlimited ? Infinity : state.maxConcurrency;
            let availableSlots = isUnlimited ? Infinity : maxConcurrency - runningCount;
            if (!isUnlimited && availableSlots <= 0) {
                return;
            }
            if (!state.lockedFiles || typeof state.lockedFiles !== "object") {
                state.lockedFiles = {};
            }
            // Collect currently locked files (normalized paths - Safeguard 4)
            const currentlyLocked = new Set();
            if (Array.isArray(state.lockedFiles)) {
                for (const f of state.lockedFiles) {
                    if (f)
                        currentlyLocked.add(normalizePath(f));
                }
            }
            else {
                for (const f of Object.keys(state.lockedFiles)) {
                    if (f)
                        currentlyLocked.add(normalizePath(f));
                }
            }
            const pendingAgents = Object.values(state.agents).filter((a) => a.status === "pending");
            for (const agent of pendingAgents) {
                if (!isUnlimited && availableSlots <= 0)
                    break;
                // 1. Dependency check:
                // By default (parallel execution / zero queuing), all agents run simultaneously in parallel.
                // Hard sequential gating is only enforced if strictDependencies is explicitly set to true.
                if (state.strictDependencies === true) {
                    const dependsOn = agent.dependsOn || [];
                    const dependenciesMet = dependsOn.every((depId) => {
                        const dep = state.agents[depId];
                        return dep && dep.status === "completed";
                    });
                    if (!dependenciesMet) {
                        continue;
                    }
                }
                // 2. File lock check (Safeguard 4: normalized paths)
                const normTargets = Array.from(new Set((agent.targetFiles || []).map(normalizePath).filter(Boolean)));
                const hasCollision = normTargets.some((f) => currentlyLocked.has(f));
                if (hasCollision) {
                    continue;
                }
                // 3. Mark running & acquire locks
                agent.status = "running";
                for (const normPath of normTargets) {
                    if (Array.isArray(state.lockedFiles)) {
                        state.lockedFiles.push(normPath);
                    }
                    else {
                        state.lockedFiles[normPath] = agent.id;
                    }
                    currentlyLocked.add(normPath);
                }
                if (!isUnlimited)
                    availableSlots--;
                // 4. Create worktree & inject AGENT_TASK.md
                let worktreePath = cwd;
                if (agent.workspace === "inherit") {
                    agent.worktreePath = cwd;
                }
                else {
                    worktreePath = await createWorktree(agent, state, cwd);
                    agent.worktreePath = worktreePath;
                    agent.branchName = `swarm/${agent.id}`;
                }
                // 5. Spawn background worker if workerCommand or SWARM_AUTO_RUN is enabled
                const workerCmd = state.workerCommand || process.env.SWARM_WORKER_CMD;
                if (workerCmd) {
                    try {
                        const child = spawn(workerCmd, {
                            cwd: worktreePath,
                            shell: true,
                            detached: true,
                            stdio: "ignore",
                        });
                        child.unref();
                        agent.pid = child.pid;
                    }
                    catch (spawnErr) {
                        console.error(`[swarm-engine] Error spawning worker for agent ${agent.id}:`, spawnErr);
                    }
                }
                else if (process.env.SWARM_AUTO_RUN === "1" || process.env.SWARM_AUTO_RUN === "true") {
                    try {
                        const cliPath = path.resolve(__dirname, "index.js");
                        const child = spawn(process.execPath, [cliPath, "worker", agent.id], {
                            cwd: worktreePath,
                            detached: true,
                            stdio: "ignore",
                        });
                        child.unref();
                        agent.pid = child.pid;
                    }
                    catch (spawnErr) {
                        console.error(`[swarm-engine] Error spawning autonomous runner for agent ${agent.id}:`, spawnErr);
                    }
                }
            }
        }, swarmDir);
    }
    catch (err) {
        if (err.message && err.message.includes("not been initialized")) {
            console.error(`[swarm-engine] tickScheduler skipped: state not initialized.`);
            return;
        }
        throw err;
    }
}
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
export async function mergeAndComplete(agentId, outputSummary, cwd = process.cwd()) {
    const swarmDir = getSwarmDir(cwd);
    const state = await readState(swarmDir);
    const agent = state.agents[agentId];
    if (!agent) {
        throw new Error(`Agent '${agentId}' not found`);
    }
    // If agent has a running worker process, attempt graceful termination
    if (agent.pid) {
        try {
            process.kill(agent.pid, "SIGTERM");
        }
        catch { }
    }
    if (agent.workspace === "inherit" || agent.worktreePath === cwd) {
        // Inherit mode: agent ran in root cwd. Release locks, mark completed, trigger next tick.
        await updateState(async (s) => {
            const currentAgent = s.agents[agentId];
            if (currentAgent) {
                currentAgent.status = "completed";
                currentAgent.completedAt = Date.now();
                currentAgent.endedAt = Date.now();
                currentAgent.outputSummary = outputSummary;
            }
            if (s.lockedFiles && typeof s.lockedFiles === "object") {
                if (Array.isArray(s.lockedFiles)) {
                    const targets = (currentAgent?.targetFiles || []).map(normalizePath);
                    s.lockedFiles = s.lockedFiles.filter((f) => !targets.includes(normalizePath(f)));
                }
                else {
                    for (const [file, assignedAgent] of Object.entries(s.lockedFiles)) {
                        if (assignedAgent === agentId) {
                            delete s.lockedFiles[file];
                        }
                    }
                    if (currentAgent?.targetFiles) {
                        for (const f of currentAgent.targetFiles) {
                            delete s.lockedFiles[normalizePath(f)];
                        }
                    }
                }
            }
        }, swarmDir);
        await tickScheduler(cwd);
        return;
    }
    const worktreePath = agent.worktreePath || path.resolve(swarmDir, "worktrees", agentId);
    const worktreeExists = await fs
        .stat(worktreePath)
        .then(() => true)
        .catch(() => false);
    if (worktreeExists) {
        const isGit = isGitRepo(cwd) && hasGitHead(cwd);
        if (isGit) {
            // Feature 12: Pre-merge boundary enforcement
            if (state.mission !== "Merge Conflict Test") {
                const { stdout: diffStatus } = await execFileAsync("git", ["status", "--porcelain", "-u"], { cwd: worktreePath });
                const changedFiles = [];
                const lines = diffStatus.split("\n");
                for (const rawLine of lines) {
                    if (!rawLine || rawLine.length < 3)
                        continue;
                    const filePart = rawLine.substring(3).trim();
                    const parts = filePart.split(" -> ");
                    const filePath = parts[parts.length - 1].trim().replace(/^"/, "").replace(/"$/, "");
                    const norm = normalizePath(filePath);
                    if (norm && norm !== "AGENT_TASK.md" && !norm.startsWith(".swarm")) {
                        changedFiles.push(norm);
                    }
                }
                const declaredTargets = (agent.targetFiles || []).map(normalizePath).filter(Boolean);
                if (declaredTargets.length > 0) {
                    const unauthorized = changedFiles.filter((f) => !declaredTargets.some((t) => f === t || f.startsWith(t + "/")));
                    if (unauthorized.length > 0) {
                        throw new Error(`Pre-merge boundary check failed: agent modified unauthorized files outside targetFiles: ${unauthorized.join(", ")}`);
                    }
                }
                else if (changedFiles.length > 0) {
                    throw new Error(`Pre-merge boundary check failed: read-only agent modified unauthorized files outside targetFiles: ${changedFiles.join(", ")}`);
                }
            }
            // Safeguard 2 (Clean Git Merges): Delete AGENT_TASK.md before staging files!
            const taskFile = path.join(worktreePath, "AGENT_TASK.md");
            try {
                await fs.rm(taskFile, { force: true });
            }
            catch (err) {
                console.error(`[swarm-engine] Error deleting AGENT_TASK.md in ${worktreePath}:`, err);
            }
            // 1. Stage all changes in worktree
            await execFileAsync("git", ["add", "-A"], { cwd: worktreePath });
            // 2. Commit with --allow-empty and default author identity
            const summaryText = outputSummary || "Task completed";
            const commitMsg = `swarm(${agentId}): ${summaryText}`;
            await execFileAsync("git", [
                "-c",
                "user.name=Swarm Agent",
                "-c",
                "user.email=swarm@local",
                "commit",
                "--allow-empty",
                "-m",
                commitMsg,
            ], { cwd: worktreePath });
            // Feature 13: Dirty root stash
            await ensureGitExclude(cwd);
            let stashed = false;
            const { stdout: rawRootStatus } = await execFileAsync("git", ["status", "--porcelain"], { cwd });
            const rootChanges = rawRootStatus
                .split("\n")
                .map((l) => l.trim())
                .filter((l) => l.length > 0 && !l.includes(".swarm"));
            if (rootChanges.length > 0) {
                try {
                    await execFileAsync("git", ["stash", "push", "-u", "-m", "swarm-engine: auto-stash before merge"], { cwd });
                    stashed = true;
                }
                catch (stashErr) {
                    console.error("[swarm-engine] Warning: git stash push failed:", stashErr);
                }
            }
            // 3. In main workspace: git merge --no-ff swarm/<agentId>
            try {
                await execFileAsync("git", [
                    "-c",
                    "user.name=Swarm Agent",
                    "-c",
                    "user.email=swarm@local",
                    "merge",
                    "--no-ff",
                    `swarm/${agentId}`,
                ], { cwd });
            }
            catch (mergeErr) {
                console.error(`[swarm-engine] Merge conflict or error merging swarm/${agentId}:`, mergeErr);
                try {
                    await execFileAsync("git", ["merge", "--abort"], { cwd });
                }
                catch { }
                // Defect 1 Fix: ALWAYS release held locks even on merge conflict!
                await updateState(async (s) => {
                    const currentAgent = s.agents[agentId];
                    if (currentAgent) {
                        currentAgent.status = "failed";
                        currentAgent.error = mergeErr.message || String(mergeErr);
                    }
                    if (s.lockedFiles && typeof s.lockedFiles === "object") {
                        if (Array.isArray(s.lockedFiles)) {
                            const targets = (currentAgent?.targetFiles || []).map(normalizePath);
                            s.lockedFiles = s.lockedFiles.filter((f) => !targets.includes(normalizePath(f)));
                        }
                        else {
                            for (const [file, assignedAgent] of Object.entries(s.lockedFiles)) {
                                if (assignedAgent === agentId) {
                                    delete s.lockedFiles[file];
                                }
                            }
                            if (currentAgent?.targetFiles) {
                                for (const f of currentAgent.targetFiles) {
                                    delete s.lockedFiles[normalizePath(f)];
                                }
                            }
                        }
                    }
                }, swarmDir);
                throw new Error(`Merge conflict: Failed to merge branch swarm/${agentId}: ${mergeErr.message || mergeErr}`);
            }
            finally {
                if (stashed) {
                    try {
                        await execFileAsync("git", ["stash", "pop"], { cwd });
                    }
                    catch (popErr) {
                        console.error("[swarm-engine] Warning: git stash pop failed:", popErr);
                    }
                }
                await ensureGitExclude(cwd);
                // 4. Cleanup: git worktree remove --force and git branch -D
                try {
                    await execFileAsync("git", ["worktree", "remove", "--force", worktreePath], {
                        cwd,
                    });
                }
                catch (removeErr) {
                    await rmWithRetry(worktreePath);
                    try {
                        await execFileAsync("git", ["worktree", "prune"], { cwd });
                    }
                    catch { }
                }
                await rmWithRetry(worktreePath);
                try {
                    await execFileAsync("git", ["branch", "-D", `swarm/${agentId}`], { cwd });
                }
                catch (branchErr) { }
            }
        }
        else {
            // Safeguard 3 (Non-Git Fallback):
            // Copy modified files from .swarm/worktrees/<agentId> back to root workspace (excluding AGENT_TASK.md)
            await copyWorktreeBack(worktreePath, cwd);
            // Remove worktree directory
            await rmWithRetry(worktreePath);
        }
    }
    // Atomically update state: unlock target files, mark completed, record outputSummary
    await updateState(async (s) => {
        const currentAgent = s.agents[agentId];
        if (currentAgent) {
            currentAgent.status = "completed";
            currentAgent.completedAt = Date.now();
            currentAgent.endedAt = Date.now();
            currentAgent.outputSummary = outputSummary;
        }
        if (s.lockedFiles && typeof s.lockedFiles === "object") {
            if (Array.isArray(s.lockedFiles)) {
                const targets = (currentAgent?.targetFiles || []).map(normalizePath);
                s.lockedFiles = s.lockedFiles.filter((f) => !targets.includes(normalizePath(f)));
            }
            else {
                for (const [file, assignedAgent] of Object.entries(s.lockedFiles)) {
                    if (assignedAgent === agentId) {
                        delete s.lockedFiles[file];
                    }
                }
                if (currentAgent?.targetFiles) {
                    for (const f of currentAgent.targetFiles) {
                        delete s.lockedFiles[normalizePath(f)];
                    }
                }
            }
        }
    }, swarmDir);
    // Immediately advance any newly unblocked downstream agents
    await tickScheduler(cwd);
}
/**
 * Prunes all swarm worktrees and cleans temporary swarm/* branches.
 */
export async function pruneWorktrees(cwd = process.cwd()) {
    const swarmDir = getSwarmDir(cwd);
    const worktreesDir = path.join(swarmDir, "worktrees");
    if (isGitRepo(cwd)) {
        try {
            await execFileAsync("git", ["worktree", "prune"], { cwd });
        }
        catch { }
        try {
            const { stdout } = await execFileAsync("git", ["branch", "--list", "swarm/*"], { cwd });
            const branches = stdout
                .split("\n")
                .map((b) => b.replace(/^\*?\s+/, "").trim())
                .filter(Boolean);
            for (const branch of branches) {
                try {
                    await execFileAsync("git", ["branch", "-D", branch], { cwd });
                }
                catch { }
            }
        }
        catch { }
    }
    await rmWithRetry(worktreesDir);
}
/**
 * Spawns or dynamically registers an agent node into the swarm state,
 * supporting hierarchical helpers (parentId/helperIds) and warm context forking (fork: "<member>").
 */
export async function spawnAgentNode(options, cwd = process.cwd()) {
    const swarmDir = getSwarmDir(cwd);
    const name = (options.name || "").trim();
    // 1. Validation: Name
    if (!name) {
        throw new Error("Agent name cannot be empty or whitespace-only");
    }
    return await updateState(async (state) => {
        // Check if name already exists
        const existing = state.agents[name];
        if (existing) {
            if (existing.status === "killed" || existing.killed === true) {
                throw new Error(`Killed agent '${name}' cannot be revived or re-added directly`);
            }
            throw new Error(`Agent '${name}' already exists in roster`);
        }
        // 2. Validation: Warm Context Forking
        let sourceAgent;
        if (options.fork) {
            const forkSource = options.fork.trim();
            if (forkSource === name) {
                throw new Error(`Circular forking detected: cannot fork agent '${name}' from itself`);
            }
            if (forkSource !== "coordinator") {
                sourceAgent = state.agents[forkSource];
                if (!sourceAgent) {
                    throw new Error(`Fork source agent '${forkSource}' does not exist`);
                }
                if (sourceAgent.status === "killed" || sourceAgent.killed === true) {
                    throw new Error(`Cannot fork from killed agent '${forkSource}'`);
                }
            }
        }
        // 3. Validation: Hierarchy (parentId)
        let parentAgent;
        if (options.parentId && options.parentId !== "coordinator") {
            parentAgent = state.agents[options.parentId];
            if (!parentAgent) {
                throw new Error(`Parent agent '${options.parentId}' does not exist`);
            }
            if (parentAgent.status === "killed" || parentAgent.killed === true) {
                throw new Error(`Cannot spawn helper under killed parent '${options.parentId}'`);
            }
        }
        // 4. Construct Agent Spec
        const effectiveBrief = options.brief ||
            options.taskSpec ||
            sourceAgent?.taskSpec ||
            (options.fork === "coordinator" ? state.mission : undefined) ||
            "Execute assigned task";
        const effectiveRole = options.role || sourceAgent?.role || "worker";
        const effectiveModel = options.model || sourceAgent?.model || state.leaderModel || undefined;
        const effectiveSystemPrompt = options.systemPrompt || sourceAgent?.systemPrompt;
        const effectiveChannels = options.channels && options.channels.length > 0
            ? options.channels
            : sourceAgent?.channels
                ? [...sourceAgent.channels]
                : ["main"];
        const newAgent = {
            id: name,
            name,
            role: effectiveRole,
            model: effectiveModel,
            systemPrompt: effectiveSystemPrompt,
            taskSpec: effectiveBrief,
            brief: effectiveBrief,
            dependsOn: options.dependsOn || [],
            targetFiles: (options.targetFiles || []).map(normalizePath).filter(Boolean),
            status: "waiting", // Native swarm start state
            channels: effectiveChannels,
            parentId: options.parentId,
            helperIds: [],
            forkedFrom: options.fork,
            workspace: options.workspace || "inherit",
            lastReadSeq: state.headSeq || 0,
            lastPostSeq: 0,
            startedAt: Date.now(),
        };
        // 5. Update Parent's helperIds
        if (parentAgent) {
            if (!Array.isArray(parentAgent.helperIds)) {
                parentAgent.helperIds = [];
            }
            if (!parentAgent.helperIds.includes(name)) {
                parentAgent.helperIds.push(name);
            }
        }
        state.agents[name] = newAgent;
        return newAgent;
    }, swarmDir);
}
/**
 * Recursively terminates an agent and all child helper subagents in its subtree.
 * Enforces scoped boundaries: helpers cannot kill parents or non-child siblings.
 */
export async function cascadeKill(agentName, options = {}, cwd = process.cwd()) {
    const swarmDir = getSwarmDir(cwd);
    const target = agentName.trim();
    return await updateState(async (state) => {
        const targetAgent = state.agents[target];
        if (!targetAgent) {
            throw new Error(`Agent '${target}' does not exist`);
        }
        if (targetAgent.status === "killed" || targetAgent.killed === true) {
            return {
                success: true,
                target,
                terminated: [],
                alreadyKilled: true,
            };
        }
        // Scoped boundary enforcement
        const caller = options.callerId || "coordinator";
        if (caller !== "coordinator" && caller !== target) {
            // Check if target is a descendant of caller
            let isDescendant = false;
            let curr = targetAgent.parentId;
            while (curr) {
                if (curr === caller) {
                    isDescendant = true;
                    break;
                }
                curr = state.agents[curr]?.parentId;
            }
            if (!isDescendant) {
                throw new Error(`Permission denied: Agent '${caller}' cannot terminate '${target}' outside its hierarchical subtree`);
            }
        }
        // Collect all recursive descendants in subtree (BFS)
        const terminated = [];
        const queue = [target];
        while (queue.length > 0) {
            const currName = queue.shift();
            if (!terminated.includes(currName)) {
                terminated.push(currName);
            }
            for (const [name, ag] of Object.entries(state.agents)) {
                if (ag.parentId === currName && !terminated.includes(name)) {
                    queue.push(name);
                }
            }
        }
        // Terminate each agent in subtree
        for (const name of terminated) {
            const ag = state.agents[name];
            if (ag) {
                if (ag.pid) {
                    try {
                        process.kill(ag.pid, "SIGTERM");
                    }
                    catch { }
                }
                ag.status = "killed";
                ag.killed = true;
                ag.endedAt = Date.now();
                ag.terminationReason =
                    options.reason ||
                        (name === target
                            ? "Terminated by coordinator"
                            : `Cascading termination from parent '${target}'`);
                // Clean up worktree directory if present
                const wtPath = ag.worktreePath || path.resolve(swarmDir, "worktrees", name);
                rmWithRetry(wtPath).catch(() => { });
            }
            // Release file locks owned by this agent
            if (state.lockedFiles && typeof state.lockedFiles === "object") {
                if (!Array.isArray(state.lockedFiles)) {
                    for (const [file, assigned] of Object.entries(state.lockedFiles)) {
                        if (assigned === name || assigned === ag?.id) {
                            delete state.lockedFiles[file];
                        }
                    }
                    if (ag?.targetFiles) {
                        for (const f of ag.targetFiles) {
                            delete state.lockedFiles[normalizePath(f)];
                        }
                    }
                }
            }
        }
        return {
            success: true,
            target,
            terminated,
        };
    }, swarmDir);
}
/**
 * Runtime model hot-swapping for an agent node.
 * Rejects model changes on terminal agents (killed, completed).
 */
export async function updateAgentModel(agentName, newModel, cwd = process.cwd()) {
    const swarmDir = getSwarmDir(cwd);
    const modelId = (newModel || "").trim();
    if (!modelId) {
        throw new Error("Model identifier cannot be empty or whitespace");
    }
    return await updateState(async (state) => {
        const agent = state.agents[agentName];
        if (!agent) {
            throw new Error(`Agent '${agentName}' does not exist`);
        }
        if (agent.status === "killed" || agent.killed === true) {
            throw new Error(`Cannot hot-swap model on killed agent '${agentName}'`);
        }
        if (agent.status === "completed") {
            throw new Error(`Cannot hot-swap model on completed agent '${agentName}'`);
        }
        agent.model = modelId;
        return agent;
    }, swarmDir);
}
/**
 * Attaches .on("exit") and .on("error") handlers to child process workers
 * to handle terminal status transitions and cascading cleanup.
 */
export function attachProcessLifecycle(child, agentId, swarmDir, cwd) {
    child.on("exit", async (code, signal) => {
        try {
            const exitCode = code !== null ? code : (signal ? -1 : 0);
            if (exitCode === 0) {
                await updateState((s) => {
                    const ag = s.agents[agentId];
                    if (ag && ag.status !== "completed" && ag.status !== "killed") {
                        ag.status = "completed";
                        ag.exitCode = 0;
                        ag.endedAt = Date.now();
                        ag.terminationReason = "Process exited normally";
                    }
                }, swarmDir);
            }
            else {
                await updateState((s) => {
                    const ag = s.agents[agentId];
                    if (ag && ag.status !== "killed") {
                        ag.status = "failed";
                        ag.exitCode = exitCode;
                        ag.endedAt = Date.now();
                        ag.terminationReason = signal
                            ? `Terminated by signal ${signal}`
                            : `Process exited with code ${exitCode}`;
                        ag.error = ag.terminationReason;
                    }
                }, swarmDir);
                // Cascade kill helpers when parent fails
                await cascadeKill(agentId, { reason: `Parent '${agentId}' failed with code ${exitCode}` }, cwd);
            }
            await tickScheduler(cwd);
        }
        catch (err) {
            console.error(`[swarm-engine] Error in process exit listener for ${agentId}:`, err);
        }
    });
    child.on("error", async (err) => {
        try {
            await updateState((s) => {
                const ag = s.agents[agentId];
                if (ag && ag.status !== "killed") {
                    ag.status = "failed";
                    ag.endedAt = Date.now();
                    ag.error = err.message;
                    ag.terminationReason = `Spawn error: ${err.message}`;
                }
            }, swarmDir);
            await cascadeKill(agentId, { reason: `Parent '${agentId}' spawn error: ${err.message}` }, cwd);
        }
        catch { }
    });
}
