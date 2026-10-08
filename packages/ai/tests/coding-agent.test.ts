import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { CodingAgent, type AgentEvents, type AgentWorkspace, type CreateAgentStream } from '../src';
import { MULTI_MODULE_APP, buildGraphFromSources, nodeByName } from '@kestrel/core/testing';

type Block = Anthropic.Beta.BetaContentBlock;

function message(content: Block[], stopReason: Anthropic.Beta.BetaStopReason): Anthropic.Beta.BetaMessage {
  return {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content,
    stop_reason: stopReason,
    stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 80 },
  } as unknown as Anthropic.Beta.BetaMessage;
}

const text = (value: string): Block => ({ type: 'text', text: value, citations: null }) as Block;
const toolUse = (id: string, name: string, input: unknown): Block => ({ type: 'tool_use', id, name, input }) as Block;

/** Replays scripted model turns and records every request. */
function scripted(turns: Anthropic.Beta.BetaMessage[]) {
  const requests: Array<Parameters<CreateAgentStream>[0]> = [];
  const createStream: CreateAgentStream = (params) => {
    // Snapshot: the agent keeps appending to the same array.
    requests.push({ ...params, messages: [...params.messages] });
    const next = turns.shift();
    if (!next) {
      throw new Error('The script ran out of turns.');
    }
    let listener: ((delta: string) => void) | undefined;
    return {
      on: (_event, callback) => {
        listener = callback;
      },
      finalMessage: async () => {
        for (const block of next.content) {
          if (block.type === 'text') {
            listener?.(block.text);
          }
        }
        return next;
      },
    };
  };
  return { createStream, requests };
}

function memoryWorkspace(files: Record<string, string>): AgentWorkspace & { files: Record<string, string> } {
  return {
    files,
    readFile: async (path) => {
      if (!(path in files)) {
        throw new Error(`No such file: ${path}`);
      }
      return files[path];
    },
    writeFile: async (path, content) => {
      files[path] = content;
    },
    listFiles: async (path) => Object.keys(files).filter((file) => path === '.' || file.startsWith(`${path}/`)),
    run: async (command) => ({ exitCode: command.includes('fail') ? 1 : 0, output: `ran ${command}` }),
  };
}

function recorder(): AgentEvents & { log: string[] } {
  const log: string[] = [];
  return {
    log,
    onText: (delta) => log.push(`text:${delta}`),
    onToolStart: (call) => log.push(`start:${call.summary}`),
    onToolEnd: (call) => log.push(`end:${call.ok ? 'ok' : 'error'}:${call.summary}`),
  };
}

const graph = buildGraphFromSources(MULTI_MODULE_APP);

