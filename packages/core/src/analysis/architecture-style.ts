import type { ArchitectureGraph, ArchitectureNode, ArchitectureStyle, ProjectProfile } from '../models';

/**
 * Recognises architectural styles from the graph.
 *
 * Every verdict is derived from counted, checkable facts and ships with the
 * evidence that produced it. Nothing here asks a model what it thinks.
 */
export class ArchitectureStyleDetector {
  detect(graph: ArchitectureGraph): ArchitectureStyle[] {
    const projects = graph.metadata?.projects ?? [];
    const styles: ArchitectureStyle[] = [...detectWorkspaceStyles(graph, projects)];

    for (const project of projects) {
      styles.push(...detectProjectStyles(graph, project));
    }

    return styles;
  }
}

function detectWorkspaceStyles(
  graph: ArchitectureGraph,
  projects: readonly ProjectProfile[],
): ArchitectureStyle[] {
  const styles: ArchitectureStyle[] = [];
  const services = projects.filter((project) => project.kind === 'api' || project.kind === 'fullstack');

  if (projects.length > 1) {
    styles.push({
      id: 'monorepo',
      label: 'Monorepo',
      scope: 'workspace',
      confidence: 'high',
      description: 'Several packages live in one repository.',
      evidence: [`${projects.length} package.json files`, projects.map((p) => p.name).join(', ')],
    });
  }

  if (services.length >= 2) {
    styles.push({
      id: 'microservices',
      label: 'Multiple services',
      scope: 'workspace',
      confidence: 'medium',
      description: 'More than one deployable backend in the repository.',
      evidence: services.map((project) => `${project.name} (${project.kind})`),
    });
  }

  const ui = projects.filter((project) => project.kind === 'ui');
  if (ui.length > 0 && services.length > 0) {
    const uiCalls = graph.edges.filter(
      (edge) => edge.type === 'calls' && isControllerId(graph, edge.target),
    );
    styles.push({
      id: 'client-server',
      label: 'Client / server',
      scope: 'workspace',
      confidence: uiCalls.length > 0 ? 'high' : 'medium',
      description: 'A front-end talks to a backend API in the same repository.',
      evidence:
        uiCalls.length > 0
          ? [`${uiCalls.length} call(s) from the UI reach a controller`]
          : ['A UI project and an API project coexist'],
    });
  }

  return styles;
}

