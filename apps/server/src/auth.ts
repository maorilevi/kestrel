import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { organization } from 'better-auth/plugins';

import type { ServerConfig } from './config';
import type { DatabaseHandle } from './db';

function authOptions(config: ServerConfig, database: DatabaseHandle) {
  return {
    baseURL: config.authUrl,
    secret: config.authSecret,
    database: { db: database.db, type: database.type },
    trustedOrigins: [config.webOrigin],
    emailAndPassword: { enabled: true },
    plugins: [
      // Every project belongs to an organization: a founder's personal one or a team's.
      organization(),
    ],
  } satisfies BetterAuthOptions;
}

/**
 * Creates Better Auth after bringing its tables up to date, so it never starts
 * against a schema older than the code.
 */
export async function createAuth(config: ServerConfig, database: DatabaseHandle) {
  const options = authOptions(config, database);
  const { runMigrations } = await getMigrations(options);
  await runMigrations();
  return betterAuth(options);
}

export type Auth = Awaited<ReturnType<typeof createAuth>>;

export interface SessionInfo {
  userId: string;
  userName: string;
  activeOrganizationId: string | null;
}

export async function readSession(auth: Auth, headers: Headers): Promise<SessionInfo | undefined> {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    return undefined;
  }
  const active = (session.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
  return { userId: session.user.id, userName: session.user.name, activeOrganizationId: active };
}

/** True when the user belongs to the organization. */
export async function isMember(database: DatabaseHandle, userId: string, organizationId: string): Promise<boolean> {
  // Better Auth's `member` table is not part of KESTREL's typed schema.
  const db = database.db as unknown as import('kysely').Kysely<{
    member: { userId: string; organizationId: string };
  }>;
  const row = await db
    .selectFrom('member')
    .select('userId')
    .where('userId', '=', userId)
    .where('organizationId', '=', organizationId)
    .executeTakeFirst();
  return row !== undefined;
}
