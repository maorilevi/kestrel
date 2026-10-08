import { existsSync } from 'node:fs';
import * as path from 'node:path';

import type { Logger } from '@kestrel/core';
import { E2BSandboxProvider, LocalSandboxProvider, type SandboxProvider } from '@kestrel/sandbox';

import { buildServer } from './app';
import { createAuth } from './auth';
import { loadConfig } from './config';
import { migrate, openDatabase } from './db';

const logger: Logger = {
  info: (message) => console.log(`[kestrel] ${message}`),
  warn: (message) => console.warn(`[kestrel] ${message}`),
  error: (message, error) => console.error(`[kestrel] ${message}`, error ?? ''),
};

async function main(): Promise<void> {
  const config = loadConfig();

  const scannerBundlePath = path.join(config.repoRoot, 'packages', 'core', 'dist', 'kestrel-scan.cjs');
  if (!existsSync(scannerBundlePath)) {
    throw new Error('The scanner bundle is missing. Run `npm run build -w @kestrel/core` first.');
  }

  const database = openDatabase(config.databaseUrl);
  await migrate(database);
  const auth = await createAuth(config, database);

  const provider: SandboxProvider =
    config.sandbox.provider === 'e2b'
      ? new E2BSandboxProvider({ apiKey: config.sandbox.apiKey, template: config.sandbox.template })
      : new LocalSandboxProvider(path.join(config.dataDir, 'sandboxes'));
  if (provider.id === 'local') {
    logger.warn('Using the local sandbox provider: project code runs on this machine without isolation.');
  }

  const { app } = await buildServer({ config, database, auth, provider, scannerBundlePath, logger });
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info(`Control plane listening on http://localhost:${config.port} (${database.type}, ${provider.id} sandboxes)`);

  const shutdown = async (): Promise<void> => {
    await app.close();
    await database.db.destroy();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  logger.error('Failed to start', error);
  process.exit(1);
});
