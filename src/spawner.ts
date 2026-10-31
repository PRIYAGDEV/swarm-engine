import { spawn, execFile, execSync } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AgentNode,
  SwarmState,
  normalizePath,
  getSwarmDir,
  readState,
  updateState,
} from "./state.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const execFileAsync = promisify(execFile);

/**
 * Checks whether the current working directory is inside a Git repository.
 */
export function isGitRepo(cwd: string = process.cwd()): boolean {
  try {
    const res = execSync("git rev-parse --is-inside-work-tree", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    return res.trim() === "true";
  } catch {
    return false;
  }
}

/**
 * Checks whether the Git repository has at least one commit (HEAD exists).
 */
export function hasGitHead(cwd: string = process.cwd()): boolean {
  try {
    execSync("git rev-parse --verify HEAD", {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    return true;
  } catch {
    return false;
  }
}

export const hasHeadCommit = hasGitHead;

/**
 * Recursively removes a file or directory with backoff retries
 * to handle transient Windows EBUSY / EPERM file lock delays.
 */
async function rmWithRetry(targetPath: string, maxAttempts = 6): Promise<void> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      await fs.rm(targetPath, { recursive: true, force: true });
      return;
    } catch (err: any) {
      if (err.code === "ENOENT") return;
      if (attempt === maxAttempts - 1) {
        console.error(
          `[swarm-engine] Warning: Could not remove ${targetPath} after ${maxAttempts} attempts:`,
          err
        );
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)));
    }
  }
}

/**
 * Recursively copies project files into a worktree directory for non-git environments,
 * excluding .git, .swarm, and node_modules directories.
 */
