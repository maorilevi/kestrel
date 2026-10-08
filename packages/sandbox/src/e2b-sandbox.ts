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
  /** E2B template name or id; the default image ships Node and git. */
  template?: string;
  /** Idle lifetime before E2B pauses or kills the sandbox. */
  timeoutMs?: number;
}

const WORKDIR = '/home/user/project';
const TOOLDIR = '/home/user/.kestrel';
/** Every E2B sandbox is its own VM, so one fixed port per role is enough. */
const DEV_PORT = 3000;

export class E2BSandboxProvider implements SandboxProvider {
  readonly id = 'e2b';

  constructor(private readonly options: E2BProviderOptions) {}

  async create(options: { projectId: string }): Promise<Sandbox> {
    const client = await E2BSandboxClient.create(this.options.template ?? 'base', {
      apiKey: this.options.apiKey,
      timeoutMs: this.options.timeoutMs ?? 30 * 60_000,
      metadata: { kestrelProjectId: options.projectId },
    });
    await client.files.makeDir(WORKDIR);
    await client.files.makeDir(TOOLDIR);
    return new E2BSandbox(client);
  }

  async connect(sandboxId: string): Promise<Sandbox | undefined> {
    try {
      const client = await E2BSandboxClient.connect(sandboxId, { apiKey: this.options.apiKey });
      return new E2BSandbox(client);
    } catch {
      return undefined;
    }
  }
}

class E2BSandbox implements Sandbox {
  readonly workdir = WORKDIR;
  readonly tooldir = TOOLDIR;

  constructor(private readonly client: E2BSandboxClient) {}

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
    return DEV_PORT;
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
