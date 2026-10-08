import type { ArchitectureDiff } from '@kestrel/core/model';

import type { ExtensionMessage, WebviewRequest } from './protocol';

/**
 * Messages of the web platform's project channel, on top of the canvas
 * protocol. The canvas ignores what it does not know, so one WebSocket carries
 * both: the canvas reads architecture and chat, the workspace shell reads
 * project state, logs and files.
 */

export type ProjectStatus =
  /** Known, not running. */
  | 'idle'
  /** Creating the sandbox and writing or cloning the code. */
  | 'provisioning'
  /** Installing dependencies. */
  | 'installing'
  /** Starting the dev server and waiting for it to answer. */
  | 'starting'
  /** Dev server is answering; the preview URL works. */
  | 'ready'
  /** The project runs, but has no dev server to preview. */
  | 'running'
  | 'error'
  | 'stopped';

export type ProjectSource = { kind: 'template'; template: string } | { kind: 'github'; repoUrl: string };

export interface ProjectSummary {
  id: string;
  name: string;
  organizationId: string;
  source: ProjectSource;
  status: ProjectStatus;
  previewUrl?: string;
  createdAt: string;
}

export type LogStream = 'system' | 'stdout' | 'stderr';

export type AgentRunStatus = 'running' | 'done' | 'refused' | 'cancelled' | 'error';

export interface AgentToolStep {
  id: string;
  name: string;
  /** "Edit apps/api/src/users/users.service.ts", "Run npm test → exit 0". */
  summary: string;
  status: 'running' | 'ok' | 'error';
  detail?: string;
}

/** One agent run: what was asked, what it did, and what it changed. */
export interface AgentRunSummary {
  id: string;
  prompt: string;
  /** Components the run was focused on. */
  nodeIds: string[];
  status: AgentRunStatus;
  startedBy: string;
  startedAt: string;
  /** The agent's closing summary. */
  summary?: string;
  error?: string;
  changedFiles: string[];
  /** Short commit hash of the run's changes, when the project is a git repository. */
  commit?: string;
  architecture?: ArchitectureDiff;
  /** The run's commit was reverted. */
  undone?: boolean;
  /** Text and steps in the order they happened. */
  transcript: Array<{ kind: 'text'; text: string } | { kind: 'tool'; step: AgentToolStep }>;
}

export type PlatformMessage =
  | { type: 'PROJECT_STATE'; status: ProjectStatus; previewUrl?: string; error?: string }
  | { type: 'PROJECT_LOG'; stream: LogStream; text: string }
  /** The recent log, sent once when a client connects. */
  | { type: 'PROJECT_LOG_HISTORY'; entries: Array<{ stream: LogStream; text: string }> }
  | { type: 'FILE_CONTENT'; filePath: string; content: string; line?: number }
  | { type: 'FILE_ERROR'; filePath: string; message: string }
  /** The canvas asked to send these components to the agent. */
  | { type: 'AGENT_CONTEXT'; nodeIds: string[] }
  /** A run started, finished or was undone: the whole run. */
  | { type: 'AGENT_RUN'; run: AgentRunSummary }
  | { type: 'AGENT_TEXT'; runId: string; text: string }
  | { type: 'AGENT_TOOL'; runId: string; step: AgentToolStep }
  /** A request to the agent was refused (busy, not running, not configured). */
  | { type: 'AGENT_ERROR'; message: string }
  /** Recent runs, newest first, sent once when a client connects. */
  | { type: 'AGENT_HISTORY'; runs: AgentRunSummary[] };

export type PlatformRequest =
  | { type: 'START_PROJECT' }
  | { type: 'STOP_PROJECT' }
  | { type: 'RESTART_DEV_SERVER' }
  | { type: 'AGENT_START'; prompt: string; nodeIds: string[] }
  | { type: 'AGENT_CANCEL' }
  | { type: 'AGENT_UNDO'; runId: string };

/** Everything a project channel can send to the browser. */
export type ChannelMessage = ExtensionMessage | PlatformMessage;
/** Everything the browser can send on a project channel. */
export type ChannelRequest = WebviewRequest | PlatformRequest;

const PLATFORM_REQUESTS = new Set([
  'START_PROJECT',
  'STOP_PROJECT',
  'RESTART_DEV_SERVER',
  'AGENT_START',
  'AGENT_CANCEL',
  'AGENT_UNDO',
]);

export function isPlatformRequest(value: unknown): value is PlatformRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    PLATFORM_REQUESTS.has(String((value as { type?: unknown }).type))
  );
}
