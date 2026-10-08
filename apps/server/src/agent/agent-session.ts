import { randomUUID } from 'node:crypto';

import Anthropic from '@anthropic-ai/sdk';
import { CodingAgent, type AgentEffort, type CreateAgentStream } from '@kestrel/ai';
import type { Logger } from '@kestrel/core';
import { diffGraphs, isEmptyDiff, type ArchitectureDiff, type ArchitectureGraph } from '@kestrel/core/model';
import type { AgentRunSummary, AgentToolStep, ChannelMessage } from '@kestrel/protocol';
import type { Sandbox } from '@kestrel/sandbox';

import type { AgentRunStore } from './run-store';
import { createSandboxWorkspace } from './sandbox-workspace';

export interface AgentSettings {
  apiKey?: string;
  model: string;
  effort: AgentEffort;
  /** Replaces the Anthropic client, for tests. */
  createStream?: CreateAgentStream;
}

/** What the session needs from the project it belongs to. */
export interface AgentHost {
  readonly projectId: string;
  /** The running sandbox, or undefined when the project is not running. */
  activeSandbox(): Sandbox | undefined;
  getGraph(): ArchitectureGraph;
  /** Rebuilds the architecture and resolves with a graph built after the call. */
  rescanAndWait(timeoutMs: number): Promise<ArchitectureGraph | undefined>;
  broadcast(message: ChannelMessage): void;
}

export class AgentBusyError extends Error {}

const COMMITTER = '-c user.name="KESTREL agent" -c user.email=agent@kestrel.dev';

/**
 * Runs the coding agent for one project, one run at a time: streams its steps
 * to everyone watching, commits what it changed, and reports the change as an
 * architecture diff. A run can be undone while it is the latest commit.
 */
export class AgentSession {
  private current: { run: AgentRunSummary; controller: AbortController } | undefined;
  private history: AgentRunSummary[] | undefined;
  private lastDiff: ArchitectureDiff | null = null;

  constructor(
    private readonly host: AgentHost,
    private readonly settings: AgentSettings,
    private readonly runs: AgentRunStore,
    private readonly logger: Logger,
  ) {}

  get running(): boolean {
    return this.current !== undefined;
  }

  /** History and the standing architecture diff, for a client that just connected. */
  async snapshot(): Promise<ChannelMessage[]> {
    const history = await this.loadHistory();
    return [
      { type: 'AGENT_HISTORY', runs: history },
      { type: 'ARCHITECTURE_DIFF', payload: this.lastDiff },
    ];
  }

  async start(prompt: string, nodeIds: readonly string[], user: { id: string; name: string }): Promise<AgentRunSummary> {
    if (this.current) {
      throw new AgentBusyError('The agent is already working on this project.');
    }
    const trimmed = prompt.trim();
    if (!trimmed) {
      throw new Error('Tell the agent what to do.');
    }
    if (trimmed.length > 8000) {
      throw new Error('That request is too long.');
    }
    const sandbox = this.host.activeSandbox();
    if (!sandbox) {
      throw new Error('Start the project before asking the agent for changes.');
    }
    if (!this.settings.apiKey && !this.settings.createStream) {
      throw new Error('The agent is not configured on this server: set ANTHROPIC_API_KEY.');
    }

    const run: AgentRunSummary = {
      id: randomUUID(),
      prompt: trimmed,
      nodeIds: [...nodeIds],
      status: 'running',
      startedBy: user.name,
      startedAt: new Date().toISOString(),
      changedFiles: [],
      transcript: [],
    };
    const controller = new AbortController();
    this.current = { run, controller };
    await this.loadHistory();
    this.history?.unshift(run);
    this.host.broadcast({ type: 'AGENT_RUN', run });

    void this.execute(run, controller, sandbox, user.id).finally(() => {
      this.current = undefined;
    });
    return run;
  }

  cancel(): void {
    this.current?.controller.abort();
  }

  async undo(runId: string): Promise<void> {
    if (this.current) {
      throw new AgentBusyError('Wait for the agent to finish before undoing.');
    }
    const history = await this.loadHistory();
    const run = history.find((candidate) => candidate.id === runId);
    if (!run?.commit || run.undone) {
      throw new Error('That run has nothing to undo.');
    }
    const sandbox = this.host.activeSandbox();
    if (!sandbox) {
      throw new Error('Start the project to undo changes.');
    }
    const head = await sandbox.run('git rev-parse --short HEAD');
    if (head.exitCode !== 0 || head.stdout.trim() !== run.commit) {
      throw new Error('Newer changes were made after this run; undo those first.');
    }
    const reset = await sandbox.run('git reset --hard -q HEAD~1');
    if (reset.exitCode !== 0) {
      throw new Error(`Could not undo: ${reset.stderr.trim()}`);
    }
    run.undone = true;
    await this.runs.save(this.host.projectId, run, '');
    this.host.broadcast({ type: 'AGENT_RUN', run });
    this.setDiff(null);
    void this.host.rescanAndWait(30_000);
  }

