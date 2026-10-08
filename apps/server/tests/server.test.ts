import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';
import type { CreateAgentStream } from '@kestrel/ai';
import type { AgentRunSummary, ChannelMessage } from '@kestrel/protocol';
import { LocalSandboxProvider } from '@kestrel/sandbox';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';

import { buildServer, type KestrelServer } from '../src/app';
import { createAuth } from '../src/auth';
import { loadConfig } from '../src/config';
import { migrate, openDatabase } from '../src/db';

const WEB_ORIGIN = 'http://localhost:3000';
const root = mkdtempSync(path.join(tmpdir(), 'kestrel-server-'));
const scannerBundlePath = path.resolve(__dirname, '../../../packages/core/dist/kestrel-scan.cjs');

/** A template with no dependencies, so the test does not reach the npm registry. */
function writeFakeTemplate(): string {
  const repoRoot = path.join(root, 'repo');
  const template = path.join(repoRoot, 'templates', 'fullstack-starter');
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'demo', scripts: { dev: 'node server.js' } }),
    'server.js':
      "require('http').createServer((q, s) => s.end('hello from the sandbox')).listen(Number(process.env.PORT));",
    'src/users.service.ts': "import { Injectable } from '@nestjs/common';\n@Injectable()\nexport class UsersService {}\n",
  };
  for (const [relativePath, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(template, relativePath)), { recursive: true });
    writeFileSync(path.join(template, relativePath), content);
  }
  return repoRoot;
}

/**
 * Stands in for the model: on the first turn it writes a new NestJS service,
 * on the second it reports what it did. Every request is recorded.
 */
const agentRequests: Array<Parameters<CreateAgentStream>[0]> = [];
const agentStream: CreateAgentStream = (params) => {
  agentRequests.push(params);
  const firstTurn = params.messages.length === 1;
  const content = firstTurn
    ? [
        { type: 'text', text: 'Adding an audit service.', citations: null },
        {
          type: 'tool_use',
          id: `toolu_${agentRequests.length}`,
          name: 'write_file',
          input: {
            path: 'src/audit.service.ts',
            content: "import { Injectable } from '@nestjs/common';\n@Injectable()\nexport class AuditService {}\n",
          },
        },
      ]
    : [{ type: 'text', text: 'Created AuditService.', citations: null }];
  const message = {
    id: 'msg',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5',
    content,
    stop_reason: firstTurn ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  } as unknown as Anthropic.Beta.BetaMessage;
  let onText: ((delta: string) => void) | undefined;
  return {
    on: (_event, listener) => {
      onText = listener;
    },
    finalMessage: async () => {
      for (const block of message.content) {
        if (block.type === 'text') {
          onText?.(block.text);
        }
      }
      return message;
    },
  };
};

let server: KestrelServer;
let baseUrl: string;

beforeAll(async () => {
  const config = {
    ...loadConfig({ NODE_ENV: 'test', BETTER_AUTH_URL: 'http://localhost:4000', WEB_ORIGIN, KESTREL_DATA_DIR: root }),
    repoRoot: writeFakeTemplate(),
  };
  const database = openDatabase(':memory:');
  await migrate(database);
  const auth = await createAuth(config, database);
  const silent = { info: () => undefined, warn: () => undefined, error: () => undefined };

  server = await buildServer({
    config,
    database,
    auth,
    provider: new LocalSandboxProvider(path.join(root, 'sandboxes')),
    scannerBundlePath,
    logger: silent,
    devServerTimeoutMs: 30_000,
    agentStream,
  });
  await server.app.listen({ port: 0, host: '127.0.0.1' });
  const address = server.app.server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});

afterAll(async () => {
  await server?.app.close();
  rmSync(root, { recursive: true, force: true });
});

/** A signed-in user with an active organization, as the web app sets it up. */
async function signUp(email: string): Promise<(url: string, init?: RequestInit) => Promise<Response>> {
  let cookie = '';
  const call = async (url: string, init: RequestInit = {}): Promise<Response> => {
    const response = await fetch(`${baseUrl}${url}`, {
      ...init,
      headers: { 'content-type': 'application/json', origin: WEB_ORIGIN, cookie, ...init.headers },
    });
    const set = response.headers.getSetCookie();
    if (set.length > 0) {
      cookie = set.map((value) => value.split(';')[0]).join('; ');
    }
    return response;
  };

  const signUpResponse = await call('/api/auth/sign-up/email', {
    method: 'POST',
    body: JSON.stringify({ email, password: 'correct horse battery', name: email.split('@')[0] }),
  });
  expect(signUpResponse.status).toBe(200);

  const slug = email.replace(/[^a-z0-9]/g, '-');
  const organization = await call('/api/auth/organization/create', {
    method: 'POST',
    body: JSON.stringify({ name: `${slug} workspace`, slug }),
  });
  expect(organization.status).toBe(200);
  const { id } = (await organization.json()) as { id: string };
  const active = await call('/api/auth/organization/set-active', {
    method: 'POST',
    body: JSON.stringify({ organizationId: id }),
  });
  expect(active.status).toBe(200);
  return call;
}

