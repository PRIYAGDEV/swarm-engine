#!/usr/bin/env node
/**
 * Swarm Engine CLI Entrypoint
 *
 * Provides command-line subcommands:
 * - mcp: Start stdio Model Context Protocol (MCP) server
 * - init: Initialize .swarm/, configure .gitignore, and create AGENTS.md
 * - status: Display swarm state table or raw JSON (--json)
 * - watch: Live 2-second autorefresh status dashboard
 * - reset: Prune git worktrees, delete swarm branches, and reset state
 * - complete: Commit and merge a completed agent task
 */
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { initState, readState, updateState, releaseLock, getSwarmDir, } from "./state.js";
import { pruneWorktrees, mergeAndComplete, tickScheduler } from "./spawner.js";
import { startMcpServer } from "./mcp.js";
import { renderDashboard } from "./tui.js";
import { runAgentWorker } from "./runner.js";
/**
 * Helper to retrieve the string value of a command-line flag.
 * Supports both '--flag value' and '--flag=value'.
 */
function getFlagValue(args, flag) {
    const index = args.indexOf(flag);
    if (index !== -1 && index + 1 < args.length && !args[index + 1].startsWith("-")) {
        return args[index + 1];
    }
    const prefix = `${flag}=`;
    const match = args.find((a) => a.startsWith(prefix));
    if (match) {
        return match.slice(prefix.length);
    }
    return undefined;
}
/**
 * Helper to check whether any of the given flags are present.
 */
function hasFlag(args, ...flags) {
    return args.some((a) => flags.includes(a));
}
/**
 * Formats structured SwarmState into an aligned ASCII status table.
 */
function formatStatusTable(state) {
    const agents = Object.values(state.agents || {});
    const running = agents.filter((a) => a.status === "running").length;
    const total = agents.length;
    const lines = [];
    lines.push("================================================================================");
    lines.push("SWARM ENGINE STATUS");
    lines.push("================================================================================");
    lines.push(`Mission:     ${state.mission || "N/A"}`);
    lines.push(`Concurrency: ${running} / ${state.maxConcurrency || 4} active (${total} total agents)`);
    if (state.workerCommand) {
        lines.push(`Worker:      ${state.workerCommand}`);
    }
    lines.push("--------------------------------------------------------------------------------");
    lines.push("AGENTS:");
    if (agents.length === 0) {
        lines.push("  (no agents registered)");
    }
    else {
        const idWidth = Math.max(16, ...agents.map((a) => a.id.length));
        const roleWidth = Math.max(14, ...agents.map((a) => a.role.length));
        const statusWidth = 11;
        const depWidth = Math.max(12, ...agents.map((a) => (a.dependsOn && a.dependsOn.length > 0 ? a.dependsOn.join(",") : "-").length));
        const targetWidth = Math.max(14, ...agents.map((a) => (a.targetFiles && a.targetFiles.length > 0 ? a.targetFiles.join(",") : "-").length));
        const header = [
            "ID".padEnd(idWidth),
            "ROLE".padEnd(roleWidth),
            "STATUS".padEnd(statusWidth),
            "DEPENDS ON".padEnd(depWidth),
            "TARGET FILES".padEnd(targetWidth),
            "OUTPUT SUMMARY / WORKTREE",
        ].join("  ");
        lines.push(header);
        lines.push("-".repeat(Math.max(80, header.length)));
        for (const a of agents) {
            const deps = a.dependsOn && a.dependsOn.length > 0 ? a.dependsOn.join(",") : "-";
            const targets = a.targetFiles && a.targetFiles.length > 0 ? a.targetFiles.join(",") : "-";
            const info = a.outputSummary || a.worktreePath || "-";
            lines.push([
                a.id.padEnd(idWidth),
                a.role.padEnd(roleWidth),
                a.status.toUpperCase().padEnd(statusWidth),
                deps.padEnd(depWidth),
                targets.padEnd(targetWidth),
                info,
            ].join("  "));
        }
    }
    lines.push("--------------------------------------------------------------------------------");
    // Active File Locks
    lines.push("ACTIVE FILE LOCKS:");
    let locks = [];
    if (Array.isArray(state.lockedFiles)) {
        locks = state.lockedFiles.map((f) => `  - ${f}`);
    }
    else if (state.lockedFiles && typeof state.lockedFiles === "object") {
        locks = Object.entries(state.lockedFiles).map(([f, id]) => `  - ${f} (${id})`);
    }
    if (locks.length === 0) {
        lines.push("  (none)");
    }
    else {
        lines.push(...locks);
    }
    lines.push("");
    // Blackboard
    lines.push("BLACKBOARD KEYS:");
    const bbKeys = Object.keys(state.blackboard || {});
    if (bbKeys.length === 0) {
        lines.push("  (empty)");
    }
    else {
        for (const k of bbKeys) {
            const val = state.blackboard[k];
            const preview = typeof val === "object" ? JSON.stringify(val) : String(val);
            lines.push(`  - ${k}: ${preview}`);
        }
    }
    lines.push("================================================================================");
    return lines.join("\n");
}
/**
 * Safeguard 2: Automatically updates .gitignore to include .swarm/ and AGENT_TASK.md.
 */
