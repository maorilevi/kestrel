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

export type PlatformMessage =
  | { type: 'PROJECT_STATE'; status: ProjectStatus; previewUrl?: string; error?: string }
  | { type: 'PROJECT_LOG'; stream: LogStream; text: string }
  /** The recent log, sent once when a client connects. */
  | { type: 'PROJECT_LOG_HISTORY'; entries: Array<{ stream: LogStream; text: string }> }
  | { type: 'FILE_CONTENT'; filePath: string; content: string; line?: number }
  | { type: 'FILE_ERROR'; filePath: string; message: string };

export type PlatformRequest = { type: 'START_PROJECT' } | { type: 'STOP_PROJECT' } | { type: 'RESTART_DEV_SERVER' };

/** Everything a project channel can send to the browser. */
export type ChannelMessage = ExtensionMessage | PlatformMessage;
/** Everything the browser can send on a project channel. */
export type ChannelRequest = WebviewRequest | PlatformRequest;

const PLATFORM_REQUESTS = new Set(['START_PROJECT', 'STOP_PROJECT', 'RESTART_DEV_SERVER']);

export function isPlatformRequest(value: unknown): value is PlatformRequest {
  return (
    typeof value === 'object' &&
    value !== null &&
    PLATFORM_REQUESTS.has(String((value as { type?: unknown }).type))
  );
}