describe('coding agent', () => {
  it('explores, edits, verifies and summarises', async () => {
    const workspace = memoryWorkspace({ 'src/users/users.service.ts': 'export class UsersService {\n  list() { return []; }\n}\n' });
    const { createStream, requests } = scripted([
      message([text('Looking around.'), toolUse('t1', 'list_files', { path: 'src' })], 'tool_use'),
      message(
        [
          toolUse('t2', 'read_file', { path: 'src/users/users.service.ts' }),
          toolUse('t3', 'edit_file', {
            path: 'src/users/users.service.ts',
            old_string: 'list() { return []; }',
            new_string: 'list() { return []; }\n  count() { return 0; }',
          }),
        ],
        'tool_use',
      ),
      // Streamed input can arrive malformed: missing "content".
      message([toolUse('t4', 'write_file', { path: 'src/new.ts' })], 'tool_use'),
      message([toolUse('t5', 'run_command', { command: 'npm run typecheck' })], 'tool_use'),
      message([text('Added UsersService.count().')], 'end_turn'),
    ]);
    const events = recorder();
    const agent = new CodingAgent({ workspace, createStream });

    const result = await agent.run(
      { prompt: 'Add a count method', graph, focusNodeIds: [nodeByName(graph, 'UsersService').id] },
      events,
      new AbortController().signal,
    );

    expect(result).toMatchObject({ outcome: 'done', summary: 'Added UsersService.count().', changedFiles: ['src/users/users.service.ts'], turns: 5 });
    expect(result.usage).toEqual({ inputTokens: 500, outputTokens: 100, cacheReadTokens: 400 });
    expect(workspace.files['src/users/users.service.ts']).toContain('count() { return 0; }');
    expect(workspace.files['src/new.ts']).toBeUndefined();
    expect(events.log).toContain('end:error:Write src/new.ts (invalid input)');
    expect(events.log).toContain('end:ok:Run npm run typecheck → exit 0');

    const first = requests[0];
    expect(first.model).toBe('claude-opus-5');
    expect(first.fallbacks).toBe('default');
    expect(first.betas).toContain('server-side-fallback-2026-07-01');
    expect(first.output_config).toEqual({ effort: 'xhigh' });
    const tools = (first.tools ?? []) as Anthropic.Beta.BetaTool[];
    expect(tools.filter((tool) => tool.eager_input_streaming).map((tool) => tool.name)).toEqual(['write_file', 'edit_file']);
    // The architecture brief rides in the cached system prompt; the focus in the task.
    const system = first.system as Anthropic.Beta.BetaTextBlockParam[];
    expect(system[1].text).toContain('UsersModule');
    expect(system[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(String(first.messages[0].content)).toContain('Add a count method');
    expect(String(first.messages[0].content)).toContain('UsersService');

    // Both results of a parallel turn go back in a single user message.
    const third = requests[2].messages;
    const results = third[third.length - 1].content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results.map((block) => block.tool_use_id)).toEqual(['t2', 't3']);
    // The malformed call is answered with an INVALID_JSON error.
    const fourth = requests[3].messages;
    const invalid = (fourth[fourth.length - 1].content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
    expect(invalid).toMatchObject({ tool_use_id: 't4', is_error: true });
    expect(String(invalid.content)).toContain('INVALID_JSON');
  });

  it('reports edit mistakes back to the model instead of failing', async () => {
    const workspace = memoryWorkspace({ 'a.ts': 'x\nx\n' });
    const { createStream, requests } = scripted([
      message([toolUse('t1', 'edit_file', { path: 'a.ts', old_string: 'x', new_string: 'y' })], 'tool_use'),
      message([toolUse('t2', 'edit_file', { path: 'a.ts', old_string: 'zzz', new_string: 'y' })], 'tool_use'),
      message([text('Gave up.')], 'end_turn'),
    ]);
    await new CodingAgent({ workspace, createStream }).run({ prompt: 'p', graph, focusNodeIds: [] }, recorder(), new AbortController().signal);

    const answer = (index: number) => {
      const history = requests[index].messages;
      return String((history[history.length - 1].content as Anthropic.Beta.BetaToolResultBlockParam[])[0].content);
    };
    expect(answer(1)).toContain('appears 2 times');
    expect(answer(2)).toContain('was not found');
    expect(workspace.files['a.ts']).toBe('x\nx\n');
  });

  it('never runs the tools of a refused turn', async () => {
    const workspace = memoryWorkspace({ 'a.ts': 'x' });
    const { createStream } = scripted([message([toolUse('t1', 'write_file', { path: 'a.ts', content: 'y' })], 'refusal')]);
    const result = await new CodingAgent({ workspace, createStream }).run(
      { prompt: 'p', graph, focusNodeIds: [] },
      recorder(),
      new AbortController().signal,
    );
    expect(result.outcome).toBe('refused');
    expect(workspace.files['a.ts']).toBe('x');
  });

  it('stops when cancelled', async () => {
    const controller = new AbortController();
    const workspace = memoryWorkspace({});
    const { createStream } = scripted([message([toolUse('t1', 'list_files', { path: '.' })], 'tool_use')]);
    const events = recorder();
    events.onToolStart = () => controller.abort();
    const result = await new CodingAgent({ workspace, createStream }).run({ prompt: 'p', graph, focusNodeIds: [] }, events, controller.signal);
    expect(result.outcome).toBe('cancelled');
  });
});
