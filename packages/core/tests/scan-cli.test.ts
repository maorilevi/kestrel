import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import { parseScanArgs, runScanCli, type ScanEvent } from '../src/cli/scan';
import { MULTI_MODULE_APP } from '../src/testing';

let root: string | undefined;

afterEach(() => {
  if (root) {
    rmSync(root, { recursive: true, force: true });
    root = undefined;
  }
});

describe('scan cli', () => {
  it('parses flags in any order', () => {
    expect(parseScanArgs(['--watch', '/repo', '--name', 'demo', '--exclude', '**/gen/**'])).toEqual({
      root: '/repo',
      name: 'demo',
      watch: true,
      excludes: ['**/gen/**'],
      debounceMs: 500,
    });
    expect(() => parseScanArgs([])).toThrow(/Usage/);
  });

  it('emits scanning then a graph', async () => {
    root = mkdtempSync(path.join(tmpdir(), 'kestrel-cli-'));
    for (const [relativePath, content] of Object.entries(MULTI_MODULE_APP)) {
      mkdirSync(path.dirname(path.join(root, relativePath)), { recursive: true });
      writeFileSync(path.join(root, relativePath), content);
    }

    const events: ScanEvent[] = [];
    const graph = await new Promise<ScanEvent>((resolve) => {
      runScanCli({ root: root as string, watch: false, excludes: [], debounceMs: 0 }, (event) => {
        events.push(event);
        if (event.type === 'graph' || event.type === 'error') {
          resolve(event);
        }
      });
    });

    expect(events[0]).toEqual({ type: 'scanning' });
    expect(graph.type).toBe('graph');
    if (graph.type === 'graph') {
      expect(graph.graph.nodes.map((node) => node.name)).toContain('UsersService');
    }
  });
});
