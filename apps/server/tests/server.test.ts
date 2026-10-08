import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import type { ChannelMessage } from '@kestrel/protocol';
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

  it('rejects unknown sources', async () => {
    const call = await signUp('builder@example.com');
    const bad = await call('/api/projects', {
      method: 'POST',
      body: JSON.stringify({ name: 'X', source: { kind: 'github', repoUrl: 'https://evil.example.com/a/b' } }),
    });
    expect(bad.status).toBe(400);
  });
});
