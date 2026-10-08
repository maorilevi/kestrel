import type { ExtensionMessage, WebviewRequest } from '../types/architecture';

/**
 * The only channel the canvas has to the outside world.
 * No Node APIs, no file system, no network — just typed messages to a host.
 *
 * The host is the VS Code extension today and the web control plane tomorrow;
 * each supplies a transport and the components never know which one it is.
 */
export interface HostTransport {
  postMessage(message: WebviewRequest): void;
  /** Subscribes to host messages; returns the unsubscribe function. */
  onMessage(handler: (message: ExtensionMessage) => void): () => void;
  /** View state that survives a reload of the canvas (scroll, selection, layout). */
  getState(): unknown;
  setState(state: unknown): void;
}

interface VsCodeApi {
  postMessage(message: WebviewRequest): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

/** Host messages arrive as window `message` events, in a webview and an iframe alike. */
export function onWindowMessage(handler: (message: ExtensionMessage) => void): () => void {
  const listener = (event: MessageEvent<ExtensionMessage>): void => {
    const message = event.data;
    if (message && typeof message === 'object' && typeof message.type === 'string') {
      handler(message);
    }
  };

  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

/** The VS Code webview bridge. `acquireVsCodeApi` may be called only once. */
export function createVsCodeTransport(api: VsCodeApi): HostTransport {
  return {
    postMessage: (message) => api.postMessage(message),
    onMessage: onWindowMessage,
    getState: () => api.getState(),
    setState: (state) => api.setState(state),
  };
}

/** A transport that drops every request: the canvas renders, but nothing answers. */
export function createDetachedTransport(): HostTransport {
  let state: unknown;
  return {
    postMessage: () => undefined,
    onMessage: onWindowMessage,
    getState: () => state,
    setState: (next) => {
      state = next;
    },
  };
}

function createDefaultTransport(): HostTransport {
  const api = typeof window !== 'undefined' ? window.acquireVsCodeApi?.() : undefined;
  return api ? createVsCodeTransport(api) : createDetachedTransport();
}

let transport: HostTransport | undefined;

function current(): HostTransport {
  transport ??= createDefaultTransport();
  return transport;
}

/** Installs the host transport. Call before the canvas is mounted. */
export function setHostTransport(next: HostTransport): void {
  transport = next;
}

export function postRequest(request: WebviewRequest): void {
  current().postMessage(request);
}

export function onExtensionMessage(handler: (message: ExtensionMessage) => void): () => void {
  return current().onMessage(handler);
}

export function getPersistedState<T>(): T | undefined {
  return current().getState() as T | undefined;
}

export function persistState(state: unknown): void {
  current().setState(state);
}
