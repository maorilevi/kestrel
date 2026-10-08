import { describe, expect, it } from 'vitest';

import { CHAT_SYSTEM_PROMPT, buildChatContext } from '../src/chat-context';
import { MULTI_MODULE_APP, buildGraphFromSources, nodeByName } from '@kestrel/core/testing';

const MANIFEST = {
  'package.json': JSON.stringify({
    name: 'demo-api',
    dependencies: { '@nestjs/core': '^10.0.0', typeorm: '^0.3.0', pg: '^8.0.0' },
  }),
};

describe('chat context', () => {
  const graph = buildGraphFromSources(MULTI_MODULE_APP, 'demo-api', MANIFEST);

  it('describes the applications, including archetype and datastore', () => {
    const { brief } = buildChatContext(graph);

    expect(brief).toContain('## Applications');
    expect(brief).toContain('REST API');
    expect(brief).toContain('PostgreSQL via TypeORM');
  });

  it('lists modules with what they contain and import', () => {
    const { brief } = buildChatContext(graph);

    expect(brief).toContain('AuthModule');
    expect(brief).toContain('contains: AuthController, AuthService, TokenService');
    expect(brief).toContain('imports: UsersModule');
  });

  it('groups components by layer with their relationships', () => {
    const { brief } = buildChatContext(graph);

    expect(brief).toContain('## Layer: presentation');
    expect(brief).toContain('## Layer: business');
    expect(brief).toContain('uses: AuthService');
    expect(brief).toContain('used by: AuthController');
  });

  it('carries no timestamp, so the prompt cache survives between turns', () => {
    const first = buildChatContext(graph).brief;
    const second = buildChatContext(buildGraphFromSources(MULTI_MODULE_APP, 'demo-api', MANIFEST)).brief;

    expect(second).toBe(first);
    expect(first).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('puts the selection in the volatile focus block, not the cached brief', () => {
    const authService = nodeByName(graph, 'AuthService');
    const context = buildChatContext(graph, { selectedNodeIds: [authService.id] });

    expect(context.focus).toContain('AuthService');
    expect(context.focus).toContain('injects → UsersService');
    expect(context.brief).not.toContain('currently has these selected');
  });

  it('is empty-focus when nothing is selected', () => {
    expect(buildChatContext(graph).focus).toBe('');
  });

  it('scopes the brief to one project when the view is filtered', () => {
    const monorepo = buildGraphFromSources(
      {
        'apps/api/src/users.controller.ts': `
import { Controller } from '@nestjs/common';

@Controller('users')
export class UsersController {}
`,
        'apps/web/src/dashboard.tsx': 'export function Dashboard() { return <div />; }',
      },
      'monorepo',
      {
        'apps/api/package.json': JSON.stringify({ name: 'api', dependencies: { '@nestjs/core': '^10' } }),
        'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { react: '^19' } }),
      },
    );

    const scoped = buildChatContext(monorepo, { projectId: 'apps/api' }).brief;

    expect(scoped).toContain('UsersController');
    expect(scoped).not.toContain('Dashboard');
  });

  it('respects the character budget and says so', () => {
    const context = buildChatContext(graph, { characterBudget: 200 });

    expect(context.truncated).toBe(true);
    expect(context.brief).toContain('omitted to fit the context budget');
  });

  it('offers the node names an answer may cite', () => {
    expect(buildChatContext(graph).citableNames).toContain('AuthService');
  });

  it('instructs the model to stay inside the provided architecture', () => {
    expect(CHAT_SYSTEM_PROMPT).toContain('Never invent components');
    expect(CHAT_SYSTEM_PROMPT).toContain('[[UsersService]]');
  });
});
