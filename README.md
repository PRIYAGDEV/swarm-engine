<div align="center">

# ⚡ Swarm Engine

### Turn your AI assistant into an entire engineering team.
**A pure Agent Skill for Antigravity, Claude Code, Kilo, and Roo Code · Unbounded parallel subagents · Zero Git collisions · Zero TUI overhead**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Tests: 79 Passing](https://img.shields.io/badge/tests-79%20passing%20%7C%20100%25%20verified-brightgreen.svg)](test/)
[![Antigravity Parity: 100%](https://img.shields.io/badge/Google%20Antigravity%20Parity-100%25%20Exact-purple.svg)](#-google-antigravity--carbon-swarm-parity)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](https://nodejs.org)
[![Zero Vulnerabilities](https://img.shields.io/badge/vulnerabilities-0-brightgreen.svg)](package.json)
[![Concurrency: Unlimited](https://img.shields.io/badge/concurrency-%E2%88%9E%20unlimited-purple.svg)](#-how-does-it-work)

<p align="center">
  Tired of single-agent bottlenecks or complex external terminal apps?<br>
  <b>Swarm Engine</b> is a <b>pure AI Agent Skill</b> that empowers your AI assistant to act as a full <b>Swarm Coordinator</b>—spawning specialized subagents, partitioning file ownership cleanly with zero worktree bloat, and synchronizing on a shared message board inside chat.
</p>

[Pure Skill Architecture](#-pure-agent-skill-architecture) • [How It Works](#-how-does-it-work) • [Using with Your AI Tool](#-using-with-your-favorite-ai-tool) • [FAQ](#-frequently-asked-questions)

</div>

---

## 💡 What Makes Swarm Engine Different?

| What Happens Normally | What Swarm Engine Does | Why You Win |
|:---|:---|:---|
| **One Agent at a Time**<br>Tasks run sequentially. 5 tasks take 5× longer. | **Unlimited Parallel Subagents ($\infty$)**<br>Decomposes missions into 5 to 20+ specialized subagents. | **5x to 10x faster execution**. True concurrent throughput. |
| **Git Conflicts & Overwrites**<br>Agents edit the same files and corrupt code. | **Direct Workspace Execution (Zero Worktrees)**<br>Coordinator partitions files cleanly (`workspace: "inherit"` by default). | **Zero git collisions.** Direct workspace editing without worktree bloat. |
| **Silent Down-Tiering to Weaker Models**<br>Coding workers downgraded to Flash/Mini. | **Automatic User Model Inheritance**<br>Coders automatically run on your session model (`Gemini 4 Carbon`, `Claude 3.7 Sonnet`). | **Zero quality compromise.** Never downgraded. |
| **Clunky External TUIs & Terminal Apps**<br>Forced to run CLI commands and watch spinners. | **Pure Agent Skill (Nothing Else)**<br>Operated 100% natively inside your AI assistant's chat. | **Zero context switching.** No terminal windows needed. |
| **Fragile Framework-Specific MCPs**<br>Bespoke configs that break across tools. | **Universal Dynamic Harness Support**<br>Automatically adapts to Antigravity, Claude Code, Kilo, and Roo. | **Works everywhere.** Install once, run anywhere. |

---

## 🎯 Pure Agent Skill Architecture

Swarm Engine is designed from the ground up as a **pure AI Agent Skill** (`SKILL.md`). There is no terminal dashboard to watch, no external TUI to run, and no manual CLI commands required.

Your AI assistant loads the skill and uses four standard tools:

| Tool | What It Does |
|:---|:---|
| **`swarm`** | Manages the swarm: `title`, `add` (spawns workers), `models`, `model` (hot-swap), `kill`, and `channel`. |
| **`post_message`** | Posts immutable messages to the shared message board (`.swarm/board.jsonl`) with `@doorbell` mentions. |
| **`read_board`** | Reads messages, diff summaries, and test outputs filtered by sequence number (`since`) or channel. |
| **`swarm_wait`** | Puts the coordinator to sleep with zero token consumption until a worker posts an update. |

---

## 🚀 Using Swarm Engine as an Agent Skill

Swarm Engine installs natively as an Agent Skill across all major AI agent environments:

<details open>
<summary><b>⚡ Using with Google Antigravity / Gemini 4 Carbon</b></summary>

1. Pre-installed globally at `~/.gemini/config/skills/swarm-engine/SKILL.md`.
2. Antigravity discovers the skill and activates the Swarm Coordinator protocol.
3. Simply instruct Antigravity in chat:
   > *"Run a swarm to build the authentication service, database models, and unit tests in parallel"*
4. The coordinator automatically uses your active session model (e.g. `Gemini 4 Carbon` or `Gemini 3.8 Pro`) for all technical coders.
</details>

<details>
<summary><b>🟣 Using with Claude Code</b></summary>

1. Installed at `~/.claude/skills/swarm-engine/SKILL.md`.
2. Claude Code automatically delegates multi-file tasks into parallel subagents inside isolated worktrees.
3. Technical workers automatically inherit `Claude 3.7 Sonnet` without quality compromise.
</details>

<details>
<summary><b>🤖 Using with Kilo Code / Kilo CLI</b></summary>

1. Installed at `~/.config/kilo/skills/swarm-engine/SKILL.md`.
2. Kilo reads your active model directly from `kilo.jsonc` (e.g. `MiniMax-M2.7`, `GLM-5.3-Flash`, `DeepSeek`).
3. Agents run concurrently with zero file collisions.
</details>

<details>
<summary><b>💻 Using with Roo Code / Cline</b></summary>

1. Installed at `~/.roo/skills/swarm-engine/SKILL.md`.
2. Operates via shared workspace protocols and isolated branches.
</details>

---

## ⚙️ How Does It Work?

```text
               User Request in Chat
                         │
                         ▼
             ┌────────────────────────┐
             │   Coordinator Agent    │  (Uses swarm-engine skill)
             │   (Sizes & Splits DAG) │
             └───────────┬────────────┘
                         │
         ┌───────────────┼───────────────┐
         ▼               ▼               ▼
   ┌───────────┐   ┌───────────┐   ┌───────────┐
   │  Worker 1 │   │  Worker 2 │   │  Worker 3 │  ... (5 to 20+ parallel agents)
   │  Schema   │   │  API Dev  │   │  Tests    │
   └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
         │               │               │
         ▼               ▼               ▼
      prisma/        controllers/      tests/     (Direct in-place file ownership)
         │               │               │
         └───────────────┼───────────────┘
                         ▼
             ┌────────────────────────┐
             │  Shared Message Board  │  (Doorbell @mentions & topic channels)
             │  (.swarm/board.jsonl)  │
             └───────────┬────────────┘
                         ▼
             ┌────────────────────────┐
             │ Verified Milestone OK  │  (In-place review & testing)
             └────────────────────────┘
```

1. **Size & Split**: The coordinator deconstructs the mission into independent pieces (one per file or module).
2. **Direct Workspace Execution (Zero Worktrees)**: Workers operate directly in your project repository (`workspace: "inherit"` by default) without creating git worktree folders.
3. **File Ownership**: The coordinator assigns distinct, non-overlapping files so agents collaborate in-place without collision.
4. **Coordinate**: Workers communicate via `@doorbell` mentions on the shared message board.
5. **Optional Worktree Sandboxing**: Isolated Git worktrees (`workspace: "share"`) remain available if an isolated experimental git branch is ever explicitly requested.

---

## 🔮 Google Antigravity & Carbon Parity (Enhanced)

Swarm Engine delivers **100% architectural parity** with Google Antigravity's native `/swarm` and `/teamwork` skills, enhanced with production-grade isolation:

1. **Automatic Teamwork Model Inheritance (Zero Quality Compromise)**:
   - Technical coders, builders, and authors automatically inherit your active conversation model (`Gemini 4 Carbon`, `Claude 3.7 Sonnet`, `Gemini 3.8 Pro`).
   - Operational stall monitors and narrators automatically use `flash_lite` to save quota during background checks.
   - Down-tiering to smaller models is strictly opt-in.
2. **Doorbell Mentions & Monotonic Sequences**:
   - Every message is given a sequential `#seq` ID (`#1`, `#2`, `#3`).
   - Mentioning `@name` wakes only that worker from `swarm_wait`.
   - Mentioning `@all` broadcasts to all active workers.
   - Channel mentions (`@#ui`) alert only subscribers to that topic stream.
3. **Workspace Isolation & Fallback**:
   - `inherit`: Shared working directory for readers and verifiers.
   - `share`: Isolated Git worktrees for parallel authors.
   - `branch`: Independent clones for experimental refactoring.
   - Non-Git fallback for directories without Git history.
4. **Stall Watchdog (`monitor`)**:
   - An independent monitor wakes when the swarm goes quiet and alerts `@coordinator [stall]` with the specific stuck sequence numbers.

---

## ❓ Frequently Asked Questions

<details>
<summary><b>Q: Do I need to run a CLI command or watch a terminal?</b></summary>

**No.** Swarm Engine is a pure Agent Skill. You interact with your AI assistant in chat as usual. The assistant activates the skill, splits the work, and manages the swarm autonomously.
</details>

<details>
<summary><b>Q: Does Swarm Engine create git worktrees or mess up my Git branches?</b></summary>

**No.** By default, Swarm Engine runs with `workspace: "inherit"` just like Antigravity's `/teamwork` and `/swarm`. Workers operate directly in your project directory with **zero git worktrees** created on disk, zero git branch switching, and zero merge overhead. File conflicts are designed out upfront by assigning distinct files or modules to each worker.
</details>

<details>
<summary><b>Q: How does it prevent agents from overwriting each other's code?</b></summary>

Swarm Engine uses atomic POSIX/Windows directory file locks (`.swarm/state.lock`). If Worker 1 is editing `auth.ts`, Worker 2 is blocked from reserving `auth.ts` until Worker 1 finishes and releases the lock.
</details>

<details>
<summary><b>Q: How do I re-sync skills across my machine?</b></summary>

Run `npm run sync:skills` from the project repository to synchronize the canonical `SKILL.md` across Antigravity, Claude Code, Kilo, DeepSeek, and Roo Code.
</details>

---

## 📄 License

MIT © [PRIYAGDEV](https://github.com/PRIYAGDEV)
