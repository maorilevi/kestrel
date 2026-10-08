'use client';

import type { LogStream, ProjectStatus, ProjectSummary } from '@kestrel/protocol';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { api } from '@/lib/api';
import { ProjectChannel, type ChannelState } from '@/lib/channel';

import { isBusy, StatusPill } from './StatusPill';

// The canvas measures the DOM and owns its own React root: browser only.
const Canvas = dynamic(() => import('./Canvas'), {
  ssr: false,
  loading: () => <div className="placeholder">Loading the canvas…</div>,
});

type Tab = 'preview' | 'logs' | 'code';

interface LogEntry {
  stream: LogStream;
  text: string;
}

interface OpenFile {
  filePath: string;
  content?: string;
  line?: number;
  error?: string;
}

const LOG_LIMIT = 2000;

export function Workspace({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [project, setProject] = useState<ProjectSummary>();
  const [loadError, setLoadError] = useState<string>();
  const [channel, setChannel] = useState<ProjectChannel>();
  const [connection, setConnection] = useState<ChannelState>('connecting');
  const [status, setStatus] = useState<ProjectStatus>('idle');
  const [previewUrl, setPreviewUrl] = useState<string>();
  const [statusError, setStatusError] = useState<string>();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [file, setFile] = useState<OpenFile>();
  const [tab, setTab] = useState<Tab>('logs');
  const [previewKey, setPreviewKey] = useState(0);

  useEffect(() => {
    api.project(projectId).then(setProject, (error: Error) => setLoadError(error.message));
  }, [projectId]);

  useEffect(() => {
    const next = new ProjectChannel(projectId);
    const offState = next.onState(setConnection);
    const offMessages = next.subscribe((message) => {
      switch (message.type) {
        case 'PROJECT_STATE':
          setStatus(message.status);
          setPreviewUrl(message.previewUrl);
          setStatusError(message.error);
          if (message.status === 'ready') {
            setTab((current) => (current === 'logs' ? 'preview' : current));
          }
          break;
        case 'PROJECT_LOG_HISTORY':
          setLogs(message.entries.slice(-LOG_LIMIT));
          break;
        case 'PROJECT_LOG':
          setLogs((current) => [...current, { stream: message.stream, text: message.text }].slice(-LOG_LIMIT));
          break;
        case 'FILE_CONTENT':
          setFile({ filePath: message.filePath, content: message.content, line: message.line });
          setTab('code');
          break;
        case 'FILE_ERROR':
          setFile({ filePath: message.filePath, error: message.message });
          setTab('code');
          break;
      }
    });
    next.connect();
    setChannel(next);
    return () => {
      offState();
      offMessages();
      next.dispose();
    };
  }, [projectId]);

  if (loadError) {
    return (
      <main className="page">
        <p className="error-text">{loadError}</p>
        <Link href="/projects" className="btn">
          Back to projects
        </Link>
      </main>
    );
  }

  const busy = isBusy(status);
  const running = status === 'ready' || status === 'running';

  return (
    <div className="workspace">
      <div className="workspace__bar">
        <Link href="/projects" className="btn btn--ghost btn--small" aria-label="Back to projects">
          ←
        </Link>
        <span className="workspace__name">{project?.name ?? '…'}</span>
        <StatusPill status={status} />
        {connection !== 'open' ? <span className="muted" style={{ fontSize: 12 }}>reconnecting…</span> : null}
        <div className="app-header__spacer" />
        {running || busy ? (
          <>
            <button
              className="btn btn--small"
              disabled={busy}
              onClick={() => channel?.send({ type: 'RESTART_DEV_SERVER' })}
            >
              Restart dev server
            </button>
            <button className="btn btn--small" onClick={() => channel?.send({ type: 'STOP_PROJECT' })}>
              Stop
            </button>
          </>
        ) : (
          <button className="btn btn--small btn--primary" onClick={() => channel?.send({ type: 'START_PROJECT' })}>
            Start
          </button>
        )}
        {previewUrl ? (
          <a className="btn btn--small" href={previewUrl} target="_blank" rel="noreferrer">
            Open preview ↗
          </a>
        ) : null}
        <button
          className="btn btn--small btn--ghost btn--danger"
          onClick={async () => {
            if (window.confirm(`Delete ${project?.name ?? 'this project'} and its sandbox?`)) {
              await api.deleteProject(projectId);
              router.push('/projects');
            }
          }}
        >
          Delete
        </button>
      </div>

      <div className="workspace__body">
        <section className="workspace__canvas" aria-label="Architecture">
          {channel ? <Canvas channel={channel} /> : null}
        </section>

        <section className="workspace__side">
          <div className="tabs" role="tablist">
            {(['preview', 'logs', 'code'] as const).map((name) => (
              <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>
                {name === 'preview' ? 'Preview' : name === 'logs' ? 'Logs' : file ? fileName(file.filePath) : 'Code'}
              </button>
            ))}
            {tab === 'preview' && previewUrl ? (
              <button style={{ marginLeft: 'auto' }} onClick={() => setPreviewKey((key) => key + 1)} aria-label="Reload preview">
                ↻
              </button>
            ) : null}
          </div>

          <div className="tab-panel" role="tabpanel">
            {tab === 'preview' ? (
              previewUrl ? (
                <iframe key={previewKey} className="preview-frame" src={previewUrl} title="Preview" />
              ) : (
                <div className="placeholder">
                  {statusError ??
                    (busy
                      ? 'The preview appears once the dev server answers.'
                      : status === 'running'
                        ? 'This project has no dev script to preview.'
                        : 'Start the project to see its preview.')}
                </div>
              )
            ) : null}
            {tab === 'logs' ? <LogView entries={logs} /> : null}
            {tab === 'code' ? <CodeView file={file} /> : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function LogView({ entries }: { entries: LogEntry[] }) {
  const ref = useRef<HTMLPreElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    const element = ref.current;
    if (element && pinned.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [entries]);

  return (
    <pre
      ref={ref}
      className="log"
      onScroll={(event) => {
        const element = event.currentTarget;
        pinned.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
      }}
    >
      {entries.length === 0 ? <span className="muted">No output yet.</span> : null}
      {entries.map((entry, index) => (
        <span key={index} className={entry.stream === 'system' ? 'log__system' : entry.stream === 'stderr' ? 'log__stderr' : undefined}>
          {entry.text}
        </span>
      ))}
    </pre>
  );
}

function CodeView({ file }: { file?: OpenFile }) {
  const focus = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    focus.current?.scrollIntoView({ block: 'center' });
  }, [file]);

  if (!file) {
    return <div className="placeholder">Open a component from the canvas to read its code here.</div>;
  }
  if (file.error !== undefined) {
    return <div className="placeholder error-text">{file.error}</div>;
  }
  const lines = (file.content ?? '').split('\n');
  return (
    <>
      <div className="code-head">{file.filePath}</div>
      <pre className="code">
        {lines.map((line, index) => {
          const isFocus = file.line === index + 1;
          return (
            <span
              key={index}
              ref={isFocus ? focus : undefined}
              className={`code__line${isFocus ? ' code__line--focus' : ''}`}
            >
              {line || ' '}
            </span>
          );
        })}
      </pre>
    </>
  );
}

function fileName(filePath: string): string {
  return filePath.split('/').pop() ?? filePath;
}
