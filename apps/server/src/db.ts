import { mkdirSync } from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { NodeSqliteDialect } from '@better-auth/kysely-adapter/node-sqlite-dialect';
import { Kysely, PostgresDialect, sql, type Dialect } from 'kysely';
import pg from 'pg';

/** Tables KESTREL owns. Better Auth manages its own (user, session, organization, …). */
export interface ProjectTable {
  id: string;
  organization_id: string;
  name: string;
  /** JSON-encoded `ProjectSource`. */
  source: string;
  status: string;
  sandbox_provider: string | null;
  sandbox_id: string | null;
  preview_url: string | null;
  created_by: string;
  created_at: string;
}

export interface Database {
  project: ProjectTable;
}

export interface DatabaseHandle {
  db: Kysely<Database>;
  type: 'sqlite' | 'postgres';
}

export function openDatabase(url: string): DatabaseHandle {
  if (/^postgres(ql)?:\/\//.test(url)) {
    const dialect = new PostgresDialect({ pool: new pg.Pool({ connectionString: url }) });
    return { db: new Kysely<Database>({ dialect }), type: 'postgres' };
  }

  if (url !== ':memory:') {
    mkdirSync(path.dirname(url), { recursive: true });
  }
  const database = new DatabaseSync(url);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  // The adapter's dialect is typed for Better Auth's Kysely copy; the runtime contract is the same.
  const dialect = new NodeSqliteDialect({ database }) as unknown as Dialect;
  return { db: new Kysely<Database>({ dialect }), type: 'sqlite' };
}

export async function migrate({ db }: DatabaseHandle): Promise<void> {
  await db.schema
    .createTable('project')
    .ifNotExists()
    .addColumn('id', 'text', (column) => column.primaryKey())
    .addColumn('organization_id', 'text', (column) => column.notNull())
    .addColumn('name', 'text', (column) => column.notNull())
    .addColumn('source', 'text', (column) => column.notNull())
    .addColumn('status', 'text', (column) => column.notNull())
    .addColumn('sandbox_provider', 'text')
    .addColumn('sandbox_id', 'text')
    .addColumn('preview_url', 'text')
    .addColumn('created_by', 'text', (column) => column.notNull())
    .addColumn('created_at', 'text', (column) => column.notNull().defaultTo(sql`CURRENT_TIMESTAMP`))
    .execute();

  await db.schema
    .createIndex('project_organization_idx')
    .ifNotExists()
    .on('project')
    .column('organization_id')
    .execute();
}
