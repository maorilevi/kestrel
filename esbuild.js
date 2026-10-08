/* eslint-disable no-console */
const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Reports build problems in a format VS Code's problem matcher understands. */
const problemReporter = {
  name: 'problem-reporter',
  setup(build) {
    build.onStart(() => {
      console.log(`[kestrel] build started (${build.initialOptions.outfile})`);
    });
    build.onEnd((result) => {
      for (const error of result.errors) {
        console.error(`✘ ${error.text}`);
        if (error.location) {
          console.error(`    ${error.location.file}:${error.location.line}:${error.location.column}`);
        }
      }
      console.log(`[kestrel] build finished (${build.initialOptions.outfile})`);
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'warning',
  plugins: [problemReporter],
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ['webview/src/main.tsx'],
  bundle: true,
  outfile: 'dist/webview/main.js',
  platform: 'browser',
  format: 'iife',
  target: 'es2020',
  jsx: 'automatic',
  loader: {
    '.svg': 'dataurl',
  },
  define: {
    'process.env.NODE_ENV': production ? '"production"' : '"development"',
  },
  sourcemap: !production,
  minify: production,
  logLevel: 'warning',
  plugins: [problemReporter],
};

async function main() {
  if (watch) {
    const contexts = await Promise.all([
      esbuild.context(extensionConfig),
      esbuild.context(webviewConfig),
    ]);
    await Promise.all(contexts.map((context) => context.watch()));
    console.log('[kestrel] watching for changes...');
    return;
  }

  await Promise.all([esbuild.build(extensionConfig), esbuild.build(webviewConfig)]);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
