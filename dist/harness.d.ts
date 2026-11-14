/**
 * Swarm Engine — Dynamic Agent Harness Adapter
 *
 * Automatically detects the host AI agent harness (Google Antigravity, Claude Code,
 * Kilo CLI, Roo Code/Cline, or Standalone) and dynamically configures:
 * 1. Worker coordination protocols (Antigravity message board vs Claude CLI vs Kilo runner)
 * 2. Injected AGENT_TASK.md instructions tailored to harness capabilities
 * 3. Dynamic worker process commands and environment variables
 * 4. Subagent role/mode alignment
 */
import { AgentNode, SwarmState } from "./state.js";
export type AgentHarnessType = "antigravity" | "claude-code" | "kilo" | "roo-cline" | "standalone";
export interface AgentHarnessInfo {
    type: AgentHarnessType;
    name: string;
    description: string;
    envVars: Record<string, string>;
    capabilities: {
        nativeSubagents: boolean;
        sharedMessageBoard: boolean;
        isolatedWorktrees: boolean;
        autoModelInheritance: boolean;
        cliRunner: boolean;
    };
}
/**
 * Checks if a specific CLI command exists in the operating system PATH.
 */
export declare function isCommandAvailable(cmd: string): boolean;
/**
 * Automatically detects which AI agent harness is hosting the Swarm Engine.
 */
export declare function detectAgentHarness(cwd?: string): AgentHarnessInfo;
/**
 * Dynamically constructs the AGENT_TASK.md task specification customized
 * specifically for the active agent harness.
 */
export declare function generateDynamicAgentTask(agent: AgentNode, state: SwarmState, cwd?: string): string;
/**
 * Dynamically resolves the worker launch command based on the active agent harness.
 */
export declare function resolveWorkerCommandForHarness(agent: AgentNode, state: SwarmState, cwd?: string): string | undefined;
/**
 * Injects harness-specific environment variables for spawned worker child processes.
 */
export declare function buildWorkerEnvForHarness(agent: AgentNode, state: SwarmState, cwd?: string): NodeJS.ProcessEnv;
