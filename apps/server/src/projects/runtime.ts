import { promises as fs } from 'node:fs';

import type { Logger } from '@kestrel/core';
import { createEmptyGraph, type ArchitectureGraph } from '@kestrel/core/model';
import type { GraphSource } from '@kestrel/ai';
import type { ChannelMessage, LogStream, ProjectStatus } from '@kestrel/protocol';
import type { Sandbox, SandboxProcess, SandboxProvider } from '@kestrel/sandbox';

import { AgentSession, type AgentSettings } from '../agent/agent-session';
import type { AgentRunStore } from '../agent/run-store';
import type { ProjectRecord, ProjectStore } from './store';
import { parseGitHubUrl, readTemplate } from './templates';

export interface RuntimeDependencies {
  store: ProjectStore;
  provider: SandboxProvider;
  /** Root of the KESTREL repository (templates live under it). */
  repoRoot: string;
  /** Path of the bundled `kestrel-scan.cjs` uploaded into every sandbox. */
  scannerBundlePath: string;
  logger: Logger;
  agent: AgentSettings;
  runs: AgentRunStore;
  /** How long the dev server may take to answer before the project is in error. */
  devServerTimeoutMs?: number;
}

const LOG_LIMIT = 1000;
const ACTIVE: ReadonlySet<ProjectStatus> = new Set(['provisioning', 'installing', 'starting', 'ready', 'running']);
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

/**
 * One project's life on the control plane: its sandbox, the dev server that
 * serves the preview, and the scanner that keeps the architecture graph live.
 *
 * Every state change is broadcast to the project's channel subscribers, so any
 * number of browser tabs (or teammates) watch the same project.
 */
export class ProjectRuntime implements GraphSource {
  private status: ProjectStatus;
  private previewUrl: string | undefined;
  private error: string | undefined;
  private graph: ArchitectureGraph = createEmptyGraph();
  private hasGraph = false;

  private sandbox: Sandbox | undefined;
  private devServer: SandboxProcess | undefined;
  private scanner: SandboxProcess | undefined;
  private starting: Promise<void> | undefined;
  private stopping = false;

  private readonly log: Array<{ stream: LogStream; text: string }> = [];
  private readonly listeners = new Set<(message: ChannelMessage) => void>();
  /** Counts scans the scanner started, so a waiter can ask for a graph built after a point in time. */
  private scansStarted = 0;
  private currentScan = 0;
  private readonly graphWaiters = new Set<{ after: number; resolve: (graph: ArchitectureGraph) => void }>();

  readonly agent: AgentSession;

  constructor(
    private record: ProjectRecord,
    private readonly deps: RuntimeDependencies,
  ) {
    // A status persisted as active belonged to a process that no longer exists.
    this.status = ACTIVE.has(record.status) ? 'stopped' : record.status;
    this.previewUrl = undefined;
    this.agent = new AgentSession(
      {
        projectId: record.id,
        activeSandbox: () => (this.status === 'ready' || this.status === 'running' ? this.sandbox : undefined),
        getGraph: () => this.graph,
        rescanAndWait: (timeoutMs) => this.rescanAndWait(timeoutMs),
        broadcast: (message) => this.broadcast(message),
      },
      deps.agent,
      deps.runs,
      deps.logger,
    );
  }

  get id(): string {
    return this.record.id;
  }

  getGraph(): ArchitectureGraph {
    return this.graph;
  }

  getStatus(): { status: ProjectStatus; previewUrl?: string; error?: string } {
    return { status: this.status, previewUrl: this.previewUrl, error: this.error };
  }

  /** Subscribes to the channel; the listener first receives the current state. */
  subscribe(listener: (message: ChannelMessage) => void): () => void {
    listener({ type: 'PROJECT_STATE', ...this.getStatus() });
    listener({ type: 'PROJECT_LOG_HISTORY', entries: [...this.log] });
    listener(this.architectureMessage());
    this.listeners.add(listener);
    void this.agent.snapshot().then(
      (messages) => {
        if (this.listeners.has(listener)) {
          messages.forEach(listener);
        }
      },
      (error: unknown) => this.deps.logger.warn(`Could not load agent history: ${describe(error)}`),
    );
    return () => this.listeners.delete(listener);
  }

