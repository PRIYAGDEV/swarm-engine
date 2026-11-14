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
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
/**
 * Checks if a specific CLI command exists in the operating system PATH.
 */
export function isCommandAvailable(cmd) {
    try {
        const isWin = process.platform === "win32";
        const checkCmd = isWin ? `where ${cmd}` : `which ${cmd}`;
        execSync(checkCmd, { stdio: "ignore" });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Automatically detects which AI agent harness is hosting the Swarm Engine.
 */
export function detectAgentHarness(cwd = process.cwd()) {
    const home = process.env.USERPROFILE || process.env.HOME || "";
    const appData = process.env.APPDATA || "";
    // 0. Explicit Environment Override
    const explicit = (process.env.SWARM_HARNESS || "").toLowerCase().trim();
    if (explicit === "claude-code" || explicit === "claude") {
        return {
            type: "claude-code",
            name: "Claude Code",
            description: "Anthropic Claude Code CLI agent harness",
            envVars: { CLAUDE_CODE: "1", SWARM_HARNESS: "claude-code" },
            capabilities: {
                nativeSubagents: true,
                sharedMessageBoard: true,
                isolatedWorktrees: true,
                autoModelInheritance: true,
                cliRunner: isCommandAvailable("claude"),
            },
        };
    }
    if (explicit === "kilo") {
        return {
            type: "kilo",
            name: "Kilo Code",
            description: "Kilo CLI / Kilo Code multi-provider agent harness",
            envVars: { KILO_SESSION: "1", SWARM_HARNESS: "kilo" },
            capabilities: {
                nativeSubagents: false,
                sharedMessageBoard: true,
                isolatedWorktrees: true,
                autoModelInheritance: true,
                cliRunner: isCommandAvailable("kilo"),
            },
        };
    }
    if (explicit === "roo-cline" || explicit === "roo" || explicit === "cline") {
        return {
            type: "roo-cline",
            name: "Roo Code / Cline",
            description: "Roo Code / Cline dual-mode VSCode agent harness",
            envVars: { SWARM_HARNESS: "roo-cline" },
            capabilities: {
                nativeSubagents: false,
                sharedMessageBoard: true,
                isolatedWorktrees: true,
                autoModelInheritance: true,
                cliRunner: false,
            },
        };
    }
    if (explicit === "antigravity") {
        return {
            type: "antigravity",
            name: "Google Antigravity",
            description: "Google DeepMind Agentic Harness with Gemini 4 Carbon and native swarm board",
            envVars: { ANTIGRAVITY_AGENT: "1", SWARM_HARNESS: "antigravity" },
            capabilities: {
                nativeSubagents: true,
                sharedMessageBoard: true,
                isolatedWorktrees: true,
                autoModelInheritance: true,
                cliRunner: true,
            },
        };
    }
    // 1. Explicit Active Session Markers (Order: Claude Code > Kilo > Antigravity > Workspace Dirs)
    if (process.env.CLAUDE_CODE === "1") {
        return {
            type: "claude-code",
            name: "Claude Code",
            description: "Anthropic Claude Code CLI agent harness",
            envVars: { CLAUDE_CODE: "1", SWARM_HARNESS: "claude-code" },
            capabilities: {
                nativeSubagents: true,
                sharedMessageBoard: true,
                isolatedWorktrees: true,
                autoModelInheritance: true,
                cliRunner: isCommandAvailable("claude"),
            },
        };
    }
    if (process.env.KILO_SESSION === "1") {
        return {
            type: "kilo",
            name: "Kilo Code",
            description: "Kilo CLI / Kilo Code multi-provider agent harness",
            envVars: { KILO_SESSION: "1", SWARM_HARNESS: "kilo" },
            capabilities: {
                nativeSubagents: false,
                sharedMessageBoard: true,
                isolatedWorktrees: true,
                autoModelInheritance: true,
                cliRunner: isCommandAvailable("kilo"),
            },
        };
    }
    if (process.env.ROO_MODE) {
        return {
            type: "roo-cline",
            name: "Roo Code / Cline",
            description: "Roo Code / Cline dual-mode VSCode agent harness",
            envVars: { SWARM_HARNESS: "roo-cline" },
            capabilities: {
                nativeSubagents: false,
                sharedMessageBoard: true,
                isolatedWorktrees: true,
                autoModelInheritance: true,
                cliRunner: false,
            },
        };
    }
    if (process.env.ANTIGRAVITY_AGENT === "1" ||
        !!process.env.ANTIGRAVITY_CONVERSATION_ID ||
        !!process.env.ANTIGRAVITY_APP_DATA_DIR) {
        return {
            type: "antigravity",
            name: "Google Antigravity",
            description: "Google DeepMind Agentic Harness with Gemini 4 Carbon and native swarm board",
            envVars: { ANTIGRAVITY_AGENT: "1", SWARM_HARNESS: "antigravity" },
            capabilities: {
                nativeSubagents: true,
                sharedMessageBoard: true,
                isolatedWorktrees: true,
                autoModelInheritance: true,
                cliRunner: true,
            },
        };
    }
    // 2. Workspace-Local Directory Markers
    if (fs.existsSync(path.join(cwd, ".claude"))) {
        return {
            type: "claude-code",
            name: "Claude Code",
            description: "Anthropic Claude Code CLI agent harness",
            envVars: { CLAUDE_CODE: "1", SWARM_HARNESS: "claude-code" },
            capabilities: {
                nativeSubagents: true,
                sharedMessageBoard: true,
                isolatedWorktrees: true,
                autoModelInheritance: true,
                cliRunner: isCommandAvailable("claude"),
            },
        };
    }
    if (fs.existsSync(path.join(cwd, ".kilo"))) {
        return {
            type: "kilo",
            name: "Kilo Code",
            description: "Kilo CLI / Kilo Code multi-provider agent harness",
            envVars: { KILO_SESSION: "1", SWARM_HARNESS: "kilo" },
            capabilities: {
                nativeSubagents: false,
                sharedMessageBoard: true,
                isolatedWorktrees: true,
                autoModelInheritance: true,
                cliRunner: isCommandAvailable("kilo"),
            },
        };
    }
    if (fs.existsSync(path.join(cwd, ".roo")) || fs.existsSync(path.join(cwd, ".cline"))) {
        return {
            type: "roo-cline",
            name: "Roo Code / Cline",
            description: "Roo Code / Cline dual-mode VSCode agent harness",
            envVars: { SWARM_HARNESS: "roo-cline" },
            capabilities: {
                nativeSubagents: false,
                sharedMessageBoard: true,
                isolatedWorktrees: true,
                autoModelInheritance: true,
                cliRunner: false,
            },
        };
    }
    // 3. User Global Configurations
    if (fs.existsSync(path.join(home, ".gemini", "antigravity"))) {
        return {
            type: "antigravity",
            name: "Google Antigravity",
            description: "Google DeepMind Agentic Harness with Gemini 4 Carbon and native swarm board",
            envVars: { ANTIGRAVITY_AGENT: "1", SWARM_HARNESS: "antigravity" },
            capabilities: {
                nativeSubagents: true,
                sharedMessageBoard: true,
                isolatedWorktrees: true,
                autoModelInheritance: true,
                cliRunner: true,
            },
        };
    }
    // 5. Standalone / Headless Fallback
    return {
        type: "standalone",
        name: "Standalone Engine",
        description: "Standalone Swarm Engine with autonomous Fable worker loop",
        envVars: {
            SWARM_HARNESS: "standalone",
        },
        capabilities: {
            nativeSubagents: false,
            sharedMessageBoard: true,
            isolatedWorktrees: true,
            autoModelInheritance: true,
            cliRunner: true,
        },
    };
}
/**
 * Dynamically constructs the AGENT_TASK.md task specification customized
 * specifically for the active agent harness.
 */
export function generateDynamicAgentTask(agent, state, cwd = process.cwd()) {
    const harness = detectAgentHarness(cwd);
    const targetFilesList = agent.targetFiles && agent.targetFiles.length > 0
        ? agent.targetFiles.map((f) => `- \`${f}\``).join("\n")
        : "None specified (Full workspace access)";
    const header = `# Agent Task Assignment

**Agent ID:** ${agent.id}
**Role:** ${agent.role}
**Model:** ${agent.model || "inherit"}
**Workspace Mode:** ${agent.workspace || "inherit"}
**Mission:** ${state.mission}
**Agent Harness:** ${harness.name} (${harness.type})

## System Prompt
${agent.systemPrompt || "Execute assigned responsibilities within project workspace with strict verification."}

## Task Specification
${agent.taskSpec}

## Target Files (Exclusively Locked)
${targetFilesList}

## Blackboard Memory Context
\`\`\`json
${JSON.stringify(state.blackboard || {}, null, 2)}
\`\`\`
`;
    switch (harness.type) {
        case "antigravity":
            return `${header}
## Antigravity Swarm Protocol
You are running under **Google Antigravity**. Use the 4 native swarm tools:
1. **Doorbell Awakening**: Other agents wake you via \`@${agent.id}\` mentions on the shared message board.
2. **Post Deliverables**:
   \`\`\`json
   {
     "name": "post_message",
     "arguments": {
       "text": "@coordinator [done] ${agent.id}: Completed implementation. Ran tests cleanly."
     }
   }
   \`\`\`
3. **Sequence Referencing**: Refer to upstream work by sequence number (e.g. \`#4\`, \`#6\`) rather than copy-pasting.
4. **Park When Finished**:
   \`\`\`json
   {
     "name": "swarm_wait",
     "arguments": { "memberName": "${agent.id}" }
   }
   \`\`\`
5. **Task Completion**: Call \`complete_agent_task\` with \`agentId: "${agent.id}"\` upon finishing.
`;
        case "claude-code":
            return `${header}
## Claude Code Execution Protocol
You are executing in the **Claude Code** agent harness.
1. Inspect files in this workspace using View/Read tools.
2. Apply changes surgically with Edit tools.
3. Validate changes by running automated tests via Bash (\`npm test\`, \`cargo test\`, etc.).
4. When verified, call the \`complete_agent_task\` MCP tool or report your diff summary back to Claude.
`;
        case "kilo":
            return `${header}
## Kilo Code Execution Protocol
You are executing in the **Kilo Code / Kilo CLI** agent harness.
1. Execute file edits in this workspace using configured provider: \`${agent.model}\`.
2. Ensure no file lock conflicts occur with other running subagents.
3. Call \`complete_agent_task\` or run \`swarm-engine complete ${agent.id} "<summary>"\` when ready.
`;
        case "roo-cline":
            return `${header}
## Roo Code / Cline Execution Protocol
You are executing in the **Roo Code / Cline** agent harness under mode \`${agent.role}\`.
1. Make targeted file changes inside this workspace directory.
2. Verify all modifications compile cleanly and satisfy the task specification.
3. Call MCP tool \`complete_agent_task\` with \`agentId: "${agent.id}"\`.
`;
        case "standalone":
        default:
            return `${header}
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
}
/**
 * Dynamically resolves the worker launch command based on the active agent harness.
 */
export function resolveWorkerCommandForHarness(agent, state, cwd = process.cwd()) {
    // Explicit overrides take highest priority
    if (state.workerCommand)
        return state.workerCommand;
    if (process.env.SWARM_WORKER_CMD)
        return process.env.SWARM_WORKER_CMD;
    const harness = detectAgentHarness(cwd);
    switch (harness.type) {
        case "kilo": {
            if (harness.capabilities.cliRunner && (process.env.SWARM_AUTO_RUN === "1" || process.env.SWARM_AUTO_RUN === "true")) {
                const modelArg = agent.model ? `--model "${agent.model}"` : "";
                return `kilo run ${modelArg} "Read AGENT_TASK.md in current directory, implement all requirements, run tests, and report completion."`;
            }
            break;
        }
        case "claude-code": {
            if (harness.capabilities.cliRunner && (process.env.SWARM_AUTO_RUN === "1" || process.env.SWARM_AUTO_RUN === "true")) {
                const modelArg = agent.model ? `--model "${agent.model}"` : "";
                return `claude -p "Read AGENT_TASK.md in current directory, implement all requirements, run tests, and report completion." ${modelArg}`;
            }
            break;
        }
        case "antigravity":
        case "roo-cline":
        case "standalone":
        default: {
            if (process.env.SWARM_AUTO_RUN === "1" || process.env.SWARM_AUTO_RUN === "true") {
                const cliPath = path.resolve(__dirname, "index.js");
                return `"${process.execPath}" "${cliPath}" worker ${agent.id}`;
            }
            break;
        }
    }
    return undefined;
}
/**
 * Injects harness-specific environment variables for spawned worker child processes.
 */
export function buildWorkerEnvForHarness(agent, state, cwd = process.cwd()) {
    const harness = detectAgentHarness(cwd);
    const baseEnv = {
        ...process.env,
        SWARM_HARNESS: harness.type,
        SWARM_AGENT_ID: agent.id,
        SWARM_AGENT_ROLE: agent.role,
        SWARM_AGENT_MODEL: agent.model || "",
        SWARM_DIR: path.join(cwd, ".swarm"),
        SWARM_WORKTREE: agent.worktreePath || cwd,
        ...harness.envVars,
    };
    if (agent.model) {
        if (harness.type === "antigravity") {
            baseEnv.GEMINI_MODEL = agent.model;
        }
        else if (harness.type === "claude-code") {
            baseEnv.ANTHROPIC_MODEL = agent.model;
        }
        else if (harness.type === "kilo") {
            baseEnv.KILO_MODEL = agent.model;
        }
    }
    return baseEnv;
}