async function ensureGitignore(cwd) {
    const gitignorePath = path.join(cwd, ".gitignore");
    let content = "";
    try {
        content = await fs.readFile(gitignorePath, "utf8");
    }
    catch (err) {
        if (err.code !== "ENOENT")
            throw err;
    }
    const lines = content ? content.split(/\r?\n/) : [];
    const normalizedLines = lines.map((l) => l.trim());
    let modified = false;
    if (!normalizedLines.includes(".swarm/") && !normalizedLines.includes(".swarm")) {
        lines.push(".swarm/");
        modified = true;
    }
    if (!normalizedLines.includes("AGENT_TASK.md")) {
        lines.push("AGENT_TASK.md");
        modified = true;
    }
    if (modified || !content) {
        const newContent = lines.filter((l) => l.length > 0).join("\n") + "\n";
        await fs.writeFile(gitignorePath, newContent, "utf8");
    }
}
/**
 * Generates the universal AGENTS.md instruction guide in the workspace root.
 */
function generateAgentsMarkdown() {
    return `# Swarm Engine — Agent Coordination Protocol

This repository is powered by **Swarm Engine**, a multi-agent orchestration framework designed to coordinate parallel AI coding agents using Model Context Protocol (MCP) tools, isolated Git worktrees, atomic file locking, and shared blackboard memory.

## Architecture & How It Works

1. **DAG Scheduling & Concurrency**:
   - Swarm Engine schedules tasks using a Directed Acyclic Graph (DAG) with dependency tracking (\`dependsOn\`).
   - Tasks execute up to \`maxConcurrency\` (default: 4) parallel workers.
   - Dependent tasks are automatically queued as \`pending\` and advance to \`running\` as prerequisites complete.

2. **Git Worktree Isolation**:
   - Each running agent operates in an isolated directory at \`.swarm/worktrees/<agentId>\` on branch \`swarm/<agentId>\`.
   - Worktrees prevent concurrent file write conflicts between agents.
   - For non-git or unborn repositories, an automatic recursive copy fallback is used.
   - Inside each worktree, \`AGENT_TASK.md\` contains the assigned task spec, role, target files, and blackboard context.

3. **Atomic File Locking (Safeguard 4)**:
   - When an agent is scheduled, its \`targetFiles\` are normalized and locked in \`.swarm/state.json\`.
   - No two concurrent agents can modify the same file simultaneously.

4. **Shared Blackboard Memory**:
   - Agents read and publish shared schemas, API contracts, interfaces, and shared state keys via the blackboard.

5. **Clean Merges & History Hygiene (Safeguard 2)**:
   - When an agent completes, its \`AGENT_TASK.md\` is automatically removed before committing.
   - Changes are cleanly merged to the main branch (\`--no-ff\`), worktrees and temporary branches are pruned, and file locks are released.

---

## MCP Tools Reference

If you are connected to the Swarm Engine MCP Server, you have access to the following 6 tools:

| MCP Tool | Description |
|---|---|
| \`spawn_swarm\` | Initializes or updates the swarm mission and enqueues 1..N initial agents forming a DAG. |
| \`add_dynamic_agent\` | Dynamically adds an on-the-fly specialist agent mid-flight with dependency and lock validation. |
| \`pull_agent_task\` | Claims or views the next ready task or inspects a specific agent's assigned task and context. |
| \`write_blackboard\` | Stores or updates shared memory (contracts, schemas, or memory keys) visible to all agents. |
| \`complete_agent_task\` | Commits worktree changes, cleanly merges to main, deletes worktree and branch, releases locks, and unblocks downstream agents. |
| \`get_swarm_status\` | Returns a complete snapshot of mission, concurrency, agents, file locks, and blackboard keys. |

---

## Standard Agent Workflow

### 1. Inspect Swarm Status
Check active agents, file locks, and blackboard state:
\`\`\`json
{
  "name": "get_swarm_status",
  "arguments": { "detail": false }
}
\`\`\`

### 2. Pull Your Task
Claim the next available task (or a specific agent ID):
\`\`\`json
{
  "name": "pull_agent_task",
  "arguments": {}
}
\`\`\`
This returns:
- \`worktreePath\`: Path to your isolated working directory (e.g. \`.swarm/worktrees/agent-123\`)
- \`taskSpec\`: Specific instructions and requirements for your task
- \`targetFiles\`: The files you are authorized and locked to edit
- \`blackboard\`: Shared data and contracts from prior agents

### 3. Implement in Your Worktree
Navigate to \`worktreePath\`. Only modify the designated \`targetFiles\`. Do not edit files outside your assigned worktree.

### 4. Share Knowledge on Blackboard
If you create a data contract, schema, or export that subsequent agents need:
\`\`\`json
{
  "name": "write_blackboard",
  "arguments": {
    "key": "user_schema",
    "value": { "type": "object", "properties": { "id": "string", "name": "string" } }
  }
}
\`\`\`

### 5. Complete Task
When finished and verified:
\`\`\`json
{
  "name": "complete_agent_task",
  "arguments": {
    "agentId": "<your-agent-id>",
    "summary": "Implemented user schema and unit tests"
  }
}
\`\`\`
Swarm Engine will automatically commit your changes, merge them back to the main repository, clean up the worktree, release your file locks, and schedule any downstream agents waiting on you.

---

## Rules for Agents

- **DO NOT** edit \`.swarm/state.json\` manually; all updates must go through MCP tools or CLI commands.
- **DO NOT** commit \`AGENT_TASK.md\` (Swarm Engine handles this automatically).
- **DO NOT** touch files outside your assigned \`targetFiles\` without acquiring them or adding a dynamic agent.
- Keep output summaries clear and descriptive for git commit messages.
`;
}
/**
 * Handles the 'init' subcommand.
 */
