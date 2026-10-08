import { useState } from 'react';

import type { ArchitectureGraph, ArchitectureIssue, ArchitectureStyle } from '../types/architecture';

export interface InsightsProps {
  graph: ArchitectureGraph;
  onSelectNodes: (nodeIds: string[]) => void;
}

const SEVERITY_LABELS: Record<ArchitectureIssue['severity'], string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Note',
};

/**
 * Architecture feedback: which styles KESTREL recognised, and what it found
 * wrong. Every row is backed by nodes in the graph, so clicking one selects
 * exactly the code the finding is about.
 */
export function Insights({ graph, onSelectNodes }: InsightsProps) {
  const [open, setOpen] = useState(false);

  const styles = graph.metadata?.styles ?? [];
  const issues = graph.metadata?.issues ?? [];
  const projects = graph.metadata?.projects ?? [];

  if (styles.length === 0 && issues.length === 0) {
    return null;
  }

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  const notes = issues.length - errors - warnings;

  const scopeLabel = (scope: string): string =>
    scope === 'workspace' ? 'workspace' : (projects.find((p) => p.id === scope)?.name ?? scope);

  return (
    <section className={`kestrel-insights${open ? ' is-open' : ''}`}>
      <button type="button" className="kestrel-insights__summary" onClick={() => setOpen(!open)}>
        <span className="kestrel-insights__caret">{open ? '▾' : '▸'}</span>
        <strong>Architecture</strong>
        {styles.slice(0, 3).map((style) => (
          <span key={`${style.id}:${style.scope}`} className="kestrel-badge">
            {style.label}
          </span>
        ))}
        {styles.length > 3 ? <span className="kestrel-badge">+{styles.length - 3}</span> : null}
        <span className="kestrel-insights__spacer" />
        {warnings > 0 ? <span className="kestrel-stats kestrel-stats--warning">⚠ {warnings}</span> : null}
        {notes > 0 ? <span className="kestrel-stats">{notes} notes</span> : null}
        {issues.length === 0 ? <span className="kestrel-stats">no findings</span> : null}
      </button>

      {open ? (
        <div className="kestrel-insights__body">
          <div className="kestrel-insights__column">
            <h3>Detected styles</h3>
            {styles.length === 0 ? <p className="kestrel-hint">Nothing conclusive.</p> : null}
            <ul className="kestrel-insights__list">
              {styles.map((style) => (
                <StyleRow key={`${style.id}:${style.scope}`} style={style} scopeLabel={scopeLabel} />
              ))}
            </ul>
          </div>

          <div className="kestrel-insights__column">
            <h3>Findings</h3>
            {issues.length === 0 ? (
              <p className="kestrel-hint">No architectural problems found in the graph.</p>
            ) : null}
            <ul className="kestrel-insights__list">
              {issues.map((issue) => (
                <li key={issue.id} className={`kestrel-finding kestrel-finding--${issue.severity}`}>
                  <button type="button" onClick={() => onSelectNodes(issue.nodeIds)}>
                    <span className="kestrel-finding__severity">{SEVERITY_LABELS[issue.severity]}</span>
                    <span>{issue.message}</span>
                  </button>
                  {issue.hint ? <p className="kestrel-hint">{issue.hint}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function StyleRow({
  style,
  scopeLabel,
}: {
  style: ArchitectureStyle;
  scopeLabel: (scope: string) => string;
}) {
  return (
    <li className="kestrel-style">
      <div className="kestrel-style__header">
        <strong>{style.label}</strong>
        <span className="kestrel-relations__detail">{scopeLabel(style.scope)}</span>
        <span className={`kestrel-badge kestrel-badge--${style.confidence}`}>{style.confidence}</span>
      </div>
      <p className="kestrel-hint">{style.description}</p>
      <ul className="kestrel-style__evidence">
        {style.evidence.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ul>
    </li>
  );
}
