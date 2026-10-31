/**
 * Swarm Engine E2E Test Harness
 * 
 * Provides:
 * - Ephemeral isolated sandboxes (Git & non-Git workspaces)
 * - CLI child process execution runner
 * - MCP stdio JSON-RPC client implementation
 * - Cross-platform path and cleanup helpers
 */

import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline';

const execFileAsync = promisify(execFile);

export const PROJECT_ROOT = path.resolve(import.meta.dirname, '..');
export const CLI_PATH = path.join(PROJECT_ROOT, 'dist', 'index.js');

/**
 * Returns true if dist/index.js has been compiled.
 */
export function isCliBuilt() {
  return existsSync(CLI_PATH);
}

/**
 * Skip helper for node:test tests when dist/index.js has not been compiled yet.
 */
export function requireCliOrSkip(t) {
  if (!isCliBuilt()) {
    t.skip(`Skipping: CLI not built at ${CLI_PATH}. Compile with 'npm run build' first.`);
    return false;
  }
  return true;
}

/**
 * Executes a CLI command against dist/index.js
 */
export async function runCli(args = [], { cwd, env = {}, timeout = 15000, input = '' } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill();
        reject(new Error(`CLI command timed out after ${timeout}ms: node dist/index.js ${args.join(' ')}`));
      }
    }, timeout);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    child.on('close', (exitCode) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          exitCode: exitCode ?? 0,
          stdout,
          stderr,
        });
      }
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

/**
 * MCP Stdio JSON-RPC 2.0 Test Client
 */
export class McpTestClient {
  constructor(cwd, env = {}) {
    this.cwd = cwd;
    this.env = env;
    this.child = null;
    this.requestId = 1;
    this.pendingRequests = new Map();
    this.stderrOutput = '';
    this.stdoutRaw = '';
    this.isClosed = false;
  }

  async start() {
    this.child = spawn(process.execPath, [CLI_PATH, 'mcp'], {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    const rl = readline.createInterface({
      input: this.child.stdout,
      crlfDelay: Infinity,
    });

    rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      this.stdoutRaw += line + '\n';

      try {
        const msg = JSON.parse(trimmed);
        if (msg.id !== undefined && this.pendingRequests.has(msg.id)) {
          const { resolve, timer } = this.pendingRequests.get(msg.id);
          clearTimeout(timer);
          this.pendingRequests.delete(msg.id);
          resolve(msg);
        }
      } catch (err) {
        console.error('[McpTestClient] Malformed stdout line received (violates MCP JSON-RPC):', trimmed);
      }
    });

    this.child.stderr.on('data', (chunk) => {
      this.stderrOutput += chunk.toString('utf8');
    });

    this.child.on('error', (err) => {
      console.error('[McpTestClient] Process error:', err);
    });

    this.child.on('exit', (code, signal) => {
      this.isClosed = true;
      for (const [id, { reject, timer }] of this.pendingRequests.entries()) {
        clearTimeout(timer);
        reject(new Error(`MCP server exited with code ${code} / signal ${signal} before request ${id} responded`));
      }
      this.pendingRequests.clear();
    });

    // Perform MCP handshake
    await this.init();
  }

