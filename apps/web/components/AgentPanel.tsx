'use client';

import type { AgentRunSummary, ArchitectureDiffSummary } from '@/lib/agent-types';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';

import { undoableRunId } from '@/lib/agent-runs';

export interface AgentNode {
  id: string;
  name: string;
  type: string;
}

export function AgentPanel({
  runs,
  nodes,
  focus,
  onFocusChange,
  canRun,
  error,
  onStart,
  onCancel,
  onUndo,
  onOpenFile,
}: {
  runs: AgentRunSummary[];
  /** The current architecture, to name focused components. */
  nodes: ReadonlyMap<string, AgentNode>;
  focus: string[];
  onFocusChange(nodeIds: string[]): void;
  /** False while the project is not running. */
  canRun: boolean;
  error?: string;
  onStart(prompt: string): void;
  onCancel(): void;
  onUndo(runId: string): void;
  onOpenFile(path: string): void;
}) {
  const [draft, setDraft] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const running = runs.some((run) => run.status === 'running');
  const undoable = undoableRunId(runs);

  useEffect(() => {
    const element = scroller.current;
    if (element) {
      element.scrollTop = element.scrollHeight;
    }
  }, [runs]);

  const submit = () => {
    if (!draft.trim() || running || !canRun) {
      return;
    }
    onStart(draft.trim());
    setDraft('');
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="agent">
      <div className="agent__runs" ref={scroller}>
        {runs.length === 0 ? (
          <div className="agent__empty">
            <h3>Ask for a change</h3>
            <p>
              Describe what you want built or changed. Select components on the canvas and choose <em>Ask agent</em> to
              focus the agent on them. Every run becomes a commit you can undo, and its effect shows up on the map.
            </p>
          </div>
        ) : null}
        {runs.map((run) => (
          <RunCard
            key={run.id}
            run={run}
            nodes={nodes}
            canUndo={run.id === undoable}
            onUndo={() => onUndo(run.id)}
            onOpenFile={onOpenFile}
          />
        ))}
      </div>

      <div className="agent__composer">
        {error ? <div className="error-text">{error}</div> : null}
        {focus.length > 0 ? (
          <div className="agent__focus" aria-label="Focus">
            {focus.map((id) => (
              <span key={id} className="chip">
                {nodes.get(id)?.name ?? id.split('#').pop()}
                <button type="button" aria-label="Remove" onClick={() => onFocusChange(focus.filter((item) => item !== id))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          className="input agent__input"
          placeholder={canRun ? 'Add a "last seen" date to users and show it on the users page…' : 'Start the project to use the agent.'}
          value={draft}
          disabled={!canRun}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={onKeyDown}
          rows={3}
        />
        <div className="agent__actions">
          <span className="muted" style={{ fontSize: 12 }}>
            Ctrl+Enter to send
          </span>
          {running ? (
            <button className="btn btn--small" onClick={onCancel}>
              Stop
            </button>
          ) : (
            <button className="btn btn--small btn--primary" onClick={submit} disabled={!canRun || !draft.trim()}>
              Send to agent
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

const STATUS_LABELS: Record<AgentRunSummary['status'], string> = {
  running: 'Working…',
  done: 'Done',
  refused: 'Declined',
  cancelled: 'Stopped',
  error: 'Failed',
};

function RunCard({
  run,
  nodes,
  canUndo,
  onUndo,
  onOpenFile,
}: {
  run: AgentRunSummary;
  nodes: ReadonlyMap<string, AgentNode>;
  canUndo: boolean;
  onUndo(): void;
  onOpenFile(path: string): void;
}) {
  const focusNames = run.nodeIds.map((id) => nodes.get(id)?.name ?? id.split('#').pop() ?? id);
  // The closing summary is shown in the result; the transcript shows the work.
  const transcript =
    run.status !== 'running' && run.summary
      ? run.transcript.filter((entry, index) => !(entry.kind === 'text' && index === run.transcript.length - 1))
      : run.transcript;

  return (
    <article className={`run run--${run.status}${run.undone ? ' run--undone' : ''}`}>
      <header className="run__prompt">
        <span className="run__who">{run.startedBy}</span>
        <p>{run.prompt}</p>
        {focusNames.length > 0 ? <div className="run__focus">Focus: {focusNames.join(', ')}</div> : null}
      </header>

      <div className="run__transcript">
        {transcript.map((entry, index) =>
          entry.kind === 'text' ? (
            <p key={index} className="run__text">
              {entry.text}
            </p>
          ) : (
            <div key={entry.step.id} className={`step step--${entry.step.status}`} title={entry.step.detail}>
              <span className="step__icon" aria-hidden>
                {entry.step.status === 'running' ? '◌' : entry.step.status === 'ok' ? '✓' : '!'}
              </span>
              <span className="step__summary">{entry.step.summary}</span>
            </div>
          ),
        )}
      </div>

      {run.status !== 'running' ? (
        <footer className="run__result">
          <div className="run__status">
            <strong>{run.undone ? 'Undone' : STATUS_LABELS[run.status]}</strong>
            {run.commit ? <code>{run.commit}</code> : null}
            {canUndo ? (
              <button className="btn btn--small btn--ghost" onClick={onUndo}>
                Undo
              </button>
            ) : null}
          </div>
          {run.error ? <p className="error-text">{run.error}</p> : null}
          {run.summary ? <p className="run__summary">{run.summary}</p> : null}
          {run.architecture ? <DiffChips diff={run.architecture} /> : null}
          {run.changedFiles.length > 0 ? (
            <ul className="run__files">
              {run.changedFiles.map((file) => (
                <li key={file}>
                  <button type="button" className="link" onClick={() => onOpenFile(file)} disabled={run.undone}>
                    {file}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </footer>
      ) : null}
    </article>
  );
}

function DiffChips({ diff }: { diff: ArchitectureDiffSummary }) {
  const chips = [
    ...diff.addedNodes.map((node) => ({ key: `+${node.id}`, label: `+ ${node.name}`, tone: 'added' })),
    ...diff.changedNodes.map((node) => ({ key: `~${node.id}`, label: `~ ${node.name}`, tone: 'changed' })),
    ...diff.removedNodes.map((node) => ({ key: `-${node.id}`, label: `− ${node.name}`, tone: 'removed' })),
  ];
  if (chips.length === 0) {
    return <p className="muted run__nochange">No change to the architecture.</p>;
  }
  return (
    <div className="run__diff" aria-label="Architecture change">
      {chips.map((chip) => (
        <span key={chip.key} className={`diff-chip diff-chip--${chip.tone}`}>
          {chip.label}
        </span>
      ))}
    </div>
  );
}