  architectureMessage(): ChannelMessage {
    return this.hasGraph ? { type: 'ARCHITECTURE_UPDATED', payload: this.graph } : { type: 'ARCHITECTURE_LOADING' };
  }

  /** Starts the project; concurrent calls share one start. */
  start(): Promise<void> {
    if (ACTIVE.has(this.status) && !this.starting) {
      return Promise.resolve();
    }
    this.starting ??= this.boot().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    try {
      await this.starting?.catch(() => undefined);
      await Promise.all([this.devServer?.kill(), this.scanner?.kill()]);
      this.devServer = undefined;
      this.scanner = undefined;
      this.previewUrl = undefined;
      await this.setStatus('stopped');
      this.system('Project stopped.');
    } finally {
      this.stopping = false;
    }
  }

  /** Stops the project and deletes its sandbox. */
  async destroy(): Promise<void> {
    await this.stop();
    const sandbox = this.sandbox ?? (await this.reattach());
    await sandbox?.destroy();
    this.sandbox = undefined;
    this.listeners.clear();
  }

  async restartDevServer(): Promise<void> {
    if (!this.sandbox) {
      return this.start();
    }
    // Detach first, so the exit of the old process is not reported as a crash.
    const previous = this.devServer;
    this.devServer = undefined;
    await previous?.kill();
    await this.startDevServer(this.sandbox);
  }

  /** Asks the scanner for a fresh graph. */
  rescan(): void {
    void this.scanner?.write('scan\n');
  }

  /** Rescans and resolves with the first graph from a scan that started after this call. */
  rescanAndWait(timeoutMs: number): Promise<ArchitectureGraph | undefined> {
    if (!this.scanner) {
      return Promise.resolve(undefined);
    }
    return new Promise((resolve) => {
      const waiter = {
        after: this.scansStarted,
        resolve: (graph: ArchitectureGraph) => {
          clearTimeout(timer);
          this.graphWaiters.delete(waiter);
          resolve(graph);
        },
      };
      const timer = setTimeout(() => {
        this.graphWaiters.delete(waiter);
        resolve(undefined);
      }, timeoutMs);
      this.graphWaiters.add(waiter);
      this.rescan();
    });
  }

  async readFile(filePath: string): Promise<string> {
    const sandbox = this.sandbox ?? (await this.reattach());
    if (!sandbox) {
      throw new Error('The project is not running.');
    }
    return sandbox.readFile(filePath);
  }

  private async boot(): Promise<void> {
    this.error = undefined;
    // A retry after an error may still have a scanner or a half-started server.
    const leftovers = [this.devServer, this.scanner];
    this.devServer = undefined;
    this.scanner = undefined;
    await Promise.all(leftovers.map((process) => process?.kill()));
    try {
      await this.setStatus('provisioning');
      let sandbox = await this.reattach();
      const fresh = !sandbox;
      if (!sandbox) {
        this.system(`Creating a ${this.deps.provider.id} sandbox…`);
        sandbox = await this.deps.provider.create({ projectId: this.id });
        await this.persist({ sandboxProvider: this.deps.provider.id, sandboxId: sandbox.id });
        await this.seed(sandbox);
      } else {
        this.system('Reattached to the existing sandbox.');
      }
      this.sandbox = sandbox;

      const manifest = await this.readManifest(sandbox);
      if (manifest && (fresh || !(await this.exists(sandbox, 'node_modules')))) {
        await this.setStatus('installing');
        await this.exec(sandbox, 'npm install --no-audit --no-fund', 'Installing dependencies', 15 * 60_000);
        // The lockfile the install wrote belongs to the baseline, not to the first agent run.
        if (fresh && this.record.source.kind === 'template') {
          await sandbox.run(
            'git add -A && git -c user.name=KESTREL -c user.email=bot@kestrel.dev commit -qm "Install dependencies"',
          );
        }
      }

      await this.startScanner(sandbox);
      await this.startDevServer(sandbox, manifest);
    } catch (error) {
      if (this.stopping) {
        return;
      }
      this.error = describe(error);
      this.deps.logger.error(`Project ${this.id} failed to start`, error);
      this.system(`Failed: ${this.error}`, 'stderr');
      await this.setStatus('error');
    }
  }

