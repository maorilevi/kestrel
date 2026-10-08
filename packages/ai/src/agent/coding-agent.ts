import Anthropic from '@anthropic-ai/sdk';
import type { ArchitectureGraph } from '@kestrel/core/model';

import { buildChatContext } from '../chat-context';
import { AGENT_TOOLS, describeToolCall, runTool, type AgentWorkspace } from './tools';

type Message = Anthropic.Beta.BetaMessage;
type MessageParam = Anthropic.Beta.BetaMessageParam;
type StreamParams = Anthropic.Beta.Messages.MessageCreateParamsStreaming;

/** The slice of a message stream the agent uses; the SDK's stream satisfies it. */
export interface AgentStream {
  on(event: 'text', listener: (delta: string) => void): unknown;
  finalMessage(): Promise<Message>;
}

export type CreateAgentStream = (params: StreamParams, options: { signal: AbortSignal }) => AgentStream;

export type AgentEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface CodingAgentOptions {
  workspace: AgentWorkspace;
  /** Defaults to a stream from a client built with `apiKey`. */
  createStream?: CreateAgentStream;
  apiKey?: string;
  model?: string;
  effort?: AgentEffort;
  /** Upper bound on model turns in one run. */
  maxTurns?: number;
}

export interface AgentTask {
  prompt: string;
  /** The architecture as it is when the task starts. */
  graph: ArchitectureGraph;
  /** Components the user pointed at; they get the deepest detail. */
  focusNodeIds: readonly string[];
}

export interface AgentEvents {
  onText(delta: string): void;
  onToolStart(call: { id: string; name: string; summary: string }): void;
  onToolEnd(call: { id: string; name: string; summary: string; ok: boolean; detail?: string }): void;
}

export type AgentOutcome = 'done' | 'refused' | 'cancelled' | 'turn-limit';

export interface AgentResult {
  outcome: AgentOutcome;
  /** The agent's closing words: what it changed and why. */
  summary: string;
  changedFiles: string[];
  turns: number;
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number };
}

export const DEFAULT_AGENT_MODEL = 'claude-opus-5';
const MAX_TOKENS = 64_000;
const JSON_RETRIES = 2;

const SYSTEM_PROMPT = `You are the coding agent inside KESTREL, a development environment that shows a software system as an architecture graph. You work directly in the project's repository through tools; the developer watches your steps and the resulting architecture change live.

How to work:
- Explore before changing: find the relevant files with list_files and read them. The architecture brief below tells you which components exist and how they connect; use it to find where a change belongs.
- Make the change the task calls for, following the structure and conventions already in the code. A new backend capability usually means a controller, a service and module wiring, and a UI change usually goes through the existing hooks and API client, so the architecture stays coherent.
- Verify when the project gives you a way to: run its typecheck, build or tests (see package.json scripts) and fix what fails. Do not start servers; the dev server is already running and reloads on save.
- Add a dependency only when the task needs one; then update package.json and run the package manager's install.
- Stay inside the project. Never touch .git or node_modules.

When you are done, reply with a short summary for the developer: what you changed and why, naming the components involved, and anything they should check. Keep it to a few sentences.`;

/**
 * An architecture-aware coding agent: a streaming Messages API tool loop whose
 * tools act on a project workspace (a sandbox), not on this machine.
 */
export class CodingAgent {
  private readonly createStream: CreateAgentStream;
  private readonly model: string;
  private readonly effort: AgentEffort;
  private readonly maxTurns: number;

  constructor(private readonly options: CodingAgentOptions) {
    this.model = options.model ?? DEFAULT_AGENT_MODEL;
    this.effort = options.effort ?? 'xhigh';
    this.maxTurns = options.maxTurns ?? 60;
    if (options.createStream) {
      this.createStream = options.createStream;
    } else {
      const client = new Anthropic({ apiKey: options.apiKey });
      this.createStream = (params, requestOptions) => client.beta.messages.stream(params, requestOptions);
    }
  }

