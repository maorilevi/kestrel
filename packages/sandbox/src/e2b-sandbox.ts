import { CommandExitError, Sandbox as E2BSandboxClient, type CommandHandle } from 'e2b';

import {
  resolveInside,
  type RunOptions,
  type RunResult,
  type Sandbox,
  type SandboxFile,
  type SandboxProcess,
  type SandboxProvider,
} from './sandbox';

export interface E2BProviderOptions {
  apiKey: string;
  /** E2B template name; build `kestrel-node` with `npm run e2b:template -w @kestrel/sandbox`. */
  template?: string;
  /** Idle time after which E2B pauses the sandbox (files and processes are kept). */
  timeoutMs?: number;
}

const WORKDIR = '/home/user/project';
const TOOLDIR = '/home/user/.kestrel';
/** Every E2B sandbox is its own VM, so ports are simply handed out in order. */
const FIRST_PORT = 3000;
const DEFAULT_TIMEOUT_MS = 15 * 60_000;

export class E2BSandboxProvider implements SandboxProvider {
  readonly id = 'e2b';

  constructor(private readonly options: E2BProviderOptions) {}

  async create(options: { projectId: string }): Promise<Sandbox> {
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const client = await E2BSandboxClient.create(this.options.template ?? 'kestrel-node', {
      apiKey: this.options.apiKey,
      timeoutMs,
      // A project's code lives in its sandbox: an idle sandbox is paused, never deleted.
      lifecycle: { onTimeout: 'pause', autoResume: false },
      metadata: { kestrelProjectId: options.projectId },
    });
    await client.files.makeDir(WORKDIR);
    await client.files.makeDir(TOOLDIR);
    return new E2BSandbox(client, timeoutMs);
  }

  async connect(sandboxId: string): Promise<Sandbox | undefined> {
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    try {
      // Connecting resumes a paused sandbox.
      const client = await E2BSandboxClient.connect(sandboxId, { apiKey: this.options.apiKey, timeoutMs });
      return new E2BSandbox(client, timeoutMs);
    } catch {
      return undefined;
    }
  }
}

class E2BSandbox implements Sandbox {
  readonly workdir = WORKDIR;
  readonly tooldir = TOOLDIR;
  private nextPort = FIRST_PORT;

  constructor(
    private readonly client: E2BSandboxClient,
    private readonly timeoutMs: number,
  ) {}

  get id(): string {
    return this.client.sandboxId;
  }

  async writeFiles(files: readonly SandboxFile[]): Promise<void> {
    if (files.length === 0) {
      return;
    }
    await this.client.files.write(
      files.map((file) => ({ path: resolveInside(WORKDIR, file.path), data: toData(file.content) })),
    );
  }

  async writeAbsolute(absolutePath: string, content: string | Uint8Array): Promise<void> {
    await this.client.files.write(absolutePath, toData(content));
  }

  readFile(relativePath: string): Promise<string> {
    return this.client.files.read(resolveInside(WORKDIR, relativePath));
  }

  async run(command: string, options: RunOptions = {}): Promise<RunResult> {
    try {
      const result = await this.client.commands.run(command, {
        cwd: this.cwd(options.cwd),
        envs: options.env,
        timeoutMs: options.timeoutMs ?? 0,
        onStdout: options.onStdout,
        onStderr: options.onStderr,
      });
      return { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    } catch (error) {
      if (error instanceof CommandExitError) {
        return { exitCode: error.exitCode, stdout: error.stdout, stderr: error.stderr };
      }
      throw error;
    }
  }

  async spawn(command: string, options: RunOptions = {}): Promise<SandboxProcess> {
    const handle: CommandHandle = await this.client.commands.run(command, {
      background: true,
      stdin: true,
      cwd: this.cwd(options.cwd),
      envs: options.env,
      timeoutMs: 0,
      onStdout: options.onStdout,
      onStderr: options.onStderr,
    });
    const exited = handle.wait().then(
      (result) => result.exitCode,
      (error: unknown) => (error instanceof CommandExitError ? error.exitCode : -1),
    );
    return {
      pid: handle.pid,
      write: (data) => handle.sendStdin(data),
      kill: async () => {
        await handle.kill();
        await exited;
      },
      exited,
    };
  }

  previewUrl(port: number): string {
    return `https://${this.client.getHost(port)}`;
  }

  async allocatePort(): Promise<number> {
    const port = this.nextPort;
    this.nextPort += 1;
    return port;
  }

  async keepAlive(): Promise<void> {
    await this.client.setTimeout(this.timeoutMs);
  }

  async destroy(): Promise<void> {
    await this.client.kill();
  }

  private cwd(cwd: string | undefined): string {
    if (!cwd) {
      return WORKDIR;
    }
    return cwd.startsWith('/') ? cwd : resolveInside(WORKDIR, cwd);
  }
}

function toData(content: string | Uint8Array): string | ArrayBuffer {
  if (typeof content === 'string') {
    return content;
  }
  return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer;
}
