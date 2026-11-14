import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { initState, readState, ensureState, updateState, recordAgentAction, updateAgentProgress, normalizePath, getSwarmDir, getDeduplicatedChannelList, getSwarmStatusSummary, terminateAgent, modelHotSwap, canTerminateAgent, isTerminalStatus, } from "./state.js";
import { postMessage, readBoard, swarmWait, MAIN_CHANNEL, CHANNEL_NAME_REGEX, RESERVED_CHANNELS, } from "./board.js";
import { tickScheduler, mergeAndComplete, generateAgentTaskContent, } from "./spawner.js";
import { runAgentWorker } from "./runner.js";
import { renderDashboard } from "./tui.js";
import { detectActiveModels, detectActiveModelsSync, resolveModelForRole, getAvailableModels, getQuotaFallbackModel, } from "./detector.js";
/**
 * Cycle detection helper using 3-color DFS traversal.
 * 0 = unvisited, 1 = visiting (current recursion stack), 2 = visited.
 */
function hasCycle(agents) {
    const adj = new Map();
    for (const a of agents) {
        adj.set(a.id, a.dependsOn || []);
    }
    const visited = new Map();
    function dfs(node) {
        visited.set(node, 1);
        const neighbors = adj.get(node) || [];
        for (const neighbor of neighbors) {
            const state = visited.get(neighbor) || 0;
            if (state === 1) {
                return true; // Cycle detected
            }
            if (state === 0) {
                if (dfs(neighbor))
                    return true;
            }
        }
        visited.set(node, 2);
        return false;
    }
    for (const a of agents) {
        if ((visited.get(a.id) || 0) === 0) {
            if (dfs(a.id))
                return true;
        }
    }
    return false;
}
/**
 * Creates and configures the Swarm Engine MCP Server with the 6 core tools:
 * 1. spawn_swarm
 * 2. add_dynamic_agent
 * 3. pull_agent_task
 * 4. write_blackboard
 * 5. complete_agent_task
 * 6. get_swarm_status
 */
