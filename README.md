<div align="center">

# ⚡ Swarm Engine

### Turn your AI assistant into an entire engineering team.
**Run 5 to 20+ specialized AI agents in parallel · Zero Git collisions · Live visual terminal dashboard**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests: 59 Passing](https://img.shields.io/badge/tests-59%20passing%20%7C%206%20tiers-brightgreen.svg)](test/)
[![Pillars: 13/13 Verified](https://img.shields.io/badge/verification-13%2F13%20passed-brightgreen.svg)](test/verify_packaging_and_scaling.mjs)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![Zero Vulnerabilities](https://img.shields.io/badge/vulnerabilities-0-brightgreen.svg)](package.json)
[![Concurrency: Unlimited](https://img.shields.io/badge/concurrency-%E2%88%9E%20unlimited-purple.svg)](#-how-does-it-work)

<p align="center">
  Tired of waiting for a single AI agent to write your code file by file?<br>
  <b>Swarm Engine</b> spawns a coordinated squad of AI specialists—architects, frontend devs, backend devs, and test engineers—that work <b>simultaneously</b> on your codebase in isolated Git worktrees, with <b>zero merge conflicts</b> and a <b>live visual dashboard</b>.
</p>

[Quick Start (30 Seconds)](#-quick-start-in-30-seconds) • [How It Works](#-how-does-it-work) • [Using with Your AI Tool](#-using-with-your-favorite-ai-tool) • [Live Dashboard](#%EF%B8%8F-live-terminal-dashboard) • [FAQ](#-frequently-asked-questions)

</div>

---

## 💡 What Makes Swarm Engine Different?

| What Happens Normally | What Swarm Engine Does | Why You Win |
|:---|:---|:---|
| **One Agent at a Time**<br>Tasks run sequentially. 5 tasks take 5× longer. | **Unlimited Parallel Agents ($\infty$)**<br>Spawns 5 to 20+ subagents working simultaneously. | **5x to 10x faster execution**. No artificial queues. |
| **Git Conflicts & Overwrites**<br>Agents edit the same files and corrupt code. | **Isolated Git Worktrees + File Locks**<br>Each agent gets a clean, private workspace and temporary branch. | **Zero git collisions.** Your `main` branch stays clean. |
| **Locked into One Hardcoded Model**<br>Forced to use whatever model is hardcoded. | **Automatic Model Detection**<br>Detects your active model from Kilo, Claude, Cursor, or `.env`. | Uses **your model** (MiniMax, Claude, DeepSeek, GPT). |
| **Complex MCP Config Files**<br>Debugging JSON files, stdio pipes, and paths. | **Native Agent Skill (Zero-Config)**<br>Installed everywhere on your PC automatically. | **No setup needed.** Just tell your AI to run a swarm. |
| **Invisible Background Actions**<br>You stare at a spinner wondering what's happening. | **Live Fable 5.1 Terminal Dashboard**<br>Visual cards with real-time diffs, tools, and token speeds. | You see **every edit, read, and test** in real time. |

---

## 🚀 Quick Start in 30 Seconds

### Step 1: Install Globally
Install via npm so `swarm-engine` is available in every terminal:

```bash
npm install -g swarm-engine
```

*(Or build locally: `git clone https://github.com/PRIYAGDEV/swarm-engine.git && cd Swarm-engine && npm install && npm run build && npm link`)*

### Step 2: Run a Swarm on Your Project

Open any terminal in your project directory and type:

```bash
# Launch a team of parallel agents on your mission
swarm-engine run "Add Google authentication, create user database schema, and write unit tests"
```

### Step 3: Watch the Live Dashboard

In another terminal window (or split pane), run:

```bash
swarm-engine watch
```

That's it! Your agents will split the work, code in parallel, test their changes, and merge cleanly into your repository.

---

## 🖥️ Live Terminal Dashboard

When your swarm runs, Swarm Engine renders an interactive Fable-styled visual terminal interface:

```text
swarm-engine -> 3 × workers · ~/my-app                                            ↓ 242.0k · 12m 45s
* swarm   lead orchestrator                                                workers : gpt-4o : claude-3-5
● Final pass. Dispatching.
● Mission: Multi-agent service refactoring and API migration
● @worker-1 Fix lint errors and refactor codebase.
◒ Orchestrating... (12m 45s · 242.0k tokens · esc to interrupt)
────────────────────────────────────────────────────────────────────────────────────────────────────────
╭ * worker-1 ──────────────── refactor_specialist · gpt-4o ╮ ╭ * worker-2 ─────────────────── test_engineer ╮
│ ● Edit(src/services/auth.ts)                             │ │ ● Read(tests/auth.test.ts)                   │
│  140 - let reps = 0                                      │ │   └ Read 94 lines                            │
│   68 + const reps = 0                                    │ │ ● Bash(npm test auth)                        │
│ ● Refactoring... (↓ 92.0k · 78 tok/s)                    │ │ ● Testing... (↓ 124.0k · 110 tok/s)          │
╰──────────────────────────────────────────────────────────╯ ╰──────────────────────────────────────────────╯
╭ * worker-3 ────────────────────────────── cleanup_agent ╮
│ ● Read(src/ui/Component.tsx)                             │
│   └ Read 160 lines                                       │
│ ● Simmering... (↓ 26.0k · 44 tok/s)                      │
╰──────────────────────────────────────────────────────────╯
[swarm-engine] 0:agents* 1:orchestrator ● 1/3 done · +142 -38 lines · 1 active lock       q: quit  r: refresh
```

### What You See in the Dashboard:
* **Agent Cards**: Each worker gets its own card showing its role and active model.
* **Live Action Log**: Shows exactly what tool the agent is running right now (`Edit`, `Read`, `Bash`).
* **Visual Git Diff Bars**: Red/green diff counters showing lines added and removed.
* **Telemetry**: Real-time token usage and generation speed (`tok/s`).
* **Active Locks**: Which files are currently reserved to prevent collisions.

---

## 🛠️ Using with Your Favorite AI Tool

Swarm Engine works out of the box with the most popular AI coding assistants. You don't even need to configure MCP—it runs as a native **Agent Skill**!

<details open>
<summary><b>🤖 Using with Kilo Code / Kilo CLI</b></summary>

1. **Auto Model Detection**: Swarm Engine reads your `~/.config/kilo/kilo.jsonc` file automatically. If you're using `MiniMax-M2.7`, `GLM-5.3-Flash`, or `DeepSeek`, your swarm agents will automatically use that exact model!
2. **Skill Included**: The skill is installed at `~/.config/kilo/skills/swarm-engine`.
3. **Usage in Kilo**: Just type in your Kilo chat:
   > *"Run a swarm to build the login screen, API service, and auth tests in parallel"*
</details>

<details>
<summary><b>🟣 Using with Claude Code</b></summary>

1. The skill is installed at `~/.claude/skills/swarm-engine`.
2. Claude Code will automatically invoke `swarm-engine run` to break complex multi-file tasks into parallel subagents.
3. You can also trigger it manually from Claude Code by running `!swarm-engine run "..."`.
</details>

<details>
<summary><b>💻 Using with Cursor</b></summary>

1. Open your integrated terminal in Cursor (`Ctrl + ~`).
2. Run `swarm-engine run "your task"` in the terminal.
3. Keep Cursor's editor open on your main code—agents work in background `.swarm/worktrees/` without disrupting what you're viewing, and merge cleanly when finished!
</details>

<details>
<summary><b>⚡ Using with Antigravity / Gemini</b></summary>

1. Pre-installed globally at `~/.gemini/config/skills/swarm-engine`.
2. Antigravity detects the skill and automatically delegates multi-agent tasks directly to Swarm Engine.
</details>

---

## ⚙️ How Does It Work?

```text
                 Your Mission Prompt
                         │
                         ▼
             ┌────────────────────────┐
             │   DAG Auto-Scheduler   │
             │   (Zero Queuing)       │
             └───────────┬────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   ┌───────────┐   ┌───────────┐   ┌───────────┐
   │ Agent 1   │   │ Agent 2   │   │ Agent 3   │  ... (up to 20+ agents)
   │ Frontend  │   │ Backend   │   │ Tests     │
   └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
         │               │               │
   Worktree 1      Worktree 2      Worktree 3     (Isolated Git folders)
         │               │               │
         └───────────────┼───────────────┘
                         ▼
             ┌────────────────────────┐
             │  Shared Blackboard Bus │  (Passes API types & schemas)
             └───────────┬────────────┘
                         ▼
             ┌────────────────────────┐
             │ Safe Clean Git Merge   │  (Zero-conflict --no-ff)
             └────────────────────────┘
```

1. **Decompose**: The mission is split into specialist roles (e.g. 5 to 20+ subagents).
2. **Isolate**: Each agent gets its own clean directory (`.swarm/worktrees/<agentId>`) on a dedicated Git branch.
3. **Protect**: If Agent 1 is editing `auth.ts`, an atomic file lock prevents Agent 2 from touching it until Agent 1 finishes.
4. **Communicate**: Agents share API schemas and database models through a shared **in-memory Blackboard**.
5. **Merge**: When an agent finishes, its temporary prompt files are deleted, changes are merged cleanly into `main`, and the worktree is cleaned up.

---

## 📋 Simple Command Cheat Sheet

Everything you need to control Swarm Engine in your terminal:

| Goal | Command | What It Does |
|:---|:---|:---|
| **Start a Swarm** | `swarm-engine run "My Mission"` | Spawns parallel agents and starts coding. |
| **Watch Progress** | `swarm-engine watch` | Opens the real-time Fable terminal dashboard. |
| **Check Status** | `swarm-engine status` | Prints a snapshot table of all agents and active locks. |
| **Status for Scripts** | `swarm-engine status --json` | Outputs clean JSON for scripting and automation. |
| **Reset / Clean Up** | `swarm-engine reset --hard` | Safely removes all worktrees, branches, and locks. |
| **Sync Skills Everywhere**| `npm run sync:skills` | Re-syncs the skill to Kilo, Claude, Cursor, Antigravity, etc. |

---

## ❓ Frequently Asked Questions

<details>
<summary><b>Q: Will Swarm Engine mess up my Git branches or commit history?</b></summary>

**No.** Swarm Engine was specifically engineered to protect your Git repository:
1. Every subagent works on an isolated temporary branch inside its own Git worktree folder (`.swarm/worktrees/`).
2. Task prompt files (`AGENT_TASK.md`) are deleted **before** commits are created so they never enter your Git history.
3. When finished, changes are merged cleanly using `--no-ff` and temporary branches are automatically deleted.
</details>

<details>
<summary><b>Q: Why were my agents waiting / queued before, and are they parallel now?</b></summary>

In previous versions, swarms had a low default concurrency limit (e.g. 4) and strict sequential dependency chains. In the current version:
- **Concurrency is infinite ($\infty$) by default** (`maxConcurrency: 0`).
- **Zero queuing**: All agents without an explicit file lock collision start immediately in parallel.
</details>

<details>
<summary><b>Q: How does it know which model to use?</b></summary>

Swarm Engine contains an intelligent model detector ([`src/detector.ts`](src/detector.ts)):
- If you use **Kilo CLI**, it reads your active model directly from `~/.config/kilo/kilo.jsonc` (e.g. `MiniMax-M2.7`, `GLM-5.3-Flash`, `DeepSeek-V4`).
- It also checks `.env`, Claude Code, and Cursor configs.
- You never get stuck with the wrong model.
</details>

<details>
<summary><b>Q: Do I need to configure MCP (Model Context Protocol)?</b></summary>

**No!** While Swarm Engine includes a full MCP server (`swarm-engine mcp`), we recommend using it as an **Agent Skill**. AI tools can simply call `swarm-engine run` via their terminal tools without managing background servers or fragile JSON configs.
</details>

<details>
<summary><b>Q: What if I don't use Git or my repo has 0 commits?</b></summary>

Swarm Engine has an automatic **Non-Git Fallback**. If you are outside a Git repository, it uses atomic filesystem directory snapshotting to provide the exact same safety and isolation guarantees without throwing errors.
</details>

---

## 🧪 Battle-Tested Quality

Swarm Engine has been rigorously tested against real-world file race conditions and high-concurrency swarms:

- **59 / 59 Unit & Integration Tests Passing** across 6 tiers (`npm test`).
- **13 / 13 Verification Pillars Passed** simulating 18+ concurrent subagents (`npm run verify`).
- **Zero Security Vulnerabilities** (`npm audit`).

```bash
# Run tests anytime
npm test

# Run multi-environment verification
npm run verify
```

---

## 📄 License

Open-source under the **[MIT License](LICENSE)**.

Crafted with ⚡ by **[PRIYAGDEV](https://github.com/PRIYAGDEV)**. Contributions, suggestions, and feature requests are always welcome!