async function handleInit(args, cwd = process.cwd()) {
    const swarmDir = getSwarmDir(cwd);
    // Parse optional mission argument (first non-flag argument)
    let mission = "Default Swarm Mission";
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith("-")) {
            if (arg === "--concurrency" || arg === "--worker")
                i++;
            continue;
        }
        mission = arg;
        break;
    }
    // Parse concurrency
    let concurrency = 4;
    const concurrencyStr = getFlagValue(args, "--concurrency");
    if (concurrencyStr) {
        const parsed = parseInt(concurrencyStr, 10);
        if (!isNaN(parsed) && parsed > 0)
            concurrency = parsed;
    }
    // Parse workerCommand
    const workerCommand = getFlagValue(args, "--worker");
    const leaderModel = getFlagValue(args, "--leader-model") || getFlagValue(args, "-lm") || process.env.SWARM_LEADER_MODEL || process.env.LEADER_MODEL || undefined;
    // Create .swarm and .swarm/worktrees
    await fs.mkdir(path.join(swarmDir, "worktrees"), { recursive: true });
    // Initialize state
    await initState(mission, concurrency, workerCommand, swarmDir, leaderModel);
    // Safeguard 2: Update .gitignore
    await ensureGitignore(cwd);
    // Generate AGENTS.md in workspace root
    const agentsMdPath = path.join(cwd, "AGENTS.md");
    await fs.writeFile(agentsMdPath, generateAgentsMarkdown(), "utf8");
    // Output confirmation and MCP config snippets
    console.log("✓ Initialized .swarm directory");
    console.log("✓ Updated .gitignore with .swarm/ and AGENT_TASK.md");
    console.log("✓ Created AGENTS.md instruction file");
    console.log("");
    console.log("Add swarm-engine to your MCP client configuration:");
    console.log("");
    console.log("Claude Desktop / Cursor (claude_desktop_config.json):");
    console.log(JSON.stringify({
        mcpServers: {
            "swarm-engine": {
                command: "npx",
                args: ["swarm-engine", "mcp"],
            },
        },
    }, null, 2));
    console.log("");
    console.log("Cline / Roo Code (cline_mcp_settings.json):");
    console.log(JSON.stringify({
        mcpServers: {
            "swarm-engine": {
                command: "npx",
                args: ["swarm-engine", "mcp"],
            },
        },
    }, null, 2));
}
/**
 * Handles the 'status' subcommand.
 */
