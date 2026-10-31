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
export {};
