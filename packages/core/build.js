/* eslint-disable no-console */
// Bundles the headless scanner into one file a sandbox can run with plain `node`.
const esbuild = require('esbuild');

esbuild
  .build({
    entryPoints: ['src/cli/scan.ts'],
    bundle: true,
    outfile: 'dist/kestrel-scan.cjs',
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    minify: true,
    legalComments: 'none',
    logLevel: 'warning',
  })
  .then(() => console.log('[core] built dist/kestrel-scan.cjs'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
