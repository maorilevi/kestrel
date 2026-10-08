import type { ApplicationArchetype } from '../profile/application-archetype';

/**
 * Project level facts KESTREL derives from a repository.
 *
 * A "project" is one `package.json` (so a monorepo yields several), which is
 * what makes it possible to say "apps/api is a NestJS API on PostgreSQL while
 * apps/web is a React UI" instead of collapsing both into one verdict.
 */

export type ProjectKind = 'api' | 'ui' | 'fullstack' | 'library' | 'unknown';

export const PROJECT_KIND_LABELS: Readonly<Record<ProjectKind, string>> = {
  api: 'Backend API',
  ui: 'UI',
  fullstack: 'Fullstack',
  library: 'Library',
  unknown: 'Unknown',
};

export type DatabaseKind =
  | 'postgres'
  | 'mysql'
  | 'mariadb'
  | 'sqlite'
  | 'mssql'
  | 'oracle'
  | 'cockroachdb'
  | 'mongodb'
  | 'redis'
  | 'elasticsearch'
  | 'dynamodb'
  | 'cassandra'
  | 'neo4j'
  | 'unknown';

export const DATABASE_LABELS: Readonly<Record<DatabaseKind, string>> = {
  postgres: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  sqlite: 'SQLite',
  mssql: 'SQL Server',
  oracle: 'Oracle',
  cockroachdb: 'CockroachDB',
  mongodb: 'MongoDB',
  redis: 'Redis',
  elasticsearch: 'Elasticsearch',
  dynamodb: 'DynamoDB',
  cassandra: 'Cassandra',
  neo4j: 'Neo4j',
  unknown: 'Database',
};

export interface DetectedDatabase {
  /** Deterministic id, also used as the graph node id. */
  id: string;
  kind: DatabaseKind;
  /** Display label, e.g. `PostgreSQL`. */
  label: string;
  /** Library the database is reached through, e.g. `TypeORM`, `Prisma`. */
  access: string;
  /** Schema file the engine was read from, when there is one. */
  schemaPath?: string;
  /** Why KESTREL believes this, e.g. `package.json: pg`. */
  evidence: string[];
}

export type FrameworkCategory = 'backend' | 'frontend' | 'orm' | 'meta';

export interface DetectedFramework {
  id: string;
  label: string;
  category: FrameworkCategory;
}

export interface ProjectProfile {
  /** Workspace relative directory of the manifest; `.` for the root project. */
  id: string;
  name: string;
  /** Posix directory the project owns, `''` for the workspace root. */
  rootPath: string;
  workspaceName: string;
  kind: ProjectKind;
  /** What the application is at runtime, e.g. a Lambda or an Angular SPA. */
  archetype: ApplicationArchetype;
  archetypeLabel: string;
  archetypeConfidence: 'high' | 'medium' | 'low';
  /** Framework shown next to the archetype, e.g. `React`, `NestJS`. */
  primaryFramework?: string;
  frameworks: DetectedFramework[];
  databases: DetectedDatabase[];
  /** Human readable reasons behind `kind`. */
  evidence: string[];
  fileCount: number;
}

export function createDatabaseId(projectId: string, kind: DatabaseKind, access: string): string {
  return `database#${projectId}#${kind}:${access.toLowerCase()}`;
}
