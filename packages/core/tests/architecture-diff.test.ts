import { describe, expect, it } from 'vitest';

import { diffGraphs, isEmptyDiff } from '../src/model';
import { MULTI_MODULE_APP, buildGraphFromSources } from '../src/testing';

describe('architecture diff', () => {
  const before = buildGraphFromSources(MULTI_MODULE_APP);

  it('is empty for the same code', () => {
    expect(isEmptyDiff(diffGraphs(before, buildGraphFromSources(MULTI_MODULE_APP)))).toBe(true);
  });

  it('reports a new service, its wiring and the components whose dependencies changed', () => {
    const after = buildGraphFromSources({
      ...MULTI_MODULE_APP,
      'src/users/audit.service.ts': `
import { Injectable } from '@nestjs/common';
@Injectable()
export class AuditService {}
`,
      'src/users/users.service.ts': `
import { Injectable } from '@nestjs/common';
import { AuditService } from './audit.service';
@Injectable()
export class UsersService {
  constructor(private readonly audit: AuditService) {}
}
`,
      'src/users/users.module.ts': MULTI_MODULE_APP['src/users/users.module.ts'].replace(
        'providers: [UsersService]',
        'providers: [UsersService, AuditService]',
      ).replace("import { UsersService } from './users.service';", "import { UsersService } from './users.service';\nimport { AuditService } from './audit.service';"),
    });

    const diff = diffGraphs(before, after);

    expect(diff.addedNodes.map((node) => node.name)).toEqual(['AuditService']);
    expect(diff.removedNodes).toEqual([]);
    expect(diff.addedEdges).toContainEqual(
      expect.objectContaining({ type: 'injects', source: 'src/users/users.service.ts#UsersService' }),
    );
    expect(diff.changedNodes.map((node) => node.name)).toContain('UsersService');
  });

  it('reports removed components', () => {
    const { ['src/auth/token.service.ts']: _removed, ...rest } = MULTI_MODULE_APP;
    const diff = diffGraphs(before, buildGraphFromSources(rest));
    expect(diff.removedNodes.map((node) => node.id)).toContain('src/auth/token.service.ts#TokenService');
  });
});
