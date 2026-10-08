import { describe, expect, it } from 'vitest';

import { NestJsParser } from '../src/parser/nestjs-parser';
import { TypeScriptParser } from '../src/parser/typescript-parser';
import { MULTI_MODULE_APP, SINGLE_FILE_APP, buildGraphFromSources, hasEdge, nodeByName } from '../src/testing';

function analyze(sources: Record<string, string>) {
  const parsed = new TypeScriptParser().parseSources(sources);
  return { parsed, analysis: new NestJsParser().analyze(parsed.files) };
}

describe('NestJS module detection', () => {
  it('detects @Module classes and their metadata', () => {
    const { analysis } = analyze(MULTI_MODULE_APP);

    expect(analysis.modules.map((module) => module.declaration.name).sort()).toEqual([
      'AppModule',
      'AuthModule',
      'UsersModule',
    ]);

    const authModule = analysis.modules.find((module) => module.declaration.name === 'AuthModule');
    expect(authModule?.imports).toEqual(['UsersModule']);
    expect(authModule?.controllers).toEqual(['AuthController']);
    expect(authModule?.providers).toEqual(['AuthService', 'TokenService']);
    expect(authModule?.exports).toEqual(['AuthService']);
  });

  it('produces module nodes in the graph', () => {
    const graph = buildGraphFromSources(MULTI_MODULE_APP);
    const modules = graph.nodes.filter((node) => node.type === 'module').map((node) => node.name);
    expect(modules.sort()).toEqual(['AppModule', 'AuthModule', 'UsersModule']);
    expect(graph.metadata?.stats.moduleCount).toBe(3);
  });
});

describe('controller detection', () => {
  it('detects @Controller classes and extracts the route', () => {
    const graph = buildGraphFromSources(MULTI_MODULE_APP);
    const controller = nodeByName(graph, 'AuthController');

    expect(controller.type).toBe('controller');
    expect(controller.metadata?.route).toBe('auth');
    expect(controller.filePath).toBe('src/auth/auth.controller.ts');
    expect(controller.metadata?.methods).toEqual([
      expect.objectContaining({ name: 'getProfile', decorators: ['Get'], route: 'profile' }),
    ]);
  });
});

describe('injectable service detection', () => {
  it('detects @Injectable providers as services', () => {
    const graph = buildGraphFromSources(MULTI_MODULE_APP);
    const services = graph.nodes.filter((node) => node.type === 'service').map((node) => node.name);

    expect(services.sort()).toEqual(['AuthService', 'TokenService', 'UsersService']);
    expect(nodeByName(graph, 'UsersService').metadata?.role).toBe('service');
  });

  it('keeps the finer grained role for future node types', () => {
    const graph = buildGraphFromSources({
      'src/users/users.repository.ts': `
import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersRepository {}
`,
    });

    const repository = nodeByName(graph, 'UsersRepository');
    expect(repository.type).toBe('service');
    expect(repository.metadata?.role).toBe('repository');
  });
});

describe('constructor dependency detection', () => {
  it('creates injects edges for constructor parameters', () => {
    const graph = buildGraphFromSources(MULTI_MODULE_APP);

    expect(hasEdge(graph, 'injects', 'AuthService', 'UsersService')).toBe(true);
    expect(hasEdge(graph, 'injects', 'AuthService', 'TokenService')).toBe(true);
    expect(hasEdge(graph, 'injects', 'AuthController', 'AuthService')).toBe(true);
    expect(graph.metadata?.stats.dependencyCount).toBe(3);
  });

  it('records the injected property name on the edge', () => {
    const graph = buildGraphFromSources(MULTI_MODULE_APP);
    const source = nodeByName(graph, 'AuthService');
    const target = nodeByName(graph, 'UsersService');
    const edge = graph.edges.find((candidate) => candidate.source === source.id && candidate.target === target.id);

    expect(edge?.metadata?.propertyName).toBe('usersService');
  });

  it('resolves dependencies declared in the same file', () => {
    const graph = buildGraphFromSources(SINGLE_FILE_APP);

    expect(hasEdge(graph, 'injects', 'AuthController', 'AuthService')).toBe(true);
    expect(hasEdge(graph, 'injects', 'AuthService', 'UsersService')).toBe(true);
    expect(hasEdge(graph, 'injects', 'AuthService', 'TokenService')).toBe(true);
  });
});

describe('module imports', () => {
  it('creates imports edges between modules', () => {
    const graph = buildGraphFromSources(MULTI_MODULE_APP);

    expect(hasEdge(graph, 'imports', 'AppModule', 'AuthModule')).toBe(true);
    expect(hasEdge(graph, 'imports', 'AppModule', 'UsersModule')).toBe(true);
    expect(hasEdge(graph, 'imports', 'AuthModule', 'UsersModule')).toBe(true);
  });

  it('represents dynamic modules from packages as external nodes', () => {
    const graph = buildGraphFromSources(MULTI_MODULE_APP);
    const config = nodeByName(graph, 'ConfigModule');

    expect(config.type).toBe('external');
    expect(config.metadata?.unresolved).toBe(true);
    expect(config.metadata?.packageName).toBe('@nestjs/config');
    expect(hasEdge(graph, 'imports', 'AppModule', 'ConfigModule')).toBe(true);
  });

  it('understands forwardRef imports', () => {
    const graph = buildGraphFromSources({
      'src/a/a.module.ts': `
import { Module, forwardRef } from '@nestjs/common';
import { BModule } from '../b/b.module';

@Module({ imports: [forwardRef(() => BModule)] })
export class AModule {}
`,
      'src/b/b.module.ts': `
import { Module } from '@nestjs/common';

@Module({})
export class BModule {}
`,
    });

    expect(hasEdge(graph, 'imports', 'AModule', 'BModule')).toBe(true);
    const edge = graph.edges.find((candidate) => candidate.type === 'imports');
    expect(edge?.metadata?.forwardRef).toBe(true);
  });
});

describe('module containment', () => {
  it('links a module to the controllers and providers it declares', () => {
    const graph = buildGraphFromSources(MULTI_MODULE_APP);

    expect(hasEdge(graph, 'contains', 'AuthModule', 'AuthController')).toBe(true);
    expect(hasEdge(graph, 'contains', 'AuthModule', 'AuthService')).toBe(true);
    expect(hasEdge(graph, 'contains', 'AuthModule', 'TokenService')).toBe(true);
    expect(hasEdge(graph, 'contains', 'UsersModule', 'UsersService')).toBe(true);

    expect(nodeByName(graph, 'AuthController').parentId).toBe(nodeByName(graph, 'AuthModule').id);
  });

  it('hangs root modules off the application node', () => {
    const graph = buildGraphFromSources(MULTI_MODULE_APP);
    const application = graph.nodes.find((node) => node.type === 'application');

    expect(application?.name).toBe('test-workspace');
    expect(hasEdge(graph, 'contains', 'test-workspace', 'AppModule')).toBe(true);
    // AuthModule and UsersModule are reached through imports, not duplicated at the root.
    expect(hasEdge(graph, 'contains', 'test-workspace', 'AuthModule')).toBe(false);
  });

  it('records module exports on the module node', () => {
    const graph = buildGraphFromSources(MULTI_MODULE_APP);
    const usersModule = nodeByName(graph, 'UsersModule');

    expect(usersModule.metadata?.exports).toEqual([nodeByName(graph, 'UsersService').id]);
  });
});
