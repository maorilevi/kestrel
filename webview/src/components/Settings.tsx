import { useEffect, useState, type ReactNode } from 'react';

import type { SettingsSnapshot } from '../types/architecture';
import { onExtensionMessage, postRequest } from '../vscode/vscode';

export interface SettingsProps {
  onClose: () => void;
}

const PROVIDERS: Array<{ id: 'auto' | 'anthropic' | 'vscode'; label: string; detail: string }> = [
  { id: 'auto', label: 'Automatic', detail: 'Anthropic when connected, otherwise a VS Code model' },
  { id: 'anthropic', label: 'Anthropic API', detail: 'Full architecture, prompt cached between turns' },
  { id: 'vscode', label: 'VS Code model', detail: 'Uses a model your editor already provides' },
];

const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;

/**
 * KESTREL's own settings.
 *
 * Every control writes the same configuration key the VS Code settings editor
 * would, so the two can never disagree — this panel just puts the choices where
 * the work is happening.
 */
export function Settings({ onClose }: SettingsProps) {
  const [settings, setSettings] = useState<SettingsSnapshot | null>(null);

  useEffect(() => {
    const unsubscribe = onExtensionMessage((message) => {
      if (message.type === 'SETTINGS') {
        setSettings(message.payload);
      }
    });
    postRequest({ type: 'GET_SETTINGS' });
    return unsubscribe;
  }, []);

  const update = (key: string, value: unknown): void => {
    postRequest({ type: 'UPDATE_SETTING', key, value });
  };

  if (!settings) {
    return (
      <aside className="kestrel-settings">
        <header className="kestrel-settings__header">
          <strong>Settings</strong>
          <span className="kestrel-chat__spacer" />
          <button type="button" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="kestrel-hint">Loading…</p>
      </aside>
    );
  }

  const usesAnthropic = settings.provider !== 'vscode';
  const usesVsCode = settings.provider !== 'anthropic';

  return (
    <aside className="kestrel-settings">
      <header className="kestrel-settings__header">
        <strong>Settings</strong>
        <span className="kestrel-chat__spacer" />
        {settings.activeProvider ? (
          <span className="kestrel-relations__detail">now: {settings.activeProvider}</span>
        ) : null}
        <button type="button" onClick={onClose} title="Close settings">
          Close
        </button>
      </header>

      <div className="kestrel-settings__body">
        <Group title="Model provider">
          <div className="kestrel-settings__choices">
            {PROVIDERS.map((provider) => (
              <label key={provider.id} className="kestrel-settings__choice">
                <input
                  type="radio"
                  name="provider"
                  checked={settings.provider === provider.id}
                  onChange={() => update('kestrel.chat.provider', provider.id)}
                />
                <span>
                  <strong>{provider.label}</strong>
                  <span className="kestrel-relations__detail"> {provider.detail}</span>
                </span>
              </label>
            ))}
          </div>
        </Group>

        {usesAnthropic ? (
          <Group title="Anthropic">
            <select
              className="kestrel-settings__select"
              value={settings.anthropicModel}
              onChange={(event) => update('kestrel.chat.model', event.target.value)}
            >
              {settings.models.anthropic.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                  {model.note ? ' — ' + model.note : ''}
                </option>
              ))}
            </select>

            <label className="kestrel-settings__row">
              <span>Reasoning effort</span>
              <select
                className="kestrel-settings__select"
                value={settings.effort}
                onChange={(event) => update('kestrel.chat.effort', event.target.value)}
              >
                {EFFORTS.map((effort) => (
                  <option key={effort} value={effort}>
                    {effort}
                  </option>
                ))}
              </select>
            </label>

            <label className="kestrel-settings__row">
              <span>Timeout (seconds)</span>
              <input
                type="number"
                min={10}
                max={600}
                className="kestrel-settings__number"
                value={Math.round(settings.timeoutMs / 1000)}
                onChange={(event) =>
                  update('kestrel.chat.timeoutMs', Math.max(10, Number(event.target.value)) * 1000)
                }
              />
            </label>

            <p className="kestrel-hint">
              {settings.credential
                ? 'Connected using your ' + settings.credential + '.'
                : 'Not connected yet.'}
            </p>

            <div className="kestrel-inspector__actions">
              <button
                type="button"
                className={settings.credential ? '' : 'is-primary'}
                onClick={() => postRequest({ type: 'RUN_COMMAND', command: 'kestrel.signIn' })}
              >
                {settings.credential ? 'Change connection' : 'Connect chat'}
              </button>
              <button
                type="button"
                onClick={() => postRequest({ type: 'RUN_COMMAND', command: 'kestrel.testChat' })}
              >
                Test connection
              </button>
            </div>
          </Group>
        ) : null}

        {usesVsCode ? (
          <Group title="VS Code model">
            {settings.models.vscode.length === 0 ? (
              <p className="kestrel-hint">
                Your editor offers no language models. Install one, or use the Anthropic API.
              </p>
            ) : (
              <select
                className="kestrel-settings__select"
                value={settings.vsCodeModel}
                onChange={(event) => update('kestrel.chat.vsCodeModel', event.target.value)}
              >
                <option value="">Automatic — best available</option>
                {settings.models.vscode.map((model) => (
                  <option key={model.id} value={model.id} disabled={!model.available}>
                    {model.label}
                    {model.note ? ' — ' + model.note : ''}
                  </option>
                ))}
              </select>
            )}
          </Group>
        ) : null}

        <Group title="Scanning">
          <label className="kestrel-settings__row">
            <span>Rebuild on file changes</span>
            <input
              type="checkbox"
              checked={settings.autoRefresh}
              onChange={(event) => update('kestrel.autoRefresh', event.target.checked)}
            />
          </label>

          <label className="kestrel-settings__row">
            <span>Debounce (ms)</span>
            <input
              type="number"
              min={200}
              max={10000}
              step={100}
              className="kestrel-settings__number"
              value={settings.refreshDebounceMs}
              onChange={(event) =>
                update('kestrel.refreshDebounceMs', Math.max(200, Number(event.target.value)))
              }
            />
          </label>

          <label className="kestrel-settings__row">
            <span>File limit per folder</span>
            <input
              type="number"
              min={100}
              step={100}
              className="kestrel-settings__number"
              value={settings.maxFiles}
              onChange={(event) => update('kestrel.maxFiles', Math.max(100, Number(event.target.value)))}
            />
          </label>
        </Group>

        <p className="kestrel-hint">
          These are the same settings VS Code stores — changing one here changes it there.
        </p>
      </div>
    </aside>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="kestrel-settings__group">
      <h3>{title}</h3>
      {children}
    </section>
  );
}
