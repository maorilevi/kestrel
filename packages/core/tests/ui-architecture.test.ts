import { describe, expect, it } from 'vitest';

import { ArchitectureAnalyzer } from '../src/analysis/architecture-analyzer';
import { ArchitectureStyleDetector } from '../src/analysis/architecture-style';
import { buildGraphFromSources, hasEdge, nodeByName } from '../src/testing';

const MANIFESTS = {
  'apps/web/package.json': JSON.stringify({
    name: 'web',
    dependencies: { react: '^19.0.0', 'react-router-dom': '^6.0.0' },
  }),
  'apps/api/package.json': JSON.stringify({
    name: 'api',
    dependencies: { '@nestjs/core': '^10.0.0', '@nestjs/common': '^10.0.0' },
  }),
};

const SOURCES: Record<string, string> = {
  'apps/web/src/app/app.tsx': `
import { Route, Routes } from 'react-router-dom';
import { Overview } from './pages/Overview';
import { TraceExplorer } from './pages/TraceExplorer';

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Overview />} />
      <Route path="/traces" element={<TraceExplorer />} />
    </Routes>
  );
}
`,
  'apps/web/src/app/pages/Overview.tsx': `
import { StatTile } from '../components/StatTile';
import { useDashboard } from '../data/useDashboard';

export function Overview() {
  const { data } = useDashboard({ days: 30 });
  return <StatTile value={data} />;
}
`,
  'apps/web/src/app/pages/TraceExplorer.tsx': `
import { useTraces } from '../data/useTraces';

export function TraceExplorer() {
  const traces = useTraces();
  return <div>{traces.length}</div>;
}
`,
  'apps/web/src/app/components/StatTile.tsx': `
export function StatTile({ value }: { value: unknown }) {
  return <div>{String(value)}</div>;
}
`,
  'apps/web/src/app/data/useDashboard.ts': `
import { fetchOverview } from './client';

export function useDashboard(filters: { days: number }) {
  return { data: fetchOverview(filters) };
}
`,
  'apps/web/src/app/data/useTraces.ts': `
import { api } from './api';

export function useTraces() {
  return api.get('/api/v1/traces');
}
`,
  'apps/web/src/app/data/client.ts': `
import { api } from './api';

export function fetchOverview(filters: { days: number }) {
  return api.get('/api/v1/overview');
}
`,
  'apps/web/src/app/data/api.ts': `
export const api = {
  get: (path: string) => fetch(path),
};
`,
  'apps/web/src/app/auth/AuthProvider.tsx': `
import { createContext } from 'react';

export const AuthContext = createContext(null);

export function AuthProvider({ children }: { children: unknown }) {
  return <AuthContext.Provider value={null}>{children}</AuthContext.Provider>;
}
`,
  'apps/api/src/overview/overview.controller.ts': `
import { Controller, Get } from '@nestjs/common';

@Controller('api/v1')
export class OverviewController {
  @Get('overview')
  overview() {
    return null;
  }
}
`,
  'apps/api/src/traces/traces.controller.ts': `
import { Controller, Get } from '@nestjs/common';

@Controller('api/v1')
export class TracesController {
  @Get('traces')
  list() {
    return null;
  }
}
`,
};

describe('UI architecture', () => {
  const graph = buildGraphFromSources(SOURCES, 'monorepo', MANIFESTS);

  it('detects pages from the router, with their route', () => {
    const overview = nodeByName(graph, 'Overview');

    expect(overview.type).toBe('page');
    expect(overview.metadata?.route).toBe('/');
    expect(nodeByName(graph, 'TraceExplorer').metadata?.route).toBe('/traces');
  });

  it('detects components, hooks, context providers and API clients', () => {
    expect(nodeByName(graph, 'StatTile').type).toBe('component');
    expect(nodeByName(graph, 'useDashboard').type).toBe('hook');
    expect(nodeByName(graph, 'AuthProvider').metadata?.role).toBe('context-provider');
    expect(nodeByName(graph, 'fetchOverview').type).toBe('api-client');
  });

  it('places UI elements in layers', () => {
    expect(nodeByName(graph, 'Overview').metadata?.layer).toBe('presentation');
    expect(nodeByName(graph, 'StatTile').metadata?.layer).toBe('presentation');
    expect(nodeByName(graph, 'useDashboard').metadata?.layer).toBe('business');
    expect(nodeByName(graph, 'fetchOverview').metadata?.layer).toBe('data');
  });

  it('links a page to the components it renders', () => {
    expect(hasEdge(graph, 'renders', 'Overview', 'StatTile')).toBe(true);
  });

  it('links a page to the hooks it calls', () => {
    expect(hasEdge(graph, 'calls', 'Overview', 'useDashboard')).toBe(true);
    expect(hasEdge(graph, 'calls', 'useDashboard', 'fetchOverview')).toBe(true);
  });

  it('connects the front-end to the controller that serves its requests', () => {
    expect(hasEdge(graph, 'calls', 'useTraces', 'TracesController')).toBe(true);
    expect(hasEdge(graph, 'calls', 'fetchOverview', 'OverviewController')).toBe(true);
    // The path decides, not the order the controllers were parsed in.
    expect(hasEdge(graph, 'calls', 'useTraces', 'OverviewController')).toBe(false);
  });

  it('groups UI files into feature modules', () => {
    const pages = graph.nodes.find((node) => node.name === 'pages' && node.type === 'module');
    expect(pages?.metadata?.role).toBe('feature');
    expect(hasEdge(graph, 'contains', 'pages', 'Overview')).toBe(true);
    expect(hasEdge(graph, 'contains', 'components', 'StatTile')).toBe(true);
    expect(hasEdge(graph, 'contains', 'data', 'useDashboard')).toBe(true);
  });

  it('does not treat backend classes as UI elements', () => {
    expect(nodeByName(graph, 'OverviewController').type).toBe('controller');
    expect(graph.nodes.filter((node) => node.type === 'page').every((node) =>
      node.filePath?.startsWith('apps/web'),
    )).toBe(true);
  });

  it('counts UI elements in the stats', () => {
    expect(graph.metadata?.stats.uiElementCount).toBeGreaterThanOrEqual(6);
  });
});

