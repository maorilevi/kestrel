import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';

import { LocalSandboxProvider, resolveInside } from '../src';

const root = mkdtempSync(path.join(tmpdir(), 'kestrel-sandbox-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('resolveInside', () => {
  it('keeps paths inside the project', () => {
    expect(resolveInside('/w', 'a/./b/../c.ts')).toBe('/w/a/c.ts');
    expect(() => resolveInside('/w', '../etc/passwd')).toThrow(/escapes/);
    expect(() => resolveInside('/w', 'a/../../x')).toThrow(/escapes/);
  });
});

describe('local sandbox', () => {
  const provider = new LocalSandboxProvider(root);

  it('writes, reads and runs inside the workdir', async () => {
    const sandbox = await provider.create();
    await sandbox.writeFiles([{ path: 'src/hello.txt', content: 'hi' }]);

    expect(await sandbox.readFile('src/hello.txt')).toBe('hi');
    const result = await sandbox.run('node -e "process.stdout.write(require(\'fs\').readFileSync(\'src/hello.txt\',\'utf8\'))"');
    expect(result).toMatchObject({ exitCode: 0, stdout: 'hi' });
    expect((await sandbox.run('node -e "process.exit(3)"')).exitCode).toBe(3);

    expect(await provider.connect(sandbox.id)).toBeDefined();
    await sandbox.destroy();
    expect(await provider.connect(sandbox.id)).toBeUndefined();
  });

  it('streams a long-running process and passes stdin', async () => {
    const sandbox = await provider.create();
    let output = '';
    const child = await sandbox.spawn(
      'node -e "process.stdin.on(\'data\', (d) => { process.stdout.write(\'got:\' + d); process.exit(0); })"',
      { onStdout: (chunk) => (output += chunk) },
    );
    await child.write('ping\n');
    expect(await child.exited).toBe(0);
    expect(output).toContain('got:ping');
    expect(await sandbox.allocatePort()).toBeGreaterThan(0);
    await sandbox.destroy();
  });
});
