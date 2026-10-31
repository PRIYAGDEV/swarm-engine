#!/usr/bin/env node

/**
 * Root convenience wrapper for Swarm Engine Multi-Environment Skill Synchronizer.
 * Re-exports and runs skills/swarm-engine/scripts/sync_skills.mjs
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { syncSkills, getTargetEnvironments } from "../skills/swarm-engine/scripts/sync_skills.mjs";

export { syncSkills, getTargetEnvironments };

const __filename = fileURLToPath(import.meta.url);

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