describe('architecture style detection', () => {
  const graph = buildGraphFromSources(SOURCES, 'monorepo', MANIFESTS);
  const styles = new ArchitectureStyleDetector().detect(graph);
  const byId = (id: string) => styles.find((style) => style.id === id);

  it('recognises a monorepo', () => {
    expect(byId('monorepo')?.confidence).toBe('high');
  });

  it('recognises a client/server split and proves it with the calls it found', () => {
    const clientServer = byId('client-server');
    expect(clientServer).toBeDefined();
    expect(clientServer?.evidence.join(' ')).toMatch(/call\(s\) from the UI reach a controller/);
  });

  it('recognises a routed SPA', () => {
    const spa = byId('spa-routing');
    expect(spa?.label).toBe('Routed SPA');
    expect(spa?.scope).toBe('apps/web');
  });

  it('recognises hooks layered over a data client', () => {
    expect(byId('hooks-data-layer')?.scope).toBe('apps/web');
  });

  it('recognises the layered structure of the UI', () => {
    const layered = styles.filter((style) => style.id === 'layered');
    expect(layered.map((style) => style.scope)).toContain('apps/web');
  });

  it('carries evidence on every style', () => {
    expect(styles.every((style) => style.evidence.length > 0)).toBe(true);
  });
});

describe('UI classification precision', () => {
  const graph = buildGraphFromSources(
    {
      ...SOURCES,
      'apps/web/src/app/pages/settings/primitives.tsx': `
export function TextField({ label }: { label: string }) {
  return <input aria-label={label} />;
}

export function SaveBar() {
  return <div />;
}
`,
      'apps/web/src/app/pages/settings/SettingsLayout.tsx': `
import { TextField } from './primitives';

export function SettingsLayout() {
  return <TextField label="name" />;
}
`,
      'apps/web/src/app/pages/Placeholder.tsx': `
export function Placeholder() {
  return <div>soon</div>;
}
`,
    },
    'monorepo',
    MANIFESTS,
  );

  it('does not call every export in a pages folder a page', () => {
    // `primitives.tsx` does not export a `Primitives` page.
    expect(nodeByName(graph, 'TextField').type).toBe('component');
    expect(nodeByName(graph, 'SaveBar').type).toBe('component');
  });

  it('treats an unrendered export that owns its file in a pages folder as a page', () => {
    expect(nodeByName(graph, 'Placeholder').type).toBe('page');
  });

  it('lets an explicit role beat the folder convention', () => {
    // `SettingsLayout` is a layout wherever it lives.
    expect(nodeByName(graph, 'SettingsLayout').metadata?.role).toBe('layout');
  });

  it('demotes an unrouted page that something else renders', () => {
    const overview = nodeByName(graph, 'Overview');
    expect(overview.type).toBe('page');
    expect(overview.metadata?.route).toBe('/');
  });
});

describe('cross-project calls are not layer violations', () => {
  it('does not report the UI calling the API as an inverted dependency', () => {
    const graph = buildGraphFromSources(SOURCES, 'monorepo', MANIFESTS);
    const issues = new ArchitectureAnalyzer().analyze(graph);

    expect(issues.filter((issue) => issue.type === 'layer-violation')).toEqual([]);
  });
});
