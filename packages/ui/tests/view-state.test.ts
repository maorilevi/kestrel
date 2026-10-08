import { describe, expect, it } from 'vitest';

import {
  computeBreadcrumbs,
  computeVisibleGraph,
  initialViewState,
} from '../src/state/view-state';
import { MULTI_MODULE_APP, buildGraphFromSources, nodeByName } from '@kestrel/core/testing';

/**
 * The progressive dive is pure logic in the visualization layer, so it is
 * tested here rather than in a browser.
 */
describe('progressive dive', () => {
  const graph = buildGraphFromSources(MULTI_MODULE_APP);

  it('shows only the application and its modules at the bird\'s-eye level', () => {
    const visible = computeVisibleGraph(graph, initialViewState);
    const types = new Set(visible.nodes.map((node) => node.type));

    expect(types).toEqual(new Set(['application', 'module']));
    expect(visible.nodes.map((node) => node.name).sort()).toEqual([
      'AppModule',
      'AuthModule',
      'UsersModule',
      'test-workspace',
    ]);
  });

  it('shows the components of a module one level down', () => {
    const authModule = nodeByName(graph, 'AuthModule');
    const visible = computeVisibleGraph(graph, {
      ...initialViewState,
      level: 'module',
      focusId: authModule.id,
    });

    const names = visible.nodes.map((node) => node.name).sort();
    expect(names).toContain('AuthController');
    expect(names).toContain('AuthService');
    expect(names).toContain('TokenService');
    // One hop out keeps cross-module dependencies visible.
    expect(names).toContain('UsersService');
    expect(names).not.toContain('AppModule');
  });

  it('shows direct neighbours of a component', () => {
    const authService = nodeByName(graph, 'AuthService');
    const visible = computeVisibleGraph(graph, {
      ...initialViewState,
      level: 'component',
      focusId: authService.id,
    });

    expect(visible.nodes.map((node) => node.name).sort()).toEqual([
      'AuthController',
      'AuthService',
      'TokenService',
      'UsersService',
    ]);
  });

  it('hides external nodes unless they are requested', () => {
    const withoutExternals = computeVisibleGraph(graph, initialViewState);
    const withExternals = computeVisibleGraph(graph, { ...initialViewState, showExternal: true });

    expect(withoutExternals.nodes.map((node) => node.name)).not.toContain('ConfigModule');
    expect(withExternals.nodes.map((node) => node.name)).toContain('ConfigModule');
  });

  it('only keeps edges whose endpoints are both visible', () => {
    const visible = computeVisibleGraph(graph, initialViewState);
    const ids = new Set(visible.nodes.map((node) => node.id));

    expect(visible.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
  });

  it('highlights search matches instead of removing nodes', () => {
    const visible = computeVisibleGraph(graph, { ...initialViewState, search: 'auth' });

    expect(visible.nodes.length).toBeGreaterThan(1);
    expect([...visible.highlighted].map((id) => id.split('#')[1])).toEqual(['AuthModule']);
  });

  it('shows applications only at the top of a monorepo', () => {
    const monorepo = buildGraphFromSources(
      {
        'apps/api/src/app.module.ts': `
import { Module } from '@nestjs/common';

@Module({})
export class AppModule {}
`,
        'apps/web/src/app.tsx': 'export function App() { return null; }',
      },
      'monorepo',
      {
        'apps/api/package.json': JSON.stringify({ name: 'api', dependencies: { '@nestjs/core': '^10' } }),
        'apps/web/package.json': JSON.stringify({ name: 'web', dependencies: { react: '^19' } }),
      },
    );

    const top = computeVisibleGraph(monorepo, initialViewState);
    expect(top.nodes.map((node) => node.name).sort()).toEqual(['api', 'web']);

    // Selecting a project drops into its modules.
    const inside = computeVisibleGraph(monorepo, { ...initialViewState, projectId: 'apps/api' });
    expect(inside.nodes.map((node) => node.name).sort()).toEqual(['AppModule', 'api']);
  });

  it('shows only layered components in the layers view', () => {
    const visible = computeVisibleGraph(graph, { ...initialViewState, level: 'layers' });
    const types = new Set(visible.nodes.map((node) => node.type));

    expect(types.has('module')).toBe(false);
    expect(types.has('application')).toBe(false);
    expect(visible.nodes.every((node) => node.metadata?.layer !== undefined)).toBe(true);
    expect(visible.nodes.map((node) => node.name)).toContain('AuthController');
  });

  it('hides the layers the user switched off', () => {
    const visible = computeVisibleGraph(graph, {
      ...initialViewState,
      level: 'layers',
      hiddenLayers: ['presentation'],
    });

    expect(visible.nodes.map((node) => node.name)).not.toContain('AuthController');
    expect(visible.nodes.map((node) => node.name)).toContain('AuthService');
  });

  it('never hides nodes that have no layer', () => {
    const visible = computeVisibleGraph(graph, {
      ...initialViewState,
      hiddenLayers: ['presentation', 'business', 'data', 'infrastructure', 'shared'],
    });

    expect(visible.nodes.map((node) => node.name)).toContain('AuthModule');
  });

  it('builds breadcrumbs from the containment hierarchy', () => {
    const authService = nodeByName(graph, 'AuthService');
    const crumbs = computeBreadcrumbs(graph, {
      ...initialViewState,
      level: 'component',
      focusId: authService.id,
    });

    // AuthModule is reached through AppModule, so the full path is shown.
    expect(crumbs.map((crumb) => crumb.label)).toEqual([
      'KESTREL',
      'test-workspace',
      'AppModule',
      'AuthModule',
      'AuthService',
    ]);
  });
});
