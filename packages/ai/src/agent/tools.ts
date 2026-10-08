import type Anthropic from '@anthropic-ai/sdk';

/**
 * Where the agent works: a project's files and shell, wherever they live.
 * Paths are relative to the project root; implementations must refuse any
 * path that escapes it.
 */
export interface AgentWorkspace {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  /** Project files under `path` (relative), excluding dependencies and build output. */
  listFiles(path: string): Promise<string[]>;
  run(command: string, timeoutMs: number): Promise<{ exitCode: number; output: string }>;
}

type Tool = Anthropic.Beta.BetaTool;

const MAX_LISTED_FILES = 400;
const MAX_READ_LINES = 2000;
const MAX_COMMAND_OUTPUT = 20_000;

/**
 * The agent's tool surface: read, list, write, exact-string edit, and a shell
 * for builds and tests. Inputs that carry file bodies stream as generated
 * (`eager_input_streaming`), so every input is validated before it runs.
 */
export const AGENT_TOOLS: Tool[] = [
  {
    name: 'list_files',
    description:
      'List the project files under a directory (relative to the project root), skipping node_modules, build output and .git. Use it to find files before reading them.',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Directory relative to the project root; "." for the root.' } },
      required: ['path'],
    },
  },
  {
    name: 'read_file',
    description:
      'Read a text file. Lines come back numbered ("  12\\tcode") for reference only: the numbers are not part of the file, so leave them out of edit_file strings.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        offset: { type: 'integer', description: '1-based first line to return.' },
        limit: { type: 'integer', description: `Number of lines to return (at most ${MAX_READ_LINES}).` },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description: 'Create a file, or replace a file entirely. Prefer edit_file for changes to an existing file.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string' }, content: { type: 'string', description: 'The complete file content.' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Replace an exact string in a file. old_string must match the file exactly, including whitespace, and be unique unless replace_all is true. Read the file first.',
    eager_input_streaming: true,
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_string: { type: 'string' },
        new_string: { type: 'string' },
        replace_all: { type: 'boolean' },
      },
      required: ['path', 'old_string', 'new_string'],
    },
  },
  {
    name: 'run_command',
    description:
      'Run a shell command in the project root and get its exit code and output, for example a typecheck, a build or the tests. Do not start long-running servers: the dev server is already running and reloads on save.',
    input_schema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        timeout_seconds: { type: 'integer', description: 'Defaults to 120, at most 600.' },
      },
      required: ['command'],
    },
  },
];

export interface ToolOutcome {
  /** What goes back to the model. */
  content: string;
  isError: boolean;
  /** One line for people watching the run. */
  summary: string;
  /** Set when the tool changed a file. */
  changedPath?: string;
}

class ToolInputError extends Error {}

function str(input: Record<string, unknown>, key: string, optional = false): string | undefined {
  const value = input[key];
  if (value === undefined && optional) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ToolInputError(`"${key}" must be a string`);
  }
  return value;
}

function int(input: Record<string, unknown>, key: string): number | undefined {
  const value = input[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new ToolInputError(`"${key}" must be an integer`);
  }
  return value;
}

/** A one-line description of a call, shown before it runs. */
export function describeToolCall(name: string, input: unknown): string {
  const record = (input ?? {}) as Record<string, unknown>;
  const path = typeof record.path === 'string' ? record.path : '';
  switch (name) {
    case 'list_files':
      return `List ${path || '.'}`;
    case 'read_file':
      return `Read ${path}`;
    case 'write_file':
      return `Write ${path}`;
    case 'edit_file':
      return `Edit ${path}`;
    case 'run_command':
      return `Run ${typeof record.command === 'string' ? record.command : ''}`;
    default:
      return name;
  }
}

/** Validates a tool call's input and runs it against the workspace. Never throws. */
export async function runTool(workspace: AgentWorkspace, name: string, rawInput: unknown): Promise<ToolOutcome> {
  const summary = describeToolCall(name, rawInput);
  if (typeof rawInput !== 'object' || rawInput === null) {
    return invalid(rawInput, summary);
  }
  const input = rawInput as Record<string, unknown>;

  let parsed: () => Promise<ToolOutcome>;
  try {
    parsed = bind(workspace, name, input, summary);
  } catch (error) {
    if (error instanceof ToolInputError) {
      return invalid(rawInput, summary);
    }
    throw error;
  }

  try {
    return await parsed();
  } catch (error) {
    return { content: describe(error), isError: true, summary };
  }
}

