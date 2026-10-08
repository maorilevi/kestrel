import { describe, expect, it } from 'vitest';

import { ArchitectureAnalyzer } from '../src/analysis/architecture-analyzer';
import { buildGraphFromSources, nodeByName } from '../src/testing';

const NEST_MANIFEST = {
  'package.json': JSON.stringify({
    name: 'api',
    dependencies: { '@nestjs/core': '^10.0.0', typeorm: '^0.3.0', pg: '^8.0.0' },
  }),
};

function analyze(sources: Record<string, string>, manifests = NEST_MANIFEST) {
  const graph = buildGraphFromSources(sources, 'api', manifests);
  return { graph, issues: new ArchitectureAnalyzer().analyze(graph) };
}

describe('layer feedback', () => {
  it('flags a controller reading the database directly', () => {
    const { issues } = analyze({
      'src/reports/reports.controller.ts': `
import { Controller } from '@nestjs/common';
import { DataSource } from 'typeorm';

@Controller('reports')
export class ReportsController {
  constructor(private readonly dataSource: DataSource) {}
}
`,
    });

    const finding = issues.find((issue) => issue.type === 'direct-data-access');
    expect(finding?.severity).toBe('warning');
    expect(finding?.message).toContain('ReportsController');
    expect(finding?.hint).toContain('service');
  });

  it('flags a dependency pointing from data back up to business', () => {
    const { graph, issues } = analyze({
      'src/users/users.repository.ts': `
import { Injectable } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class UsersRepository {
  constructor(private readonly audit: AuditService) {}
}
`,
      'src/audit/audit.service.ts': `
import { Injectable } from '@nestjs/common';

@Injectable()
export class AuditService {}
`,
    });

    expect(nodeByName(graph, 'UsersRepository').metadata?.layer).toBe('data');
    const finding = issues.find((issue) => issue.type === 'layer-violation');
    expect(finding?.message).toContain('UsersRepository');
    expect(finding?.nodeIds).toHaveLength(2);
  });

  it('says nothing about a well layered application', () => {
    const { issues } = analyze({
      'src/users/users.controller.ts': `
import { Controller } from '@nestjs/common';
import { UsersService } from './users.service';

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}
}
`,
      'src/users/users.service.ts': `
import { Injectable } from '@nestjs/common';
import { UsersRepository } from './users.repository';

@Injectable()
export class UsersService {
  constructor(private readonly repository: UsersRepository) {}
}
`,
      'src/users/users.repository.ts': `
import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersRepository {}
`,
      'src/users/users.module.ts': `
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersRepository } from './users.repository';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, UsersRepository],
})
export class UsersModule {}
`,
    });

    expect(issues).toEqual([]);
  });
});

describe('coupling feedback', () => {
  it('flags a service that depends on too much', () => {
    const dependencies = Array.from({ length: 9 }, (_, index) => `Dep${index}`);
    const sources: Record<string, string> = {
      'src/god/god.service.ts': `
import { Injectable } from '@nestjs/common';
${dependencies.map((name) => `import { ${name} } from './${name}';`).join('\n')}

@Injectable()
export class GodService {
  constructor(
${dependencies.map((name, index) => `    private readonly dep${index}: ${name},`).join('\n')}
  ) {}
}
`,
    };
    for (const name of dependencies) {
      sources[`src/god/${name}.ts`] = `
import { Injectable } from '@nestjs/common';

@Injectable()
export class ${name} {}
`;
    }

    const { issues } = analyze(sources);
    const finding = issues.find((issue) => issue.type === 'god-service');

    expect(finding?.message).toContain('GodService');
    expect(finding?.message).toContain('9');
    expect(finding?.hint).toContain('Split');
  });

  it('flags a controller with too many collaborators', () => {
    const services = Array.from({ length: 6 }, (_, index) => `S${index}`);
    const sources: Record<string, string> = {
      'src/fat/fat.controller.ts': `
import { Controller } from '@nestjs/common';
${services.map((name) => `import { ${name} } from './${name}';`).join('\n')}

@Controller('fat')
export class FatController {
  constructor(
${services.map((name, index) => `    private readonly s${index}: ${name},`).join('\n')}
  ) {}
}
`,
    };
    for (const name of services) {
      sources[`src/fat/${name}.ts`] = `
import { Injectable } from '@nestjs/common';

@Injectable()
export class ${name} {}
`;
    }

    const { issues } = analyze(sources);
    expect(issues.find((issue) => issue.type === 'fat-controller')?.severity).toBe('info');
  });
});

describe('module boundary feedback', () => {
  const CROSS_MODULE = {
    'src/users/users.service.ts': `
import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {}
`,
    'src/users/users.module.ts': `
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

@Module({ providers: [UsersService] })
export class UsersModule {}
`,
    'src/billing/billing.service.ts': `
import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';

@Injectable()
export class BillingService {
  constructor(private readonly users: UsersService) {}
}
`,
    'src/billing/billing.module.ts': `
import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { BillingService } from './billing.service';

@Module({ imports: [UsersModule], providers: [BillingService] })
export class BillingModule {}
`,
  };

  it('flags reaching into a provider the owning module does not export', () => {
    const { issues } = analyze(CROSS_MODULE);
    const finding = issues.find((issue) => issue.type === 'cross-module-access');

    expect(finding?.message).toContain('BillingService injects UsersService');
    expect(finding?.hint).toContain('exports of UsersModule');
  });

  it('stays quiet once the provider is exported', () => {
    const exported = {
      ...CROSS_MODULE,
      'src/users/users.module.ts': `
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

@Module({ providers: [UsersService], exports: [UsersService] })
export class UsersModule {}
`,
    };

    expect(analyze(exported).issues.filter((issue) => issue.type === 'cross-module-access')).toEqual([]);
  });

  it('flags a provider that is declared but never used', () => {
    const { issues } = analyze({
      'src/dead/dead.service.ts': `
import { Injectable } from '@nestjs/common';

@Injectable()
export class DeadService {}
`,
      'src/dead/dead.module.ts': `
import { Module } from '@nestjs/common';
import { DeadService } from './dead.service';

@Module({ providers: [DeadService] })
export class DeadModule {}
`,
    });

    const finding = issues.find((issue) => issue.type === 'unused-service');
    expect(finding?.message).toContain('DeadService is declared by DeadModule');
  });
});

describe('finding quality', () => {
  it('orders findings by severity and carries a hint on each', () => {
    const { issues } = analyze({
      'src/a/a.service.ts': `
import { Injectable } from '@nestjs/common';
import { BService } from '../b/b.service';

@Injectable()
export class AService {
  constructor(private readonly b: BService) {}
}
`,
      'src/b/b.service.ts': `
import { Injectable } from '@nestjs/common';
import { AService } from '../a/a.service';

@Injectable()
export class BService {
  constructor(private readonly a: AService) {}
}
`,
    });

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((issue) => typeof issue.hint === 'string' && issue.hint.length > 0)).toBe(true);

    const severities = issues.map((issue) => issue.severity);
    const ranks = { error: 0, warning: 1, info: 2 } as const;
    expect(severities.map((severity) => ranks[severity])).toEqual(
      [...severities.map((severity) => ranks[severity])].sort((a, b) => a - b),
    );
  });
});