export function createMcpServer() {
    const server = new McpServer({
        name: "swarm-engine",
        version: "1.0.0",
    });
    // Tool 1: spawn_swarm
    server.tool("spawn_swarm", "Initialize and launch an unbounded multi-agent swarm with as many specialized subagents as required by the mission (e.g. 5, 10, 15, 20+ parallel workers) with zero queuing and infinite concurrency (maxConcurrency: 0 by default). Decompose complex problems into specialized roles with non-overlapping targetFiles to maximize parallel throughput across isolated git worktrees.", {
        mission: z.string().describe("Overall mission statement or goal for the swarm"),
        leaderModel: z
            .string()
            .optional()
            .describe("Model identifier used by the leader/orchestrator agent (e.g. 'MiniMax-M2.7', 'claude-3-7-sonnet', 'gpt-4o')"),
        maxConcurrency: z
            .number()
            .int()
            .nonnegative()
            .optional()
            .default(0)
            .describe("Maximum concurrent running agents (0 = unlimited / infinite concurrency, default: 0). Do not artificially limit concurrency unless operating under extreme host resource constraints."),
        parallel: z
            .boolean()
            .optional()
            .default(true)
            .describe("Run all agents simultaneously in parallel across isolated worktrees with zero queuing (default: true)"),
        strictDependencies: z
            .boolean()
            .optional()
            .default(false)
            .describe("Enforce hard sequential blocking on dependsOn (default: false — all agents run parallel)"),
        workerCommand: z
            .string()
            .optional()
            .describe("Optional shell command executed to run detached workers in their worktrees"),
        agents: z
            .array(z.object({
            id: z.string().optional().describe("Optional unique agent ID"),
            role: z.string().describe("Agent role (e.g., 'architect', 'backend', 'frontend', 'database', 'auth', 'testing', 'perf', 'docs', 'security'). Specify narrow, specialized responsibilities with non-overlapping targetFiles."),
            model: z.string().optional().describe("User-configured model identifier or name (optional, auto-detected)"),
            systemPrompt: z.string().optional().describe("Custom instructions and system prompt for the agent"),
            taskSpec: z.string().describe("Detailed task requirements and prompt decomposition for this agent. Clearly define deliverables and file boundaries (non-overlapping targetFiles) to maximize parallel velocity."),
            dependsOn: z
                .array(z.string())
                .optional()
                .default([])
                .describe("Optional list of agent IDs for collaboration context and blackboard sharing. In parallel mode (default), agents run concurrently in their isolated worktrees."),
            targetFiles: z
                .array(z.string())
                .optional()
                .default([])
                .describe("Files this agent plans to create or modify (normalized for locking). Ensure non-overlapping targetFiles across concurrent agents to avoid file lock contention."),
            workspace: z
                .string()
                .optional()
                .describe("Workspace isolation mode: 'inherit' (shared root), 'share' (git worktree), 'branch' (isolated clone)"),
        }))
            .optional()
            .default([])
            .describe("List of initial agent definitions. Assistant models are explicitly encouraged to decompose complex missions into 5 to 20+ specialized subagents (e.g., architect, backend, frontend, database, auth, testing, perf, docs, security) running concurrently in parallel with zero queuing across isolated git worktrees."),
    }, async ({ mission, leaderModel, maxConcurrency, parallel, strictDependencies, workerCommand, agents }) => {
        try {
            const detected = await detectActiveModels();
            const effectiveLeader = leaderModel || detected.leaderModel || undefined;
            const agentSpecs = (agents || []).map((a) => {
                let wsMode = undefined;
                if (a.workspace) {
                    wsMode = ["inherit", "share", "branch"].includes(a.workspace)
                        ? a.workspace
                        : "share";
                }
                const resolvedModel = resolveModelForRole({
                    role: a.role,
                    requestedModel: a.model,
                    leaderModel: effectiveLeader,
                    brief: a.taskSpec,
                    name: a.id,
                });
                return {
                    id: a.id || `agent-${crypto.randomUUID().slice(0, 8)}`,
                    role: a.role,
                    model: resolvedModel,
                    systemPrompt: a.systemPrompt,
                    taskSpec: a.taskSpec,
                    dependsOn: a.dependsOn || [],
                    targetFiles: (a.targetFiles || []).map(normalizePath).filter(Boolean),
                    workspace: wsMode,
                };
            });
            if (hasCycle(agentSpecs)) {
                return {
                    isError: true,
                    content: [{ type: "text", text: "Error: Cycle detected in agent dependency graph" }],
                };
            }
            const agentIdSet = new Set(agentSpecs.map((a) => a.id));
            const invalidDeps = agentSpecs.flatMap((a) => a.dependsOn.filter((dep) => !agentIdSet.has(dep)));
            if (invalidDeps.length > 0) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text",
                            text: `Error: Dependency agent '${invalidDeps[0]}' does not exist`,
                        },
                    ],
                };
            }
            await initState(mission, maxConcurrency !== undefined ? maxConcurrency : 0, workerCommand, undefined, effectiveLeader, parallel !== false, strictDependencies === true);
            await updateState((state) => {
                for (const spec of agentSpecs) {
                    state.agents[spec.id] = {
                        id: spec.id,
                        role: spec.role,
                        model: spec.model,
                        systemPrompt: spec.systemPrompt,
                        taskSpec: spec.taskSpec,
                        dependsOn: spec.dependsOn,
                        targetFiles: spec.targetFiles,
                        workspace: spec.workspace,
                        status: "pending",
                    };
                }
            });
            await tickScheduler();
            const finalState = await readState();
            const allAgents = Object.values(finalState.agents || {});
            const runningAgents = allAgents.filter((a) => a.status === "running").map((a) => a.id);
            const pendingAgents = allAgents.filter((a) => a.status === "pending").map((a) => a.id);
            const activeLocks = Array.isArray(finalState.lockedFiles)
                ? finalState.lockedFiles
                : Object.keys(finalState.lockedFiles || {});
            const dashboardStr = await renderDashboard(finalState, process.cwd());
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            mission: finalState.mission,
                            maxConcurrency: finalState.maxConcurrency,
                            totalAgents: allAgents.length,
                            runningAgents,
                            pendingAgents,
                            activeLocks,
                        }),
                    },
                    {
                        type: "text",
                        text: dashboardStr,
                    },
                ],
            };
        }
        catch (err) {
            console.error("[swarm-engine] spawn_swarm error:", err);
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
            };
        }
    });
    // Tool 2: add_dynamic_agent
    server.tool("add_dynamic_agent", "Dynamically inject an on-the-fly specialist subagent mid-execution into the running swarm. Can be called repeatedly to scale the swarm to 20+ agents as new subtasks, bugs, or refactorings are discovered. Injects directly into an isolated worktree with zero queuing.", {
        id: z.string().optional().describe("Optional unique agent ID"),
        role: z.string().describe("Role or specialization of the dynamic agent (e.g., 'database_migrator', 'security_auditor', 'performance_tuner'). Specify narrow, well-defined responsibilities with non-overlapping targetFiles."),
        model: z.string().optional().describe("User-configured model identifier or name (optional)"),
        taskSpec: z.string().describe("Detailed task specification and prompt decomposition for this agent. Clearly specify scope and isolated file boundaries (non-overlapping targetFiles) to prevent file lock contention."),
        systemPrompt: z.string().optional().describe("Optional custom system prompt"),
        dependsOn: z
            .array(z.string())
            .optional()
            .default([])
            .describe("Optional collaboration context tags (agents run in parallel)"),
        targetFiles: z
            .array(z.string())
            .optional()
            .default([])
            .describe("Files this agent will create or modify. Ensure non-overlapping targetFiles to avoid file lock contention with other running subagents."),
        workspace: z
            .string()
            .optional()
            .describe("Workspace isolation mode: 'inherit' (shared root), 'share' (git worktree), 'branch' (isolated clone)"),
    }, async ({ id, role, model, taskSpec, systemPrompt, dependsOn, targetFiles, workspace }) => {
        try {
            let state;
            try {
                state = await readState();
            }
            catch {
                return {
                    isError: true,
                    content: [{ type: "text", text: "Error: Swarm not initialized" }],
                };
            }
            for (const depId of dependsOn || []) {
                if (!state.agents[depId]) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Error: Dependency agent '${depId}' does not exist`,
                            },
                        ],
                    };
                }
            }
            const agentId = id || `agent-${crypto.randomUUID().slice(0, 8)}`;
            const normTargets = (targetFiles || []).map(normalizePath).filter(Boolean);
            let wsMode = undefined;
            if (workspace) {
                wsMode = ["inherit", "share", "branch"].includes(workspace)
                    ? workspace
                    : "share";
            }
            const currentSpecs = Object.values(state.agents).map((a) => ({
                id: a.id,
                dependsOn: a.dependsOn || [],
            }));
            currentSpecs.push({ id: agentId, dependsOn: dependsOn || [] });
            if (hasCycle(currentSpecs)) {
                return {
                    isError: true,
                    content: [{ type: "text", text: "Error: Cycle detected in agent dependency graph" }],
                };
            }
            const effectiveModel = resolveModelForRole({
                role,
                requestedModel: model,
                leaderModel: state.leaderModel,
                brief: taskSpec,
                name: agentId,
            });
            const newAgent = {
                id: agentId,
                role,
                model: effectiveModel,
                systemPrompt,
                taskSpec,
                dependsOn: dependsOn || [],
                targetFiles: normTargets,
                workspace: wsMode,
                status: "pending",
            };
            await updateState((s) => {
                s.agents[agentId] = newAgent;
            });
            await tickScheduler();
            const finalState = await readState();
            const agentNode = finalState.agents[agentId] || newAgent;
            const scheduled = agentNode.status === "running";
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            agent: agentNode,
                            scheduled,
                            reason: scheduled
                                ? undefined
                                : "Waiting for dependencies, file lock availability, or concurrency slot",
                        }),
                    },
                ],
            };
        }
        catch (err) {
            console.error("[swarm-engine] add_dynamic_agent error:", err);
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
            };
        }
    });
    // Tool 3: pull_agent_task
    server.tool("pull_agent_task", "Claim or view the next ready task or inspect a specific agent's assigned task, returning worktree path, task spec, system prompt, target files, and blackboard memory.", {
        agentId: z
            .string()
            .optional()
            .describe("Specific agent ID to pull/claim. If omitted, claims the next available 'running' agent or ready 'pending' agent"),
    }, async ({ agentId }) => {
        try {
            let state;
            try {
                state = await readState();
            }
            catch {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                message: "Swarm not initialized",
                            }),
                        },
                    ],
                };
            }
            let targetAgent;
            if (agentId) {
                targetAgent = state.agents[agentId];
                if (!targetAgent) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: `Error: Agent '${agentId}' not found` }],
                    };
                }
                if (targetAgent.status === "pending") {
                    await tickScheduler();
                    state = await readState();
                    targetAgent = state.agents[agentId];
                }
            }
            else {
                targetAgent = Object.values(state.agents).find((a) => a.status === "running");
                if (!targetAgent) {
                    await tickScheduler();
                    state = await readState();
                    targetAgent = Object.values(state.agents).find((a) => a.status === "running");
                }
            }
            if (!targetAgent) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                message: "No tasks currently available to pull",
                            }),
                        },
                    ],
                };
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            agentId: targetAgent.id,
                            role: targetAgent.role,
                            status: targetAgent.status,
                            taskSpec: targetAgent.taskSpec,
                            systemPrompt: targetAgent.systemPrompt,
                            worktreePath: targetAgent.worktreePath,
                            branchName: targetAgent.branchName,
                            targetFiles: targetAgent.targetFiles,
                            lockedFiles: targetAgent.targetFiles,
                            mission: state.mission,
                            blackboard: state.blackboard || {},
                        }),
                    },
                ],
            };
        }
        catch (err) {
            console.error("[swarm-engine] pull_agent_task error:", err);
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
            };
        }
    });
    // Tool 4: write_blackboard
    server.tool("write_blackboard", "Save or update a shared memory entry (contract, schema, API route, or coordination flag) on the blackboard, visible to all swarm agents.", {
        key: z.string().describe("Blackboard memory key name"),
        value: z.any().describe("Data value to store (primitive, JSON object, or array)"),
    }, async ({ key, value }) => {
        try {
            if (!key || typeof key !== "string" || key.trim() === "") {
                return {
                    isError: true,
                    content: [{ type: "text", text: "Error: Key cannot be empty" }],
                };
            }
            let allKeys = [];
            await updateState((state) => {
                if (!state.blackboard || typeof state.blackboard !== "object") {
                    state.blackboard = {};
                }
                state.blackboard[key] = value;
                allKeys = Object.keys(state.blackboard);
            });
            // Sync blackboard update into AGENT_TASK.md in all running worktrees
            try {
                const syncState = await readState();
                for (const ag of Object.values(syncState.agents || {})) {
                    if (ag.worktreePath) {
                        const taskPath = path.join(ag.worktreePath, "AGENT_TASK.md");
                        if (fs.existsSync(taskPath)) {
                            try {
                                const updatedMd = generateAgentTaskContent(ag, syncState);
                                fs.writeFileSync(taskPath, updatedMd, "utf8");
                            }
                            catch { }
                        }
                    }
                }
            }
            catch { }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            key,
                            value,
                            allKeys,
                        }),
                    },
                ],
            };
        }
        catch (err) {
            console.error("[swarm-engine] write_blackboard error:", err);
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
            };
        }
    });
    // Tool 5: complete_agent_task
    server.tool("complete_agent_task", "Commit worktree changes, cleanly merge to main, delete worktree and branch, release file locks, update agent status to 'completed', and trigger the DAG scheduler for downstream agents.", {
        agentId: z.string().describe("ID of the agent that has finished its task"),
        summary: z.string().optional().describe("Summary of changes made, accomplishments, and notes"),
        outputSummary: z.string().optional().describe("Summary of changes made, accomplishments, and notes"),
    }, async ({ agentId, summary, outputSummary }) => {
        try {
            const finalSummary = summary ?? outputSummary;
            await mergeAndComplete(agentId, finalSummary);
            const state = await readState();
            const unblockedAgents = Object.values(state.agents)
                .filter((a) => a.status === "running")
                .map((a) => a.id);
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            agentId,
                            status: "completed",
                            summary: finalSummary || "Task completed",
                            unblockedAgents,
                        }),
                    },
                ],
            };
        }
        catch (err) {
            console.error("[swarm-engine] complete_agent_task error:", err);
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
            };
        }
    });
    // Tool 6: get_swarm_status
    server.tool("get_swarm_status", "Get a complete snapshot of the swarm state: mission, concurrency, agent statuses, active file locks, and blackboard keys.", {
        detail: z
            .boolean()
            .optional()
            .default(false)
            .describe("If true, returns full taskSpec and systemPrompt for all agents"),
    }, async ({ detail }) => {
        try {
            let state;
            try {
                state = await readState();
            }
            catch {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                initialized: false,
                                message: "Swarm not initialized. Call spawn_swarm or run 'swarm-engine init'",
                            }),
                        },
                    ],
                };
            }
            const agentsList = Object.values(state.agents || {});
            const summary = {
                total: agentsList.length,
                pending: agentsList.filter((a) => a.status === "pending").length,
                running: agentsList.filter((a) => a.status === "running").length,
                completed: agentsList.filter((a) => a.status === "completed").length,
                failed: agentsList.filter((a) => a.status === "failed").length,
            };
            const lockedFilesList = Array.isArray(state.lockedFiles)
                ? state.lockedFiles
                : Object.keys(state.lockedFiles || {});
            const detected = detectActiveModelsSync();
            const effectiveLeader = state.leaderModel || detected.leaderModel;
            const defaultWorkerModel = detected.workerModel || effectiveLeader;
            const formattedAgents = detail
                ? agentsList.map((a) => ({
                    ...a,
                    model: a.model || defaultWorkerModel,
                }))
                : agentsList.map((a) => ({
                    id: a.id,
                    role: a.role,
                    model: a.model || defaultWorkerModel,
                    status: a.status,
                    dependsOn: a.dependsOn,
                    targetFiles: a.targetFiles,
                    thought: a.thought,
                    actions: a.actions?.slice(-3),
                    worktreePath: a.worktreePath,
                    branchName: a.branchName,
                    outputSummary: a.outputSummary,
                }));
            const dashboardStr = await renderDashboard(state, process.cwd());
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            initialized: true,
                            mission: state.mission,
                            leaderModel: effectiveLeader,
                            maxConcurrency: state.maxConcurrency,
                            summary,
                            counts: summary,
                            agents: formattedAgents,
                            lockedFiles: lockedFilesList,
                            blackboard: state.blackboard || {},
                            dashboard: dashboardStr,
                        }),
                    },
                    {
                        type: "text",
                        text: dashboardStr,
                    },
                ],
            };
        }
        catch (err) {
            console.error("[swarm-engine] get_swarm_status error:", err);
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
            };
        }
    });
    // Tool 7: record_agent_action
    server.tool("record_agent_action", "Record a real-time tool action (Edit, Read, Bash, Update) executed by an agent so it streams to the Fable TUI dashboard.", {
        agentId: z.string().describe("Target agent ID"),
        actionType: z.enum(["edit", "read", "bash", "update", "delete", "status"]).describe("Type of tool action"),
        target: z.string().describe("Target file path or executed shell command"),
        detail: z.string().optional().describe("Descriptive summary (e.g. 'Read 159 lines', '29 passed', 'Updated 2 lines')"),
        diffs: z
            .array(z.object({
            type: z.enum(["add", "del"]),
            line: z.string(),
            lineNo: z.number().optional(),
        }))
            .optional()
            .describe("Code diff lines (+ green, - red)"),
    }, async ({ agentId, actionType, target, detail, diffs }) => {
        try {
            await recordAgentAction(agentId, {
                type: actionType,
                target,
                detail,
                diffs,
            });
            return {
                content: [{ type: "text", text: JSON.stringify({ success: true, agentId, actionType, target }) }],
            };
        }
        catch (err) {
            console.error("[swarm-engine] record_agent_action error:", err);
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
            };
        }
    });
    // Tool 8: update_agent_progress
    server.tool("update_agent_progress", "Update an agent's real-time telemetry: thought, poetic verb (Pruning, Simmering, etc.), tokens, and throughput (tok/s).", {
        agentId: z.string().describe("Target agent ID"),
        thought: z.string().optional().describe("Current task or reasoning thought"),
        verb: z.string().optional().describe("Poetic action verb (e.g. 'Pruning...', 'Whispering...', 'Simmering...')"),
        tokens: z.number().optional().describe("Estimated or accumulated tokens"),
        tokPerSec: z.number().optional().describe("Real-time token speed (tok/s)"),
    }, async ({ agentId, thought, verb, tokens, tokPerSec }) => {
        try {
            await updateAgentProgress(agentId, { thought, verb, tokens, tokPerSec });
            return {
                content: [{ type: "text", text: JSON.stringify({ success: true, agentId }) }],
            };
        }
        catch (err) {
            console.error("[swarm-engine] update_agent_progress error:", err);
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
            };
        }
    });
    // Tool 9: run_agent_task
    server.tool("run_agent_task", "Triggers autonomous worker execution for an agent inside its isolated worktree (inspects files, applies edits, runs bash checks, merges on finish).", {
        agentId: z.string().describe("Target agent ID to execute"),
    }, async ({ agentId }) => {
        try {
            const state = await ensureState(getSwarmDir());
            const agent = state.agents?.[agentId];
            if (agent &&
                (agent.status === "completed" ||
                    agent.status === "killed" ||
                    agent.status === "failed" ||
                    agent.killed)) {
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: false,
                                started: false,
                                agentId,
                                reason: `Cannot run task for agent in terminal state '${agent.status}'.`,
                            }),
                        },
                    ],
                };
            }
            // Run in background / async
            runAgentWorker(agentId).catch((err) => {
                console.error(`[swarm-engine] Error running worker ${agentId}:`, err);
            });
            return {
                content: [{ type: "text", text: JSON.stringify({ success: true, started: true, agentId }) }],
            };
        }
        catch (err) {
            console.error("[swarm-engine] run_agent_task error:", err);
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
            };
        }
    });
    // Tool 10: post_message
    server.tool("post_message", "Post an immutable message to the shared swarm message board. Supports doorbell addressing via '@<name>', '@<prefix>' (for numbered worker copies), '@all' (broadcast to all agents), and '@#<channel>' (all active channel subscribers). Naming an agent wakes it from swarm_wait; naming nobody logs the message without ringing doorbells.", {
        text: z
            .string()
            .describe("Message text to post on the shared board. Must not be empty. Supports @name, @prefix, @all, and @#channel doorbell mentions."),
        channel: z
            .string()
            .optional()
            .default("main")
            .describe("Target channel name (default: 'main'). Use dedicated channels to isolate workstream chatter."),
        from: z
            .string()
            .optional()
            .describe("Optional sender identity. Defaults to 'coordinator' or detected active agent from environment."),
    }, async ({ text, channel, from }) => {
        try {
            const state = await ensureState(getSwarmDir());
            if (!text || typeof text !== "string" || text.trim() === "") {
                return {
                    isError: true,
                    content: [{ type: "text", text: "Error: Message text cannot be empty or whitespace-only." }],
                };
            }
            const targetChannel = (channel || MAIN_CHANNEL).trim().toLowerCase();
            if (targetChannel !== MAIN_CHANNEL) {
                if (!CHANNEL_NAME_REGEX.test(targetChannel) || RESERVED_CHANNELS.has(targetChannel)) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Error: Invalid channel name '${targetChannel}'. Must match ${CHANNEL_NAME_REGEX} and not be reserved.`,
                            },
                        ],
                    };
                }
                if (state.channels?.[targetChannel]?.archived) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Error: Channel '#${targetChannel}' is archived and read-only.`,
                            },
                        ],
                    };
                }
            }
            const sender = from || process.env.SWARM_AGENT_ID || "coordinator";
            const message = await postMessage(state, getSwarmDir(), {
                text,
                channel: targetChannel,
                from: sender,
            });
            const mentions = message.mentions || [];
            const channelMentions = message.channelMentions || [];
            const broadcast = Boolean(message.broadcast);
            // Doorbell wakeup: transition mentioned agents in waiting state to working
            if (mentions.length > 0 || broadcast) {
                try {
                    await updateState((s) => {
                        for (const [id, ag] of Object.entries(s.agents || {})) {
                            if (ag.status === "waiting") {
                                if (broadcast) {
                                    ag.status = "working";
                                    delete ag.waitSince;
                                }
                                else {
                                    const targetName = ag.name || id;
                                    const isHit = mentions.some((m) => targetName.toLowerCase() === m.toLowerCase() ||
                                        id.toLowerCase() === m.toLowerCase() ||
                                        id.toLowerCase().startsWith(m.toLowerCase() + "-"));
                                    if (isHit) {
                                        ag.status = "working";
                                        delete ag.waitSince;
                                    }
                                }
                            }
                        }
                    }, getSwarmDir());
                }
                catch { }
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            seq: message.seq,
                            message,
                            mentions,
                            channelMentions,
                            broadcast,
                        }),
                    },
                ],
            };
        }
        catch (err) {
            console.error("[swarm-engine] post_message error:", err);
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
            };
        }
    });
    // Tool 11: read_board
    server.tool("read_board", "Read messages from the shared swarm message board. Reads messages with sequence number strictly greater than 'since' (default: 0) up to 'limit' (default: 200). Can filter by channel ('main', specific channel name, or '*' for all channels). Optionally returns real-time member statuses.", {
        since: z
            .number()
            .int()
            .optional()
            .default(0)
            .describe("Read messages with sequence number strictly greater than this cursor (default: 0). Pass the highest sequence number already seen."),
        channel: z
            .string()
            .optional()
            .describe("Channel to filter by ('main', specific channel name, or '*' for all channels). Defaults to member's subscribed channels or all if coordinator."),
        limit: z
            .number()
            .int()
            .optional()
            .default(200)
            .describe("Maximum number of messages to return (default: 200, max: 1000)."),
        status: z
            .boolean()
            .optional()
            .default(false)
            .describe("If true, returns member status snapshot along with messages."),
        member: z
            .string()
            .optional()
            .describe("Optional member name querying the board (used to apply channel visibility rules if channel is omitted)."),
        memberName: z
            .string()
            .optional()
            .describe("Alias for member."),
        callerId: z
            .string()
            .optional()
            .describe("Caller agent ID querying the board (updates lastReadSeq cursor)."),
    }, async ({ since, channel, limit, status, member, memberName, callerId }) => {
        try {
            let state;
            try {
                state = await readState();
            }
            catch {
                // Uninitialized workspace: handled gracefully returning headSeq: 0
            }
            const effectiveSince = since !== undefined && since > 0 ? since : 0;
            const effectiveLimit = limit !== undefined ? limit : 200;
            const effectiveMember = callerId || memberName || member || process.env.SWARM_AGENT_ID || "coordinator";
            const result = await readBoard(state, getSwarmDir(), {
                since: effectiveSince,
                channel: channel ? channel.trim().toLowerCase() : undefined,
                limit: effectiveLimit,
                status: status === true,
                memberName: effectiveMember,
            });
            // Advance reading agent's lastReadSeq cursor
            if (effectiveMember && effectiveMember !== "coordinator") {
                try {
                    await updateState((s) => {
                        const ag = s.agents?.[effectiveMember];
                        if (ag) {
                            ag.lastReadSeq = Math.max(ag.lastReadSeq || 0, result.headSeq);
                        }
                    }, getSwarmDir());
                }
                catch { }
            }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            headSeq: result.headSeq,
                            count: result.messages.length,
                            messages: result.messages,
                            ...(result.members ? { members: result.members, roster: result.members } : {}),
                            ...(result.channels ? { channels: result.channels } : {}),
                        }),
                    },
                ],
            };
        }
        catch (err) {
            console.error("[swarm-engine] read_board error:", err);
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
            };
        }
    });
    // Tool 12: swarm_wait
    server.tool("swarm_wait", "Park agent execution until a matching message is posted to the board (zero-token sleep). Wakes when a new message with seq > since arrives that addresses the agent (via @name, @prefix, @all, or @#channel), or wakes on any new message if mentions_only is false. Includes a configurable timeout in milliseconds.", {
        since: z
            .number()
            .int()
            .optional()
            .describe("The sequence number cursor to wait from. Agent wakes for qualifying messages with seq > since. Defaults to headSeq or member's cursor."),
        mentions_only: z
            .boolean()
            .optional()
            .default(true)
            .describe("If true (default), wake only when explicitly named (@name, @prefix, @all, or @#channel). If false, wake on any new message in subscribed channels."),
        timeoutMs: z
            .number()
            .int()
            .optional()
            .default(30000)
            .describe("Maximum time in milliseconds to wait before timing out (default: 30000ms / 30s, max: 300000ms / 5m)."),
        member: z
            .string()
            .optional()
            .describe("Optional member name to wait as (defaults to active agent from environment or 'coordinator')."),
        memberName: z
            .string()
            .optional()
            .describe("Alias for member."),
        channel: z
            .string()
            .optional()
            .describe("Optional channel name to filter messages while waiting."),
    }, async ({ since, mentions_only, timeoutMs, member, memberName, channel }) => {
        try {
            const state = await ensureState(getSwarmDir());
            const effectiveMember = memberName || member || process.env.SWARM_AGENT_ID || "coordinator";
            const memberCursor = state.agents?.[effectiveMember]?.lastReadSeq;
            const effectiveSince = since !== undefined && since !== null
                ? since
                : (state.headSeq !== undefined && state.headSeq > 0 ? state.headSeq : (memberCursor || 0));
            const result = await swarmWait(state, getSwarmDir(), {
                memberName: effectiveMember,
                since: effectiveSince,
                channel: channel ? channel.trim().toLowerCase() : undefined,
                mentionsOnly: mentions_only !== false,
                timeoutMs,
            });
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            timedOut: result.timedOut,
                            headSeq: result.headSeq,
                            count: result.messages.length,
                            messages: result.messages,
                        }),
                    },
                ],
            };
        }
        catch (err) {
            console.error("[swarm-engine] swarm_wait error:", err);
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
            };
        }
    });
    // Tool 13: swarm
    server.tool("swarm", "Unified swarm management tool matching Google Antigravity & Carbon native swarm parity. Supports status, models, add, model, kill, title, and channel management.", {
        action: z
            .enum(["channel", "status", "models", "add", "model", "kill", "title"])
            .describe("Action to perform on the swarm: status, models, add, model, kill, title, or channel."),
        op: z
            .enum(["create", "subscribe", "unsubscribe", "list", "archive"])
            .optional()
            .describe("Channel operation (required when action is 'channel')"),
        channel: z
            .string()
            .optional()
            .describe("Target channel name (e.g. 'parser', 'ui'). Required for create, subscribe, unsubscribe, archive."),
        topic: z
            .string()
            .optional()
            .describe("Topic or description of the channel (used with op: 'create')"),
        members: z
            .array(z.string())
            .optional()
            .describe("List of member/agent names to subscribe or unsubscribe"),
        name: z
            .string()
            .optional()
            .describe("Member name for add, model, kill, or channel ops"),
        caller: z
            .string()
            .optional()
            .describe("Optional caller identity (defaults to 'coordinator' or detected agent)"),
        callerId: z
            .string()
            .optional()
            .describe("Caller agent ID for permission checking (alias for caller)"),
        brief: z
            .string()
            .optional()
            .describe("Worker task brief/assignment for add"),
        taskSpec: z
            .string()
            .optional()
            .describe("Detailed task specification (alias for brief)"),
        role: z
            .string()
            .optional()
            .describe("Role of the agent (e.g. 'worker', 'verifier', 'narrator', 'monitor')"),
        model: z
            .string()
            .optional()
            .describe("Model identifier for add or model"),
        title: z
            .string()
            .optional()
            .describe("Swarm mission or title for action: 'title'"),
        parentId: z
            .string()
            .optional()
            .describe("Parent agent ID for hierarchical helper subagents"),
        fork: z
            .string()
            .optional()
            .describe("Source member name or 'coordinator' to fork conversation/memory context from"),
        n: z
            .number()
            .optional()
            .describe("Number of homogeneous copies to spawn (<name>-1..<name>-<n>)"),
        tasks: z
            .array(z.string())
            .optional()
            .describe("Per-worker slice targets for sharded spawning"),
        workspace: z
            .enum(["inherit", "share", "branch"])
            .optional()
            .describe("Workspace isolation mode: 'inherit' (shared repo), 'share' (git worktree), or 'branch' (isolated clone)"),
        wakeMode: z
            .string()
            .optional()
            .describe("Wake filter mode: 'mentions' | 'all' | 'anything'"),
        channels: z
            .array(z.string())
            .optional()
            .describe("Initial channels to assign to the new worker"),
        all: z
            .boolean()
            .optional()
            .describe("List all models including unverified for action: 'models'"),
    }, async ({ action, op, channel, topic, members, name, caller, callerId, brief, taskSpec, role, model, title, parentId, fork, n, tasks, workspace, wakeMode, channels, all, }) => {
        try {
            const swarmDir = getSwarmDir();
            const state = await ensureState(swarmDir);
            const effectiveCaller = callerId || caller || process.env.SWARM_AGENT_ID || "coordinator";
            // 1. ACTION: status
            if (action === "status") {
                const summary = getSwarmStatusSummary(state);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify(summary),
                        },
                    ],
                };
            }
            // 2. ACTION: title
            if (action === "title") {
                if (typeof title !== "string" || !title.trim()) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: "Error: 'title' cannot be empty." }],
                    };
                }
                const trimmedTitle = title.trim();
                await updateState((s) => {
                    s.title = trimmedTitle;
                    s.mission = trimmedTitle;
                }, swarmDir);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                action: "title",
                                title: trimmedTitle,
                                mission: trimmedTitle,
                            }),
                        },
                    ],
                };
            }
            // 3. ACTION: models
            if (action === "models") {
                const detected = await detectActiveModels(path.dirname(swarmDir));
                const active = state.leaderModel || detected.leaderModel || "gemini-3.8-flash";
                const models = getAvailableModels(active);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                action: "models",
                                models,
                                activeModel: active,
                                leaderModel: active,
                                tiers: {
                                    architect: resolveModelForRole({ role: "architect", leaderModel: active }),
                                    worker: resolveModelForRole({ role: "worker", leaderModel: active }),
                                    verifier: resolveModelForRole({ role: "verifier", leaderModel: active }),
                                    monitor: resolveModelForRole({ role: "monitor", leaderModel: active }),
                                },
                            }),
                        },
                    ],
                };
            }
            // 4. ACTION: model
            if (action === "model") {
                if (!name || typeof name !== "string" || !name.trim()) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: "Error: 'name' is required for action: 'model'." }],
                    };
                }
                if (!model || typeof model !== "string" || !model.trim()) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: "Error: 'model' cannot be empty." }],
                    };
                }
                const targetName = name.trim();
                let targetModel = model.trim();
                const targetAgent = state.agents?.[targetName];
                if (["fallback", "auto", "quota_failover", "next"].includes(targetModel.toLowerCase())) {
                    const current = (targetName === "coordinator" ? state.leaderModel : targetAgent?.model) || state.leaderModel || "gemini-3.8-flash";
                    targetModel = getQuotaFallbackModel(current);
                }
                else if (["pro", "flash", "flash_lite"].includes(targetModel.toLowerCase())) {
                    targetModel = resolveModelForRole({
                        role: targetName === "coordinator" ? "coordinator" : targetAgent?.role,
                        requestedModel: targetModel,
                        leaderModel: state.leaderModel,
                        name: targetName,
                        cwd: path.dirname(swarmDir),
                    });
                }
                if (targetName === "coordinator") {
                    await updateState((s) => {
                        s.leaderModel = targetModel;
                    }, swarmDir);
                    return {
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    success: true,
                                    action: "model",
                                    name: "coordinator",
                                    model: targetModel,
                                }),
                            },
                        ],
                    };
                }
                if (!targetAgent) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: `Error: Agent '${targetName}' not found.` }],
                    };
                }
                if (isTerminalStatus(targetAgent.status) || targetAgent.killed === true) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: `Error: Cannot switch model of terminal agent '${targetName}' (status: ${targetAgent.status}).` }],
                    };
                }
                const updated = await modelHotSwap(targetName, targetModel, swarmDir);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                action: "model",
                                name: targetName,
                                model: updated.model,
                            }),
                        },
                    ],
                };
            }
            // 5. ACTION: kill
            if (action === "kill") {
                if (!name || typeof name !== "string" || !name.trim()) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: "Error: 'name' is required for action: 'kill'." }],
                    };
                }
                const targetName = name.trim();
                const targetAgent = state.agents?.[targetName];
                if (!targetAgent) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: `Error: Agent '${targetName}' not found.` }],
                    };
                }
                if (targetAgent.status === "killed" || targetAgent.killed === true) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: `Error: Agent '${targetName}' is already killed.` }],
                    };
                }
                const perm = canTerminateAgent(state, effectiveCaller, targetName);
                if (!perm.allowed) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: `Error: ${perm.reason}` }],
                    };
                }
                const killResult = await terminateAgent(targetName, { callerId: effectiveCaller }, swarmDir);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                action: "kill",
                                name: targetName,
                                killed: killResult.killed,
                            }),
                        },
                    ],
                };
            }
            // 6. ACTION: add
            if (action === "add") {
                if (!name || typeof name !== "string" || !name.trim()) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: "Error: Agent name cannot be empty." }],
                    };
                }
                const rawName = name.trim();
                // Check duplicate or killed
                const existing = state.agents?.[rawName];
                if (existing) {
                    if (existing.status === "killed" || existing.killed === true) {
                        return {
                            isError: true,
                            content: [
                                {
                                    type: "text",
                                    text: `Error: Agent '${rawName}' was killed and cannot be resurrected. Use a new unique name.`,
                                },
                            ],
                        };
                    }
                    return {
                        isError: true,
                        content: [{ type: "text", text: `Error: Agent '${rawName}' already exists in live swarm.` }],
                    };
                }
                // Parent verification
                if (parentId && parentId.trim()) {
                    const pId = parentId.trim();
                    if (pId !== "coordinator") {
                        const pAgent = state.agents?.[pId];
                        if (!pAgent) {
                            return {
                                isError: true,
                                content: [{ type: "text", text: `Error: Parent agent '${pId}' not found.` }],
                            };
                        }
                        if (pAgent.status === "killed" || pAgent.killed === true) {
                            return {
                                isError: true,
                                content: [{ type: "text", text: `Error: Parent agent '${pId}' is killed.` }],
                            };
                        }
                    }
                }
                // Fork verification
                if (fork && fork.trim()) {
                    const fSource = fork.trim();
                    if (fSource === rawName) {
                        return {
                            isError: true,
                            content: [{ type: "text", text: `Error: Circular fork: agent '${rawName}' cannot fork from itself.` }],
                        };
                    }
                    if (fSource !== "coordinator") {
                        const fAgent = state.agents?.[fSource];
                        if (!fAgent) {
                            return {
                                isError: true,
                                content: [{ type: "text", text: `Error: Source agent '${fSource}' for fork not found.` }],
                            };
                        }
                        if (fAgent.status === "killed" || fAgent.killed === true) {
                            return {
                                isError: true,
                                content: [{ type: "text", text: `Error: Cannot fork from killed agent '${fSource}'.` }],
                            };
                        }
                    }
                }
                // Build agent definition
                const taskBrief = brief ||
                    taskSpec ||
                    (fork && fork.trim() !== "coordinator"
                        ? state.agents?.[fork.trim()]?.taskSpec
                        : undefined) ||
                    (fork && fork.trim() === "coordinator" ? state.mission : undefined) ||
                    `Task assignment for ${rawName}`;
                const assignedChannels = channels ||
                    (fork && fork.trim() !== "coordinator"
                        ? [...(state.agents?.[fork.trim()]?.channels || ["main"])]
                        : ["main"]);
                const effectiveRole = role ||
                    (fork && fork.trim() !== "coordinator"
                        ? state.agents?.[fork.trim()]?.role
                        : undefined) ||
                    (parentId ? "helper" : "worker");
                const agentModel = resolveModelForRole({
                    role: effectiveRole,
                    requestedModel: model,
                    leaderModel: state.leaderModel,
                    sourceModel: fork && fork.trim() !== "coordinator"
                        ? state.agents?.[fork.trim()]?.model
                        : parentId && parentId.trim()
                            ? state.agents?.[parentId.trim()]?.model
                            : undefined,
                    fork,
                    parentId,
                    brief: taskBrief,
                    name: rawName,
                    cwd: path.dirname(swarmDir),
                    qualityProfile: !model || model === "inherit" ? "quality" : undefined,
                });
                const newAgent = {
                    id: rawName,
                    name: rawName,
                    role: effectiveRole,
                    model: agentModel,
                    taskSpec: taskBrief,
                    brief: taskBrief,
                    systemPrompt: fork && fork.trim() !== "coordinator"
                        ? state.agents?.[fork.trim()]?.systemPrompt
                        : undefined,
                    dependsOn: [],
                    targetFiles: [],
                    status: "waiting",
                    startedAt: Date.now(),
                    channels: assignedChannels,
                    wakeMode: wakeMode || "mentions",
                    parentId: parentId && parentId.trim() ? parentId.trim() : undefined,
                    helperIds: [],
                    forkedFrom: fork && fork.trim() ? fork.trim() : undefined,
                    workspace: workspace || "inherit",
                    lastReadSeq: state.headSeq || 0,
                    lastPostSeq: 0,
                };
                // Atomically persist agent and update parent's helperIds
                await updateState((s) => {
                    if (s.agents[rawName]) {
                        if (s.agents[rawName].status === "killed" || s.agents[rawName].killed) {
                            throw new Error(`Agent '${rawName}' was killed and cannot be resurrected.`);
                        }
                        throw new Error(`Agent '${rawName}' already exists.`);
                    }
                    if (newAgent.parentId && newAgent.parentId !== "coordinator") {
                        const parent = s.agents[newAgent.parentId];
                        if (!parent || parent.status === "killed" || parent.killed) {
                            throw new Error(`Parent agent '${newAgent.parentId}' not found or killed.`);
                        }
                        if (!parent.helperIds || !Array.isArray(parent.helperIds)) {
                            parent.helperIds = [];
                        }
                        if (!parent.helperIds.includes(rawName)) {
                            parent.helperIds.push(rawName);
                        }
                    }
                    s.agents[rawName] = newAgent;
                }, swarmDir);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                action: "add",
                                name: rawName,
                                agent: newAgent,
                                open_board: "read_board",
                            }),
                        },
                    ],
                };
            }
            // 7. ACTION: channel
            if (action !== "channel") {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text",
                            text: `Error: Unknown action '${action}'. Must be status, models, add, model, kill, title, or channel.`,
                        },
                    ],
                };
            }
            if (!op) {
                return {
                    isError: true,
                    content: [
                        {
                            type: "text",
                            text: "Error: 'op' is required when action is 'channel' (must be create, subscribe, unsubscribe, list, or archive).",
                        },
                    ],
                };
            }
            if (op === "list") {
                const channelList = getDeduplicatedChannelList(state);
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                op: "list",
                                channels: channelList,
                            }),
                        },
                    ],
                };
            }
            const normChannel = (channel || "").trim();
            if (!normChannel) {
                return {
                    isError: true,
                    content: [{ type: "text", text: `Error: 'channel' is required for op '${op}'.` }],
                };
            }
            const CHANNEL_REGEX = /^[a-z][a-z0-9-]{0,23}$/;
            const RESERVED = new Set(["main", "all", "here"]);
            if (op === "create") {
                if (normChannel.toLowerCase() === "main" || RESERVED.has(normChannel.toLowerCase())) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: `Error: Cannot create reserved channel '${normChannel}'.` }],
                    };
                }
                if (!CHANNEL_REGEX.test(normChannel)) {
                    return {
                        isError: true,
                        content: [
                            {
                                type: "text",
                                text: `Error: Invalid channel name '${normChannel}'. Must start with a lowercase letter, contain only lowercase letters, digits, and hyphens, max 24 chars, and not contain spaces or uppercase.`,
                            },
                        ],
                    };
                }
                if (state.channels?.[normChannel] && !state.channels[normChannel].archived) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: `Error: Channel '#${normChannel}' already exists.` }],
                    };
                }
                await postMessage(state, swarmDir, {
                    text: `Created channel #${normChannel}${topic ? `: ${topic}` : ""}`,
                    from: effectiveCaller,
                    channel: MAIN_CHANNEL,
                    control: {
                        op: "create",
                        channel: normChannel,
                        topic: topic || "",
                        members: members || [effectiveCaller],
                    },
                });
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                op: "create",
                                channel: normChannel,
                                topic: topic || "",
                            }),
                        },
                    ],
                };
            }
            const chLower = normChannel.toLowerCase();
            if (chLower === MAIN_CHANNEL) {
                return {
                    isError: true,
                    content: [{ type: "text", text: `Error: Cannot ${op} the main channel.` }],
                };
            }
            const existingChannel = state.channels?.[chLower] || state.channels?.[normChannel];
            if (!existingChannel) {
                return {
                    isError: true,
                    content: [{ type: "text", text: `Error: Channel '#${normChannel}' does not exist.` }],
                };
            }
            const targetChannelName = existingChannel.name;
            if (op === "archive") {
                if (existingChannel.archived) {
                    return {
                        isError: true,
                        content: [{ type: "text", text: `Error: Channel '#${normChannel}' is already archived.` }],
                    };
                }
                await postMessage(state, swarmDir, {
                    text: `Archived channel #${targetChannelName}`,
                    from: effectiveCaller,
                    channel: targetChannelName,
                    control: {
                        op: "archive",
                        channel: targetChannelName,
                    },
                });
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                op: "archive",
                                channel: targetChannelName,
                                archived: true,
                            }),
                        },
                    ],
                };
            }
            if (existingChannel.archived) {
                return {
                    isError: true,
                    content: [{ type: "text", text: `Error: Channel '#${normChannel}' is archived.` }],
                };
            }
            const targetMembers = members || (name ? [name] : [effectiveCaller]);
            if (!targetMembers || targetMembers.length === 0) {
                return {
                    isError: true,
                    content: [{ type: "text", text: `Error: No members specified for op '${op}'.` }],
                };
            }
            const warnings = [];
            for (const m of targetMembers) {
                if (m !== "coordinator" && (!state.agents || !state.agents[m])) {
                    warnings.push(`Member '${m}' is not currently registered as an active agent.`);
                }
            }
            if (op === "subscribe") {
                await postMessage(state, swarmDir, {
                    text: `Subscribed ${targetMembers.join(", ")} to #${targetChannelName}`,
                    from: effectiveCaller,
                    channel: targetChannelName,
                    control: {
                        op: "subscribe",
                        channel: targetChannelName,
                        members: targetMembers,
                    },
                });
                const updatedState = await readState();
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                op: "subscribe",
                                channel: targetChannelName,
                                subscribers: updatedState.channels?.[targetChannelName]?.subscribers || [],
                                warnings: warnings.length > 0 ? warnings : undefined,
                            }),
                        },
                    ],
                };
            }
            if (op === "unsubscribe") {
                await postMessage(state, swarmDir, {
                    text: `Unsubscribed ${targetMembers.join(", ")} from #${targetChannelName}`,
                    from: effectiveCaller,
                    channel: targetChannelName,
                    control: {
                        op: "unsubscribe",
                        channel: targetChannelName,
                        members: targetMembers,
                    },
                });
                const updatedState = await readState();
                return {
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                success: true,
                                op: "unsubscribe",
                                channel: targetChannelName,
                                subscribers: updatedState.channels?.[targetChannelName]?.subscribers || [],
                                warnings: warnings.length > 0 ? warnings : undefined,
                            }),
                        },
                    ],
                };
            }
            return {
                isError: true,
                content: [{ type: "text", text: `Error: Unsupported channel operation '${op}'.` }],
            };
        }
        catch (err) {
            console.error("[swarm-engine] swarm channel error:", err);
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
            };
        }
    });
    // Tool 14: get_swarm_view
    server.tool("get_swarm_view", "Expose canonical structured JSON telemetry view (view.json) for IDEs, dashboards, and monitors. Generates atomic view.json strictly capped under 64KB.", {}, async () => {
        try {
            const swarmDir = getSwarmDir();
            const viewPath = path.join(swarmDir, "view.json");
            const tmpPath = path.join(swarmDir, "view.json.tmp");
            // Clean up any stale tmp file
            try {
                await fs.promises.rm(tmpPath, { force: true });
            }
            catch { }
            let state;
            let isInit = true;
            try {
                state = await readState(swarmDir);
            }
            catch {
                isInit = false;
                state = {
                    mission: "Swarm uninitialized",
                    title: "Swarm uninitialized",
                    maxConcurrency: 0,
                    agents: {},
                    blackboard: {},
                    lockedFiles: {},
                    headSeq: 0,
                    channels: {},
                };
            }
            const allAgents = Object.values(state.agents || {});
            const completedCount = allAgents.filter((a) => a.status === "completed").length;
            const totalAgents = allAgents.length;
            const nowMap = {};
            for (const [id, agent] of Object.entries(state.agents || {})) {
                const name = agent.name || id;
                if (agent.status === "waiting") {
                    nowMap[name] = "Waiting on board";
                }
                else if (agent.status === "completed") {
                    nowMap[name] = "Completed task";
                }
                else if (agent.status === "killed") {
                    nowMap[name] = "Retired / Killed";
                }
                else if (agent.status === "failed") {
                    nowMap[name] = `Failed: ${agent.error || "error"}`;
                }
                else {
                    nowMap[name] = agent.brief || agent.taskSpec || "Working on task";
                }
            }
            const headline = state.title || state.mission || "Swarm execution active";
            const goal = {
                title: state.title || state.mission || "Swarm execution",
                line: state.mission || "",
            };
            const phase = {
                label: state.title || state.mission || "Execution",
                index: completedCount,
                total: Math.max(totalAgents, 1),
            };
            const workstreams = Object.values(state.channels || {}).map((ch) => {
                const members = ch.subscribers || [];
                const assigned = members.map((m) => state.agents?.[m]).filter(Boolean);
                const done = assigned.filter((a) => a.status === "completed").length;
                return {
                    id: ch.name,
                    title: ch.topic || ch.name,
                    channel: ch.name,
                    owners: ch.subscribers,
                    done,
                    total: Math.max(assigned.length, 1),
                };
            });
            const attention = [];
            for (const [id, agent] of Object.entries(state.agents || {})) {
                if (agent.status === "failed") {
                    attention.push({
                        id: `failed-${id}`,
                        title: `Agent ${id} failed`,
                        message: agent.error || "Agent execution failed",
                        severity: "error",
                        actions: [{ label: "Retry", target: id }],
                    });
                }
            }
            const threads = Object.values(state.channels || {}).map((ch) => ({
                id: ch.name,
                name: ch.name,
                topic: ch.topic || "",
            }));
            const view = {
                version: 1,
                initialized: isInit,
                headline,
                goal,
                phase,
                as_of_seq: state.headSeq || 0,
                now: nowMap,
                running_summary: state.mission || "Swarm active",
                attention,
                workstreams,
                threads,
            };
            let viewStr = JSON.stringify(view, null, 2);
            if (Buffer.byteLength(viewStr, "utf8") > 64000) {
                view.threads = view.threads.slice(0, 5);
                view.attention = view.attention.slice(0, 10);
                view.running_summary = (view.running_summary || "").slice(0, 500);
                viewStr = JSON.stringify(view, null, 2);
            }
            // Atomically write view.json
            try {
                await fs.promises.mkdir(swarmDir, { recursive: true });
                const tmpWrite = path.join(swarmDir, `view.json.tmp.${Date.now()}-${crypto.randomBytes(4).toString("hex")}`);
                await fs.promises.writeFile(tmpWrite, viewStr, "utf8");
                await fs.promises.rename(tmpWrite, viewPath);
            }
            catch { }
            return {
                content: [
                    {
                        type: "text",
                        text: JSON.stringify({
                            success: true,
                            view,
                            ...view,
                        }),
                    },
                ],
            };
        }
        catch (err) {
            console.error("[swarm-engine] get_swarm_view error:", err);
            return {
                isError: true,
                content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
            };
        }
    });
    return server;
}
/**
 * Starts the Swarm Engine MCP Server on standard I/O (stdio).
 * Safeguard 1: Logs are routed strictly to stderr (console.error)
 * to preserve stdout JSON-RPC frame framing.
 */
export async function startMcpServer() {
    const server = createMcpServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("[swarm-engine] Universal MCP Server running on stdio");
}
