import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { ArchitectureNode } from '../types/architecture';
import { hostSupportsCommands, onExtensionMessage, postRequest } from '../host/host';

export interface ChatProps {
  nodes: ArchitectureNode[];
  selectedNodeIds: string[];
  projectId: string | null;
  onSelectNode: (nodeId: string) => void;
  /** Brings a set of nodes on screen and centres the viewport on them. */
  onRevealNodes: (nodeIds: string[]) => void;
  onTraceFlow: (nodeIds: string[]) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Set by the parent so the toolbar can put the cursor in the composer. */
  focusSignal: number;
}

interface ChatEntry {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  pending?: boolean;
}

const SUGGESTIONS = [
  'What does this application do, structurally?',
  'Which components write to the database?',
  'Trace the data flow for the selected component.',
  'What would break if I change the selected component?',
  'Is there anything wrong with this architecture?',
];

/**
 * Architecture chat.
 *
 * The panel never talks to a model itself: it sends the question plus the
 * current selection to the extension, which assembles the architectural
 * context and streams the answer back.
 */
export function Chat({
  nodes,
  selectedNodeIds,
  projectId,
  onSelectNode,
  onRevealNodes,
  onTraceFlow,
  collapsed,
  onToggleCollapsed,
  focusSignal,
}: ChatProps) {
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<{ ready: boolean; provider?: string; message?: string; remedyCommand?: string }>({
    ready: false,
  });
  const [error, setError] = useState<{ message: string; remedyCommand?: string } | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const nextId = useRef(0);
  const listRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const nodesByName = useMemo(() => {
    const map = new Map<string, ArchitectureNode>();
    for (const node of nodes) {
      if (!map.has(node.name)) {
        map.set(node.name, node);
      }
    }
    return map;
  }, [nodes]);

  useEffect(() => {
    const unsubscribe = onExtensionMessage((message) => {
      switch (message.type) {
        case 'CHAT_STATUS':
          setStatus({
            ready: message.ready,
            provider: message.provider,
            message: message.message,
            remedyCommand: message.remedyCommand,
          });
          break;

        case 'CHAT_DELTA':
          setEntries((current) => {
            const last = current[current.length - 1];
            if (!last || last.role !== 'assistant') {
              return current;
            }
            return [...current.slice(0, -1), { ...last, text: last.text + message.text }];
          });
          break;

        case 'CHAT_DONE':
          setStreaming(false);
          setEntries((current) => {
            const last = current[current.length - 1];
            if (!last || last.role !== 'assistant') {
              return current;
            }
            // A cancelled or empty answer should not linger as a blank bubble.
            if (last.text.trim().length === 0) {
              return current.slice(0, -1);
            }
            return [...current.slice(0, -1), { ...last, pending: false }];
          });
          setUsage(
            message.inputTokens !== undefined
              ? `${message.provider} · ${message.inputTokens} in / ${message.outputTokens ?? 0} out` +
                  (message.cachedTokens ? ` · ${message.cachedTokens} cached` : '')
              : message.provider,
          );
          break;

        case 'CHAT_ERROR':
          setStreaming(false);
          setError({ message: message.message, remedyCommand: message.remedyCommand });
          setEntries((current) => {
            const last = current[current.length - 1];
            return last && last.role === 'assistant' && last.pending ? current.slice(0, -1) : current;
          });
          break;
      }
    });

    postRequest({ type: 'CHAT_STATUS' });
    return unsubscribe;
  }, []);

  // A request that is still running must look like it: silence with no clock
  // is indistinguishable from a broken panel.
  useEffect(() => {
    if (!streaming) {
      setElapsed(0);
      return;
    }
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [streaming]);

  // The toolbar button puts the cursor here rather than opening a panel.
  useEffect(() => {
    if (focusSignal > 0 && !collapsed) {
      composerRef.current?.focus();
    }
  }, [focusSignal, collapsed]);

  useEffect(() => {
    // Assigning scrollTop works in every host; scrollTo is not always present,
    // and an auto-scroll must never be able to take the panel down.
    const list = listRef.current;
    if (list) {
      list.scrollTop = list.scrollHeight;
    }
  }, [entries]);

  const send = useCallback(
    (text: string) => {
      const question = text.trim();
      if (question.length === 0 || streaming) {
        return;
      }

      setError(null);
      setUsage(null);
      setDraft('');
      setStreaming(true);
      setEntries((current) => [
        ...current,
        { id: (nextId.current += 1), role: 'user', text: question },
        { id: (nextId.current += 1), role: 'assistant', text: '', pending: true },
      ]);

      postRequest({ type: 'CHAT_SEND', text: question, nodeIds: selectedNodeIds, projectId });
    },
    [selectedNodeIds, projectId, streaming],
  );

  const stop = useCallback(() => {
    postRequest({ type: 'CHAT_CANCEL' });
    setStreaming(false);
  }, []);

  const clear = useCallback(() => {
    postRequest({ type: 'CHAT_CLEAR' });
    setEntries([]);
    setError(null);
    setUsage(null);
  }, []);

  const selectedNames = selectedNodeIds
    .map((id) => nodes.find((node) => node.id === id)?.name)
    .filter((name): name is string => name !== undefined);

  return (
    <aside className="kestrel-chat">
      <header className="kestrel-chat__header">
        <button
          type="button"
          className="kestrel-chat__collapse"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          title={collapsed ? 'Expand the chat' : 'Collapse the chat'}
        >
          <span aria-hidden="true">{collapsed ? '▸' : '▾'}</span> Ask about this architecture
        </button>
        <span className="kestrel-chat__spacer" />
        {!collapsed && status.provider ? (
          <span className="kestrel-relations__detail">{status.provider}</span>
        ) : null}
        {!collapsed ? (
          <button type="button" onClick={clear} disabled={entries.length === 0} title="Clear the conversation">
            Clear
          </button>
        ) : null}
      </header>

      {collapsed ? null : (
        <>

      {selectedNames.length > 0 ? (
        <div className="kestrel-chat__context">
          <span className="kestrel-relations__detail">In context:</span>
          {selectedNames.map((name) => (
            <span key={name} className="kestrel-badge">
              {name}
            </span>
          ))}
        </div>
      ) : null}

      <div className="kestrel-chat__messages" ref={listRef}>
        {entries.length === 0 ? (
          <div className="kestrel-chat__empty">
            <p className="kestrel-hint">
              Questions are answered from the architecture KESTREL extracted — modules, dependencies,
              layers, datastores and findings. Select nodes first to focus the answer on them.
            </p>
            <div className="kestrel-chat__suggestions">
              {SUGGESTIONS.map((suggestion) => (
                <button key={suggestion} type="button" onClick={() => send(suggestion)}>
                  {suggestion}
                </button>
              ))}
            </div>
            {hostSupportsCommands() ? (
              <button
                type="button"
                className="kestrel-link"
                onClick={() => postRequest({ type: 'RUN_COMMAND', command: 'kestrel.testChat' })}
              >
                Test the connection
              </button>
            ) : null}
          </div>
        ) : null}

        {entries.map((entry) => (
          <div key={entry.id} className={`kestrel-message kestrel-message--${entry.role}`}>
            <div className="kestrel-message__role">{entry.role === 'user' ? 'You' : 'KESTREL'}</div>
            <div className="kestrel-message__body">
              {entry.text.length > 0 ? (
                <Answer text={entry.text} nodesByName={nodesByName} onSelectNode={onSelectNode} />
              ) : (
                <span className="kestrel-chat__thinking">
                  {entry.pending && streaming
                    ? `Waiting for ${status.provider ?? 'the model'}${elapsed > 2 ? ` — ${elapsed}s` : ''}…`
                    : 'Thinking…'}
                </span>
              )}
            </div>
            {entry.role === 'assistant' && !entry.pending ? (
              <AnswerActions
                text={entry.text}
                nodesByName={nodesByName}
                onRevealNodes={onRevealNodes}
                onTraceFlow={onTraceFlow}
              />
            ) : null}
          </div>
        ))}

        {error ? (
          <div className="kestrel-banner kestrel-banner--error">
            <p>{error.message}</p>
            {error.remedyCommand && hostSupportsCommands() ? (
              <button
                type="button"
                className="is-primary"
                onClick={() => postRequest({ type: 'RUN_COMMAND', command: error.remedyCommand as string })}
              >
                {error.remedyCommand === 'kestrel.signIn' ? 'Connect chat' : 'Set API key'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {!status.ready && status.message ? (
        <div className="kestrel-chat__setup">
          <p className="kestrel-hint">{status.message}</p>
          {hostSupportsCommands() ? (
          <div className="kestrel-inspector__actions">
            <button
              type="button"
              className="is-primary"
              onClick={() => postRequest({ type: 'RUN_COMMAND', command: 'kestrel.signIn' })}
              title="Choose how the chat answers — an API key, or a model VS Code provides"
            >
              Connect chat
            </button>
            <button
              type="button"
              onClick={() => postRequest({ type: 'RUN_COMMAND', command: 'kestrel.setApiKey' })}
            >
              Use an API key
            </button>
          </div>
          ) : null}
        </div>
      ) : null}

      <form
        className="kestrel-chat__composer"
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <textarea
          ref={composerRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send(draft);
            }
          }}
          placeholder="Ask about modules, dependencies, layers, data flow…"
          rows={2}
        />
        {streaming ? (
          <button type="button" onClick={stop} title="Stop waiting for this answer">
            Stop
          </button>
        ) : (
          <button type="submit" className="is-primary" disabled={draft.trim().length === 0}>
            Ask
          </button>
        )}
      </form>

      {usage ? <div className="kestrel-chat__usage">{usage}</div> : null}
        </>
      )}
    </aside>
  );
}

/**
 * The components an answer named, in the order it named them. This is what
 * turns a written answer into a place on the map.
 */
function citedNodes(text: string, nodesByName: Map<string, ArchitectureNode>): ArchitectureNode[] {
  const found: ArchitectureNode[] = [];
  for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const node = nodesByName.get(match[1]);
    if (node && !found.some((candidate) => candidate.id === node.id)) {
      found.push(node);
    }
  }
  return found;
}

/** Take-me-there actions for an answer that named components. */
function AnswerActions({
  text,
  nodesByName,
  onRevealNodes,
  onTraceFlow,
}: {
  text: string;
  nodesByName: Map<string, ArchitectureNode>;
  onRevealNodes: (nodeIds: string[]) => void;
  onTraceFlow: (nodeIds: string[]) => void;
}) {
  const cited = citedNodes(text, nodesByName);
  if (cited.length === 0) {
    return null;
  }

  const ids = cited.map((node) => node.id);

  return (
    <div className="kestrel-message__actions">
      <button type="button" onClick={() => onRevealNodes(ids)}>
        Show in graph{cited.length > 1 ? ` (${cited.length})` : ''}
      </button>
      <button type="button" onClick={() => onTraceFlow(ids)}>
        Trace data flow
      </button>
    </div>
  );
}

/**
 * Renders an answer, turning `[[NodeName]]` citations into links that select
 * the node in the graph. Everything else is shown as plain text — the panel
 * deliberately does not execute markup from a model.
 */
function Answer({
  text,
  nodesByName,
  onSelectNode,
}: {
  text: string;
  nodesByName: Map<string, ArchitectureNode>;
  onSelectNode: (nodeId: string) => void;
}) {
  const parts = text.split(/(\[\[[^\]]+\]\])/g);

  return (
    <>
      {parts.map((part, index) => {
        const match = /^\[\[([^\]]+)\]\]$/.exec(part);
        if (!match) {
          return <span key={index}>{part}</span>;
        }

        const node = nodesByName.get(match[1]);
        if (!node) {
          return <span key={index}>{match[1]}</span>;
        }

        return (
          <button key={index} type="button" className="kestrel-link" onClick={() => onSelectNode(node.id)}>
            {node.name}
          </button>
        );
      })}
    </>
  );
}
