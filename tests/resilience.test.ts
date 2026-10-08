import { describe, expect, it } from 'vitest';

import { NestJsParser } from '../src/architecture/parser/nestjs-parser';
import { TypeScriptParser } from '../src/architecture/parser/typescript-parser';
import { buildGraphFromSources, nodeByName } from './fixtures';

describe('parser resilience', () => {
  it('keeps analysing the repository when one file is malformed', () => {
    const graph = buildGraphFromSources({
      'src/broken/broken.ts': `
@Injectable(
export class Broken {
  constructor( {
`,
      'src/users/users.service.ts': `
import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {}
`,
    });

    expect(graph.nodes.map((node) => node.name)).toContain('UsersService');
  });

  it('handles a workspace without any TypeScript file', () => {
    const graph = buildGraphFromSources({});

    expect(graph.nodes).toHaveLength(1);
    expect(graph.nodes[0].type).toBe('application');
    expect(graph.metadata?.frameworkDetected).toBe(false);
  });

  it('handles TypeScript that is not a NestJS project', () => {
    const graph = buildGraphFromSources({
      'src/math.ts': `
export class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}
`,
    });

    expect(graph.metadata?.frameworkDetected).toBe(false);
    expect(graph.metadata?.stats.moduleCount).toBe(0);
    expect(graph.nodes.filter((node) => node.type !== 'application')).toHaveLength(0);
  });

  it('does not treat plain classes as providers', () => {
    const { files } = new TypeScriptParser().parseSources({
      'src/dto/user.dto.ts': `
export class UserDto {
  name!: string;
}
`,
    });

    expect(new NestJsParser().analyze(files).components).toHaveLength(0);
  });

  it('still builds a node for an undecorated class referenced by a module', () => {
    const graph = buildGraphFromSources({
      'src/legacy/legacy.provider.ts': `
export class LegacyProvider {}
`,
      'src/legacy/legacy.module.ts': `
import { Module } from '@nestjs/common';
import { LegacyProvider } from './legacy.provider';

@Module({ providers: [LegacyProvider] })
export class LegacyModule {}
`,
    });

    const legacy = nodeByName(graph, 'LegacyProvider');
    expect(legacy.type).toBe('class');
    expect(legacy.parentId).toBe(nodeByName(graph, 'LegacyModule').id);
  });
});
