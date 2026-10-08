import { traceDataFlow, type FlowDirection } from './data-flow';
import type {
  ArchitectureEdge,
  ArchitectureGraph,
  ArchitectureLayer,
  ArchitectureNode,
} from '../types/architecture';

/**
 * Visualization state — the third model of the KESTREL pipeline
 * (repository → architecture → visualization).
 *
 * The functions below derive *what should be visible* from the architecture
 * graph. They know nothing about React Flow, which keeps the progressive dive
 * (overview → module → component) testable and reusable.
 */

export type ViewLevel = 'overview' | 'module' | 'component' | 'layers' | 'flow' | 'full';

export interface ViewState {
  level: ViewLevel;
  /** Node the current level is centred on (module or component). */
  focusId: string | null;
  showExternal: boolean;
  /** Layers the user switched off; nodes without a layer are never hidden. */
  hiddenLayers: ArchitectureLayer[];
  /** Project the view is restricted to, `null` for the whole workspace. */
  projectId: string | null;
  /** Nodes a data-flow trace starts from. */
  flowSeedIds: string[];
  flowDirection: FlowDirection;
  flowDepth: number;
  search: string;
  selectedNodeIds: string[];
}

export const initialViewState: ViewState = {
  level: 'overview',
  focusId: null,
  showExternal: false,
  hiddenLayers: [],
  projectId: null,
  flowSeedIds: [],
  flowDirection: 'both',
  flowDepth: 6,
  search: '',
  selectedNodeIds: [],
};

export interface VisibleGraph {
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  /** Ids matching the current search term; empty when no search is active. */
  highlighted: Set<string>;
  /** Edges that carry data along the current trace, drawn as flowing. */
  flowEdgeIds: Set<string>;
  /** True when the trace was cut short by its depth or size limit. */
  flowTruncated: boolean;
}