async function handleStatus(args, cwd = process.cwd()) {
    const swarmDir = getSwarmDir(cwd);
    let state;
    try {
        state = await readState(swarmDir);
    }
    catch (err) {
        console.error("Error: Swarm state has not been initialized. Run 'swarm-engine init' or 'spawn_swarm' first.");
        process.exit(1);
    }
    if (hasFlag(args, "--json")) {
        console.log(JSON.stringify(state, null, 2));
    }
    else if (hasFlag(args, "--table") || hasFlag(args, "--plain")) {
        console.log(formatStatusTable(state));
    }
    else {
        const dashboard = await renderDashboard(state, cwd, Date.now());
        console.log(dashboard);
    }
}
/**
 * Handles the 'watch' subcommand.
 */
async function handleWatch(args, cwd = process.cwd()) {
    const swarmDir = getSwarmDir(cwd);
    let interval = 2000;
    const intervalStr = getFlagValue(args, "--interval");
    if (intervalStr) {
        const parsed = parseInt(intervalStr, 10);
        if (!isNaN(parsed) && parsed >= 200)
            interval = parsed;
    }
    const once = hasFlag(args, "--once");
    const plain = hasFlag(args, "--plain") || hasFlag(args, "--table");
    const startTime = Date.now();
    const cleanup = () => {
        process.stdout.write("\x1b[?25h\n");
    };
    const render = async () => {
        let state;
        try {
            state = await readState(swarmDir);
        }
        catch {
            cleanup();
            console.error("Error: Swarm state has not been initialized. Run 'swarm-engine init' or 'spawn_swarm' first.");
            process.exit(1);
        }
        if (plain) {
            process.stdout.write("\x1b[2J\x1b[H");
            console.log(formatStatusTable(state));
            console.log(`\nAuto-refreshing every ${interval}ms. Press Ctrl+C to exit.`);
        }
        else {
            const output = await renderDashboard(state, cwd, startTime);
            process.stdout.write("\x1b[?25l\x1b[H\x1b[J" + output + "\n");
        }
    };
    await render();
    if (once) {
        cleanup();
        process.exit(0);
    }
    if (process.stdin.isTTY && !once) {
        try {
            process.stdin.setRawMode(true);
            process.stdin.resume();
            process.stdin.setEncoding("utf8");
            process.stdin.on("data", (key) => {
                if (key === "q" || key === "\u0003") {
                    cleanup();
                    process.exit(0);
                }
                else if (key === "r") {
                    render().catch(() => { });
                }
            });
        }
        catch {
            // Non-fatal if raw mode fails
        }
    }
    const timer = setInterval(async () => {
        try {
            await render();
        }
        catch (err) {
            console.error(`[swarm-engine watch] Error refreshing status: ${err.message}`);
        }
    }, interval);
    process.on("SIGINT", () => {
        clearInterval(timer);
        cleanup();
        process.exit(0);
    });
    process.on("SIGTERM", () => {
        clearInterval(timer);
        cleanup();
        process.exit(0);
    });
}
/**
 * Handles the 'reset' subcommand.
 */
