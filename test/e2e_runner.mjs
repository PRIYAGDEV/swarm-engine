#!/usr/bin/env node
/**
 * Swarm Engine Standalone E2E Test Runner
 * 
 * Runs all 4 test tiers using Node.js native test runner and spec reporter.
 * Usage:
 *   node test/e2e_runner.mjs          # Run all 4 tiers
 *   node test/e2e_runner.mjs tier1    # Run Tier 1 only
 *   node test/e2e_runner.mjs tier2    # Run Tier 2 only
 *   node test/e2e_runner.mjs tier3    # Run Tier 3 only
 *   node test/e2e_runner.mjs tier4    # Run Tier 4 only
 */

import { run } from 'node:test';
import { spec as SpecReporter } from 'node:test/reporters';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const allTestFiles = [
  path.join(__dirname, 'tier1_features.test.mjs'),
  path.join(__dirname, 'tier2_boundaries.test.mjs'),
  path.join(__dirname, 'tier3_interactions.test.mjs'),
  path.join(__dirname, 'tier4_realworld.test.mjs'),
  path.join(__dirname, 'tier5_adversarial.test.mjs'),
];

// Parse command line filter if supplied
const filterArg = process.argv[2]?.toLowerCase();
let targetFiles = allTestFiles;

if (filterArg) {
  const matched = allTestFiles.filter((f) => path.basename(f).toLowerCase().includes(filterArg));
  if (matched.length > 0) {
    targetFiles = matched;
  }
}

console.log('==============================================================');
console.log('             SWARM ENGINE 4-TIER E2E TEST SUITE               ');
console.log('==============================================================');
console.log(`Executing test suites (${targetFiles.length} file(s)):`);
for (const file of targetFiles) {
  console.log(` - ${path.relative(__dirname, file)}`);
}
console.log('--------------------------------------------------------------\n');

let hasFailure = false;

const testStream = run({
  files: targetFiles,
  concurrency: 1, // Sequential suite execution for deterministic output
});

testStream.on('test:fail', () => {
  hasFailure = true;
  process.exitCode = 1;
});

testStream.compose(new SpecReporter()).pipe(process.stdout);

testStream.on('end', () => {
  if (hasFailure) {
    console.error('\n❌ One or more tests failed.');
  } else {
    console.log('\n✔ All tests completed.');
  }
});
