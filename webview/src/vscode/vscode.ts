import type { ExtensionMessage, WebviewRequest } from '../types/architecture';

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

/**
 * The only channel the webview has to the outside world.
 * No Node APIs, no file system, no network — just typed messages.
 */
const api: VsCodeApi | undefined = window.acquireVsCodeApi?.();

export function postRequest(request: WebviewRequest): void {
  api?.postMessage(request);
}

export function onExtensionMessage(handler: (message: ExtensionMessage) => void): () => void {
  const listener = (event: MessageEvent<ExtensionMessage>): void => {
    const message = event.data;
    if (message && typeof message === 'object' && typeof message.type === 'string') {
      handler(message);
    }
  };

  window.addEventListener('message', listener);
  return () => window.removeEventListener('message', listener);
}

export function getPersistedState<T>(): T | undefined {
  return api?.getState() as T | undefined;
}

export function persistState(state: unknown): void {
  api?.setState(state);
}
