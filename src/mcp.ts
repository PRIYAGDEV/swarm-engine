import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import crypto from "node:crypto";
import {
  initState,
  readState,
  updateState,
  normalizePath,
  AgentNode,
  SwarmState,
} from "./state.js";
import {
  tickScheduler,
  mergeAndComplete,
} from "./spawner.js";

/**
 * Cycle detection helper using 3-color DFS traversal.
 * 0 = unvisited, 1 = visiting (current recursion stack), 2 = visited.
 */
function hasCycle(agents: { id: string; dependsOn?: string[] }[]): boolean {
  const adj = new Map<string, string[]>();
  for (const a of agents) {
    adj.set(a.id, a.dependsOn || []);
  }

  const visited = new Map<string, number>();

  function dfs(node: string): boolean {
    visited.set(node, 1);
    const neighbors = adj.get(node) || [];
    for (const neighbor of neighbors) {
      const state = visited.get(neighbor) || 0;
      if (state === 1) {
        return true; // Cycle detected
      }
      if (state === 0) {
        if (dfs(neighbor)) return true;
      }
    }
    visited.set(node, 2);
    return false;
  }

  for (const a of agents) {
    if ((visited.get(a.id) || 0) === 0) {
      if (dfs(a.id)) return true;
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
export function createMcpServer(): McpServer {
  const server = new McpServer({
    name: "swarm-engine",
    version: "1.0.0",
  });

  // Tool 1: spawn_swarm
  server.tool(
    "spawn_swarm",
    "Initialize or schedule a multi-agent swarm with an overarching mission, concurrency ceiling, optional background worker command, and a list of agent specifications forming a DAG.",
    {
      mission: z.string().describe("Overall mission statement or goal for the swarm"),
      maxConcurrency: z
        .number()
        .int()
        .positive()
        .optional()
        .default(4)
        .describe("Maximum number of agents running concurrently (default: 4)"),
      workerCommand: z
        .string()
        .optional()
        .describe("Optional shell command executed to run detached workers in their worktrees"),
      agents: z
        .array(
          z.object({
            id: z.string().optional().describe("Optional unique agent ID"),
            role: z.string().describe("Agent role (e.g., 'backend_developer')"),
            systemPrompt: z.string().optional().describe("Custom instructions and system prompt for the agent"),
            taskSpec: z.string().describe("Detailed task requirements and specifications for this agent"),
            dependsOn: z
              .array(z.string())
              .optional()
              .default([])
              .describe("List of agent IDs that must complete before this agent can start"),
            targetFiles: z
              .array(z.string())
              .optional()
              .default([])
              .describe("Files this agent plans to create or modify (normalized for locking)"),
          })
        )
        .optional()
        .default([])
        .describe("List of initial agent definitions"),
    },
    async ({ mission, maxConcurrency, workerCommand, agents }) => {
      try {
        const agentSpecs = (agents || []).map((a) => ({
          id: a.id || `agent-${crypto.randomUUID().slice(0, 8)}`,
          role: a.role,
          systemPrompt: a.systemPrompt,
          taskSpec: a.taskSpec,
          dependsOn: a.dependsOn || [],
          targetFiles: (a.targetFiles || []).map(normalizePath).filter(Boolean),
        }));

        if (hasCycle(agentSpecs)) {
          return {
            isError: true,
            content: [{ type: "text", text: "Error: Cycle detected in agent dependency graph" }],
          };
        }

        const agentIdSet = new Set(agentSpecs.map((a) => a.id));
        const invalidDeps = agentSpecs.flatMap((a) =>
          a.dependsOn.filter((dep) => !agentIdSet.has(dep))
        );
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

        await initState(mission, maxConcurrency, workerCommand);

        await updateState((state) => {
          for (const spec of agentSpecs) {
            state.agents[spec.id] = {
              id: spec.id,
              role: spec.role,
              systemPrompt: spec.systemPrompt,
              taskSpec: spec.taskSpec,
              dependsOn: spec.dependsOn,
              targetFiles: spec.targetFiles,
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
          ],
        };
      } catch (err: any) {
        console.error("[swarm-engine] spawn_swarm error:", err);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
        };
      }
    }
  );

  // Tool 2: add_dynamic_agent
  server.tool(
    "add_dynamic_agent",
    "Add an on-the-fly specialist agent mid-execution to the running swarm. Automatically schedules or queues based on dependency resolution and file lock availability.",
    {
      id: z.string().optional().describe("Optional unique agent ID"),
      role: z.string().describe("Role or specialization of the dynamic agent"),
      taskSpec: z.string().describe("Detailed task specification and guidelines for this agent"),
      systemPrompt: z.string().optional().describe("Optional custom system prompt"),
      dependsOn: z
        .array(z.string())
        .optional()
        .default([])
        .describe("Agent IDs that must complete before this agent can start"),
      targetFiles: z
        .array(z.string())
        .optional()
        .default([])
        .describe("Files this agent will create or modify"),
    },
    async ({ id, role, taskSpec, systemPrompt, dependsOn, targetFiles }) => {
      try {
        let state: SwarmState;
        try {
          state = await readState();
        } catch {
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

        const newAgent: AgentNode = {
          id: agentId,
          role,
          systemPrompt,
          taskSpec,
          dependsOn: dependsOn || [],
          targetFiles: normTargets,
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
      } catch (err: any) {
        console.error("[swarm-engine] add_dynamic_agent error:", err);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
        };
      }
    }
  );

  // Tool 3: pull_agent_task
  server.tool(
    "pull_agent_task",
    "Claim or view the next ready task or inspect a specific agent's assigned task, returning worktree path, task spec, system prompt, target files, and blackboard memory.",
    {
      agentId: z
        .string()
        .optional()
        .describe("Specific agent ID to pull/claim. If omitted, claims the next available 'running' agent or ready 'pending' agent"),
    },
    async ({ agentId }) => {
      try {
        let state: SwarmState;
        try {
          state = await readState();
        } catch {
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

        let targetAgent: AgentNode | undefined;

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
        } else {
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
      } catch (err: any) {
        console.error("[swarm-engine] pull_agent_task error:", err);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
        };
      }
    }
  );

  // Tool 4: write_blackboard
  server.tool(
    "write_blackboard",
    "Save or update a shared memory entry (contract, schema, API route, or coordination flag) on the blackboard, visible to all swarm agents.",
    {
      key: z.string().describe("Blackboard memory key name"),
      value: z.any().describe("Data value to store (primitive, JSON object, or array)"),
    },
    async ({ key, value }) => {
      try {
        if (!key || typeof key !== "string" || key.trim() === "") {
          return {
            isError: true,
            content: [{ type: "text", text: "Error: Key cannot be empty" }],
          };
        }

        let allKeys: string[] = [];
        await updateState((state) => {
          if (!state.blackboard || typeof state.blackboard !== "object") {
            state.blackboard = {};
          }
          state.blackboard[key] = value;
          allKeys = Object.keys(state.blackboard);
        });

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
      } catch (err: any) {
        console.error("[swarm-engine] write_blackboard error:", err);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
        };
      }
    }
  );

  // Tool 5: complete_agent_task
  server.tool(
    "complete_agent_task",
    "Commit worktree changes, cleanly merge to main, delete worktree and branch, release file locks, update agent status to 'completed', and trigger the DAG scheduler for downstream agents.",
    {
      agentId: z.string().describe("ID of the agent that has finished its task"),
      summary: z.string().optional().describe("Summary of changes made, accomplishments, and notes"),
      outputSummary: z.string().optional().describe("Summary of changes made, accomplishments, and notes"),
    },
    async ({ agentId, summary, outputSummary }) => {
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
      } catch (err: any) {
        console.error("[swarm-engine] complete_agent_task error:", err);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
        };
      }
    }
  );

  // Tool 6: get_swarm_status
  server.tool(
    "get_swarm_status",
    "Get a complete snapshot of the swarm state: mission, concurrency, agent statuses, active file locks, and blackboard keys.",
    {
      detail: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, returns full taskSpec and systemPrompt for all agents"),
    },
    async ({ detail }) => {
      try {
        let state: SwarmState;
        try {
          state = await readState();
        } catch {
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

        const formattedAgents = detail
          ? agentsList
          : agentsList.map((a) => ({
              id: a.id,
              role: a.role,
              status: a.status,
              dependsOn: a.dependsOn,
              targetFiles: a.targetFiles,
              worktreePath: a.worktreePath,
              branchName: a.branchName,
              outputSummary: a.outputSummary,
            }));

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                initialized: true,
                mission: state.mission,
                maxConcurrency: state.maxConcurrency,
                summary,
                counts: summary,
                agents: formattedAgents,
                lockedFiles: lockedFilesList,
                blackboard: state.blackboard || {},
              }),
            },
          ],
        };
      } catch (err: any) {
        console.error("[swarm-engine] get_swarm_status error:", err);
        return {
          isError: true,
          content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
        };
      }
    }
  );

  return server;
}

/**
 * Starts the Swarm Engine MCP Server on standard I/O (stdio).
 * Safeguard 1: Logs are routed strictly to stderr (console.error)
 * to preserve stdout JSON-RPC frame framing.
 */
export async function startMcpServer(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[swarm-engine] Universal MCP Server running on stdio");
}