  private async seed(sandbox: Sandbox): Promise<void> {
    const source = this.record.source;
    if (source.kind === 'template') {
      this.system(`Writing the "${source.template}" template…`);
      await sandbox.writeFiles(await readTemplate(this.deps.repoRoot, source.template));
      // A repository from the first minute: the agent's changes become commits.
      await sandbox.run(
        'git init -q && git add -A && git -c user.name=KESTREL -c user.email=bot@kestrel.dev commit -qm "Initial commit from KESTREL"',
      );
      return;
    }

    const github = parseGitHubUrl(source.repoUrl);
    if (!github) {
      throw new Error(`Not a GitHub repository URL: ${source.repoUrl}`);
    }
    await this.exec(sandbox, `git clone --depth 1 ${github.cloneUrl} .`, `Cloning ${github.owner}/${github.repo}`, 10 * 60_000);
  }

  private async startScanner(sandbox: Sandbox): Promise<void> {
    const bundle = await fs.readFile(this.deps.scannerBundlePath);
    const scannerPath = `${sandbox.tooldir}/kestrel-scan.cjs`;
    await sandbox.writeAbsolute(scannerPath, bundle);

    let buffer = '';
    this.scanner = await sandbox.spawn(
      `node "${scannerPath}" "${sandbox.workdir}" --watch --name ${JSON.stringify(this.record.name)}`,
      {
        onStdout: (chunk) => {
          buffer += chunk;
          let newline = buffer.indexOf('\n');
          while (newline >= 0) {
            this.onScanLine(buffer.slice(0, newline));
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf('\n');
          }
        },
        onStderr: (chunk) => this.append('stderr', `[scanner] ${chunk}`),
      },
    );
    const scanner = this.scanner;
    void scanner.exited.then((code) => {
      if (this.scanner === scanner && !this.stopping) {
        this.system(`The architecture scanner exited (${code}).`, 'stderr');
      }
    });
  }

