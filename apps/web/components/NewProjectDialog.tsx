'use client';

import type { ProjectSource, ProjectSummary } from '@kestrel/protocol';
import { useEffect, useState, type FormEvent } from 'react';

import { api, type TemplateInfo } from '@/lib/api';

type Mode = 'template' | 'github';

export function NewProjectDialog({
  initialMode = 'template',
  onCreated,
  onClose,
}: {
  initialMode?: Mode;
  onCreated(project: ProjectSummary): void;
  onClose(): void;
}) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [templates, setTemplates] = useState<TemplateInfo[]>([]);
  const [template, setTemplate] = useState<string>();
  const [repoUrl, setRepoUrl] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.templates().then((list) => {
      setTemplates(list);
      setTemplate((current) => current ?? list[0]?.id);
    });
  }, []);

  // An imported repository names the project unless the user already typed one.
  useEffect(() => {
    const repo = /github\.com\/[^/]+\/([^/?#]+)/.exec(repoUrl)?.[1]?.replace(/\.git$/, '');
    if (mode === 'github' && repo) {
      setName((current) => current || repo);
    }
  }, [repoUrl, mode]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const source: ProjectSource | undefined =
      mode === 'template'
        ? template
          ? { kind: 'template', template }
          : undefined
        : { kind: 'github', repoUrl: repoUrl.trim() };
    if (!source) {
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      onCreated(await api.createProject(name.trim(), source));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      setBusy(false);
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <form
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-project-title"
        onClick={(event) => event.stopPropagation()}
        onSubmit={submit}
      >
        <h2 id="new-project-title">New project</h2>

        <div className="segmented">
          <button type="button" aria-pressed={mode === 'template'} onClick={() => setMode('template')}>
            Start from a template
          </button>
          <button type="button" aria-pressed={mode === 'github'} onClick={() => setMode('github')}>
            Import from GitHub
          </button>
        </div>

        {mode === 'template' ? (
          <div role="radiogroup" aria-label="Template" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {templates.map((option) => (
              <div
                key={option.id}
                className="template-option"
                role="radio"
                tabIndex={0}
                aria-checked={template === option.id}
                onClick={() => setTemplate(option.id)}
                onKeyDown={(event) => (event.key === ' ' || event.key === 'Enter') && setTemplate(option.id)}
              >
                <div>
                  <strong>{option.name}</strong>
                  <p>{option.description}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <label className="field">
            <span>Public repository URL</span>
            <input
              className="input"
              placeholder="https://github.com/owner/repo"
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              required
              autoFocus
            />
          </label>
        )}

        <label className="field">
          <span>Project name</span>
          <input className="input" value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} />
        </label>

        {error ? <div className="error-text">{error}</div> : null}

        <div className="dialog__actions">
          <button className="btn btn--ghost" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'Creating…' : 'Create project'}
          </button>
        </div>
      </form>
    </div>
  );
}