async function handleReset(args, cwd = process.cwd()) {
    const swarmDir = getSwarmDir(cwd);
    const keepBlackboard = hasFlag(args, "--keep-blackboard");
    // 1. Prune git worktrees and delete swarm/* branches
    await pruneWorktrees(cwd);
    // 2. Remove state.lock
    await releaseLock(swarmDir);
    await fs.rm(path.join(swarmDir, "state.lock"), { recursive: true, force: true }).catch(() => { });
    // 3. Read existing mission/concurrency/blackboard if present
    let mission = "Default Swarm Mission";
    let concurrency = 4;
    let workerCommand;
    let savedBlackboard = {};
    try {
        const existing = await readState(swarmDir);
        mission = existing.mission || mission;
        concurrency = existing.maxConcurrency || concurrency;
        workerCommand = existing.workerCommand;
        if (keepBlackboard && existing.blackboard) {
            savedBlackboard = existing.blackboard;
        }
    }
    catch { }
    // 4. Reset state to clean initial state
    await initState(mission, concurrency, workerCommand, swarmDir);
    if (keepBlackboard && Object.keys(savedBlackboard).length > 0) {
        await updateState((s) => {
            s.blackboard = savedBlackboard;
        }, swarmDir);
    }
    console.log("✓ Pruned git worktrees and cleaned temporary swarm/* branches");
    console.log("✓ Removed .swarm/worktrees");
    console.log("✓ Cleared file locks");
    console.log("✓ Reset .swarm/state.json to fresh state");
}
/**
 * Handles the 'complete' subcommand.
 */
async function handleComplete(args, cwd = process.cwd()) {
    const agentId = args[0];
    if (!agentId || agentId.startsWith("-")) {
        console.error("Usage: swarm-engine complete <agentId> [summary]");
        process.exit(1);
    }
    const summary = args.slice(1).join(" ") || "Task completed";
    try {
        await mergeAndComplete(agentId, summary, cwd);
        console.log(`✓ Agent ${agentId} task completed and merged successfully`);
    }
    catch (err) {
        console.error(`Error completing task for agent ${agentId}:`, err.message || err);
        process.exit(1);
    }
}
/**
 * Handles the 'worker' subcommand to run an agent autonomously in its worktree.
 */
async function handleWorker(args, cwd = process.cwd()) {
    const agentId = args[0];
    if (!agentId || agentId.startsWith("-")) {
        console.error("Usage: swarm-engine worker <agentId>");
        process.exit(1);
    }
    try {
        await runAgentWorker(agentId, cwd);
    }
    catch (err) {
        console.error(`[swarm-engine worker] Error running agent ${agentId}:`, err.message || err);
        process.exit(1);
    }
}
/**
 * Handles the 'run' / 'start' subcommand to launch autonomous multi-agent execution with live Fable TUI.
 */
