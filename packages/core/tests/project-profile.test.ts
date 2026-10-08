import { describe, expect, it } from 'vitest';

import { MULTI_MODULE_APP, buildGraphFromSources, nodeByName, profileSources } from '../src/testing';

const NEST_PACKAGE = JSON.stringify({
  name: 'demo-api',
  dependencies: { '@nestjs/core': '^10.0.0', '@nestjs/common': '^10.0.0', typeorm: '^0.3.0', pg: '^8.11.0' },
});

const REACT_PACKAGE = JSON.stringify({
  name: 'demo-web',
  dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0', next: '^15.0.0' },
});

describe('project kind detection', () => {
  it('detects a NestJS repository as a backend API', () => {
    const [project] = profileSources(MULTI_MODULE_APP, { 'package.json': NEST_PACKAGE });

    expect(project.kind).toBe('api');
    expect(project.name).toBe('demo-api');
    expect(project.frameworks.map((framework) => framework.label)).toContain('NestJS');
    expect(project.evidence.join(' ')).toContain('@nestjs/core');
  });

  it('detects a React repository as a UI project', () => {
    const [project] = profileSources(
      {
        'src/app/page.tsx': 'export default function Page() { return null; }',
        'src/app/button.tsx': 'export function Button() { return null; }',
      },
      { 'package.json': REACT_PACKAGE },
    );

    expect(project.kind).toBe('ui');
    expect(project.frameworks.map((framework) => framework.label).sort()).toEqual(['Next.js', 'React']);
    expect(project.databases).toEqual([]);
  });

  it('detects a project that serves both an API and a UI as fullstack', () => {
    const [project] = profileSources(
      { 'src/app/page.tsx': 'export default function Page() { return null; }' },
      {
        'package.json': JSON.stringify({
          name: 'demo',
          dependencies: { next: '^15.0.0', react: '^19.0.0', express: '^4.0.0' },
        }),
      },
    );

    expect(project.kind).toBe('fullstack');
  });

  it('falls back to source signals when there is no manifest', () => {
    const [project] = profileSources(MULTI_MODULE_APP, {});

    expect(project.kind).toBe('api');
    expect(project.evidence.join(' ')).toContain('controller');
  });

  it('reports a plain TypeScript package as a library', () => {
    const [project] = profileSources(
      { 'src/math.ts': 'export const add = (a: number, b: number) => a + b;' },
      { 'package.json': JSON.stringify({ name: 'math-utils', dependencies: { tslib: '^2.0.0' } }) },
    );

    expect(project.kind).toBe('library');
  });
});

describe('monorepo profiling', () => {
  const sources = {
    'apps/api/src/users/users.controller.ts': `
import { Controller } from '@nestjs/common';

@Controller('users')
export class UsersController {}
`,
    'apps/web/src/page.tsx': 'export default function Page() { return null; }',
  };

  const manifests = {
    'package.json': JSON.stringify({ name: 'monorepo', workspaces: ['apps/*'] }),
    'apps/api/package.json': NEST_PACKAGE,
    'apps/web/package.json': REACT_PACKAGE,
  };

  it('profiles each application separately', () => {
    const projects = profileSources(sources, manifests);
    const api = projects.find((project) => project.id === 'apps/api');
    const web = projects.find((project) => project.id === 'apps/web');

    expect(api?.kind).toBe('api');
    expect(web?.kind).toBe('ui');
    expect(api?.databases.map((database) => database.label)).toEqual(['PostgreSQL']);
    expect(web?.databases).toEqual([]);
  });

  it('creates one application node per project', () => {
    const graph = buildGraphFromSources(sources, 'monorepo', manifests);
    const applications = graph.nodes.filter((node) => node.type === 'application');

    expect(applications.map((node) => node.name).sort()).toEqual(['demo-api', 'demo-web']);
    expect(nodeByName(graph, 'UsersController').metadata?.projectId).toBe('apps/api');
  });
});

/**
 * An Nx style repository: every dependency is declared once at the root and the
 * packages themselves declare little or nothing.
 */
