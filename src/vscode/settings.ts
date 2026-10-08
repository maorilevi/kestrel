import * as vscode from 'vscode';

import { CREDENTIAL_LABELS, resolveCredentialSource } from '../chat/credentials';
import {
  isWritableSettingKey,
  type ChatProviderPreference,
  type ModelChoice,
  type SettingsSnapshot,
} from '../shared/settings-model';

export type { ModelChoice, SettingsSnapshot };

/**
 * The settings surface KESTREL shows inside its own panel.
 *
 * VS Code's settings editor stays the source of truth — everything here reads
 * and writes the same configuration keys — but a developer choosing a model
 * should not have to leave the architecture view to do it.
 */

/** Anthropic models offered in the picker, most capable first. */
export const ANTHROPIC_MODELS: ReadonlyArray<{ id: string; label: string; note: string }> = [
  { id: 'claude-opus-5', label: 'Claude Opus 5', note: 'Most capable · 1M context' },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Faster and cheaper · 1M context' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', note: 'Fastest · 200K context' },
];


export async function readSettings(
  getApiKey: () => Promise<string | undefined>,
  activeProvider?: string,
): Promise<SettingsSnapshot> {
  const chat = vscode.workspace.getConfiguration('kestrel.chat');
  const scan = vscode.workspace.getConfiguration('kestrel');
  const source = resolveCredentialSource(await getApiKey());

  return {
    provider: chat.get<ChatProviderPreference>('provider', 'auto'),
    anthropicModel: chat.get<string>('model', 'claude-opus-5'),
    vsCodeModel: chat.get<string>('vsCodeModel', ''),
    effort: chat.get<string>('effort', 'high'),
    timeoutMs: chat.get<number>('timeoutMs', 120_000),
    autoRefresh: scan.get<boolean>('autoRefresh', true),
    refreshDebounceMs: scan.get<number>('refreshDebounceMs', 700),
    maxFiles: scan.get<number>('maxFiles', 5000),
    models: {
      anthropic: ANTHROPIC_MODELS.map((model) => ({
        ...model,
        available: source !== undefined,
        note: source ? model.note : `${model.note} · needs sign-in`,
      })),
      vscode: await listVsCodeModels(),
    },
    credential: source ? CREDENTIAL_LABELS[source] : undefined,
    activeProvider,
  };
}

/** Every language model the editor offers, unusable ones marked as such. */
export async function listVsCodeModels(): Promise<ModelChoice[]> {
  let models: readonly vscode.LanguageModelChat[];
  try {
    models = await vscode.lm.selectChatModels();
  } catch {
    return [];
  }

  return models.map((model) => {
    const usable = typeof model.maxInputTokens !== 'number' || model.maxInputTokens > 0;
    return {
      id: model.id,
      label: model.name,
      note: usable
        ? `${model.vendor}${model.family ? `/${model.family}` : ''} · ${model.maxInputTokens.toLocaleString()} tokens`
        : `${model.vendor} · reports no token budget, cannot answer`,
      available: usable,
    };
  });
}

/** Writes one whitelisted setting, preferring the workspace scope. */
export async function updateSetting(key: string, value: unknown): Promise<void> {
  if (!isWritableSettingKey(key)) {
    throw new Error(`KESTREL: refusing to write the setting "${key}".`);
  }

  const lastDot = key.lastIndexOf('.');
  const section = key.slice(0, lastDot);
  const name = key.slice(lastDot + 1);

  const target = vscode.workspace.workspaceFolders?.length
    ? vscode.ConfigurationTarget.Workspace
    : vscode.ConfigurationTarget.Global;

  await vscode.workspace.getConfiguration(section).update(name, value, target);
}