  private onScanLine(line: string): void {
    if (!line.trim()) {
      return;
    }
    let event: { type: string; graph?: ArchitectureGraph; message?: string; level?: string };
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === 'scanning') {
      this.scansStarted += 1;
      this.currentScan = this.scansStarted;
    } else if (event.type === 'graph' && event.graph) {
      this.graph = event.graph;
      this.hasGraph = true;
      this.broadcast({ type: 'ARCHITECTURE_UPDATED', payload: event.graph });
      for (const waiter of [...this.graphWaiters]) {
        if (this.currentScan > waiter.after) {
          waiter.resolve(event.graph);
        }
      }
    } else if (event.type === 'error' && event.message) {
      this.system(`Architecture build failed: ${event.message}`, 'stderr');
      this.broadcast({ type: 'ERROR', message: event.message });
    } else if (event.type === 'log' && event.message && event.level !== 'info') {
      this.system(`[scanner] ${event.message}`);
    }
  }

  private async startDevServer(sandbox: Sandbox, manifest?: PackageManifest): Promise<void> {
    manifest ??= await this.readManifest(sandbox);
    if (!manifest?.scripts?.dev) {
      this.system('No "dev" script in package.json: the project runs without a preview.');
      this.previewUrl = undefined;
      await this.setStatus('running');
      return;
    }

    await this.setStatus('starting');
    const port = await sandbox.allocatePort();
    const apiPort = await sandbox.allocatePort();
    const url = sandbox.previewUrl(port);
    this.system(`Starting the dev server on port ${port}…`);

    const devServer = await sandbox.spawn('npm run dev', {
      env: { PORT: String(port), API_PORT: String(apiPort), HOST: '0.0.0.0', BROWSER: 'none' },
      onStdout: (chunk) => this.append('stdout', chunk),
      onStderr: (chunk) => this.append('stderr', chunk),
    });
    this.devServer = devServer;

    const exited = devServer.exited.then((code) => {
      if (this.devServer === devServer && !this.stopping) {
        this.devServer = undefined;
        this.error = `The dev server exited with code ${code}.`;
        this.system(this.error, 'stderr');
        void this.setStatus('error');
      }
      return code;
    });

    const answered = await Promise.race([
      waitForHttp(url, this.deps.devServerTimeoutMs ?? 180_000),
      exited.then(() => false),
    ]);
    if (this.devServer !== devServer) {
      return;
    }
    if (!answered) {
      throw new Error(`The dev server did not answer at ${url}.`);
    }
    this.previewUrl = url;
    await this.persist({ previewUrl: url });
    await this.setStatus('ready');
    this.system(`Preview ready at ${url}`);
  }

  private async exec(sandbox: Sandbox, command: string, label: string, timeoutMs: number): Promise<void> {
    this.system(`${label}…`);
    const result = await sandbox.run(command, {
      timeoutMs,
      onStdout: (chunk) => this.append('stdout', chunk),
      onStderr: (chunk) => this.append('stderr', chunk),
    });
    if (result.exitCode !== 0) {
      throw new Error(`${label} failed (exit ${result.exitCode}).`);
    }
  }

  private async reattach(): Promise<Sandbox | undefined> {
    if (this.sandbox) {
      return this.sandbox;
    }
    if (!this.record.sandboxId || this.record.sandboxProvider !== this.deps.provider.id) {
      return undefined;
    }
    return this.deps.provider.connect(this.record.sandboxId);
  }

  private async readManifest(sandbox: Sandbox): Promise<PackageManifest | undefined> {
    try {
      return JSON.parse(await sandbox.readFile('package.json')) as PackageManifest;
    } catch {
      return undefined;
    }
  }

  private async exists(sandbox: Sandbox, relativePath: string): Promise<boolean> {
    const result = await sandbox.run(`node -e "process.exit(require('fs').existsSync('${relativePath}') ? 0 : 1)"`);
    return result.exitCode === 0;
  }

  private async setStatus(status: ProjectStatus): Promise<void> {
    this.status = status;
    if (status !== 'ready') {
      this.previewUrl = status === 'running' ? undefined : this.previewUrl;
    }
    this.broadcast({ type: 'PROJECT_STATE', ...this.getStatus() });
    await this.persist({ status });
  }

  private async persist(patch: Parameters<ProjectStore['update']>[1]): Promise<void> {
    this.record = {
      ...this.record,
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.sandboxId !== undefined ? { sandboxId: patch.sandboxId ?? undefined } : {}),
      ...(patch.sandboxProvider !== undefined ? { sandboxProvider: patch.sandboxProvider ?? undefined } : {}),
    };
    await this.deps.store.update(this.id, patch);
  }

  private system(text: string, stream: LogStream = 'system'): void {
    this.append(stream === 'system' ? 'system' : stream, `${text}\n`);
  }

  private append(stream: LogStream, chunk: string): void {
    const text = chunk.replace(ANSI, '');
    if (!text) {
      return;
    }
    this.log.push({ stream, text });
    if (this.log.length > LOG_LIMIT) {
      this.log.splice(0, this.log.length - LOG_LIMIT);
    }
    this.broadcast({ type: 'PROJECT_LOG', stream, text });
  }

  private broadcast(message: ChannelMessage): void {
    for (const listener of this.listeners) {
      try {
        listener(message);
      } catch (error) {
        this.deps.logger.warn(`A channel listener failed: ${describe(error)}`);
      }
    }
  }
}

interface PackageManifest {
  scripts?: Record<string, string>;
}

/** Polls until the URL answers at all; any HTTP status means the server is up. */
async function waitForHttp(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(3000), redirect: 'manual' });
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return false;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
