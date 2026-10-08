import { describe, expect, it } from 'vitest';

import { PrismaParser } from '../src/parser/prisma-parser';
import { buildGraphFromSources, hasEdge, nodeByName, toManifests } from '../src/testing';

const SCHEMA = `
// AI Tracer schema
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role {
  ADMIN
  MEMBER
}

model User {
  id             String        @id @default(uuid())
  email          String        @unique
  role           Role          @default(MEMBER)
  organizationId String
  organization   Organization  @relation(fields: [organizationId], references: [id])
  traces         Trace[]

  @@map("users")
}

model Organization {
  id    String @id @default(uuid())
  name  String
  users User[]
}

model Trace {
  id       String @id @default(uuid())
  name     String
  // a comment mentioning model Ghost { } must not create a node
  userId   String
  user     User   @relation(fields: [userId], references: [id])
}
`;

const MANIFESTS = {
  'package.json': JSON.stringify({
    name: 'tracer-api',
    dependencies: { '@nestjs/core': '^10.0.0', '@prisma/client': '^5.0.0' },
  }),
  'prisma/schema.prisma': SCHEMA,
};

const SOURCES: Record<string, string> = {
  'src/prisma/prisma.service.ts': `
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient {}
`,
  'src/users/users.service.ts': `
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findAll() {
    return this.prisma.user.findMany({ include: { organization: true } });
  }

  createTrace(name: string) {
    return this.prisma.trace.create({ data: { name } });
  }
}
`,
  'src/billing/billing.service.ts': `
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  total() {
    return this.prisma.$queryRaw\`select 1\`;
  }
}
`,
  'src/users/users.controller.ts': `
import { Controller } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}
}
`,
};

describe('prisma schema parsing', () => {
  const models = new PrismaParser().parse(toManifests(MANIFESTS));

  it('reads every model, and only models', () => {
    expect(models.map((model) => model.name).sort()).toEqual(['Organization', 'Trace', 'User']);
  });

  it('ignores models mentioned inside comments', () => {
    expect(models.map((model) => model.name)).not.toContain('Ghost');
  });

  it('records the declaration line so the schema can be opened at the model', () => {
    const user = models.find((model) => model.name === 'User');
    expect(SCHEMA.split('\n')[(user?.line ?? 1) - 1]).toContain('model User');
  });

  it('separates scalar fields from relations', () => {
    const user = models.find((model) => model.name === 'User');
    expect(user?.scalarFieldCount).toBe(4);
    expect(user?.relations.map((relation) => relation.targetModel).sort()).toEqual([
      'Organization',
      'Trace',
    ]);
  });

  it('knows which side owns the foreign key', () => {
    const user = models.find((model) => model.name === 'User');
    const toOrganization = user?.relations.find((relation) => relation.targetModel === 'Organization');
    const toTraces = user?.relations.find((relation) => relation.targetModel === 'Trace');

    expect(toOrganization?.ownsForeignKey).toBe(true);
    expect(toTraces?.ownsForeignKey).toBe(false);
    expect(toTraces?.isList).toBe(true);
  });

  it('reads the mapped table name', () => {
    expect(models.find((model) => model.name === 'User')?.tableName).toBe('users');
  });

  it('survives a malformed schema', () => {
    const broken = new PrismaParser().parse(toManifests({ 'prisma/schema.prisma': 'model {{{ oops' }));
    expect(broken).toEqual([]);
  });
});

describe('prisma models in the architecture graph', () => {
  const graph = buildGraphFromSources(SOURCES, 'tracer-api', MANIFESTS);

  it('turns models into data layer entities', () => {
    const user = nodeByName(graph, 'User');

    expect(user.metadata?.role).toBe('entity');
    expect(user.metadata?.layer).toBe('data');
    expect(user.metadata?.source).toBe('prisma');
    expect(user.filePath).toBe('prisma/schema.prisma');
    expect(graph.metadata?.stats.entityCount).toBe(3);
  });

  it('links every model to the database it lives in', () => {
    expect(hasEdge(graph, 'persists', 'User', 'PostgreSQL')).toBe(true);
    expect(hasEdge(graph, 'persists', 'Trace', 'PostgreSQL')).toBe(true);
  });

  it('draws relations from the side holding the foreign key', () => {
    expect(hasEdge(graph, 'references', 'User', 'Organization')).toBe(true);
    expect(hasEdge(graph, 'references', 'Trace', 'User')).toBe(true);
    // The inverse side (`User.traces`) must not duplicate the edge.
    expect(hasEdge(graph, 'references', 'User', 'Trace')).toBe(false);
  });

  it('connects a service to the models it actually touches', () => {
    expect(hasEdge(graph, 'persists', 'UsersService', 'User')).toBe(true);
    expect(hasEdge(graph, 'persists', 'UsersService', 'Trace')).toBe(true);
    expect(hasEdge(graph, 'persists', 'UsersService', 'Organization')).toBe(false);
  });

  it('falls back to the database when no model can be identified', () => {
    // BillingService only calls `this.prisma.$queryRaw`.
    expect(hasEdge(graph, 'persists', 'BillingService', 'PostgreSQL')).toBe(true);
    expect(nodeByName(graph, 'BillingService').metadata?.accessesDatabase).toBe(true);
  });

  it('keeps the layered chain intact', () => {
    expect(hasEdge(graph, 'injects', 'UsersController', 'UsersService')).toBe(true);
    expect(hasEdge(graph, 'injects', 'UsersService', 'PrismaService')).toBe(false);
    expect(nodeByName(graph, 'UsersController').metadata?.layer).toBe('presentation');
    expect(nodeByName(graph, 'UsersService').metadata?.layer).toBe('business');
    expect(nodeByName(graph, 'PrismaService').metadata?.layer).toBe('data');
  });
});
