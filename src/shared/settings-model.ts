/**
 * The settings contract shared by the extension and its panel.
 *
 * Pure types only: the webview must never pull in VS Code or Node through a
 * type import.
 */

export type ChatProviderPreference = 'auto' | 'anthropic' | 'vscode';

export interface ModelChoice {
  id: string;
  label: string;
  /** Context size, provider, or why a choice is unavailable. */
  note?: string;
  available: boolean;
}

export interface SettingsSnapshot {
  provider: ChatProviderPreference;
  anthropicModel: string;
  vsCodeModel: string;
  effort: string;
  timeoutMs: number;
  autoRefresh: boolean;
  refreshDebounceMs: number;
  maxFiles: number;
  models: { anthropic: ModelChoice[]; vscode: ModelChoice[] };
  /** Which credential the Anthropic provider would use, if any. */
  credential?: string;
  /** What would answer a question right now. */
  activeProvider?: string;
}

/**
 * Configuration keys the panel may write.
 *
 * The webview is untrusted input: without this list a crafted message could
 * change any VS Code setting, so writes are refused unless the key is here.
 */
export const WRITABLE_SETTING_KEYS: readonly string[] = [
  'kestrel.chat.provider',
  'kestrel.chat.model',
  'kestrel.chat.vsCodeModel',
  'kestrel.chat.effort',
  'kestrel.chat.timeoutMs',
  'kestrel.autoRefresh',
  'kestrel.refreshDebounceMs',
  'kestrel.maxFiles',
];

export function isWritableSettingKey(key: string): boolean {
  return WRITABLE_SETTING_KEYS.includes(key);
}