async function handleRun(args, cwd = process.cwd()) {
    process.env.SWARM_AUTO_RUN = "1";
    const swarmDir = getSwarmDir(cwd);
    let state;
    try {
        state = await readState(swarmDir);
    }
    catch { }
    const force = hasFlag(args, "--force", "-f");
    if (!state || force) {
        const mission = args.find((a) => !a.startsWith("-")) || "Autonomous Multi-Agent Mission";
        const concurrency = parseInt(getFlagValue(args, "--concurrency") || "4", 10);
        const leaderModel = getFlagValue(args, "--leader-model") || getFlagValue(args, "-lm") || process.env.SWARM_LEADER_MODEL || process.env.LEADER_MODEL || undefined;
        const userModel = getFlagValue(args, "--model") || getFlagValue(args, "-m") || process.env.SWARM_MODEL || process.env.MODEL || undefined;
        await initState(mission, concurrency, undefined, swarmDir, leaderModel);
        await updateState((s) => {
            s.agents["worker-1"] = {
                id: "worker-1",
                role: "refactor_specialist",
                model: userModel,
                taskSpec: "Fix lint errors and refactor codebase.",
                dependsOn: [],
                targetFiles: ["src/coach/aiCoach.ts"],
                status: "pending",
            };
            s.agents["worker-2"] = {
                id: "worker-2",
                role: "test_engineer",
                model: userModel,
                taskSpec: "Fix lint errors in plans and Deload functions.",
                dependsOn: [],
                targetFiles: ["src/coach/plan.ts"],
                status: "pending",
            };
            s.agents["worker-3"] = {
                id: "worker-3",
                role: "cleanup_agent",
                model: userModel,
                taskSpec: "Audit dead code and run lint error verification.",
                dependsOn: ["worker-1"],
                targetFiles: ["src/ui/RepCounter.tsx"],
                status: "pending",
            };
        }, swarmDir);
    }
    // Schedule agents and launch autonomous workers
    await tickScheduler(cwd);
    // Stream live Fable TUI dashboard
    await handleWatch(args, cwd);
}
/**
 * Prints the CLI help message.
 */
function printHelp() {
    console.log(`
Swarm Engine CLI — Multi-agent swarm orchestration & MCP server

USAGE:
  swarm-engine <subcommand> [options]

SUBCOMMANDS:
  mcp                           Start Model Context Protocol stdio server
  init [mission] [options]      Initialize .swarm/, .gitignore, and AGENTS.md
  run [mission] [options]       Launch autonomous swarm execution with live Fable TUI
  start [mission] [options]     Alias for run
  worker <agentId>              Run an agent worker autonomously inside its worktree
  status [options]              Display swarm status (Fable dashboard, table, or JSON)
  watch [options]               Live auto-refreshing swarm status dashboard
  dashboard [options]           Alias for watch (live interactive TUI dashboard)
  tui [options]                 Alias for watch (live interactive TUI dashboard)
  reset [options]               Prune worktrees, clear locks, and reset state
  complete <agentId> [summary]  Complete an agent task and merge its worktree

OPTIONS FOR init:
  --concurrency <num>           Maximum concurrent running agents (default: 4)
  --worker <command>            Command to execute background workers in worktrees
  --force, -f                   Overwrite existing state if already initialized

OPTIONS FOR status:
  --json                        Output raw state as formatted JSON

OPTIONS FOR watch:
  --interval <ms>               Refresh interval in milliseconds (default: 2000)
  --once                        Render status once and exit

OPTIONS FOR reset:
  --hard, -f                    Force reset without prompts
  --keep-blackboard             Preserve blackboard memory keys during reset

GLOBAL OPTIONS:
  --help, -h                    Show this help message
  --version, -v                 Show version
`);
}
/**
 * Main CLI router.
 */
async function main() {
    const rawArgs = process.argv.slice(2);
    const command = rawArgs[0];
    const subArgs = rawArgs.slice(1);
    if (!command || command === "--help" || command === "-h" || command === "help") {
        printHelp();
        process.exit(0);
    }
    if (command === "--version" || command === "-v") {
        console.log("swarm-engine 1.0.0");
        process.exit(0);
    }
    switch (command) {
        case "mcp":
            // Safeguard 1: Strictly ZERO console.log in MCP mode!
            await startMcpServer();
            break;
        case "init":
            await handleInit(subArgs);
            break;
        case "status":
            await handleStatus(subArgs);
            break;
        case "watch":
        case "dashboard":
        case "tui":
            await handleWatch(subArgs);
            break;
        case "reset":
            await handleReset(subArgs);
            break;
        case "complete":
            await handleComplete(subArgs);
            break;
        case "run":
        case "start":
            await handleRun(subArgs);
            break;
        case "worker":
            await handleWorker(subArgs);
            break;
        default:
            console.error(`Unknown command: ${command}\nRun 'swarm-engine --help' for usage.`);
            process.exit(1);
    }
}
// Execute CLI
main().catch((err) => {
    console.error("[swarm-engine] Fatal error:", err);
    process.exit(1);
});
