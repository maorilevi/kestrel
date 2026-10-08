// Bundles the control plane (and the workspace packages it uses) into one ESM
// file. `--watch` rebuilds on change and restarts the server.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
const outfile = 'dist/main.mjs';

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  logLevel: 'warning',
  // Optional native driver pg tries to load; the pure JS client is used instead.
  external: ['pg-native'],
  // CommonJS dependencies call `require`; give the ESM bundle one.
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
};

if (!watch) {
  await esbuild.build(options);
  console.log(`[server] built ${outfile}`);
} else {
  let server;
  const restart = () => {
    server?.kill();
    const env = existsSync('.env') ? ['--env-file=.env'] : [];
    server = spawn(process.execPath, [...env, '--enable-source-maps', outfile], { stdio: 'inherit' });
  };
  const context = await esbuild.context({
    ...options,
    plugins: [
      {
        name: 'restart',
        setup(build) {
          build.onEnd((result) => {
            if (result.errors.length === 0) {
              console.log('[server] rebuilt, restarting');
              restart();
            }
          });
        },
      },
    ],
  });
  await context.watch();
  const stop = () => {
    server?.kill();
    void context.dispose().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
