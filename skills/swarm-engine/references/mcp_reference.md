# Swarm Engine — Model Context Protocol (MCP) Reference

Swarm Engine provides a full-featured Model Context Protocol (MCP) server over standard I/O (`stdio`). This allows AI agents in Claude Code, Kilo CLI, Antigravity, Cline, Roo Code, and Cursor to orchestrate parallel swarms natively.

---

## 1. Tool Index

| Tool | Purpose | Concurrency & Behavior |
|---|---|---|
| `spawn_swarm` | Initializes mission and spawns 5 to 20+ initial subagents | Unbounded, `maxConcurrency: 0` default, parallel |
| `add_dynamic_agent` | Injects an on-the-fly specialist agent mid-flight | Instant scheduling, zero queuing |
| `pull_agent_task` | Claims or inspects assigned worktree task context | Returns worktree path, spec, locked files, blackboard |
| `write_blackboard` | Stores shared types, schemas, and coordination keys | Auto-synced to all running `AGENT_TASK.md` |
| `complete_agent_task` | Merges worktree, cleans branches, releases file locks | Triggers DAG scheduler for dependents |
| `get_swarm_status` | Detailed snapshot of swarm state and active locks | Optional `detail: true` for full task specs |
| `record_agent_action` | Streams live tool actions to Fable TUI | Reads, edits, diffs (+/-), shell commands |
| `update_agent_progress`| Updates real-time telemetry | Poetic verbs, tokens, tok/s velocity |
| `run_agent_task` | Launches autonomous agent execution in worktree | Background worker runner |

---

## 2. Tool Specifications & Payloads

### 2.1 `spawn_swarm`
Initializes and launches an unbounded multi-agent swarm. Assistant models are explicitly encouraged to decompose tasks into 5 to 20+ specialized parallel workers.

#### Parameter Schema
```json
{
  "type": "object",
  "properties": {
    "mission": {
      "type": "string",
      "description": "Overall mission statement or goal for the swarm"
    },
    "leaderModel": {
      "type": "string",
      "description": "Model identifier for orchestrator (e.g. 'claude-3-7-sonnet', 'gpt-4o')"
    },
    "maxConcurrency": {
      "type": "integer",
      "default": 0,
      "description": "Maximum concurrent running agents (0 = unlimited / infinite concurrency, default: 0)"
    },
    "parallel": {
      "type": "boolean",
      "default": true,
      "description": "Run all agents simultaneously in parallel across isolated worktrees with zero queuing"
    },
    "strictDependencies": {
      "type": "boolean",
      "default": false,
      "description": "Enforce hard sequential blocking on dependsOn"
    },
    "workerCommand": {
      "type": "string",
      "description": "Optional shell command executed to run detached workers in their worktrees"
    },
    "agents": {
      "type": "array",
      "default": [],
      "description": "List of initial agent definitions (5 to 20+ specialized agents encouraged)",
      "items": {
        "type": "object",
        "properties": {
          "id": { "type": "string", "description": "Optional unique agent ID" },
          "role": { "type": "string", "description": "Specialized role name" },
          "model": { "type": "string", "description": "Model identifier override" },
          "systemPrompt": { "type": "string", "description": "Custom agent instructions" },
          "taskSpec": { "type": "string", "description": "Detailed task instructions" },
          "dependsOn": { "type": "array", "items": { "type": "string" }, "default": [] },
          "targetFiles": { "type": "array", "items": { "type": "string" }, "default": [] }
        },
        "required": ["role", "taskSpec"]
      }
    }
  },
  "required": ["mission"]
}
```

#### Request Example
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "spawn_swarm",
    "arguments": {
      "mission": "Refactor authentication system to JWT with refresh tokens",
      "maxConcurrency": 0,
      "parallel": true,
      "agents": [
        {
          "id": "arch-1",
          "role": "auth_architect",
          "taskSpec": "Define JWT payload types, error enums, and blackboard contracts.",
          "targetFiles": ["src/auth/types.ts"]
        },
        {
          "id": "db-1",
          "role": "database_engineer",
          "taskSpec": "Create refresh_tokens schema and user token relations.",
          "targetFiles": ["src/db/schema.ts", "migrations/003_tokens.sql"]
        },
        {
          "id": "api-1",
          "role": "endpoint_developer",
          "taskSpec": "Implement /auth/login and /auth/refresh route handlers.",
          "targetFiles": ["src/api/auth.ts"]
        },
        {
          "id": "guard-1",
          "role": "security_guard",
          "taskSpec": "Implement Bearer token verification middleware and unit tests.",
          "targetFiles": ["src/middleware/jwt.ts", "test/jwt.spec.ts"]
        },
        {
          "id": "docs-1",
          "role": "docs_writer",
          "taskSpec": "Document auth flow in docs/auth.md and update README.",
          "targetFiles": ["docs/auth.md", "README.md"]
        }
      ]
    }
  }
}
```

#### Response Example
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"success\":true,\"mission\":\"Refactor authentication system to JWT with refresh tokens\",\"maxConcurrency\":0,\"totalAgents\":5,\"runningAgents\":[\"arch-1\",\"db-1\",\"api-1\",\"guard-1\",\"docs-1\"],\"pendingAgents\":[],\"activeLocks\":[\"src/auth/types.ts\",\"src/db/schema.ts\",\"migrations/003_tokens.sql\",\"src/api/auth.ts\",\"src/middleware/jwt.ts\",\"test/jwt.spec.ts\",\"docs/auth.md\",\"README.md\"]}"
      }
    ]
  }
}
```

---

### 2.2 `add_dynamic_agent`
Injects an on-the-fly specialist subagent mid-execution into the running swarm with zero queuing.

