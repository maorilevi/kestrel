import type { AgentRunSummary } from '@kestrel/protocol';
import { describe, expect, it } from 'vitest';

import { applyAgentMessage, undoableRunId } from '../lib/agent-runs';

function run(id: string, patch: Partial<AgentRunSummary> = {}): AgentRunSummary {
  return {
    id,
    prompt: `task ${id}`,
    nodeIds: [],
    status: 'done',
    startedBy: 'Maya',
    startedAt: '2026-10-08T10:00:00.000Z',
    changedFiles: [],
    transcript: [],
    ...patch,
  };
}

describe('agent runs in the workspace', () => {
  it('shows history oldest first and streams a live run', () => {
    let runs = applyAgentMessage([], { type: 'AGENT_HISTORY', runs: [run('b'), run('a')] });
    expect(runs.map((item) => item.id)).toEqual(['a', 'b']);

    runs = applyAgentMessage(runs, { type: 'AGENT_RUN', run: run('c', { status: 'running' }) });
    runs = applyAgentMessage(runs, { type: 'AGENT_TEXT', runId: 'c', text: 'Look' });
    runs = applyAgentMessage(runs, { type: 'AGENT_TEXT', runId: 'c', text: 'ing.' });
    runs = applyAgentMessage(runs, {
      type: 'AGENT_TOOL',
      runId: 'c',
      step: { id: 't1', name: 'read_file', summary: 'Read a.ts', status: 'running' },
    });
    runs = applyAgentMessage(runs, {
      type: 'AGENT_TOOL',
      runId: 'c',
      step: { id: 't1', name: 'read_file', summary: 'Read a.ts', status: 'ok' },
    });
    runs = applyAgentMessage(runs, { type: 'AGENT_TEXT', runId: 'c', text: 'Done.' });

    expect(runs[2].transcript).toEqual([
      { kind: 'text', text: 'Looking.' },
      { kind: 'tool', step: { id: 't1', name: 'read_file', summary: 'Read a.ts', status: 'ok' } },
      { kind: 'text', text: 'Done.' },
    ]);

    runs = applyAgentMessage(runs, { type: 'AGENT_RUN', run: run('c', { status: 'done', commit: 'abc1234' }) });
    expect(runs).toHaveLength(3);
    expect(runs[2].commit).toBe('abc1234');
  });

  it('offers undo only for the newest committed run', () => {
    expect(undoableRunId([run('a', { commit: '1' }), run('b')])).toBe('a');
    expect(undoableRunId([run('a', { commit: '1' }), run('b', { commit: '2' })])).toBe('b');
    expect(undoableRunId([run('a', { commit: '1' }), run('b', { commit: '2', undone: true })])).toBeUndefined();
    expect(undoableRunId([run('a', { commit: '1' }), run('b', { status: 'running' })])).toBeUndefined();
    expect(undoableRunId([])).toBeUndefined();
  });
});