  async sendRequest(method, params = {}, timeout = 15000) {
    if (this.isClosed) {
      throw new Error('Cannot send request to closed MCP client');
    }

    const id = this.requestId++;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      id,
      method,
      params,
    }) + '\n';

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`MCP request id=${id} (${method}) timed out after ${timeout}ms`));
      }, timeout);

      this.pendingRequests.set(id, { resolve, reject, timer });
      this.child.stdin.write(payload);
    });
  }

  async sendNotification(method, params = {}) {
    if (this.isClosed) return;
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    }) + '\n';
    this.child.stdin.write(payload);
  }

  async init() {
    const res = await this.sendRequest('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'swarm-test-runner',
        version: '1.0.0',
      },
    });

    await this.sendNotification('notifications/initialized', {});
    return res.result;
  }

  async listTools() {
    const res = await this.sendRequest('tools/list', {});
    return res.result?.tools || [];
  }

  async callTool(name, args = {}) {
    const res = await this.sendRequest('tools/call', {
      name,
      arguments: args,
    });

    if (res.error) {
      return {
        isError: true,
        error: res.error,
        message: res.error.message,
        data: null,
      };
    }

    const result = res.result || {};
    let data = null;
    const firstContent = result.content?.[0];

    if (firstContent && firstContent.type === 'text') {
      try {
        data = JSON.parse(firstContent.text);
      } catch {
        data = firstContent.text;
      }
    }

    return {
      isError: Boolean(result.isError),
      content: result.content || [],
      data,
      raw: result,
    };
  }

  getStderr() {
    return this.stderrOutput;
  }

  getStdoutRaw() {
    return this.stdoutRaw;
  }

  async close() {
    if (this.isClosed) return;
    this.isClosed = true;

    return new Promise((resolve) => {
      const killTimer = setTimeout(() => {
        try {
          this.child?.kill('SIGKILL');
        } catch {
          // ignore
        }
        resolve();
      }, 1500);

      this.child.on('close', () => {
        clearTimeout(killTimer);
        resolve();
      });

      try {
        this.child.stdin.end();
      } catch {
        // ignore
      }
    });
  }
}

/**
 * Spawns an active MCP test client connected to a workspace
 */
export async function createMcpClient(cwd, env = {}) {
  const client = new McpTestClient(cwd, env);
  await client.start();
  return client;
}

/**
 * Creates an ephemeral test workspace in os.tmpdir()
 */
export async function createTestWorkspace({ isGit = true, initialCommit = true, files = {} } = {}) {
  const sandboxDir = path.join(
    os.tmpdir(),
    `swarm-test-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  );

  await fs.mkdir(sandboxDir, { recursive: true });

  // Helper to write files
  async function writeFile(relPath, content) {
    const fullPath = path.join(sandboxDir, relPath);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, content, 'utf8');
    return fullPath;
  }

  // Helper to read files
  async function readFile(relPath) {
    const fullPath = path.join(sandboxDir, relPath);
    return await fs.readFile(fullPath, 'utf8');
  }

  // Helper to check file existence
  function fileExists(relPath) {
    return existsSync(path.join(sandboxDir, relPath));
  }

  // Helper to run git in workspace
  async function runGit(args = []) {
    return await execFileAsync('git', args, { cwd: sandboxDir });
  }

  // Helper to read .swarm/state.json
  async function readState() {
    const statePath = path.join(sandboxDir, '.swarm', 'state.json');
    if (!existsSync(statePath)) return null;
    const content = await fs.readFile(statePath, 'utf8');
    return JSON.parse(content);
  }

  // Write custom initial files
  for (const [relPath, content] of Object.entries(files)) {
    await writeFile(relPath, content);
  }

  if (isGit) {
    await runGit(['init']);
    await runGit(['config', 'user.name', 'Swarm Test']);
    await runGit(['config', 'user.email', 'test@swarm.local']);
    await runGit(['config', 'commit.gpgSign', 'false']);

    if (initialCommit) {
      if (Object.keys(files).length === 0) {
        await writeFile('README.md', '# Swarm Test Workspace\n');
      }
      await runGit(['add', '-A']);
      await runGit(['commit', '-m', 'initial commit']);
    }
  }

  // Cleanup helper with retry for Windows file lock delays
  async function cleanup() {
    if (isGit) {
      try {
        await runGit(['worktree', 'prune']);
      } catch {
        // ignore
      }
    }

    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        await fs.rm(sandboxDir, { recursive: true, force: true });
        break;
      } catch (err) {
        if (attempt === 4) {
          // Final attempt failed, non-fatal for test execution
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }
    }
  }

  return {
    dir: sandboxDir,
    writeFile,
    readFile,
    fileExists,
    runGit,
    readState,
    cleanup,
  };
}
