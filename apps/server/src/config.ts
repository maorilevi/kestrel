import { randomBytes } from 'node:crypto';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface ServerConfig {
  port: number;
  webOrigin: string;
  authUrl: string;
  authSecret: string;
  /** `postgres://…` or a sqlite file path. */
  databaseUrl: string;
  dataDir: string;
  sandbox: { provider: 'local' } | { provider: 'e2b'; apiKey: string; template: string };
  anthropicApiKey?: string;
  chatModel: string;
  /** Root of the KESTREL repository, for templates and the scanner bundle. */
  repoRoot: string;
}

const here = path.dirname(fileURLToPath(import.meta.url));

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const port = Number(env.PORT ?? 4000);
  const dataDir = path.resolve(env.KESTREL_DATA_DIR ?? path.join(here, '..', 'data'));
  const production = env.NODE_ENV === 'production';

  let authSecret = env.BETTER_AUTH_SECRET ?? '';
  if (!authSecret) {
    if (production) {
      throw new Error('BETTER_AUTH_SECRET is required in production.');
    }
    // Development only: sessions do not survive a restart, which is acceptable locally.
    authSecret = randomBytes(32).toString('hex');
  }

  const providerName = env.SANDBOX_PROVIDER ?? 'local';
  let sandbox: ServerConfig['sandbox'];
  if (providerName === 'e2b') {
    if (!env.E2B_API_KEY) {
      throw new Error('SANDBOX_PROVIDER=e2b needs E2B_API_KEY.');
    }
    sandbox = { provider: 'e2b', apiKey: env.E2B_API_KEY, template: env.E2B_TEMPLATE ?? 'base' };
  } else if (providerName === 'local') {
    if (production) {
      throw new Error('The local sandbox provider has no isolation and cannot run in production.');
    }
    sandbox = { provider: 'local' };
  } else {
    throw new Error(`Unknown SANDBOX_PROVIDER "${providerName}".`);
  }

  return {
    port,
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:3000',
    authUrl: env.BETTER_AUTH_URL ?? `http://localhost:${port}`,
    authSecret,
    databaseUrl: env.DATABASE_URL || path.join(dataDir, 'kestrel.db'),
    dataDir,
    sandbox,
    anthropicApiKey: env.ANTHROPIC_API_KEY || undefined,
    chatModel: env.KESTREL_CHAT_MODEL ?? 'claude-opus-5-5',
    repoRoot: path.resolve(here, '..', '..', '..'),
  };
}