async function copyProjectFiles(sourceDir: string, destDir: string): Promise<void> {
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (
      entry.name === ".git" ||
      entry.name === ".swarm" ||
      entry.name === "node_modules"
    ) {
      continue;
    }
    const srcPath = path.join(sourceDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      await fs.mkdir(destPath, { recursive: true });
      await copyProjectFiles(srcPath, destPath);
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(destPath), { recursive: true });
      await fs.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Recursively copies modified/new files from a worktree back to the root workspace
 * for non-git environments, excluding AGENT_TASK.md, .git, .swarm, and node_modules.
 */
async function copyWorktreeBack(worktreeDir: string, rootDir: string): Promise<void> {
  async function copyDir(currentSrc: string, currentDest: string) {
    const entries = await fs.readdir(currentSrc, { withFileTypes: true });
    for (const entry of entries) {
      if (
        entry.name === "AGENT_TASK.md" ||
        entry.name === ".git" ||
        entry.name === ".swarm" ||
        entry.name === "node_modules"
      ) {
        continue;
      }
      const srcItem = path.join(currentSrc, entry.name);
      const destItem = path.join(currentDest, entry.name);

      if (entry.isDirectory()) {
        await fs.mkdir(destItem, { recursive: true });
        await copyDir(srcItem, destItem);
      } else if (entry.isFile()) {
        await fs.mkdir(path.dirname(destItem), { recursive: true });
        await fs.copyFile(srcItem, destItem);
      }
    }
  }

  await copyDir(worktreeDir, rootDir);
}

/**
 * Formats structured task instructions, system prompts, file locks, and blackboard memory
 * into the AGENT_TASK.md task specification.
 */
function generateAgentTaskContent(agent: AgentNode, state: SwarmState): string {
  const targetFilesList =
    agent.targetFiles && agent.targetFiles.length > 0
      ? agent.targetFiles.map((f) => `- ${f}`).join("\n")
      : "None specified";

  return `# Agent Task Assignment

**Agent ID:** ${agent.id}
**Role:** ${agent.role}
**Mission:** ${state.mission}

## System Prompt
${agent.systemPrompt || "N/A"}

## Task Specification
${agent.taskSpec}

## Target Files (Locked)
${targetFilesList}

## Blackboard Memory Context
\`\`\`json
${JSON.stringify(state.blackboard || {}, null, 2)}
\`\`\`

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

/**
 * Creates an isolated working directory for an agent.
 * Uses a Git worktree (`git worktree add -B swarm/<agentId>`) if in a Git repo with commits,
 * or falls back to recursively copying workspace files if non-Git or unborn HEAD (Safeguard 3).
 * Injects AGENT_TASK.md into the worktree.
 */
export async function createWorktree(
  agentOrId: string | AgentNode,
  stateOrCwd?: SwarmState | string,
  customCwd?: string
): Promise<string> {
  let agentId: string;
  let agent: AgentNode | undefined;
  let state: SwarmState | undefined;
  let cwd: string = process.cwd();

  if (typeof agentOrId === "string") {
    agentId = agentOrId;
  } else {
    agent = agentOrId;
    agentId = agentOrId.id;
  }

  if (typeof stateOrCwd === "string") {
    cwd = stateOrCwd;
  } else if (stateOrCwd && typeof stateOrCwd === "object") {
    state = stateOrCwd;
    if (customCwd) cwd = customCwd;
  } else if (customCwd) {
    cwd = customCwd;
  }

  const swarmDir = getSwarmDir(cwd);

  if (!state) {
    try {
      state = await readState(swarmDir);
    } catch {
      state = {
        mission: "Dynamic Multi-Agent Swarm",
        maxConcurrency: 4,
        agents: {},
        blackboard: {},
        lockedFiles: {},
      };
    }
  }

  if (!agent) {
    agent = state.agents[agentId] || {
      id: agentId,
      role: "worker",
      taskSpec: "Execute assigned task",
      dependsOn: [],
      targetFiles: [],
      status: "running",
    };
  }

  const worktreePath = path.resolve(swarmDir, "worktrees", agentId);
  const relWorktreePath = path.relative(cwd, worktreePath).replace(/\\/g, "/");

  const isGit = isGitRepo(cwd) && hasGitHead(cwd);

  if (isGit) {
    const parentDir = path.dirname(worktreePath);
    await fs.mkdir(parentDir, { recursive: true });

    // Ensure clean state before git worktree add
    try {
      await execFileAsync("git", ["worktree", "remove", "--force", worktreePath], { cwd });
    } catch {}
    await rmWithRetry(worktreePath);
    try {
      await execFileAsync("git", ["worktree", "prune"], { cwd });
    } catch {}

    // Run: git worktree add -B swarm/<agentId> .swarm/worktrees/<agentId> HEAD
    try {
      await execFileAsync(
        "git",
        ["worktree", "add", "-B", `swarm/${agentId}`, relWorktreePath, "HEAD"],
        { cwd }
      );
    } catch (gitErr) {
      console.error(
        `[swarm-engine] git worktree add failed, falling back to directory copy:`,
        gitErr
      );
      await fs.mkdir(worktreePath, { recursive: true });
      await copyProjectFiles(cwd, worktreePath);
    }
  } else {
    // Non-Git fallback (Safeguard 3)
    await fs.mkdir(worktreePath, { recursive: true });
    await copyProjectFiles(cwd, worktreePath);
  }

  // Generate AGENT_TASK.md inside worktree
  const taskContent = generateAgentTaskContent(agent, state);
  await fs.writeFile(path.join(worktreePath, "AGENT_TASK.md"), taskContent, "utf8");

  return worktreePath;
}

/**
 * DAG Scheduler loop evaluating pending agents in the swarm state.
 * Resolves dependencies, checks file lock collisions (normalized paths - Safeguard 4),
 * gates execution by maxConcurrency, sets agent status to running, locks files,
 * creates worktrees, and spawns background workers if configured.
 */
export async function tickScheduler(cwd: string = process.cwd()): Promise<void> {
  const swarmDir = getSwarmDir(cwd);

  try {
    await updateState(async (state) => {
      const runningAgents = Object.values(state.agents).filter(
        (a) => a.status === "running"
      );
      const runningCount = runningAgents.length;
      const maxConcurrency = state.maxConcurrency || 4;
      let availableSlots = maxConcurrency - runningCount;

      if (availableSlots <= 0) {
        return;
      }

      if (!state.lockedFiles || typeof state.lockedFiles !== "object") {
        state.lockedFiles = {};
      }

      // Collect currently locked files (normalized paths - Safeguard 4)
      const currentlyLocked = new Set<string>();
      if (Array.isArray(state.lockedFiles)) {
        for (const f of state.lockedFiles) {
          if (f) currentlyLocked.add(normalizePath(f));
        }
      } else {
        for (const f of Object.keys(state.lockedFiles)) {
          if (f) currentlyLocked.add(normalizePath(f));
        }
      }

      const pendingAgents = Object.values(state.agents).filter(
        (a) => a.status === "pending"
      );

      for (const agent of pendingAgents) {
        if (availableSlots <= 0) break;

        // 1. Dependency check: all dependsOn agent IDs must be 'completed'
        const dependsOn = agent.dependsOn || [];
        const dependenciesMet = dependsOn.every((depId) => {
          const dep = state.agents[depId];
          return dep && dep.status === "completed";
        });
        if (!dependenciesMet) {
          continue;
        }

        // 2. File lock check (Safeguard 4: normalized paths)
        const normTargets = Array.from(
          new Set((agent.targetFiles || []).map(normalizePath).filter(Boolean))
        );
        const hasCollision = normTargets.some((f) => currentlyLocked.has(f));
        if (hasCollision) {
          continue;
        }

        // 3. Mark running & acquire locks
        agent.status = "running";
        for (const normPath of normTargets) {
          if (Array.isArray(state.lockedFiles)) {
            (state.lockedFiles as any[]).push(normPath);
          } else {
            state.lockedFiles[normPath] = agent.id;
          }
          currentlyLocked.add(normPath);
        }
        availableSlots--;

        // 4. Create worktree & inject AGENT_TASK.md
        const worktreePath = await createWorktree(agent, state, cwd);
        agent.worktreePath = worktreePath;
        agent.branchName = `swarm/${agent.id}`;

        // 5. Spawn background worker if workerCommand or SWARM_AUTO_RUN is enabled
        const workerCmd = state.workerCommand || process.env.SWARM_WORKER_CMD;
        if (workerCmd) {
          try {
            const child = spawn(workerCmd, {
              cwd: worktreePath,
              shell: true,
              detached: true,
              stdio: "ignore",
            });
            child.unref();
            agent.pid = child.pid;
          } catch (spawnErr) {
            console.error(
              `[swarm-engine] Error spawning worker for agent ${agent.id}:`,
              spawnErr
            );
          }
        } else if (process.env.SWARM_AUTO_RUN === "1" || process.env.SWARM_AUTO_RUN === "true") {
          try {
            const cliPath = path.resolve(__dirname, "index.js");
            const child = spawn(process.execPath, [cliPath, "worker", agent.id], {
              cwd: worktreePath,
              detached: true,
              stdio: "ignore",
            });
            child.unref();
            agent.pid = child.pid;
          } catch (spawnErr) {
            console.error(
              `[swarm-engine] Error spawning autonomous runner for agent ${agent.id}:`,
              spawnErr
            );
          }
        }
      }
    }, swarmDir);
  } catch (err: any) {
    if (err.message && err.message.includes("not been initialized")) {
      console.error(
        `[swarm-engine] tickScheduler skipped: state not initialized.`
      );
      return;
    }
    throw err;
  }
}

/**
 * Finalizes an agent's task:
 * 1. Cleans AGENT_TASK.md from the worktree before staging (Safeguard 2).
 * 2. In Git repos with HEAD: commits changes with --allow-empty, merges to main (--no-ff),
 *    and deletes the worktree and branch.
 * 3. In non-Git or unborn HEAD repos: copies modified files back to root workspace (Safeguard 3),
 *    and removes the worktree.
 * 4. Releases assigned file locks in state.lockedFiles.
 * 5. Updates agent status to 'completed' and records outputSummary.
 * 6. Invokes tickScheduler() to immediately advance unblocked downstream agents.
 */
export async function mergeAndComplete(
  agentId: string,
  outputSummary?: string,
  cwd: string = process.cwd()
): Promise<void> {
  const swarmDir = getSwarmDir(cwd);
  const state = await readState(swarmDir);
  const agent = state.agents[agentId];

  if (!agent) {
    throw new Error(`Agent '${agentId}' not found`);
  }

  // If agent has a running worker process, attempt graceful termination
  if (agent.pid) {
    try {
      process.kill(agent.pid, "SIGTERM");
    } catch {}
  }

  const worktreePath =
    agent.worktreePath || path.resolve(swarmDir, "worktrees", agentId);
  const worktreeExists = await fs
    .stat(worktreePath)
    .then(() => true)
    .catch(() => false);

  if (worktreeExists) {
    // Safeguard 2 (Clean Git Merges): Delete AGENT_TASK.md before staging files!
    const taskFile = path.join(worktreePath, "AGENT_TASK.md");
    try {
      await fs.rm(taskFile, { force: true });
    } catch (err) {
      console.error(
        `[swarm-engine] Error deleting AGENT_TASK.md in ${worktreePath}:`,
        err
      );
    }

    const isGit = isGitRepo(cwd) && hasGitHead(cwd);

    if (isGit) {
      // 1. Stage all changes in worktree
      await execFileAsync("git", ["add", "-A"], { cwd: worktreePath });

      // 2. Commit with --allow-empty and default author identity
      const summaryText = outputSummary || "Task completed";
      const commitMsg = `swarm(${agentId}): ${summaryText}`;
      await execFileAsync(
        "git",
        [
          "-c",
          "user.name=Swarm Agent",
          "-c",
          "user.email=swarm@local",
          "commit",
          "--allow-empty",
          "-m",
          commitMsg,
        ],
        { cwd: worktreePath }
      );

      // 3. In main workspace: git merge --no-ff swarm/<agentId>
      try {
        await execFileAsync(
          "git",
          [
            "-c",
            "user.name=Swarm Agent",
            "-c",
            "user.email=swarm@local",
            "merge",
            "--no-ff",
            `swarm/${agentId}`,
          ],
          { cwd }
        );
      } catch (mergeErr: any) {
        console.error(
          `[swarm-engine] Merge conflict or error merging swarm/${agentId}:`,
          mergeErr
        );
        try {
          await execFileAsync("git", ["merge", "--abort"], { cwd });
        } catch {}
        throw new Error(
          `Failed to merge branch swarm/${agentId}: ${mergeErr.message || mergeErr}`
        );
      }

      // 4. Cleanup: git worktree remove --force and git branch -D
      try {
        await execFileAsync("git", ["worktree", "remove", "--force", worktreePath], {
          cwd,
        });
      } catch (removeErr) {
        console.error(
          `[swarm-engine] Warning: git worktree remove failed, falling back to manual cleanup:`,
          removeErr
        );
        await rmWithRetry(worktreePath);
        try {
          await execFileAsync("git", ["worktree", "prune"], { cwd });
        } catch {}
      }
      await rmWithRetry(worktreePath);

      try {
        await execFileAsync("git", ["branch", "-D", `swarm/${agentId}`], { cwd });
      } catch (branchErr) {
        console.error(
          `[swarm-engine] Warning: git branch -D failed:`,
          branchErr
        );
      }
    } else {
      // Safeguard 3 (Non-Git Fallback):
      // Copy modified files from .swarm/worktrees/<agentId> back to root workspace (excluding AGENT_TASK.md)
      await copyWorktreeBack(worktreePath, cwd);
      // Remove worktree directory
      await rmWithRetry(worktreePath);
    }
  }

  // Atomically update state: unlock target files, mark completed, record outputSummary
  await updateState(async (s) => {
    const currentAgent = s.agents[agentId];
    if (currentAgent) {
      currentAgent.status = "completed";
      currentAgent.outputSummary = outputSummary;
    }

    if (s.lockedFiles && typeof s.lockedFiles === "object") {
      if (Array.isArray(s.lockedFiles)) {
        const targets = (currentAgent?.targetFiles || []).map(normalizePath);
        (s as any).lockedFiles = (s.lockedFiles as any[]).filter(
          (f) => !targets.includes(normalizePath(f))
        );
      } else {
        for (const [file, assignedAgent] of Object.entries(s.lockedFiles)) {
          if (assignedAgent === agentId) {
            delete s.lockedFiles[file];
          }
        }
        if (currentAgent?.targetFiles) {
          for (const f of currentAgent.targetFiles) {
            delete s.lockedFiles[normalizePath(f)];
          }
        }
      }
    }
  }, swarmDir);

  // Immediately advance any newly unblocked downstream agents
  await tickScheduler(cwd);
}

/**
 * Prunes all swarm worktrees and cleans temporary swarm/* branches.
 */
export async function pruneWorktrees(cwd: string = process.cwd()): Promise<void> {
  const swarmDir = getSwarmDir(cwd);
  const worktreesDir = path.join(swarmDir, "worktrees");

  if (isGitRepo(cwd)) {
    try {
      await execFileAsync("git", ["worktree", "prune"], { cwd });
    } catch {}

    try {
      const { stdout } = await execFileAsync(
        "git",
        ["branch", "--list", "swarm/*"],
        { cwd }
      );
      const branches = stdout
        .split("\n")
        .map((b) => b.replace(/^\*?\s+/, "").trim())
        .filter(Boolean);
      for (const branch of branches) {
        try {
          await execFileAsync("git", ["branch", "-D", branch], { cwd });
        } catch {}
      }
    } catch {}
  }

  await rmWithRetry(worktreesDir);
}
