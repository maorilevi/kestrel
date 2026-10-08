/**
 * The runtime a KESTREL project lives in: its files, its processes, its ports.
 *
 * The control plane never touches a project's code directly. It writes files,
 * runs commands and exposes ports through this interface, so the same
 * orchestration runs against a local folder in development and a remote
 * micro-VM in production.
 */

export interface SandboxFile {
  /** Path relative to `Sandbox.workdir`, posix separated. */
  path: string;
  content: string | Uint8Array;
}

export interface RunOptions {
  /** Working directory; defaults to `workdir`. Absolute, or relative to `workdir`. */
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
  onStdout?(chunk: string): void;
  onStderr?(chunk: string): void;
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface SandboxProcess {
  readonly pid: number;
  /** Writes to the process stdin. */
  write(data: string): Promise<void>;
  kill(): Promise<void>;
  /** Resolves with the exit code once the process ends. */
  readonly exited: Promise<number>;
}

export interface Sandbox {
  readonly id: string;
  /** Absolute path of the project inside the sandbox. */
  readonly workdir: string;
  /** Absolute path for KESTREL's own tooling, outside the project. */
  readonly tooldir: string;

  writeFiles(files: readonly SandboxFile[]): Promise<void>;
  /** Writes a file at an absolute path (used for tooling under `tooldir`). */
  writeAbsolute(absolutePath: string, content: string | Uint8Array): Promise<void>;
  readFile(path: string): Promise<string>;

  /** Runs a shell command to completion. A non-zero exit is a result, not an error. */
  run(command: string, options?: RunOptions): Promise<RunResult>;
  /** Starts a long-running shell command (dev server, scanner). */
  spawn(command: string, options?: RunOptions): Promise<SandboxProcess>;

  /** Public URL that reaches `port` inside the sandbox. */
  previewUrl(port: number): string;
  /** A port that is free for this sandbox's dev server. */
  allocatePort(): Promise<number>;

  /**
   * Postpones the provider's idle timeout. Called while someone is working on
   * the project; a sandbox nobody keeps alive is paused by its provider.
   */
  keepAlive(): Promise<void>;

  /** Stops every process and releases the sandbox. */
  destroy(): Promise<void>;
}

export interface SandboxProvider {
  /** `local` or `e2b`. */
  readonly id: string;
  create(options: { projectId: string }): Promise<Sandbox>;
  /** Reattaches to a sandbox created earlier, if it still exists. */
  connect(sandboxId: string): Promise<Sandbox | undefined>;
}

/** Resolves a sandbox-relative path and refuses anything that escapes `workdir`. */
export function resolveInside(workdir: string, relativePath: string): string {
  const parts: string[] = [];
  for (const part of relativePath.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') {
      continue;
    }
    if (part === '..') {
      if (parts.length === 0) {
        throw new Error(`Path escapes the project: ${relativePath}`);
      }
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  if (parts.length === 0) {
    throw new Error('Empty path');
  }
  return `${workdir.replace(/[\\/]+$/, '')}/${parts.join('/')}`;
}
