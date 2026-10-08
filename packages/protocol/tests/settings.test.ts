import { describe, expect, it } from 'vitest';

import {
  WRITABLE_SETTING_KEYS,
  isWritableSettingKey,
  type SettingsSnapshot,
} from '../src/settings-model';
import { isWebviewRequest } from '../src/protocol';

describe('writable settings', () => {
  it('accepts every key the panel offers a control for', () => {
    for (const key of [
      'kestrel.chat.provider',
      'kestrel.chat.model',
      'kestrel.chat.vsCodeModel',
      'kestrel.chat.effort',
      'kestrel.chat.timeoutMs',
      'kestrel.autoRefresh',
      'kestrel.refreshDebounceMs',
      'kestrel.maxFiles',
    ]) {
      expect(isWritableSettingKey(key)).toBe(true);
    }
  });

  it('refuses settings that belong to the editor or another extension', () => {
    for (const key of [
      'editor.fontSize',
      'workbench.colorTheme',
      'git.enabled',
      'kestrel.exclude',
      'kestrel',
      '',
    ]) {
      expect(isWritableSettingKey(key)).toBe(false);
    }
  });

  it('is scoped to KESTREL only', () => {
    expect(WRITABLE_SETTING_KEYS.every((key) => key.startsWith('kestrel.'))).toBe(true);
  });

  it('never exposes the API key through settings', () => {
    // The key lives in SecretStorage; a settings write must not be able to
    // reach it, read it, or replace it.
    expect(WRITABLE_SETTING_KEYS.some((key) => /key|secret|token/i.test(key))).toBe(false);
  });
});

describe('settings protocol', () => {
  it('accepts the settings messages the panel sends', () => {
    expect(isWebviewRequest({ type: 'GET_SETTINGS' })).toBe(true);
    expect(isWebviewRequest({ type: 'UPDATE_SETTING', key: 'kestrel.chat.model', value: 'x' })).toBe(true);
  });

  it('still rejects anything that is not a known request', () => {
    expect(isWebviewRequest({ type: 'WRITE_FILE' })).toBe(false);
    expect(isWebviewRequest({})).toBe(false);
    expect(isWebviewRequest(null)).toBe(false);
  });
});

describe('settings snapshot shape', () => {
  it('carries everything the panel needs to render without guessing', () => {
    const snapshot: SettingsSnapshot = {
      provider: 'auto',
      anthropicModel: 'claude-opus-5',
      vsCodeModel: '',
      effort: 'high',
      timeoutMs: 120_000,
      autoRefresh: true,
      refreshDebounceMs: 700,
      maxFiles: 5000,
      models: {
        anthropic: [{ id: 'claude-opus-5', label: 'Claude Opus 5', available: true }],
        vscode: [{ id: 'auto', label: 'Auto', note: 'no token budget', available: false }],
      },
      credential: 'stored API key',
      activeProvider: 'Claude Opus 5',
    };

    // A model that cannot answer is still listed, marked unavailable, so the
    // picker can explain the absence instead of hiding it.
    expect(snapshot.models.vscode[0].available).toBe(false);
    expect(snapshot.models.anthropic[0].available).toBe(true);
  });
});
