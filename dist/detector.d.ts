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
 * Searches workspace-local .kilo directory for configured models.
 */
export declare function detectFromLocalKilo(cwd?: string): {
    leader?: string;
    worker?: string;
    source?: string;
} | undefined;
/**
 * Searches global Kilo CLI and Kilo Code user configurations for the active model.
 */
export declare function detectFromGlobalKilo(): {
    leader?: string;
    worker?: string;
    source?: string;
} | undefined;
/**
 * Combined Kilo detector checking workspace first then global.
 */
export declare function detectFromKilo(cwd?: string): {
    leader?: string;
    worker?: string;
    source?: string;
} | undefined;
/**
 * Searches Claude Code configuration files for the configured model.
 */
export declare function detectFromClaudeCode(cwd?: string): {
    leader?: string;
    worker?: string;
    source?: string;
} | undefined;
/**
 * Detects active model and environment when running inside Google Antigravity.
 */
export declare function detectFromAntigravity(): {
    leader?: string;
    worker?: string;
    source?: string;
} | undefined;
/**
 * Returns the Teamwork-style model tier based on agent role, name, and task brief.
 * Roles:
 * - Stall monitor, narrator, telemetry, heartbeat -> flash_lite
 * - Lead, coordinator, architect, planner, security auditor, challenger -> pro
 * - General auditor, reviewer -> pro
 * - Verifier, syntax checker, test runner -> flash
 * - General coders, implementers, authors, builders -> flash
 */
export declare function getModelTierForRole(role?: string, name?: string, brief?: string): "pro" | "flash" | "flash_lite";
/**
 * Detects the active provider family from an active or leader model identifier.
 */
export declare function detectProviderFamily(model?: string): "gemini" | "anthropic" | "openai" | "ollama" | "generic";
/**
 * Maps a tier (pro, flash, flash_lite) to a provider-specific canonical model name.
 */
export declare function mapTierToProviderModel(tier: "pro" | "flash" | "flash_lite", family: "gemini" | "anthropic" | "openai" | "ollama" | "generic", activeLeaderModel?: string): string;
export interface ResolveModelOptions {
    role?: string;
    requestedModel?: string;
    leaderModel?: string;
    sourceModel?: string;
    fork?: string;
    parentId?: string;
    brief?: string;
    name?: string;
    cwd?: string;
    qualityProfile?: "quality" | "tiered" | "economy";
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
export declare function resolveModelForRole(options: ResolveModelOptions): string;
/**
 * Automatically returns the next available fallback model in the provider's
 * hierarchy when a worker encounters quota exhaustion (HTTP 429 RESOURCE_EXHAUSTED).
 */
export declare function getQuotaFallbackModel(currentModel: string): string;
/**
 * Returns available model options, including native Teamwork tiers
 * and modern Gemini 4 Carbon, Gemini 3.8, Claude, and OpenAI models.
 */
export declare function getAvailableModels(activeModel?: string): string[];
/**
 * Synchronous automatic model detector across environment variables,
 * editor settings, and workspace .env files.
 */
export declare function detectActiveModelsSync(cwd?: string): DetectedModels;
/**
 * Full automatic model detector including async local Ollama probe.
 */
export declare function detectActiveModels(cwd?: string): Promise<DetectedModels>;
