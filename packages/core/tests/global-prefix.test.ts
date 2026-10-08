import { describe, expect, it } from 'vitest';

import { buildGraphFromSources, nodeByName } from '../src/testing';

const MANIFESTS = {
  'apps/api/package.json': JSON.stringify({ name: 'api', dependencies: { '@nestjs/core': '^12.0.0' } }),
  'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { react: '^19.0.0' } }),
};

const SOURCES = {
  'apps/api/src/main.ts': `
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  await app.listen(3000);
}
void bootstrap();
`,
  'apps/api/src/app.module.ts': `
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
@Module({ controllers: [UsersController] })
export class AppModule {}
`,
  'apps/api/src/users.controller.ts': `
import { Controller, Get } from '@nestjs/common';
@Controller('users')
export class UsersController {
  @Get()
  list() { return []; }
}
`,
  'apps/web/src/data/api.ts': `
export const api = { get: (path: string) => fetch(path).then((r) => r.json()) };
`,
  'apps/web/src/data/useUsers.ts': `
import { useEffect, useState } from 'react';
import { api } from './api';
export function useUsers() {
  const [users, setUsers] = useState([]);
  useEffect(() => { void api.get('/api/users').then(setUsers); }, []);
  return users;
}
`,
};

describe('NestJS global prefix', () => {
  const graph = buildGraphFromSources(SOURCES, 'test-workspace', MANIFESTS);
  const hook = nodeByName(graph, 'useUsers');
  const controller = nodeByName(graph, 'UsersController');
  // Look up by id: the API application is also called `api`.
  const client = graph.nodes.find((node) => node.id === 'apps/web/src/data/api.ts#api')!;

  it('records the prefix on the controllers of the application that declares it', () => {
    expect(controller.metadata?.globalPrefix).toBe('api');
    expect(controller.metadata?.route).toBe('users');
  });

  it('matches a prefixed request path to the controller', () => {
    expect(graph.edges).toContainEqual(
      expect.objectContaining({ type: 'calls', source: hook.id, target: controller.id }),
    );
  });

  it('links a member call to the API client object it is made on', () => {
    expect(graph.edges).toContainEqual(expect.objectContaining({ type: 'calls', source: hook.id, target: client.id }));
  });
});