/** Checks the input and returns the call to make; throws ToolInputError on a bad input. */
function bind(
  workspace: AgentWorkspace,
  name: string,
  input: Record<string, unknown>,
  summary: string,
): () => Promise<ToolOutcome> {
  switch (name) {
    case 'list_files': {
      const path = str(input, 'path') as string;
      return async () => {
        const files = await workspace.listFiles(path);
        const shown = files.slice(0, MAX_LISTED_FILES);
        const more = files.length > shown.length ? `\n… ${files.length - shown.length} more; list a subdirectory.` : '';
        return { content: shown.join('\n') + more || '(no files)', isError: false, summary };
      };
    }
    case 'read_file': {
      const path = str(input, 'path') as string;
      const offset = Math.max(1, int(input, 'offset') ?? 1);
      const limit = Math.min(MAX_READ_LINES, Math.max(1, int(input, 'limit') ?? MAX_READ_LINES));
      return async () => {
        const lines = (await workspace.readFile(path)).split('\n');
        const slice = lines.slice(offset - 1, offset - 1 + limit);
        const numbered = slice.map((line, index) => `${String(offset + index).padStart(5)}\t${line}`).join('\n');
        const rest = offset - 1 + limit < lines.length ? `\n… ${lines.length - (offset - 1 + limit)} more lines.` : '';
        return { content: numbered + rest || '(empty file)', isError: false, summary };
      };
    }
    case 'write_file': {
      const path = str(input, 'path') as string;
      const content = str(input, 'content') as string;
      return async () => {
        await workspace.writeFile(path, content);
        return { content: `Wrote ${path} (${content.split('\n').length} lines).`, isError: false, summary, changedPath: path };
      };
    }
    case 'edit_file': {
      const path = str(input, 'path') as string;
      const oldString = str(input, 'old_string') as string;
      const newString = str(input, 'new_string') as string;
      const replaceAll = input.replace_all === true;
      return async () => {
        if (oldString.length === 0) {
          return { content: 'old_string is empty; use write_file to create a file.', isError: true, summary };
        }
        const current = await workspace.readFile(path);
        const count = current.split(oldString).length - 1;
        if (count === 0) {
          return { content: `old_string was not found in ${path}. Read the file and copy the text exactly.`, isError: true, summary };
        }
        if (count > 1 && !replaceAll) {
          return {
            content: `old_string appears ${count} times in ${path}. Add surrounding lines to make it unique, or set replace_all.`,
            isError: true,
            summary,
          };
        }
        const next = replaceAll ? current.split(oldString).join(newString) : current.replace(oldString, () => newString);
        await workspace.writeFile(path, next);
        return { content: `Edited ${path} (${count} replacement${count === 1 ? '' : 's'}).`, isError: false, summary, changedPath: path };
      };
    }
    case 'run_command': {
      const command = str(input, 'command') as string;
      const seconds = Math.min(600, Math.max(1, int(input, 'timeout_seconds') ?? 120));
      return async () => {
        const result = await workspace.run(command, seconds * 1000);
        const output =
          result.output.length > MAX_COMMAND_OUTPUT
            ? `… (${result.output.length - MAX_COMMAND_OUTPUT} characters cut)\n${result.output.slice(-MAX_COMMAND_OUTPUT)}`
            : result.output;
        return {
          content: `exit code ${result.exitCode}\n${output}`,
          isError: false,
          summary: `${summary} → exit ${result.exitCode}`,
        };
      };
    }
    default:
      return async () => ({ content: `Unknown tool "${name}".`, isError: true, summary });
  }
}

/** The reply for input the model sent malformed (it streams unvalidated): ask it to retry. */
function invalid(rawInput: unknown, summary: string): ToolOutcome {
  return { content: JSON.stringify({ INVALID_JSON: JSON.stringify(rawInput) }), isError: true, summary: `${summary} (invalid input)` };
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
