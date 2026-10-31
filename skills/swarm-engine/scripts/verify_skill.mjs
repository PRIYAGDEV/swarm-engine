#!/usr/bin/env node

/**
 * Self-Contained Skill Package Verifier for Swarm Engine
 * Validates frontmatter, required sections, references, and example configurations.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const skillDir = path.resolve(__dirname, "..");

export function verifySkillPackage(targetDir = skillDir) {
  const issues = [];
  const skillMdPath = path.join(targetDir, "SKILL.md");

  if (!fs.existsSync(skillMdPath)) {
    return { valid: false, issues: [`Missing SKILL.md at ${skillMdPath}`] };
  }

  const content = fs.readFileSync(skillMdPath, "utf8");

  // 1. Verify YAML frontmatter
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) {
    issues.push("SKILL.md is missing YAML frontmatter delimiters (---)");
  } else {
    const fm = fmMatch[1];
    if (!/name:\s*swarm-engine/.test(fm)) issues.push("Frontmatter missing 'name: swarm-engine'");
    if (!/license:\s*MIT/.test(fm)) issues.push("Frontmatter missing 'license: MIT'");
    if (!/version:\s*1\.0\.0/.test(fm)) issues.push("Frontmatter missing 'version: 1.0.0'");
    if (!/author:\s*PRIYAGDEV/.test(fm)) issues.push("Frontmatter missing 'author: PRIYAGDEV'");
    if (!/description:/.test(fm)) issues.push("Frontmatter missing 'description'");
  }

  // 2. Verify 6 required sections
  const requiredSections = [
    "## ⚡ When to Use This Skill",
    "## 👥 Unbounded Subagent Deployment (5 to 20+ Parallel Agents)",
    "## 🚀 Autonomous Agent Workflow (CLI-First)",
    "## 🛠️ MCP Tools Reference",
    "## 🛡️ Key Architectural Guarantees",
    "## 🔄 Get Shit Done (GSD) Workflow Integration",
  ];

  for (const sec of requiredSections) {
    if (!content.includes(sec)) {
      issues.push(`SKILL.md missing required section header: '${sec}'`);
    }
  }

  // 3. Verify references
  const expectedReferences = [
    "architecture.md",
    "cli_reference.md",
    "mcp_reference.md",
    "subagent_patterns.md",
  ];

  for (const ref of expectedReferences) {
    const refPath = path.join(targetDir, "references", ref);
    if (!fs.existsSync(refPath)) {
      issues.push(`Missing reference document: references/${ref}`);
    } else {
      const stats = fs.statSync(refPath);
      if (stats.size < 500) {
        issues.push(`Reference document references/${ref} is suspiciously small (${stats.size} bytes)`);
      }
    }
  }

  // 4. Verify examples
  const examplePath = path.join(targetDir, "examples", "unbounded_swarm_example.json");
  if (!fs.existsSync(examplePath)) {
    issues.push("Missing example file: examples/unbounded_swarm_example.json");
  } else {
    try {
      const json = JSON.parse(fs.readFileSync(examplePath, "utf8"));
      if (json.maxConcurrency !== 0) {
        issues.push("unbounded_swarm_example.json must specify maxConcurrency: 0");
      }
      if (!Array.isArray(json.agents) || json.agents.length < 15) {
        issues.push(`unbounded_swarm_example.json must contain at least 15 agents (found ${json.agents?.length})`);
      }
    } catch (e) {
      issues.push(`unbounded_swarm_example.json is not valid JSON: ${e.message}`);
    }
  }

  // 5. Verify scripts
  const syncScript = path.join(targetDir, "scripts", "sync_skills.mjs");
  if (!fs.existsSync(syncScript)) {
    issues.push("Missing sync script: scripts/sync_skills.mjs");
  }

  return {
    valid: issues.length === 0,
    issues,
    targetDir,
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  const result = verifySkillPackage();
  if (result.valid) {
    console.log("✓ Skill package verification passed with 0 issues.");
    process.exit(0);
  } else {
    console.error("✗ Skill package verification failed with issues:");
    result.issues.forEach((i) => console.error(`  - ${i}`));
    process.exit(1);
  }
}
