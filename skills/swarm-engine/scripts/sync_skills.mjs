#!/usr/bin/env node

/**
 * Swarm Engine Multi-Environment Skill Synchronizer
 *
 * Synchronizes the canonical skills/swarm-engine package across all
 * detected local AI agent environments:
 * 1. Global Antigravity (Gemini): ~/.gemini/config/skills/swarm-engine
 * 2. Claude Code: ~/.claude/skills/swarm-engine
 * 3. Kilo CLI: ~/.config/kilo/skills/swarm-engine
 * 4. Cline: ~/.cline/skills/swarm-engine (if ~/.cline/skills exists)
 * 5. Roo Code: ~/.roo/skills/swarm-engine (if ~/.roo/skills exists)
 * 6. Cursor: ~/.cursor/skills/swarm-engine (if ~/.cursor/skills exists)
 * 7. Continue: ~/.continue/skills/swarm-engine (if ~/.continue/skills exists)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Locate repo root and canonical skill directory
function findCanonicalSkillDir() {
  const candidates = [
    path.resolve(__dirname, ".."),                     // if in skills/swarm-engine/scripts
    path.resolve(__dirname, "../skills/swarm-engine"), // if in scripts/
    path.resolve(process.cwd(), "skills/swarm-engine"),
  ];

  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "SKILL.md"))) {
      return dir;
    }
  }

  throw new Error("Could not find canonical skills/swarm-engine/SKILL.md source directory");
}

/**
 * Resolves target directories across user environments.
 */
export function getTargetEnvironments() {
  const home = process.env.USERPROFILE || process.env.HOME || os.homedir();
  
  const targets = [
    {
      name: "Global Antigravity (Gemini)",
      parentDir: path.join(home, ".gemini", "config", "skills"),
      targetDir: path.join(home, ".gemini", "config", "skills", "swarm-engine"),
      required: true,
    },
    {
      name: "Claude Code",
      parentDir: path.join(home, ".claude", "skills"),
      targetDir: path.join(home, ".claude", "skills", "swarm-engine"),
      required: true,
    },
    {
      name: "Kilo CLI",
      parentDir: path.join(home, ".config", "kilo"),
      targetDir: path.join(home, ".config", "kilo", "skills", "swarm-engine"),
      required: true,
    },
    {
      name: "Cline",
      parentDir: path.join(home, ".cline", "skills"),
      targetDir: path.join(home, ".cline", "skills", "swarm-engine"),
      required: false,
    },
    {
      name: "Roo Code",
      parentDir: path.join(home, ".roo", "skills"),
      targetDir: path.join(home, ".roo", "skills", "swarm-engine"),
      required: false,
    },
    {
      name: "Cursor",
      parentDir: path.join(home, ".cursor", "skills"),
      targetDir: path.join(home, ".cursor", "skills", "swarm-engine"),
      required: false,
    },
    {
      name: "Continue",
      parentDir: path.join(home, ".continue", "skills"),
      targetDir: path.join(home, ".continue", "skills", "swarm-engine"),
      required: false,
    },
  ];

  return targets;
}

/**
 * Synchronizes canonical skill folder to all matching target environments.
 */
export async function syncSkills(options = { verbose: true }) {
  const sourceDir = findCanonicalSkillDir();
  const targets = getTargetEnvironments();

  if (options.verbose) {
    console.log("================================================================================");
    console.log("SWARM ENGINE MULTI-ENVIRONMENT SKILL SYNCHRONIZER");
    console.log("================================================================================");
    console.log(`Canonical Source: ${sourceDir}`);
    console.log("--------------------------------------------------------------------------------");
  }

  const results = [];

  for (const target of targets) {
    const parentExists = fs.existsSync(target.parentDir);

    if (!parentExists && !target.required) {
      if (options.verbose) {
        console.log(`[-] Skipping ${target.name}: parent directory not detected (${target.parentDir})`);
      }
      results.push({ name: target.name, status: "skipped", path: target.targetDir });
      continue;
    }

    try {
      // Ensure target directory exists
      fs.mkdirSync(target.targetDir, { recursive: true });

      // Synchronize full directory recursively (SKILL.md, references, scripts, examples)
      fs.cpSync(sourceDir, target.targetDir, {
        recursive: true,
        force: true,
        dereference: true,
      });

      // Verify SKILL.md exists in destination
      const destSkillFile = path.join(target.targetDir, "SKILL.md");
      const synced = fs.existsSync(destSkillFile);

      if (synced) {
        if (options.verbose) {
          console.log(`[✓] Synchronized ${target.name}`);
          console.log(`    Location: ${target.targetDir}`);
        }
        results.push({ name: target.name, status: "success", path: target.targetDir });
      } else {
        throw new Error("SKILL.md verification failed after copy");
      }
    } catch (err) {
      if (options.verbose) {
        console.error(`[✗] Failed to sync ${target.name}: ${err.message}`);
      }
      results.push({ name: target.name, status: "error", error: err.message, path: target.targetDir });
    }
  }

  if (options.verbose) {
    console.log("================================================================================");
    const successful = results.filter((r) => r.status === "success").length;
    console.log(`Synchronization Complete: ${successful} environments updated successfully.`);
    console.log("================================================================================");
  }

  const hasFailures = results.some((r) => r.status === "error");
  return { success: !hasFailures, results };
}

// Auto-execute if run directly
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  syncSkills({ verbose: true })
    .then(({ success }) => {
      process.exit(success ? 0 : 1);
    })
    .catch((err) => {
      console.error("[FATAL] Skill synchronization failed:", err);
      process.exit(1);
    });
}
