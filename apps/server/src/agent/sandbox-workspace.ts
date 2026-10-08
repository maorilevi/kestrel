import type { AgentWorkspace } from '@kestrel/ai';
import { resolveInside, type Sandbox } from '@kestrel/sandbox';

/** Directories the agent may never write into. */
const PROTECTED = new Set(['.git', 'node_modules']);

/**
 * Lists project files as JSON. Runs inside the sandbox, so it is plain Node
 * with no dependencies; argv[2] is the absolute directory, argv[3] the root.
 */
const LIST_SCRIPT = `
const fs = require('fs');
const path = require('path');
const skip = new Set(['node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.turbo']);
const [start, root] = [process.argv[2], process.argv[3]];
const files = [];
(function walk(dir) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (skip.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.isFile()) files.push(path.relative(root, full).split(path.sep).join('/'));
    if (files.length > 5000) return;
  }
})(start);
process.stdout.write(JSON.stringify(files.sort()));
`;

/** The agent's view of a sandbox: project-relative files and a shell in the project root. */
export function createSandboxWorkspace(sandbox: Sandbox): AgentWorkspace {
  const listScript = `${sandbox.tooldir}/kestrel-ls.cjs`;
  let scriptReady: Promise<void> | undefined;

  return {
    readFile: (path) => sandbox.readFile(path),

    writeFile: async (path, content) => {
      const absolute = resolveInside(sandbox.workdir, path);
      const segments = absolute.slice(sandbox.workdir.length + 1).split('/');
      if (segments.some((segment) => PROTECTED.has(segment))) {
        throw new Error(`Writing into ${segments.find((segment) => PROTECTED.has(segment))} is not allowed.`);
      }
      await sandbox.writeFiles([{ path, content }]);
    },

    listFiles: async (path) => {
      const start = path === '.' || path === '' ? sandbox.workdir : resolveInside(sandbox.workdir, path);
      scriptReady ??= sandbox.writeAbsolute(listScript, LIST_SCRIPT);
      await scriptReady;
      const result = await sandbox.run(`node "${listScript}" "${start}" "${sandbox.workdir}"`, { timeoutMs: 30_000 });
      if (result.exitCode !== 0) {
        throw new Error(result.stderr.trim() || `Could not list ${path}.`);
      }
      return JSON.parse(result.stdout) as string[];
    },

    run: async (command, timeoutMs) => {
      const result = await sandbox.run(command, { timeoutMs });
      return { exitCode: result.exitCode, output: [result.stdout, result.stderr].filter(Boolean).join('\n') };
    },
  };
}