describe('hoisted dependency monorepo', () => {
  const sources = {
    'apps/api/src/users/users.controller.ts': `
import { Controller } from '@nestjs/common';

@Controller('users')
export class UsersController {}
`,
    'apps/web/src/app.tsx': 'export function App() { return null; }',
    'apps/api-e2e/src/support/helpers.ts': 'export const wait = () => undefined;',
    'packages/sdk-node/src/client.ts': 'export class TracerClient {}',
    'tools/generate.ts': 'export const generate = () => undefined;',
  };

  const manifests = {
    'package.json': JSON.stringify({
      name: '@org/source',
      dependencies: {
        '@nestjs/core': '^10.0.0',
        '@nestjs/common': '^10.0.0',
        react: '^19.0.0',
        'react-dom': '^19.0.0',
        '@prisma/client': '^5.0.0',
      },
    }),
    'apps/api/package.json': JSON.stringify({
      name: '@org/api',
      dependencies: { '@nestjs/core': '^10.0.0', '@nestjs/common': '^10.0.0' },
    }),
    'apps/web/package.json': JSON.stringify({ name: '@org/web' }),
    'apps/api-e2e/package.json': JSON.stringify({ name: '@org/api-e2e' }),
    'packages/sdk-node/package.json': JSON.stringify({ name: '@aitracer/node' }),
    'prisma/schema.prisma': 'datasource db {\n  provider = "postgresql"\n}\n',
    'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n',
  };

  const projects = profileSources(sources, manifests);
  const byId = (id: string) => projects.find((project) => project.id === id);

  it('does not inherit the root dependencies as a fullstack verdict', () => {
    expect(projects.map((project) => project.kind)).not.toContain('fullstack');
  });

  it('keeps a package with its own backend dependencies an API', () => {
    expect(byId('apps/api')?.kind).toBe('api');
  });

  it('classifies a dependency-less package with .tsx files as a UI', () => {
    expect(byId('apps/web')?.kind).toBe('ui');
    expect(byId('apps/web')?.evidence.join(' ')).toContain('.tsx');
  });

  it('does not guess when only inherited dependencies point both ways', () => {
    expect(byId('packages/sdk-node')?.kind).toBe('library');
    expect(byId('apps/api-e2e')?.kind).toBe('library');
  });

  it('treats the workspace root as a container, not an application', () => {
    // Its dependencies belong to the packages inside it.
    expect(byId('.')?.kind).toBe('library');
    expect(byId('.')?.frameworks).toEqual([]);
    expect(byId('.')?.databases).toEqual([]);
  });

  it('only reports frameworks that fit what each package turned out to be', () => {
    expect(byId('apps/api')?.frameworks.map((framework) => framework.label).sort()).toEqual([
      'NestJS',
      'Prisma',
    ]);
    expect(byId('apps/web')?.frameworks.map((framework) => framework.label)).toEqual(['React']);
    expect(byId('packages/sdk-node')?.frameworks).toEqual([]);
  });

  it('resolves the root Prisma schema for the services that use it', () => {
    expect(byId('apps/api')?.databases).toEqual([
      expect.objectContaining({ kind: 'postgres', access: 'Prisma' }),
    ]);
  });

  it('reports one datastore per engine instead of an ORM/driver pair', () => {
    // `Database (Prisma)` + `PostgreSQL (compose)` describe one database.
    expect(byId('apps/api')?.databases).toHaveLength(1);
  });

  it('keeps shared infrastructure out of UI and library packages', () => {
    expect(byId('apps/web')?.databases).toEqual([]);
    expect(byId('packages/sdk-node')?.databases).toEqual([]);
  });
});

describe('database detection', () => {
  it('pairs an ORM with the driver that reveals the engine', () => {
    const [project] = profileSources(MULTI_MODULE_APP, { 'package.json': NEST_PACKAGE });

    expect(project.databases).toHaveLength(1);
    expect(project.databases[0]).toMatchObject({ kind: 'postgres', label: 'PostgreSQL', access: 'TypeORM' });
    expect(project.databases[0].evidence.join(' ')).toContain('package.json: pg');
  });

  it('reads the engine from TypeOrmModule.forRoot', () => {
    const [project] = profileSources(
      {
        'src/app.module.ts': `
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

@Module({
  imports: [TypeOrmModule.forRoot({ type: 'mysql', host: 'localhost' })],
})
export class AppModule {}
`,
      },
      { 'package.json': JSON.stringify({ name: 'api', dependencies: { '@nestjs/core': '^10.0.0' } }) },
    );

    expect(project.databases.map((database) => database.kind)).toContain('mysql');
    expect(project.databases[0].evidence).toContain('TypeOrmModule.forRoot()');
  });

  it('detects MongoDB through Mongoose', () => {
    const [project] = profileSources(
      {},
      {
        'package.json': JSON.stringify({
          name: 'api',
          dependencies: { '@nestjs/core': '^10.0.0', '@nestjs/mongoose': '^10.0.0', mongoose: '^8.0.0' },
        }),
      },
    );

    expect(project.databases).toEqual([
      expect.objectContaining({ kind: 'mongodb', label: 'MongoDB', access: 'Mongoose' }),
    ]);
  });

  it('reads the engine from a Prisma schema', () => {
    const [project] = profileSources(
      {},
      {
        'package.json': JSON.stringify({
          name: 'api',
          dependencies: { '@nestjs/core': '^10.0.0', '@prisma/client': '^5.0.0' },
        }),
        'prisma/schema.prisma': `
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
`,
      },
    );

    expect(project.databases).toEqual([
      expect.objectContaining({ kind: 'postgres', access: 'Prisma' }),
    ]);
  });

  it('uses docker-compose images as a last resort for backend projects', () => {
    const [project] = profileSources(
      {},
      {
        'package.json': JSON.stringify({ name: 'api', dependencies: { express: '^4.0.0' } }),
        'docker-compose.yml': `
services:
  cache:
    image: redis:7-alpine
`,
      },
    );

    expect(project.databases.map((database) => database.kind)).toEqual(['redis']);
    expect(project.databases[0].evidence[0]).toContain('docker-compose.yml');
  });

  it('reports separate entries for a primary store and a cache', () => {
    const [project] = profileSources(
      {},
      {
        'package.json': JSON.stringify({
          name: 'api',
          dependencies: { '@nestjs/core': '^10.0.0', typeorm: '^0.3.0', pg: '^8.0.0', ioredis: '^5.0.0' },
        }),
      },
    );

    expect(project.databases.map((database) => `${database.label}/${database.access}`).sort()).toEqual([
      'PostgreSQL/TypeORM',
      'Redis/Redis client',
    ]);
  });

  it('keeps a UI project free of database noise', () => {
    const [project] = profileSources(
      { 'src/page.tsx': 'export default function Page() { return null; }' },
      {
        'package.json': REACT_PACKAGE,
        'docker-compose.yml': 'services:\n  db:\n    image: postgres:16\n',
      },
    );

    expect(project.kind).toBe('ui');
    expect(project.databases).toEqual([]);
  });
});