#### Request Example
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "add_dynamic_agent",
    "arguments": {
      "id": "crypto-audit",
      "role": "security_auditor",
      "taskSpec": "Verify timing attack resilience on HMAC signature comparisons.",
      "targetFiles": ["src/auth/crypto.ts"],
      "dependsOn": ["arch-1"]
    }
  }
}
```

#### Response Example
```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"success\":true,\"agent\":{\"id\":\"crypto-audit\",\"role\":\"security_auditor\",\"status\":\"running\",\"targetFiles\":[\"src/auth/crypto.ts\"]},\"scheduled\":true}"
      }
    ]
  }
}
```

---

### 2.3 `pull_agent_task`
Claims or inspects the next ready task or retrieves a specific agent's assigned worktree context.

#### Request Example
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "method": "tools/call",
  "params": {
    "name": "pull_agent_task",
    "arguments": {
      "agentId": "db-1"
    }
  }
}
```

#### Response Example
```json
{
  "jsonrpc": "2.0",
  "id": 3,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"success\":true,\"agentId\":\"db-1\",\"role\":\"database_engineer\",\"status\":\"running\",\"taskSpec\":\"Create refresh_tokens schema...\",\"worktreePath\":\"E:\\\\Swarm-engine\\\\.swarm\\\\worktrees\\\\db-1\",\"branchName\":\"swarm/db-1\",\"targetFiles\":[\"src/db/schema.ts\",\"migrations/003_tokens.sql\"],\"blackboard\":{}}"
      }
    ]
  }
}
```

---

### 2.4 `write_blackboard`
Saves or updates a shared memory key (data contract, route mapping, schema) visible to all swarm agents.

#### Request Example
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "method": "tools/call",
  "params": {
    "name": "write_blackboard",
    "arguments": {
      "key": "jwt_interface",
      "value": {
        "header": { "alg": "HS256", "typ": "JWT" },
        "claims": ["userId", "email", "roles", "exp", "iat"]
      }
    }
  }
}
```

#### Response Example
```json
{
  "jsonrpc": "2.0",
  "id": 4,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"success\":true,\"key\":\"jwt_interface\",\"allKeys\":[\"jwt_interface\"]}"
      }
    ]
  }
}
```

---

### 2.5 `complete_agent_task`
Commits worktree changes (`--allow-empty`), strips `AGENT_TASK.md`, cleanly merges to main (`--no-ff`), prunes the worktree directory and branch, releases file locks, and triggers the scheduler.

#### Request Example
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "method": "tools/call",
  "params": {
    "name": "complete_agent_task",
    "arguments": {
      "agentId": "arch-1",
      "summary": "Defined AuthPayload and TokenPair interfaces and updated types export"
    }
  }
}
```

#### Response Example
```json
{
  "jsonrpc": "2.0",
  "id": 5,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"success\":true,\"agentId\":\"arch-1\",\"status\":\"completed\",\"summary\":\"Defined AuthPayload and TokenPair interfaces...\",\"unblockedAgents\":[\"crypto-audit\"]}"
      }
    ]
  }
}
```

---

### 2.6 `get_swarm_status`
Returns a complete snapshot of swarm mission, concurrency, agent statuses, active file locks, and blackboard keys.

#### Request Example
```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "method": "tools/call",
  "params": {
    "name": "get_swarm_status",
    "arguments": {
      "detail": false
    }
  }
}
```

#### Response Example
```json
{
  "jsonrpc": "2.0",
  "id": 6,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "{\"initialized\":true,\"mission\":\"Refactor authentication system to JWT with refresh tokens\",\"maxConcurrency\":0,\"counts\":{\"total\":5,\"pending\":0,\"running\":4,\"completed\":1,\"failed\":0},\"lockedFiles\":[\"src/db/schema.ts\",\"migrations/003_tokens.sql\",\"src/api/auth.ts\",\"src/middleware/jwt.ts\",\"test/jwt.spec.ts\",\"docs/auth.md\",\"README.md\"]}"
      }
    ]
  }
}
```

---

### 2.7 `record_agent_action`
Streams a real-time tool action (edit, read, bash, update, delete, status) executed by an agent to the Fable TUI dashboard.

#### Request Example
```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "record_agent_action",
    "arguments": {
      "agentId": "guard-1",
      "actionType": "edit",
      "target": "src/middleware/jwt.ts",
      "detail": "Added verifyToken helper",
      "diffs": [
        { "type": "add", "line": "export function verifyToken(req, res, next) {", "lineNo": 42 },
        { "type": "add", "line": "  const token = req.headers.authorization?.split(' ')[1];", "lineNo": 43 }
      ]
    }
  }
}
```

---

### 2.8 `update_agent_progress`
Updates an agent's real-time telemetry: thought, poetic verb, tokens, and throughput (`tok/s`).

#### Request Example
```json
{
  "jsonrpc": "2.0",
  "id": 8,
  "method": "tools/call",
  "params": {
    "name": "update_agent_progress",
    "arguments": {
      "agentId": "guard-1",
      "thought": "Verifying HMAC algorithm parameter validation to avoid none-algorithm exploits",
      "verb": "Forging...",
      "tokens": 1420,
      "tokPerSec": 84.5
    }
  }
}
```

---

### 2.9 `run_agent_task`
Triggers autonomous worker execution for an agent inside its isolated worktree.

#### Request Example
```json
{
  "jsonrpc": "2.0",
  "id": 9,
  "method": "tools/call",
  "params": {
    "name": "run_agent_task",
    "arguments": {
      "agentId": "guard-1"
    }
  }
}
```
