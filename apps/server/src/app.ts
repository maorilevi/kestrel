import websocket from '@fastify/websocket';
import type { Logger } from '@kestrel/core';
import type { ProjectSource } from '@kestrel/protocol';
import type { SandboxProvider } from '@kestrel/sandbox';
import { fromNodeHeaders } from 'better-auth/node';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

import { isMember, readSession, type Auth, type SessionInfo } from './auth';
import { attachChannel, ChannelTickets } from './channel';
import type { ServerConfig } from './config';
import type { DatabaseHandle } from './db';
import { RuntimeManager } from './projects/manager';
import { ProjectStore, toSummary, type ProjectRecord } from './projects/store';
import { isKnownTemplate, parseGitHubUrl, TEMPLATES } from './projects/templates';

export interface AppDependencies {
  config: ServerConfig;
  database: DatabaseHandle;
  auth: Auth;
  provider: SandboxProvider;
  scannerBundlePath: string;
  logger: Logger;
  /** Overrides for tests. */
  devServerTimeoutMs?: number;
}

export interface KestrelServer {
  app: FastifyInstance;
  runtimes: RuntimeManager;
  store: ProjectStore;
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export async function buildServer(deps: AppDependencies): Promise<KestrelServer> {
  const { config, auth, logger } = deps;
  const app = Fastify({ logger: false, bodyLimit: 1024 * 1024 });
  const store = new ProjectStore(deps.database);
  const runtimes = new RuntimeManager({
    store,
    provider: deps.provider,
    repoRoot: config.repoRoot,
    scannerBundlePath: deps.scannerBundlePath,
    logger,
    devServerTimeoutMs: deps.devServerTimeoutMs,
  });
  const tickets = new ChannelTickets();

  await app.register(websocket);

  // Action endpoints (start, stop, channel) take no body; browsers still send the JSON content type.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (_request, body, done) => {
    const text = String(body);
    if (text.trim().length === 0) {
      done(null, undefined);
      return;
    }
    try {
      done(null, JSON.parse(text));
    } catch {
      done(new HttpError(400, 'The request body is not valid JSON.'), undefined);
    }
  });

  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    const statusCode = error instanceof HttpError ? error.statusCode : (error.statusCode ?? 500);
    if (statusCode >= 500) {
      logger.error('Request failed', error);
    }
    void reply.status(statusCode).send({ error: statusCode >= 500 ? 'Internal error' : error.message });
  });

  // Better Auth owns everything under /api/auth: sign-up, sign-in, sessions, organizations.
  app.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    handler: async (request, reply) => {
      const url = new URL(request.url, config.authUrl);
      const response = await auth.handler(
        new Request(url, {
          method: request.method,
          headers: fromNodeHeaders(request.headers),
          body: request.method === 'GET' || request.body === undefined ? undefined : JSON.stringify(request.body),
        }),
      );
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        if (key !== 'set-cookie') {
          void reply.header(key, value);
        }
      });
      const cookies = response.headers.getSetCookie();
      if (cookies.length > 0) {
        void reply.header('set-cookie', cookies);
      }
      return reply.send(response.body ? await response.text() : null);
    },
  });

  const requireSession = async (request: FastifyRequest): Promise<SessionInfo> => {
    const session = await readSession(auth, fromNodeHeaders(request.headers));
    if (!session) {
      throw new HttpError(401, 'Sign in first.');
    }
    return session;
  };

  const requireOrganization = async (request: FastifyRequest): Promise<SessionInfo & { activeOrganizationId: string }> => {
    const session = await requireSession(request);
    if (!session.activeOrganizationId) {
      throw new HttpError(409, 'Choose an organization first.');
    }
    return session as SessionInfo & { activeOrganizationId: string };
  };

  /** Loads a project the signed-in user may access; anything else is a 404. */
  const requireProject = async (request: FastifyRequest, id: string): Promise<{ session: SessionInfo; record: ProjectRecord }> => {
    const session = await requireSession(request);
    const record = await store.get(id);
    if (!record || !(await isMember(deps.database, session.userId, record.organizationId))) {
      throw new HttpError(404, 'Project not found.');
    }
    return { session, record };
  };

  const summarize = (record: ProjectRecord) => {
    const live = runtimes.peek(record.id)?.getStatus();
    return toSummary(live ? { ...record, status: live.status, previewUrl: live.previewUrl } : record);
  };

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/templates', async () => ({ templates: TEMPLATES }));

  app.get('/api/projects', async (request) => {
    const session = await requireOrganization(request);
    const records = await store.listForOrganization(session.activeOrganizationId);
    return { projects: records.map(summarize) };
  });

  app.post('/api/projects', async (request, reply) => {
    const session = await requireOrganization(request);
    const body = (request.body ?? {}) as { name?: unknown; source?: { kind?: unknown; template?: unknown; repoUrl?: unknown } };

    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (name.length === 0 || name.length > 80) {
      throw new HttpError(400, 'A project needs a name of up to 80 characters.');
    }

    let source: ProjectSource;
    if (body.source?.kind === 'template' && typeof body.source.template === 'string' && isKnownTemplate(body.source.template)) {
      source = { kind: 'template', template: body.source.template };
    } else if (body.source?.kind === 'github' && typeof body.source.repoUrl === 'string') {
      const github = parseGitHubUrl(body.source.repoUrl);
      if (!github) {
        throw new HttpError(400, 'Use a public repository URL like https://github.com/owner/repo.');
      }
      source = { kind: 'github', repoUrl: `https://github.com/${github.owner}/${github.repo}` };
    } else {
      throw new HttpError(400, 'Choose a template or a GitHub repository.');
    }

    const record = await store.create({
      organizationId: session.activeOrganizationId,
      name,
      source,
      createdBy: session.userId,
    });
    // Provisioning takes minutes; the client follows it on the project channel.
    void runtimes.get(record).start();
    return reply.status(201).send({ project: summarize(record) });
  });

  app.get<{ Params: { id: string } }>('/api/projects/:id', async (request) => {
    const { record } = await requireProject(request, request.params.id);
    return { project: summarize(record) };
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/start', async (request) => {
    const { record } = await requireProject(request, request.params.id);
    void runtimes.get(record).start();
    return { project: summarize(record) };
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/stop', async (request) => {
    const { record } = await requireProject(request, request.params.id);
    await runtimes.get(record).stop();
    return { project: summarize(record) };
  });

  app.delete<{ Params: { id: string } }>('/api/projects/:id', async (request, reply) => {
    const { record } = await requireProject(request, request.params.id);
    await runtimes.destroy(record);
    await store.delete(record.id);
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string } }>('/api/projects/:id/channel', async (request) => {
    const { session, record } = await requireProject(request, request.params.id);
    return { ticket: tickets.issue(session.userId, record.id) };
  });

  app.get<{ Querystring: { ticket?: string } }>('/ws/projects', { websocket: true }, async (socket, request) => {
    const grant = request.query.ticket ? tickets.redeem(request.query.ticket) : undefined;
    const record = grant ? await store.get(grant.projectId) : undefined;
    if (!grant || !record || !(await isMember(deps.database, grant.userId, record.organizationId))) {
      socket.close(4401, 'Invalid or expired ticket');
      return;
    }
    attachChannel(socket, runtimes.get(record), config, logger);
  });

  app.addHook('onClose', async () => {
    await runtimes.shutdown();
  });

  return { app, runtimes, store };
}

