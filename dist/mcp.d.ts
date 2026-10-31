import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
/**
 * Creates and configures the Swarm Engine MCP Server with the 6 core tools:
 * 1. spawn_swarm
 * 2. add_dynamic_agent
 * 3. pull_agent_task
 * 4. write_blackboard
 * 5. complete_agent_task
 * 6. get_swarm_status
 */
export declare function createMcpServer(): McpServer;
/**
 * Starts the Swarm Engine MCP Server on standard I/O (stdio).
 * Safeguard 1: Logs are routed strictly to stderr (console.error)
 * to preserve stdout JSON-RPC frame framing.
 */
export declare function startMcpServer(): Promise<void>;
