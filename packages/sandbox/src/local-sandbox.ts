import { spawn as spawnProcess, type ChildProcess } from 'child_process';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { createServer } from 'net';
import * as path from 'path';

import {
  resolveInside,
  type RunOptions,
  type RunResult,
  type Sandbox,
  type SandboxFile,
  type SandboxProcess,
  type SandboxProvider,
} from './sandbox';

/**
 * Runs projects in plain folders on this machine.
 *
 * For development and tests only: there is no isolation, so it must never be
 * used with code the operator does not trust. Production uses E2B.
 */
export class LocalSandboxProvider implements SandboxProvider {
  readonly id = 'local';

  constructor(private readonly rootDir: string) {}

  async create(): Promise<Sandbox> {
    const id = `local-${randomUUID()}`;
    const sandbox = new LocalSandbox(id, path.join(this.rootDir, id));
    await fs.mkdir(sandbox.workdir, { recursive: true });
    await fs.mkdir(sandbox.tooldir, { recursive: true });
    return sandbox;
  }

  async connect(sandboxId: string): Promise<Sandbox | undefined> {
    if (!/^local-[0-9a-f-]+$/.test(sandboxId)) {
      return undefined;
    }
    const sandbox = new LocalSandbox(sandboxId, path.join(this.rootDir, sandboxId));
    try {
      await fs.access(sandbox.workdir);
      return sandbox;
    } catch {
      return undefined;
    }
  }
}

class LocalSandbox implements Sandbox {
  readonly workdir: string;
  readonly tooldir: string;
  private readonly processes = new Set<ChildProcess>();

  constructor(
    readonly id: string,
    private readonly home: string,
  ) {
    this.workdir = toPosix(path.join(home, 'workspace'));
    this.tooldir = toPosix(path.join(home, 'kestrel'));
  }

  async writeFiles(files: readonly SandboxFile[]): Promise<void> {
    for (const file of files) {
      await this.writeAbsolute(resolveInside(this.workdir, file.path), file.content);
    }
  }

  async writeAbsolute(absolutePath: string, content: string | Uint8Array): Promise<void> {
    await fs.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.writeFile(absolutePath, content);
  }

  readFile(relativePath: string): Promise<string> {
    return fs.readFile(resolveInside(this.workdir, relativePath), 'utf8');
  }

  async run(command: string, options: RunOptions = {}): Promise<RunResult> {
    let stdout = '';
    let stderr = '';
    const child = this.start(command, {
      ...options,
      onStdout: (chunk) => {
        stdout += chunk;
        options.onStdout?.(chunk);
      },
      onStderr: (chunk) => {
        stderr += chunk;
        options.onStderr?.(chunk);
      },
    });
    const timer = options.timeoutMs ? setTimeout(() => killTree(child), options.timeoutMs) : undefined;
    const exitCode = await exitOf(child);
    clearTimeout(timer);
    return { exitCode, stdout, stderr };
  }

  async spawn(command: string, options: RunOptions = {}): Promise<SandboxProcess> {
    const child = this.start(command, options);
    const exited = exitOf(child);
    return {
      pid: child.pid ?? -1,
      write: async (data) => {
        child.stdin?.write(data);
      },
      kill: async () => {
        killTree(child);
        await exited;
      },
      exited,
    };
  }

  previewUrl(port: number): string {
    return `http://localhost:${port}`;
  }

  allocatePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.unref();
      server.on('error', reject);
      server.listen(0, () => {
        const address = server.address();
        server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
      });
    });
  }

  async keepAlive(): Promise<void> {
    // Local folders never time out.
  }

  async destroy(): Promise<void> {
    for (const child of this.processes) {
      killTree(child);
    }
    await fs.rm(this.home, { recursive: true, force: true });
  }

  private start(command: string, options: RunOptions): ChildProcess {
    const cwd = options.cwd ? path.resolve(this.workdir, options.cwd) : this.workdir;
    const child = spawnProcess(command, {
      cwd,
      shell: true,
      env: { ...process.env, ...options.env },
      // Its own process group, so a dev server's children die with it.
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    this.processes.add(child);
    child.once('exit', () => this.processes.delete(child));
    child.stdout?.setEncoding('utf8').on('data', (chunk: string) => options.onStdout?.(chunk));
    child.stderr?.setEncoding('utf8').on('data', (chunk: string) => options.onStderr?.(chunk));
    return child;
  }
}

function exitOf(child: ChildProcess): Promise<number> {
  return new Promise((resolve) => {
    child.once('error', () => resolve(-1));
    child.once('close', (code) => resolve(code ?? -1));
  });
}

function killTree(child: ChildProcess): void {
  if (child.exitCode !== null || child.pid === undefined) {
    return;
  }
  if (process.platform === 'win32') {
    spawnProcess('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}
