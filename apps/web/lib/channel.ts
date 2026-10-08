'use client';

import type { ChannelMessage, ChannelRequest, ExtensionMessage, WebviewRequest } from '@kestrel/protocol';
import type { HostTransport } from '@kestrel/ui';

import { api } from './api';

export type ChannelState = 'connecting' | 'open' | 'closed';

function websocketBase(): string {
  const configured = process.env.NEXT_PUBLIC_KESTREL_WS_URL;
  if (configured) {
    return configured.replace(/\/+$/, '');
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.hostname}:4000`;
}

/**
 * The browser end of a project channel: one WebSocket per open project,
 * shared by the canvas and the workspace shell, reconnecting with a fresh
 * ticket when the connection drops.
 */
export class ProjectChannel {
  private socket: WebSocket | undefined;
  private readonly queue: ChannelRequest[] = [];
  private readonly listeners = new Set<(message: ChannelMessage) => void>();
  private readonly stateListeners = new Set<(state: ChannelState) => void>();
  private state: ChannelState = 'closed';
  private disposed = false;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(readonly projectId: string) {}

  connect(): void {
    if (this.disposed || this.socket || this.state === 'connecting') {
      return;
    }
    this.setState('connecting');
    void api
      .channelTicket(this.projectId)
      .then((ticket) => {
        if (this.disposed) {
          return;
        }
        const socket = new WebSocket(`${websocketBase()}/ws/projects?ticket=${encodeURIComponent(ticket)}`);
        this.socket = socket;
        socket.onopen = () => {
          this.retries = 0;
          this.setState('open');
          for (const request of this.queue.splice(0)) {
            socket.send(JSON.stringify(request));
          }
        };
        socket.onmessage = (event) => {
          let message: ChannelMessage;
          try {
            message = JSON.parse(String(event.data)) as ChannelMessage;
          } catch {
            return;
          }
          for (const listener of this.listeners) {
            listener(message);
          }
        };
        socket.onclose = () => {
          this.socket = undefined;
          this.reconnectLater();
        };
      })
      .catch(() => this.reconnectLater());
  }

  send(request: ChannelRequest): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(request));
    } else {
      this.queue.push(request);
    }
  }

  subscribe(listener: (message: ChannelMessage) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onState(listener: (state: ChannelState) => void): () => void {
    this.stateListeners.add(listener);
    listener(this.state);
    return () => this.stateListeners.delete(listener);
  }

  /** The canvas's view of this channel: it only sees the canvas protocol. */
  transport(): HostTransport {
    const key = `kestrel:canvas:${this.projectId}`;
    return {
      postMessage: (message: WebviewRequest) => this.send(message),
      onMessage: (handler: (message: ExtensionMessage) => void) =>
        this.subscribe((message) => handler(message as ExtensionMessage)),
      getState: () => {
        try {
          const saved = sessionStorage.getItem(key);
          return saved ? JSON.parse(saved) : undefined;
        } catch {
          return undefined;
        }
      },
      setState: (state: unknown) => {
        try {
          sessionStorage.setItem(key, JSON.stringify(state));
        } catch {
          // Storage can be unavailable (private mode); the canvas simply forgets its view.
        }
      },
    };
  }

  dispose(): void {
    this.disposed = true;
    clearTimeout(this.retryTimer);
    this.socket?.close();
    this.socket = undefined;
    this.listeners.clear();
    this.setState('closed');
    this.stateListeners.clear();
  }

  private reconnectLater(): void {
    if (this.disposed) {
      return;
    }
    this.setState('closed');
    const delay = Math.min(1000 * 2 ** this.retries, 15_000);
    this.retries += 1;
    this.retryTimer = setTimeout(() => this.connect(), delay);
  }

  private setState(state: ChannelState): void {
    this.state = state;
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }
}
