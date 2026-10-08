import { randomBytes } from 'node:crypto';

import { AnthropicChatProvider, ChatService } from '@kestrel/ai';
import type { Logger } from '@kestrel/core';
import {
  isPlatformRequest,
  isWebviewRequest,
  type ChannelMessage,
  type SettingsSnapshot,
  type WebviewRequest,
} from '@kestrel/protocol';

import type { ServerConfig } from './config';
import type { ProjectRuntime } from './projects/runtime';

interface ChannelSocket {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  on(event: 'message', listener: (data: unknown) => void): void;
  on(event: 'close', listener: () => void): void;
  readonly readyState: number;
}

const OPEN = 1;

/**
 * Single-use, short-lived tickets that let a browser open a project channel.
 *
 * The WebSocket may live on another origin than the page, where the session
 * cookie is not guaranteed to arrive, so the page asks for a ticket over its
 * authenticated HTTP session and presents it once.
 */
export class ChannelTickets {
  private readonly tickets = new Map<string, { userId: string; projectId: string; expiresAt: number }>();

  constructor(private readonly ttlMs = 60_000) {}

  issue(userId: string, projectId: string): string {
    this.sweep();
    const ticket = randomBytes(24).toString('base64url');
    this.tickets.set(ticket, { userId, projectId, expiresAt: Date.now() + this.ttlMs });
    return ticket;
  }

  redeem(ticket: string): { userId: string; projectId: string } | undefined {
    const entry = this.tickets.get(ticket);
    this.tickets.delete(ticket);
    if (!entry || entry.expiresAt < Date.now()) {
      return undefined;
    }
    return { userId: entry.userId, projectId: entry.projectId };
  }

  private sweep(): void {
    const now = Date.now();
    for (const [ticket, entry] of this.tickets) {
      if (entry.expiresAt < now) {
        this.tickets.delete(ticket);
      }
    }
  }
}

/**
 * One browser connection to one project: the canvas protocol (architecture,
 * chat, files) plus the platform requests (start, stop, restart).
 *
 * Each connection owns its chat conversation; the project state is shared.
 */
export function attachChannel(
  socket: ChannelSocket,
  runtime: ProjectRuntime,
  config: ServerConfig,
  logger: Logger,
): void {
  const send = (message: ChannelMessage): void => {
    if (socket.readyState === OPEN) {
      socket.send(JSON.stringify(message));
    }
  };

  let effort: 'low' | 'medium' | 'high' | 'xhigh' | 'max' = 'high';
  const chat = new ChatService(
    runtime,
    [
      new AnthropicChatProvider({
        getApiKey: async () => config.anthropicApiKey,
        getModel: () => config.chatModel,
        getEffort: () => effort,
      }),
    ],
    logger,
  );

  const unsubscribe = runtime.subscribe(send);

  const settings = (): SettingsSnapshot => ({
    provider: 'anthropic',
    anthropicModel: config.chatModel,
    vsCodeModel: '',
    effort,
    timeoutMs: 120_000,
    autoRefresh: true,
    refreshDebounceMs: 500,
    maxFiles: 5000,
    models: {
      anthropic: [{ id: config.chatModel, label: config.chatModel, available: Boolean(config.anthropicApiKey) }],
      vscode: [],
    },
    credential: config.anthropicApiKey ? 'server API key' : undefined,
    activeProvider: config.anthropicApiKey ? 'Anthropic' : undefined,
  });

  const sendChatStatus = async (): Promise<void> => {
    const status = await chat.status();
    send({
      type: 'CHAT_STATUS',
      ...status,
      // The VS Code remedies do not exist here; the operator configures the key.
      remedyCommand: undefined,
      message: status.ready ? status.message : 'The architecture chat is not configured on this server yet.',
    });
  };

  const handle = async (request: WebviewRequest): Promise<void> => {
    switch (request.type) {
      case 'READY':
      case 'GET_ARCHITECTURE':
        send(runtime.architectureMessage());
        return;
      case 'REFRESH_ARCHITECTURE':
        runtime.rescan();
        return;
      case 'OPEN_FILE':
        try {
          send({
            type: 'FILE_CONTENT',
            filePath: request.filePath,
            content: await runtime.readFile(request.filePath),
            line: request.line,
          });
        } catch (error) {
          send({ type: 'FILE_ERROR', filePath: request.filePath, message: describe(error) });
        }
        return;
      case 'CHAT_SEND':
        await chat.ask(
          { question: request.text, selectedNodeIds: request.nodeIds, projectId: request.projectId },
          {
            onDelta: (text) => send({ type: 'CHAT_DELTA', text }),
            onDone: (usage) => send({ type: 'CHAT_DONE', ...usage }),
            onError: (message) => send({ type: 'CHAT_ERROR', message }),
          },
        );
        return;
      case 'CHAT_CANCEL':
        chat.cancel();
        return;
      case 'CHAT_CLEAR':
        chat.clear();
        return;
      case 'CHAT_STATUS':
      case 'RUN_COMMAND':
        await sendChatStatus();
        return;
      case 'GET_SETTINGS':
        send({ type: 'SETTINGS', payload: settings() });
        return;
      case 'UPDATE_SETTING':
        if (request.key === 'kestrel.chat.effort' && isEffort(request.value)) {
          effort = request.value;
        }
        send({ type: 'SETTINGS', payload: settings() });
        return;
      case 'ASK_AGENT':
        send({ type: 'PROJECT_LOG', stream: 'system', text: 'Agent actions on the canvas arrive with the agent loop (M2).\n' });
        return;
      case 'SELECT_NODE':
        return;
    }
  };

  socket.on('message', (data) => {
    let request: unknown;
    try {
      request = JSON.parse(String(data));
    } catch {
      return;
    }
    const work = isPlatformRequest(request)
      ? request.type === 'START_PROJECT'
        ? runtime.start()
        : request.type === 'STOP_PROJECT'
          ? runtime.stop()
          : runtime.restartDevServer()
      : isWebviewRequest(request)
        ? handle(request)
        : Promise.resolve();
    work.catch((error: unknown) => {
      logger.error('Channel request failed', error);
      send({ type: 'ERROR', message: describe(error) });
    });
  });

  socket.on('close', () => {
    chat.cancel();
    unsubscribe();
  });
}

function isEffort(value: unknown): value is 'low' | 'medium' | 'high' | 'xhigh' | 'max' {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
