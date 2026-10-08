import type { AgentRunSummary, ChannelMessage } from '@kestrel/protocol';

/**
 * Agent runs as the workspace shows them: oldest first, the live run's text
 * and steps applied as they stream in, replaced by the server's record when
 * the run finishes.
 */
export function applyAgentMessage(runs: AgentRunSummary[], message: ChannelMessage): AgentRunSummary[] {
  switch (message.type) {
    case 'AGENT_HISTORY':
      return [...message.runs].reverse();
    case 'AGENT_RUN': {
      const index = runs.findIndex((run) => run.id === message.run.id);
      if (index < 0) {
        return [...runs, message.run];
      }
      const next = [...runs];
      next[index] = message.run;
      return next;
    }
    case 'AGENT_TEXT':
      return update(runs, message.runId, (run) => {
        const transcript = [...run.transcript];
        const last = transcript[transcript.length - 1];
        if (last?.kind === 'text') {
          transcript[transcript.length - 1] = { kind: 'text', text: last.text + message.text };
        } else {
          transcript.push({ kind: 'text', text: message.text });
        }
        return { ...run, transcript };
      });
    case 'AGENT_TOOL':
      return update(runs, message.runId, (run) => {
        const index = run.transcript.findIndex((entry) => entry.kind === 'tool' && entry.step.id === message.step.id);
        const transcript = [...run.transcript];
        if (index < 0) {
          transcript.push({ kind: 'tool', step: message.step });
        } else {
          transcript[index] = { kind: 'tool', step: message.step };
        }
        return { ...run, transcript };
      });
    default:
      return runs;
  }
}

function update(runs: AgentRunSummary[], id: string, change: (run: AgentRunSummary) => AgentRunSummary): AgentRunSummary[] {
  const index = runs.findIndex((run) => run.id === id);
  if (index < 0) {
    return runs;
  }
  const next = [...runs];
  next[index] = change(runs[index]);
  return next;
}

/** The run whose commit can be undone: the newest committed run, if nothing ran after it. */
export function undoableRunId(runs: readonly AgentRunSummary[]): string | undefined {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const run = runs[index];
    if (run.status === 'running') {
      return undefined;
    }
    if (run.commit) {
      return run.undone ? undefined : run.id;
    }
  }
  return undefined;
}
