import type { ArchitectureGraph } from '@kestrel/core/model';
import type { SettingsSnapshot } from './settings-model';

/**
 * Typed contract between the KESTREL extension host and the webview.
 * Both sides import these types — there are no untyped message objects.
 */

export type WebviewRequest =
  | { type: 'READY' }
  | { type: 'GET_ARCHITECTURE' }
  | { type: 'REFRESH_ARCHITECTURE' }
  | { type: 'OPEN_FILE'; filePath: string; line?: number; workspaceName?: string }
  | { type: 'SELECT_NODE'; nodeId: string | null }
  | { type: 'ASK_AGENT'; nodeIds: string[]; prompt?: string }
  | { type: 'CHAT_SEND'; text: string; nodeIds: string[]; projectId: string | null }
  | { type: 'CHAT_CANCEL' }
  | { type: 'CHAT_CLEAR' }
  | { type: 'CHAT_STATUS' }
  | { type: 'RUN_COMMAND'; command: string }
  | { type: 'GET_SETTINGS' }
  | { type: 'UPDATE_SETTING'; key: string; value: unknown };

export type ExtensionMessage =
  | { type: 'ARCHITECTURE_UPDATED'; payload: ArchitectureGraph }
  | { type: 'ARCHITECTURE_LOADING' }
  | { type: 'ERROR'; message: string }
  | { type: 'CHAT_STATUS'; ready: boolean; provider?: string; message?: string; remedyCommand?: string }
  | { type: 'CHAT_DELTA'; text: string }
  | { type: 'CHAT_DONE'; provider: string; inputTokens?: number; outputTokens?: number; cachedTokens?: number }
  | { type: 'CHAT_ERROR'; message: string; remedyCommand?: string }
  | { type: 'SETTINGS'; payload: SettingsSnapshot }
  | { type: 'SHOW_SETTINGS' };

export function isWebviewRequest(value: unknown): value is WebviewRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const type = (value as { type?: unknown }).type;
  return (
    type === 'READY' ||
    type === 'GET_ARCHITECTURE' ||
    type === 'REFRESH_ARCHITECTURE' ||
    type === 'OPEN_FILE' ||
    type === 'SELECT_NODE' ||
    type === 'ASK_AGENT' ||
    type === 'CHAT_SEND' ||
    type === 'CHAT_CANCEL' ||
    type === 'CHAT_CLEAR' ||
    type === 'CHAT_STATUS' ||
    type === 'RUN_COMMAND' ||
    type === 'GET_SETTINGS' ||
    type === 'UPDATE_SETTING'
  );
}