  private async execute(run: AgentRunSummary, controller: AbortController, sandbox: Sandbox, userId: string): Promise<void> {
    // Changes made before the run get their own commit, so the run's commit
    // holds only the agent's work and undoing it never takes anything else.
    try {
      await this.commitAll(sandbox, 'Save changes made before a KESTREL agent run');
    } catch (error) {
      this.logger.warn(`Could not save changes before agent run ${run.id}: ${describe(error)}`);
    }
    const before = this.host.getGraph();
    const agent = new CodingAgent({
      workspace: createSandboxWorkspace(sandbox),
      apiKey: this.settings.apiKey,
      createStream: this.settings.createStream,
      model: this.settings.model,
      effort: this.settings.effort,
    });

    const steps = new Map<string, AgentToolStep>();
    try {
      const result = await agent.run(
        { prompt: run.prompt, graph: before, focusNodeIds: run.nodeIds },
        {
          onText: (text) => {
            const last = run.transcript[run.transcript.length - 1];
            if (last?.kind === 'text') {
              last.text += text;
            } else {
              run.transcript.push({ kind: 'text', text });
            }
            this.host.broadcast({ type: 'AGENT_TEXT', runId: run.id, text });
          },
          onToolStart: (call) => {
            const step: AgentToolStep = { id: call.id, name: call.name, summary: call.summary, status: 'running' };
            steps.set(call.id, step);
            run.transcript.push({ kind: 'tool', step });
            this.host.broadcast({ type: 'AGENT_TOOL', runId: run.id, step });
          },
          onToolEnd: (call) => {
            const step = steps.get(call.id);
            if (step) {
              step.status = call.ok ? 'ok' : 'error';
              step.summary = call.summary;
              step.detail = call.detail;
              this.host.broadcast({ type: 'AGENT_TOOL', runId: run.id, step });
            }
          },
        },
        controller.signal,
      );
      run.summary = result.summary || undefined;
      run.changedFiles = result.changedFiles;
      if (result.outcome === 'refused') {
        run.status = 'refused';
        run.error = 'The model declined this request.';
      } else if (result.outcome === 'cancelled') {
        run.status = 'cancelled';
      } else if (result.outcome === 'turn-limit') {
        run.status = 'error';
        run.error = `The agent stopped after ${result.turns} turns without finishing.`;
      } else {
        run.status = 'done';
      }
      this.logger.info(
        `Agent run ${run.id}: ${run.status}, ${result.turns} turns, ${result.usage.inputTokens} in / ${result.usage.outputTokens} out / ${result.usage.cacheReadTokens} cached`,
      );
    } catch (error) {
      run.status = 'error';
      run.error = error instanceof Anthropic.APIError ? `Model request failed: ${error.message}` : describe(error);
      this.logger.error(`Agent run ${run.id} failed`, error);
    }

    // Whatever happened, keep the work that was done as one reviewable, undoable commit.
    try {
      const committed = await this.commit(sandbox, run);
      if (committed) {
        run.commit = committed.sha;
        run.changedFiles = committed.files;
      }
    } catch (error) {
      this.logger.warn(`Could not commit agent run ${run.id}: ${describe(error)}`);
    }

    // Without a graph from before the run there is nothing to compare against.
    if (run.changedFiles.length > 0 && before.nodes.length > 0) {
      const after = await this.host.rescanAndWait(45_000);
      if (after) {
        run.architecture = diffGraphs(before, after);
        this.setDiff(isEmptyDiff(run.architecture) ? null : run.architecture);
      }
    }

    await this.runs.save(this.host.projectId, run, userId).catch((error: unknown) => {
      this.logger.warn(`Could not save agent run ${run.id}: ${describe(error)}`);
    });
    this.host.broadcast({ type: 'AGENT_RUN', run });
  }

  /** Commits the run's changes; undefined when nothing changed or the project is not a git repository. */
  private commit(sandbox: Sandbox, run: AgentRunSummary): Promise<{ sha: string; files: string[] } | undefined> {
    const title = run.prompt.split('\n')[0].slice(0, 72);
    const message = [title, '', run.summary ?? '', '', `Requested-by: ${run.startedBy} (KESTREL agent run ${run.id})`].join('\n');
    return this.commitAll(sandbox, message);
  }

  /** Commits everything in the working tree with `message`. */
  private async commitAll(sandbox: Sandbox, message: string): Promise<{ sha: string; files: string[] } | undefined> {
    if ((await sandbox.run('git rev-parse --is-inside-work-tree')).exitCode !== 0) {
      return undefined;
    }
    const status = await sandbox.run('git status --porcelain');
    const files = status.stdout
      .split('\n')
      .map((line) => line.slice(3).trim())
      .filter(Boolean)
      .map((path) => (path.includes(' -> ') ? path.split(' -> ')[1] : path).replace(/^"|"$/g, ''));
    if (files.length === 0) {
      return undefined;
    }

    // Through a file, so nothing in the message is ever interpreted by the shell.
    const messagePath = `${sandbox.tooldir}/agent-commit-message.txt`;
    await sandbox.writeAbsolute(messagePath, message);
    const commit = await sandbox.run(`git add -A && git ${COMMITTER} commit -q -F "${messagePath}"`);
    if (commit.exitCode !== 0) {
      throw new Error(commit.stderr.trim() || 'git commit failed');
    }
    const sha = (await sandbox.run('git rev-parse --short HEAD')).stdout.trim();
    return { sha, files: files.sort() };
  }

  private setDiff(diff: ArchitectureDiff | null): void {
    this.lastDiff = diff;
    this.host.broadcast({ type: 'ARCHITECTURE_DIFF', payload: diff });
  }

  private async loadHistory(): Promise<AgentRunSummary[]> {
    this.history ??= await this.runs.recent(this.host.projectId);
    return this.history;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
