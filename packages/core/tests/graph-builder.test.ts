import { describe, expect, it } from 'vitest';

import { ArchitectureAnalyzer } from '../src/analysis/architecture-analyzer';
import { MULTI_MODULE_APP, buildGraphFromSources, edgesBetween, hasEdge, nodeByName } from '../src/testing';

describe('deterministic identity', () => {
  it('identifies nodes by file path and symbol, not by class name alone', () => {
    const graph = buildGraphFromSources({
      'src/billing/payment.service.ts': `
import { Injectable } from '@nestjs/common';

@Injectable()
export class PaymentService {}
`,
      'src/legacy/payment.service.ts': `
import { Injectable } from '@nestjs/common';

@Injectable()
export class PaymentService {}
`,
    });

    const ids = graph.nodes.filter((node) => node.name === 'PaymentService').map((node) => node.id);

    expect(ids).toHaveLength(2);
    expect(ids).toContain('src/billing/payment.service.ts#PaymentService');
    expect(ids).toContain('src/legacy/payment.service.ts#PaymentService');
  });

  it('produces an identical graph for identical sources', () => {
    const first = buildGraphFromSources(MULTI_MODULE_APP);
    const second = buildGraphFromSources(MULTI_MODULE_APP);

    expect(second.nodes.map((node) => node.id)).toEqual(first.nodes.map((node) => node.id));
    expect(second.edges.map((edge) => edge.id)).toEqual(first.edges.map((edge) => edge.id));
  });
});

describe('duplicate prevention', () => {
  it('creates a single node for a provider shared by two modules', () => {
    const graph = buildGraphFromSources({
      'src/shared/shared.service.ts': `
import { Injectable } from '@nestjs/common';

@Injectable()
export class SharedService {}
`,
      'src/a/a.module.ts': `
import { Module } from '@nestjs/common';
import { SharedService } from '../shared/shared.service';

@Module({ providers: [SharedService] })
export class AModule {}
`,
      'src/b/b.module.ts': `
import { Module } from '@nestjs/common';
import { SharedService } from '../shared/shared.service';

@Module({ providers: [SharedService] })
export class BModule {}
`,
    });

    expect(graph.nodes.filter((node) => node.name === 'SharedService')).toHaveLength(1);
    expect(hasEdge(graph, 'contains', 'AModule', 'SharedService')).toBe(true);
    expect(hasEdge(graph, 'contains', 'BModule', 'SharedService')).toBe(true);
    // The first containing module wins for the hierarchy.
    expect(nodeByName(graph, 'SharedService').parentId).toBe(nodeByName(graph, 'AModule').id);
  });

  it('never emits duplicate node ids', () => {
    const graph = buildGraphFromSources(MULTI_MODULE_APP);
    const ids = graph.nodes.map((node) => node.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('collapses repeated declarations into one edge', () => {
    const graph = buildGraphFromSources({
      'src/users/users.service.ts': `
import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {}
`,
      'src/auth/auth.service.ts': `
import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly usersAgain: UsersService,
  ) {}
}
`,
      'src/auth/auth.module.ts': `
import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';

@Module({ providers: [AuthService, UsersService, AuthService] })
export class AuthModule {}
`,
    });

    expect(edgesBetween(graph, 'injects', 'AuthService', 'UsersService')).toBe(1);
    expect(edgesBetween(graph, 'contains', 'AuthModule', 'AuthService')).toBe(1);

    const edgeIds = graph.edges.map((edge) => edge.id);
    expect(new Set(edgeIds).size).toBe(edgeIds.length);
  });

  it('ignores self references', () => {
    const graph = buildGraphFromSources({
      'src/loop/loop.service.ts': `
import { Injectable, Inject, forwardRef } from '@nestjs/common';

@Injectable()
export class LoopService {
  constructor(@Inject(forwardRef(() => LoopService)) private readonly self: LoopService) {}
}
`,
    });

    expect(graph.edges.filter((edge) => edge.source === edge.target)).toHaveLength(0);
  });
});

describe('custom providers and tokens', () => {
  it('resolves { provide, useClass } to the implementation', () => {
    const graph = buildGraphFromSources({
      'src/mail/mail.service.ts': `
import { Injectable } from '@nestjs/common';

@Injectable()
export class SmtpMailService {}
`,
      'src/mail/mail.module.ts': `
import { Module } from '@nestjs/common';
import { SmtpMailService } from './mail.service';

@Module({
  providers: [{ provide: 'MAIL_SERVICE', useClass: SmtpMailService }],
})
export class MailModule {}
`,
    });

    expect(hasEdge(graph, 'contains', 'MailModule', 'SmtpMailService')).toBe(true);
  });

  it('represents unresolved injection tokens as external nodes', () => {
    const graph = buildGraphFromSources({
      'src/cache/cache.service.ts': `
import { Injectable, Inject } from '@nestjs/common';

@Injectable()
export class CacheService {
  constructor(@Inject('CACHE_MANAGER') private readonly cache: unknown) {}
}
`,
    });

    const external = nodeByName(graph, 'CACHE_MANAGER');
    expect(external.type).toBe('external');
    expect(hasEdge(graph, 'injects', 'CacheService', 'CACHE_MANAGER')).toBe(true);
  });

  it('does not create nodes for primitive constructor parameters', () => {
    const graph = buildGraphFromSources({
      'src/config/config.service.ts': `
import { Injectable } from '@nestjs/common';

@Injectable()
export class ConfigService {
  constructor(private readonly prefix: string, private readonly retries: number) {}
}
`,
    });

    expect(graph.nodes.map((node) => node.name)).not.toContain('string');
    expect(graph.edges.filter((edge) => edge.type === 'injects')).toHaveLength(0);
  });
});

describe('architecture analysis', () => {
  it('detects circular dependencies deterministically', () => {
    const graph = buildGraphFromSources({
      'src/users/users.service.ts': `
import { Injectable } from '@nestjs/common';
import { BillingService } from '../billing/billing.service';

@Injectable()
export class UsersService {
  constructor(private readonly billing: BillingService) {}
}
`,
      'src/billing/billing.service.ts': `
import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';

@Injectable()
export class BillingService {
  constructor(private readonly users: UsersService) {}
}
`,
    });

    const issues = new ArchitectureAnalyzer().analyze(graph);

    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe('circular-dependency');
    expect(issues[0].nodeIds).toHaveLength(2);
    expect(issues[0].message).toContain('Circular dependency');
  });

  it('reports no issues for an acyclic architecture', () => {
    const graph = buildGraphFromSources(MULTI_MODULE_APP);
    expect(new ArchitectureAnalyzer().analyze(graph)).toEqual([]);
  });
});