function detectProjectStyles(graph: ArchitectureGraph, project: ProjectProfile): ArchitectureStyle[] {
  const styles: ArchitectureStyle[] = [];
  const nodes = graph.nodes.filter((node) => node.metadata?.projectId === project.id);
  const of = (type: string): ArchitectureNode[] => nodes.filter((node) => node.type === type);
  const inLayer = (layer: string): ArchitectureNode[] =>
    nodes.filter((node) => node.metadata?.layer === layer);

  const modules = of('module').filter((node) => node.metadata?.role === 'module');
  const controllers = of('controller');
  const services = of('service');
  const entities = nodes.filter((node) => node.metadata?.role === 'entity');
  const repositories = nodes.filter((node) => node.metadata?.role === 'repository');

  if (modules.length >= 3 && project.kind !== 'ui') {
    styles.push({
      id: 'modular-monolith',
      label: 'Modular monolith',
      scope: project.id,
      confidence: modules.length >= 5 ? 'high' : 'medium',
      description: 'One deployable application split into feature modules.',
      evidence: [`${modules.length} modules`, `${controllers.length} controllers`],
    });
  }

  const layers = ['presentation', 'business', 'data'].filter((layer) => inLayer(layer).length > 0);
  if (layers.length === 3) {
    const { downward, upward } = countLayerDirections(graph, nodes);
    const total = downward + upward;
    const ratio = total === 0 ? 1 : downward / total;

    styles.push({
      id: 'layered',
      label: 'Layered',
      scope: project.id,
      confidence: ratio >= 0.9 ? 'high' : ratio >= 0.7 ? 'medium' : 'low',
      description: 'Presentation, business and data responsibilities are separated.',
      evidence: [
        `presentation ${inLayer('presentation').length} · business ${inLayer('business').length} · data ${
          inLayer('data').length
        }`,
        `${Math.round(ratio * 100)}% of dependencies point downward`,
      ],
    });
  }

  if (controllers.length > 0 && services.length > 0 && entities.length > 0) {
    styles.push({
      id: 'controller-service-model',
      label: 'Controller / service / model',
      scope: project.id,
      confidence: 'high',
      description: 'Requests enter through controllers, logic sits in services, state in models.',
      evidence: [
        `${controllers.length} controllers`,
        `${services.length} services`,
        `${entities.length} models`,
      ],
    });
  }

  if (repositories.length >= 2) {
    styles.push({
      id: 'repository-pattern',
      label: 'Repository pattern',
      scope: project.id,
      confidence: 'high',
      description: 'Data access is isolated behind repositories.',
      evidence: [`${repositories.length} repositories`],
    });
  }

  const folders = new Set(
    nodes.flatMap((node) => (node.filePath ?? '').split('/').map((segment) => segment.toLowerCase())),
  );
  if (folders.has('domain') && (folders.has('infrastructure') || folders.has('adapters'))) {
    styles.push({
      id: 'clean-architecture',
      label: 'Clean / hexagonal',
      scope: project.id,
      confidence: folders.has('ports') || folders.has('adapters') ? 'high' : 'medium',
      description: 'Domain code is kept apart from infrastructure.',
      evidence: [`folders: ${['domain', 'application', 'infrastructure', 'ports', 'adapters']
        .filter((folder) => folders.has(folder))
        .join(', ')}`],
    });
  }

  // Front-end styles
  const pages = of('page');
  const hooks = of('hook');
  const stores = of('store');
  const apiClients = of('api-client');

  if (pages.length > 0) {
    const routed = pages.filter((page) => typeof page.metadata?.route === 'string');
    styles.push({
      id: 'spa-routing',
      label: routed.length > 0 ? 'Routed SPA' : 'Page based UI',
      scope: project.id,
      confidence: routed.length > 0 ? 'high' : 'medium',
      description: 'The interface is organised as pages behind a router.',
      evidence: [`${pages.length} pages`, routed.length > 0 ? `${routed.length} routes declared` : ''].filter(
        Boolean,
      ),
    });
  }

  if (hooks.length >= 2 && apiClients.length > 0) {
    styles.push({
      id: 'hooks-data-layer',
      label: 'Hooks over a data client',
      scope: project.id,
      confidence: 'high',
      description: 'Components read data through hooks that wrap an API client.',
      evidence: [`${hooks.length} hooks`, `${apiClients.length} API client modules`],
    });
  }

  if (stores.length > 0) {
    styles.push({
      id: 'shared-state',
      label: 'Shared UI state',
      scope: project.id,
      confidence: 'medium',
      description: 'State is shared through contexts or stores.',
      evidence: [`${stores.length} store(s) / context provider(s)`],
    });
  }

  return styles;
}

const LAYER_DEPTH: Readonly<Record<string, number>> = {
  presentation: 0,
  business: 1,
  data: 2,
  infrastructure: 3,
  shared: 3,
};

/** Counts dependencies that respect the layer order against those that invert it. */
export function countLayerDirections(
  graph: ArchitectureGraph,
  nodes: readonly ArchitectureNode[],
): { downward: number; upward: number } {
  const layerById = new Map(
    nodes.map((node) => [node.id, node.metadata?.layer as string | undefined] as const),
  );
  let downward = 0;
  let upward = 0;

  for (const edge of graph.edges) {
    if (!DEPENDENCY_EDGES.has(edge.type)) {
      continue;
    }
    const from = layerById.get(edge.source);
    const to = layerById.get(edge.target);
    if (!from || !to || from === to) {
      continue;
    }
    const depth = LAYER_DEPTH[from] ?? 0;
    const targetDepth = LAYER_DEPTH[to] ?? 0;
    if (targetDepth >= depth) {
      downward += 1;
    } else {
      upward += 1;
    }
  }

  return { downward, upward };
}

export const DEPENDENCY_EDGES = new Set(['injects', 'calls', 'persists', 'renders']);

function isControllerId(graph: ArchitectureGraph, nodeId: string): boolean {
  return graph.nodes.some((node) => node.id === nodeId && node.type === 'controller');
}
