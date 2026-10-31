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
export interface DetectedModels {
    leaderModel?: string;
    workerModel?: string;
    source?: string;
}
/**
 * Synchronous automatic model detector across environment variables,
 * editor settings, and workspace .env files.
 */
export declare function detectActiveModelsSync(cwd?: string): DetectedModels;
/**
 * Full automatic model detector including async local Ollama probe.
 */
export declare function detectActiveModels(cwd?: string): Promise<DetectedModels>;