  async run(task: AgentTask, events: AgentEvents, signal: AbortSignal): Promise<AgentResult> {
    const context = buildChatContext(task.graph, { selectedNodeIds: task.focusNodeIds });
    const system: Anthropic.Beta.BetaTextBlockParam[] = [
      { type: 'text', text: SYSTEM_PROMPT },
      // The brief is identical for every turn of the run: cache it with the system prompt.
      { type: 'text', text: `Architecture brief:\n\n${context.brief}`, cache_control: { type: 'ephemeral' } },
    ];
    const messages: MessageParam[] = [
      { role: 'user', content: context.focus ? `${task.prompt}\n\n${context.focus}` : task.prompt },
    ];

    const changed = new Set<string>();
    const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 };
    let summary = '';
    let jsonRetries = 0;
    let turns = 0;

    const finish = (outcome: AgentOutcome): AgentResult => ({
      outcome,
      summary: summary.trim(),
      changedFiles: [...changed].sort(),
      turns,
      usage,
    });

    while (turns < this.maxTurns) {
      if (signal.aborted) {
        return finish('cancelled');
      }
      turns += 1;

      let message: Message;
      try {
        const stream = this.createStream(
          {
            model: this.model,
            max_tokens: MAX_TOKENS,
            system,
            messages,
            tools: AGENT_TOOLS,
            output_config: { effort: this.effort },
            // Caches the growing conversation, so each turn re-reads it from cache.
            cache_control: { type: 'ephemeral' },
            // A declined request is retried server-side on a fallback model.
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default',
            stream: true,
          },
          { signal },
        );
        let turnText = '';
        stream.on('text', (delta) => {
          turnText += delta;
          events.onText(delta);
        });
        message = await stream.finalMessage();
        jsonRetries = 0;
        if (turnText.trim()) {
          summary = turnText;
        }
      } catch (error) {
        if (signal.aborted || error instanceof Anthropic.APIUserAbortError) {
          return finish('cancelled');
        }
        // Only a tool input that could not be parsed at all is retried; API errors propagate.
        if (error instanceof Anthropic.APIError || jsonRetries++ >= JSON_RETRIES) {
          throw error;
        }
        turns -= 1;
        continue;
      }

      usage.inputTokens += message.usage.input_tokens;
      usage.outputTokens += message.usage.output_tokens;
      usage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;

      if (message.stop_reason === 'refusal') {
        // A refusal can cut a tool call off mid-input: never run that turn's tools.
        return finish('refused');
      }
      if (message.stop_reason === 'pause_turn') {
        messages.push({ role: 'assistant', content: message.content });
        continue;
      }

      const calls = message.content.filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === 'tool_use');
      if (calls.length === 0) {
        return finish('done');
      }
      if (message.stop_reason === 'max_tokens') {
        // A tool input truncated at max_tokens usually parses as a valid partial object.
        throw new Error('The agent ran out of output space in the middle of a tool call.');
      }

      messages.push({ role: 'assistant', content: message.content });
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        if (signal.aborted) {
          results.push({ type: 'tool_result', tool_use_id: call.id, content: 'Cancelled by the user.', is_error: true });
          continue;
        }
        events.onToolStart({ id: call.id, name: call.name, summary: describeToolCall(call.name, call.input) });
        const outcome = await runTool(this.options.workspace, call.name, call.input);
        if (outcome.changedPath) {
          changed.add(outcome.changedPath);
        }
        events.onToolEnd({
          id: call.id,
          name: call.name,
          summary: outcome.summary,
          ok: !outcome.isError,
          detail: outcome.isError ? outcome.content.slice(0, 500) : undefined,
        });
        results.push({ type: 'tool_result', tool_use_id: call.id, content: outcome.content, is_error: outcome.isError });
      }
      // Every result of the turn goes back in one message.
      messages.push({ role: 'user', content: results });
    }

    return finish('turn-limit');
  }
}