export function computeVisibleGraph(graph: ArchitectureGraph, state: ViewState): VisibleGraph {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  let nodeIds: Set<string>;

  switch (state.level) {
    case 'overview':
      nodeIds = overviewNodeIds(graph, state);
      break;
    case 'module':
      nodeIds = moduleNodeIds(graph, state);
      break;
    case 'component':
      nodeIds = componentNodeIds(graph, state);
      break;
    case 'layers':
      nodeIds = layerNodeIds(graph);
      break;
    case 'flow':
      nodeIds = new Set(flowOf(graph, state).nodeIds);
      break;
    case 'full':
    default:
      nodeIds = new Set(graph.nodes.map((node) => node.id));
      break;
  }

  const hidden = new Set(state.hiddenLayers);
  for (const id of [...nodeIds]) {
    const node = byId.get(id);
    if (!node) {
      nodeIds.delete(id);
      continue;
    }
    if (!state.showExternal && node.type === 'external') {
      nodeIds.delete(id);
      continue;
    }
    // A trace shows the whole path: hiding a layer must not break the chain.
    if (state.level !== 'flow' && node.metadata?.layer && hidden.has(node.metadata.layer)) {
      nodeIds.delete(id);
      continue;
    }
    if (state.projectId && node.metadata?.projectId && node.metadata.projectId !== state.projectId) {
      nodeIds.delete(id);
    }
  }

  const nodes = graph.nodes.filter((node) => nodeIds.has(node.id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

  const flow = state.level === 'flow' ? flowOf(graph, state) : undefined;
  const flowEdgeIds = new Set(
    flow ? [...flow.edgeIds].filter((id) => edges.some((edge) => edge.id === id)) : [],
  );

  const term = state.search.trim().toLowerCase();
  const highlighted = new Set<string>(
    term.length === 0
      ? []
      : nodes
          .filter(
            (node) =>
              node.name.toLowerCase().includes(term) || (node.filePath ?? '').toLowerCase().includes(term),
          )
          .map((node) => node.id),
  );

  return { nodes, edges, highlighted, flowEdgeIds, flowTruncated: flow?.truncated ?? false };
}

/** The trace behind the flow view; also used to describe it in the inspector. */
export function flowOf(graph: ArchitectureGraph, state: ViewState) {
  return traceDataFlow(graph, state.flowSeedIds, {
    direction: state.flowDirection,
    maxDepth: state.flowDepth,
  });
}

/**
 * Layer view — the components of the system arranged by responsibility.
 * Modules and applications are left out: this view answers "what talks to what
 * across presentation, business and data", not "what lives where".
 */
function layerNodeIds(graph: ArchitectureGraph): Set<string> {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (node.metadata?.layer) {
      ids.add(node.id);
    }
  }
  return ids;
}

/**
 * Level 1 — the bird's-eye view.
 *
 * For a single application that is "app + modules + datastores". A monorepo
 * gets one level above that: the applications themselves, because 17 modules
 * from five apps side by side is not a bird's-eye view of anything. Selecting a
 * project (or double-clicking an application) drops into its modules.
 */
function overviewNodeIds(graph: ArchitectureGraph, state: ViewState): Set<string> {
  const ids = new Set<string>();
  const applicationCount = graph.nodes.filter((node) => node.type === 'application').length;
  const showModules = applicationCount <= 1 || state.projectId !== null;

  for (const node of graph.nodes) {
    if (node.type === 'application' || node.type === 'database') {
      ids.add(node.id);
    }
    if (showModules && node.type === 'module') {
      ids.add(node.id);
    }
    if (showModules && node.type === 'external' && node.metadata?.externalRole === 'module') {
      ids.add(node.id);
    }
  }

  // A module-less project still deserves a graph: fall back to everything.
  const hasModules = graph.nodes.some((node) => node.type === 'module');
  if (!hasModules && applicationCount <= 1) {
    return new Set(graph.nodes.map((node) => node.id));
  }

  return ids;
}

/** Level 2 — one module with the components it owns and their neighbours. */
function moduleNodeIds(graph: ArchitectureGraph, state: ViewState): Set<string> {
  const focusId = state.focusId;
  if (!focusId) {
    return overviewNodeIds(graph, state);
  }

  const ids = new Set<string>([focusId]);

  for (const edge of graph.edges) {
    if (edge.type === 'contains' && edge.source === focusId) {
      ids.add(edge.target);
    }
    if (edge.type === 'imports' && edge.source === focusId) {
      ids.add(edge.target);
    }
  }

  // One hop out of the module so cross-module dependencies and the datastores
  // the module writes to stay visible.
  const owned = new Set(ids);
  for (const edge of graph.edges) {
    if (edge.type !== 'injects' && edge.type !== 'persists') {
      continue;
    }
    if (owned.has(edge.source)) {
      ids.add(edge.target);
    }
    if (owned.has(edge.target)) {
      ids.add(edge.source);
    }
  }

  return ids;
}

/** Level 3 — a single component with its direct dependencies and dependents. */
function componentNodeIds(graph: ArchitectureGraph, state: ViewState): Set<string> {
  const focusId = state.focusId;
  if (!focusId) {
    return overviewNodeIds(graph, state);
  }

  const ids = new Set<string>([focusId]);
  for (const edge of graph.edges) {
    if (
      edge.type !== 'injects' &&
      edge.type !== 'imports' &&
      edge.type !== 'persists' &&
      edge.type !== 'references'
    ) {
      continue;
    }
    if (edge.source === focusId) {
      ids.add(edge.target);
    }
    if (edge.target === focusId) {
      ids.add(edge.source);
    }
  }
  return ids;
}

export interface Breadcrumb {
  id: string | null;
  label: string;
  level: ViewLevel;
  /** Set on the project crumb of a monorepo. */
  projectId?: string;
}

/** KESTREL / <app> / <module> / <component> */
export function computeBreadcrumbs(graph: ArchitectureGraph, state: ViewState): Breadcrumb[] {
  const crumbs: Breadcrumb[] = [{ id: null, label: 'KESTREL', level: 'overview' }];

  const applications = graph.nodes.filter((node) => node.type === 'application');
  if (applications.length === 1) {
    crumbs.push({ id: null, label: applications[0].name, level: 'overview' });
  } else if (applications.length > 1) {
    crumbs.push({ id: null, label: graph.metadata?.workspaceName ?? 'workspace', level: 'overview' });

    const project = graph.metadata?.projects.find((candidate) => candidate.id === state.projectId);
    if (project) {
      crumbs.push({ id: null, label: project.name, level: 'overview', projectId: project.id });
    }
  }

  if (state.level === 'layers') {
    crumbs.push({ id: null, label: 'Layers', level: 'layers' });
    return crumbs;
  }

  if (state.level === 'flow') {
    const seeds = state.flowSeedIds
      .map((id) => graph.nodes.find((node) => node.id === id)?.name)
      .filter((name): name is string => name !== undefined);
    crumbs.push({
      id: null,
      label: seeds.length > 0 ? `Data flow · ${seeds.join(', ')}` : 'Data flow',
      level: 'flow',
    });
    return crumbs;
  }

  if (state.level === 'overview' || state.level === 'full' || !state.focusId) {
    return crumbs;
  }

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const focus = byId.get(state.focusId);
  if (!focus) {
    return crumbs;
  }

  const ancestors: ArchitectureNode[] = [];
  let current: ArchitectureNode | undefined = focus;
  const guard = new Set<string>();

  while (current && !guard.has(current.id)) {
    guard.add(current.id);
    if (current.type !== 'application') {
      ancestors.unshift(current);
    }
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }

  for (const ancestor of ancestors) {
    crumbs.push({
      id: ancestor.id,
      label: ancestor.name,
      level: ancestor.type === 'module' ? 'module' : 'component',
    });
  }

  return crumbs;
}

export function findNode(graph: ArchitectureGraph, nodeId: string | null): ArchitectureNode | undefined {
  return nodeId ? graph.nodes.find((node) => node.id === nodeId) : undefined;
}
