import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { ArchitectureService, FsRepositoryScanner } from '../src';
import { MULTI_MODULE_APP } from '../src/testing';

const roots: string[] = [];

function writeRepository(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'kestrel-scan-'));
  roots.push(root);
  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(root, relativePath);
    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  }
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('file system scanner', () => {
  it('collects sources and manifests and skips excluded paths', async () => {
    const root = writeRepository({
      'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0' } }),
      'src/app.module.ts': 'export class AppModule {}',
      'src/app.service.spec.ts': 'test',
      'src/types.d.ts': 'declare const x: number;',
      'node_modules/lib/index.ts': 'export {}',
      'dist/main.ts': 'export {}',
      'src/generated/client.ts': 'export {}',
    });

    const result = await new FsRepositoryScanner(
      { path: root, name: 'demo' },
      { extraExcludes: ['**/generated/**'] },
    ).scan();

    expect(result.workspaceName).toBe('demo');
    expect(result.files.map((file) => file.relativePath)).toEqual(['src/app.module.ts']);
    expect(result.manifests.map((manifest) => manifest.relativePath)).toEqual(['package.json']);
    expect(result.files[0].absolutePath).toBe(path.join(root, 'src/app.module.ts'));
    expect(result.truncated).toBe(false);
  });

  it('reports truncation past the file limit', async () => {
    const root = writeRepository({ 'a.ts': '', 'b.ts': '', 'c.ts': '' });

    const result = await new FsRepositoryScanner(root, { maxFiles: 2 }).scan();

    expect(result.files).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('drives the full engine without an editor', async () => {
    const root = writeRepository({
      ...MULTI_MODULE_APP,
      'package.json': JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0' } }),
    });

    const graph = await new ArchitectureService(new FsRepositoryScanner(root)).build();

    const names = graph.nodes.map((node) => node.name);
    expect(names).toContain('UsersModule');
    expect(names).toContain('UsersService');
    expect(graph.edges.some((edge) => edge.type === 'injects')).toBe(true);
  });
});