function openChannel(ticket: string) {
  const socket = new WebSocket(`${baseUrl.replace('http', 'ws')}/ws/projects?ticket=${ticket}`);
  const messages: ChannelMessage[] = [];
  let closedWith = '';
  socket.on('close', (code, reason) => (closedWith = ` (closed ${code} ${String(reason)})`));
  const waiters: Array<{ test: (message: ChannelMessage) => boolean; resolve: (message: ChannelMessage) => void }> = [];
  socket.on('message', (data) => {
    const message = JSON.parse(String(data)) as ChannelMessage;
    messages.push(message);
    for (const waiter of [...waiters]) {
      if (waiter.test(message)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message);
      }
    }
  });
  const waitFor = (test: (message: ChannelMessage) => boolean, timeoutMs = 60_000): Promise<ChannelMessage> => {
    const seen = messages.find(test);
    if (seen) {
      return Promise.resolve(seen);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`Timed out. Got: ${messages.map((message) => message.type).join(', ')}${closedWith}`)),
        timeoutMs,
      );
      waiters.push({ test, resolve: (message) => (clearTimeout(timer), resolve(message)) });
    });
  };
  const opened = new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return { socket, messages, waitFor, opened };
}

describe('control plane', () => {
  it('refuses project APIs without a session', async () => {
    const response = await fetch(`${baseUrl}/api/projects`);
    expect(response.status).toBe(401);
  });

  it('creates a project from a template, previews it and streams its architecture', async () => {
    const call = await signUp('founder@example.com');

    const created = await call('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'Demo', source: { kind: 'template', template: 'fullstack-starter' } }),
    });
    expect(created.status).toBe(201);
    const { project } = (await created.json()) as { project: { id: string } };

    const listed = (await (await call('/api/projects')).json()) as { projects: Array<{ id: string }> };
    expect(listed.projects.map((item) => item.id)).toEqual([project.id]);

    const { ticket } = (await (await call(`/api/projects/${project.id}/channel`, { method: 'POST' })).json()) as {
      ticket: string;
    };
    const channel = openChannel(ticket);
    await channel.opened;

    const ready = await channel.waitFor((message) => message.type === 'PROJECT_STATE' && message.status === 'ready');
    const previewUrl = ready.type === 'PROJECT_STATE' ? ready.previewUrl : undefined;
    expect(previewUrl).toMatch(/^http:\/\/localhost:\d+$/);
    expect(await (await fetch(previewUrl as string)).text()).toBe('hello from the sandbox');

    const architecture = await channel.waitFor((message) => message.type === 'ARCHITECTURE_UPDATED');
    if (architecture.type === 'ARCHITECTURE_UPDATED') {
      expect(architecture.payload.nodes.map((node) => node.name)).toContain('UsersService');
    }

    channel.socket.send(JSON.stringify({ type: 'OPEN_FILE', filePath: 'src/users.service.ts', line: 3 }));
    const file = await channel.waitFor((message) => message.type === 'FILE_CONTENT');
    expect(file).toMatchObject({ type: 'FILE_CONTENT', filePath: 'src/users.service.ts', line: 3 });

    channel.socket.send(JSON.stringify({ type: 'OPEN_FILE', filePath: '../../etc/passwd' }));
    await channel.waitFor((message) => message.type === 'FILE_ERROR');

    // A second channel ticket is single use.
    const reused = openChannel(ticket);
    const closed = await new Promise<number>((resolve) => reused.socket.once('close', (code) => resolve(code)));
    expect(closed).toBe(4401);

    // Another organization cannot see the project.
    const stranger = await signUp('stranger@example.com');
    expect((await stranger(`/api/projects/${project.id}`)).status).toBe(404);
    expect((await stranger(`/api/projects/${project.id}/channel`, { method: 'POST' })).status).toBe(404);

    channel.socket.close();
    expect((await call(`/api/projects/${project.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/api/projects/${project.id}`)).status).toBe(404);
  }, 120_000);

  it('runs the agent in the sandbox, commits its work, diffs the architecture and undoes it', async () => {
    const call = await signUp('agent-user@example.com');
    const { project } = (await (
      await call('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ name: 'Agent demo', source: { kind: 'template', template: 'fullstack-starter' } }),
      })
    ).json()) as { project: { id: string } };
    const { ticket } = (await (await call(`/api/projects/${project.id}/channel`, { method: 'POST' })).json()) as { ticket: string };
    const channel = openChannel(ticket);
    await channel.opened;
    await channel.waitFor((message) => message.type === 'PROJECT_STATE' && message.status === 'ready');
    await channel.waitFor((message) => message.type === 'ARCHITECTURE_UPDATED');
    await channel.waitFor((message) => message.type === 'AGENT_HISTORY');

    // The canvas sends components to the agent; the workspace gets them back as context.
    channel.socket.send(JSON.stringify({ type: 'ASK_AGENT', nodeIds: ['src/users.service.ts#UsersService'] }));
    expect(await channel.waitFor((message) => message.type === 'AGENT_CONTEXT')).toMatchObject({
      nodeIds: ['src/users.service.ts#UsersService'],
    });

    channel.socket.send(
      JSON.stringify({ type: 'AGENT_START', prompt: 'Add an audit service', nodeIds: ['src/users.service.ts#UsersService'] }),
    );
    const finished = (await channel.waitFor(
      (message) => message.type === 'AGENT_RUN' && message.run.status !== 'running',
    )) as { type: 'AGENT_RUN'; run: AgentRunSummary };
    const run = finished.run;

    expect(run).toMatchObject({ status: 'done', summary: 'Created AuditService.', changedFiles: ['src/audit.service.ts'], startedBy: 'agent-user' });
    expect(run.commit).toMatch(/^[0-9a-f]{7,}$/);
    expect(run.architecture?.addedNodes.map((node) => node.name)).toEqual(['AuditService']);
    expect(run.transcript.some((entry) => entry.kind === 'tool' && entry.step.summary === 'Write src/audit.service.ts' && entry.step.status === 'ok')).toBe(true);
    const diff = await channel.waitFor((message) => message.type === 'ARCHITECTURE_DIFF' && message.payload !== null);
    expect(diff).toMatchObject({ payload: { addedNodes: [expect.objectContaining({ name: 'AuditService' })] } });

    // The agent saw the architecture and the focused component.
    const system = agentRequests[0].system as Anthropic.Beta.BetaTextBlockParam[];
    expect(system[1].text).toContain('UsersService');
    expect(agentRequests[0].model).toBe('claude-opus-5');

    channel.socket.send(JSON.stringify({ type: 'OPEN_FILE', filePath: 'src/audit.service.ts' }));
    await channel.waitFor((message) => message.type === 'FILE_CONTENT' && message.filePath === 'src/audit.service.ts');

    // A second start while nothing runs is fine, but an empty prompt is refused.
    channel.socket.send(JSON.stringify({ type: 'AGENT_START', prompt: '   ', nodeIds: [] }));
    expect(await channel.waitFor((message) => message.type === 'AGENT_ERROR')).toMatchObject({ message: 'Tell the agent what to do.' });

    channel.socket.send(JSON.stringify({ type: 'AGENT_UNDO', runId: run.id }));
    await channel.waitFor((message) => message.type === 'AGENT_RUN' && message.run.id === run.id && message.run.undone === true);
    await channel.waitFor((message) => message.type === 'ARCHITECTURE_DIFF' && message.payload === null);
    channel.socket.send(JSON.stringify({ type: 'OPEN_FILE', filePath: 'src/audit.service.ts' }));
    await channel.waitFor((message) => message.type === 'FILE_ERROR' && message.filePath === 'src/audit.service.ts');

    // History survives a reconnect.
    const again = openChannel(
      ((await (await call(`/api/projects/${project.id}/channel`, { method: 'POST' })).json()) as { ticket: string }).ticket,
    );
    const history = await again.waitFor((message) => message.type === 'AGENT_HISTORY');
    expect(history).toMatchObject({ runs: [expect.objectContaining({ id: run.id, undone: true })] });

    channel.socket.close();
    again.socket.close();
    await call(`/api/projects/${project.id}`, { method: 'DELETE' });
  }, 120_000);

  it('rejects unknown sources', async () => {
    const call = await signUp('builder@example.com');
    const bad = await call('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'X', source: { kind: 'github', repoUrl: 'https://evil.example.com/a/b' } }),
    });
    expect(bad.status).toBe(400);
  });
});
