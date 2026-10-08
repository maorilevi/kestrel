import type { DatabaseKind } from '../models/architecture-project';

/** npm package → database engine. */
export const DRIVER_PACKAGES: Readonly<Record<string, DatabaseKind>> = {
  pg: 'postgres',
  'pg-promise': 'postgres',
  postgres: 'postgres',
  '@vercel/postgres': 'postgres',
  '@neondatabase/serverless': 'postgres',
  mysql: 'mysql',
  mysql2: 'mysql',
  mariadb: 'mariadb',
  sqlite3: 'sqlite',
  'better-sqlite3': 'sqlite',
  '@libsql/client': 'sqlite',
  mssql: 'mssql',
  tedious: 'mssql',
  oracledb: 'oracle',
  mongodb: 'mongodb',
  redis: 'redis',
  ioredis: 'redis',
  'cache-manager-redis-store': 'redis',
  '@elastic/elasticsearch': 'elasticsearch',
  '@nestjs/elasticsearch': 'elasticsearch',
  '@aws-sdk/client-dynamodb': 'dynamodb',
  dynamoose: 'dynamodb',
  'cassandra-driver': 'cassandra',
  'neo4j-driver': 'neo4j',
};

/** npm package → data access library, plus the engine it implies (if any). */
export const ORM_PACKAGES: Readonly<Record<string, { access: string; kind?: DatabaseKind }>> = {
  typeorm: { access: 'TypeORM' },
  '@nestjs/typeorm': { access: 'TypeORM' },
  '@prisma/client': { access: 'Prisma' },
  prisma: { access: 'Prisma' },
  mongoose: { access: 'Mongoose', kind: 'mongodb' },
  '@nestjs/mongoose': { access: 'Mongoose', kind: 'mongodb' },
  '@typegoose/typegoose': { access: 'Typegoose', kind: 'mongodb' },
  sequelize: { access: 'Sequelize' },
  '@nestjs/sequelize': { access: 'Sequelize' },
  'sequelize-typescript': { access: 'Sequelize' },
  knex: { access: 'Knex' },
  '@mikro-orm/core': { access: 'MikroORM' },
  'drizzle-orm': { access: 'Drizzle' },
  kysely: { access: 'Kysely' },
};

/** Engines that a general purpose ORM connects to. */
export const PRIMARY_ENGINES: ReadonlySet<DatabaseKind> = new Set<DatabaseKind>([
  'postgres',
  'mysql',
  'mariadb',
  'sqlite',
  'mssql',
  'oracle',
  'cockroachdb',
  'mongodb',
]);

/** NestJS dynamic module → data access library. */
export const MODULE_ACCESS: Readonly<Record<string, { access: string; kind?: DatabaseKind }>> = {
  TypeOrmModule: { access: 'TypeORM' },
  MongooseModule: { access: 'Mongoose', kind: 'mongodb' },
  SequelizeModule: { access: 'Sequelize' },
  MikroOrmModule: { access: 'MikroORM' },
  PrismaModule: { access: 'Prisma' },
  ElasticsearchModule: { access: 'Elasticsearch', kind: 'elasticsearch' },
  RedisModule: { access: 'Redis', kind: 'redis' },
};

/** Values of `type` / `dialect` / `provider` options → engine. */
export const DIALECT_VALUES: Readonly<Record<string, DatabaseKind>> = {
  postgres: 'postgres',
  postgresql: 'postgres',
  pg: 'postgres',
  cockroachdb: 'cockroachdb',
  mysql: 'mysql',
  mariadb: 'mariadb',
  sqlite: 'sqlite',
  'better-sqlite3': 'sqlite',
  sqlserver: 'mssql',
  mssql: 'mssql',
  oracle: 'oracle',
  mongodb: 'mongodb',
};

/** Docker image name fragment → engine. */
export const IMAGE_SIGNALS: ReadonlyArray<[RegExp, DatabaseKind]> = [
  [/postgres|postgis|timescale/i, 'postgres'],
  [/cockroach/i, 'cockroachdb'],
  [/mariadb/i, 'mariadb'],
  [/mysql/i, 'mysql'],
  [/mongo/i, 'mongodb'],
  [/redis|valkey/i, 'redis'],
  [/elasticsearch|opensearch/i, 'elasticsearch'],
  [/mssql|sql-?server/i, 'mssql'],
  [/cassandra|scylla/i, 'cassandra'],
  [/neo4j/i, 'neo4j'],
  [/dynamodb/i, 'dynamodb'],
];

/**
 * Constructor parameter types that mean "this class talks to a datastore".
 * The value is the access library used for the edge label.
 */
export const PERSISTENCE_HANDLES: Readonly<Record<string, string>> = {
  Repository: 'TypeORM',
  MongoRepository: 'TypeORM',
  TreeRepository: 'TypeORM',
  EntityManager: 'TypeORM',
  DataSource: 'TypeORM',
  Connection: 'TypeORM',
  QueryRunner: 'TypeORM',
  Model: 'Mongoose',
  PrismaService: 'Prisma',
  PrismaClient: 'Prisma',
  Knex: 'Knex',
  Sequelize: 'Sequelize',
  Redis: 'Redis',
  RedisClientType: 'Redis',
  ElasticsearchService: 'Elasticsearch',
};

/** Backend framework packages. */
export const BACKEND_PACKAGES: Readonly<Record<string, string>> = {
  '@nestjs/core': 'NestJS',
  '@nestjs/common': 'NestJS',
  express: 'Express',
  fastify: 'Fastify',
  koa: 'Koa',
  '@hapi/hapi': 'Hapi',
  hono: 'Hono',
  '@apollo/server': 'Apollo Server',
  'aws-lambda': 'AWS Lambda',
};

/** Frontend framework packages. */
export const FRONTEND_PACKAGES: Readonly<Record<string, string>> = {
  react: 'React',
  'react-dom': 'React',
  next: 'Next.js',
  '@angular/core': 'Angular',
  vue: 'Vue',
  svelte: 'Svelte',
  '@sveltejs/kit': 'SvelteKit',
  'solid-js': 'SolidJS',
  '@remix-run/react': 'Remix',
  'react-native': 'React Native',
  '@ionic/angular': 'Ionic',
};
