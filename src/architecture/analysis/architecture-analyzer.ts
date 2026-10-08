import type { ArchitectureEdge, ArchitectureGraph, ArchitectureIssue } from '../models';

export interface AnalyzerThresholds {
  /** Outgoing dependencies before a service counts as doing too much. */
  godServiceDependencies: number;
  /** Incoming dependencies before a service counts as a hub. */
  godServiceDependents: number;
  /** Dependencies before a controller counts as fat. */
  fatControllerDependencies: number;
}

export const DEFAULT_THRESHOLDS: AnalyzerThresholds = {
  godServiceDependencies: 8,
  godServiceDependents: 10,
  fatControllerDependencies: 5,
};

/**
 * Deterministic architecture checks derived purely from the graph.
 *
 * No AI is involved: everything reported here is proven from nodes and edges,
 * and every finding names the nodes it is about plus what to do next.
 */
export class ArchitectureAnalyzer {
  constructor(private readonly thresholds: AnalyzerThresholds = DEFAULT_THRESHOLDS) {}

  analyze(graph: ArchitectureGraph): ArchitectureIssue[] {
    return [
      ...findCycles(graph, 'injects'),
      ...findCycles(graph, 'imports'),
      ...findLayerViolations(graph),
      ...findDirectDataAccess(graph),
      ...findOverloadedNodes(graph, this.thresholds),
      ...findUnusedProviders(graph),
      ...findCrossModuleAccess(graph),
    ].sort(bySeverity);
  }
}

const SEVERITY_ORDER: Record<ArchitectureIssue['severity'], number> = { error: 0, warning: 1, info: 2 };

function bySeverity(left: ArchitectureIssue, right: ArchitectureIssue): number {
  const bucket = SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
  return bucket !== 0 ? bucket : left.id.localeCompare(right.id);
}

const LAYER_DEPTH: Readonly<Record<string, number>> = {
  presentation: 0,
  business: 1,
  data: 2,
};

const DEPENDENCY_EDGES = new Set(['injects', 'calls', 'persists', 'renders']);

/** A dependency that points from a lower layer back up to a higher one. */
function findLayerViolations(graph: ArchitectureGraph): ArchitectureIssue[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const issues: ArchitectureIssue[] = [];

  for (const edge of graph.edges) {
    if (!DEPENDENCY_EDGES.has(edge.type)) {
      continue;
    }
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    const from = LAYER_DEPTH[String(source?.metadata?.layer)];
    const to = LAYER_DEPTH[String(target?.metadata?.layer)];

    if (source === undefined || target === undefined || from === undefined || to === undefined) {
      continue;
    }

    // A UI data client calling a backend controller crosses the network, not a
    // layer boundary. Layering is only meaningful inside one application.
    if (source.metadata?.projectId !== target.metadata?.projectId) {
      continue;
    }

    if (to < from) {
      issues.push({
        id: `layer-violation:${edge.id}`,
        type: 'layer-violation',
        severity: 'warning',
        message: `${source.name} (${source.metadata?.layer}) depends on ${target.name} (${target.metadata?.layer})`,
        hint: 'Dependencies should point from presentation towards data. Invert this one, or move the shared code into the lower layer.',
        nodeIds: [source.id, target.id],
      });
    }
  }

  return issues;
}

/** Presentation code reaching the datastore without a business layer in between. */
function findDirectDataAccess(graph: ArchitectureGraph): ArchitectureIssue[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const issues: ArchitectureIssue[] = [];

  for (const edge of graph.edges) {
    if (edge.type !== 'persists') {
      continue;
    }
    const source = byId.get(edge.source);
    if (!source || source.metadata?.layer !== 'presentation') {
      continue;
    }
    const target = byId.get(edge.target);

    issues.push({
      id: `direct-data-access:${edge.id}`,
      type: source.type === 'controller' ? 'direct-data-access' : 'ui-data-access',
      severity: 'warning',
      message: `${source.name} reads or writes ${target?.name ?? 'the datastore'} directly`,
      hint:
        source.type === 'controller'
          ? 'Move the query into a service so the controller only handles the request.'
          : 'Fetch through a hook or an API client instead of calling the datastore from a component.',
      nodeIds: [source.id, ...(target ? [target.id] : [])],
    });
  }

  return issues;
}

/** Services that do too much, and controllers that pull in too many collaborators. */
function findOverloadedNodes(graph: ArchitectureGraph, thresholds: AnalyzerThresholds): ArchitectureIssue[] {
  const issues: ArchitectureIssue[] = [];
  const outgoing = new Map<string, ArchitectureEdge[]>();
  const incoming = new Map<string, ArchitectureEdge[]>();

  for (const edge of graph.edges) {
    if (!DEPENDENCY_EDGES.has(edge.type)) {
      continue;
    }
    push(outgoing, edge.source, edge);
    push(incoming, edge.target, edge);
  }

  for (const node of graph.nodes) {
    const dependencies = outgoing.get(node.id)?.length ?? 0;
    const dependents = incoming.get(node.id)?.length ?? 0;

    if (node.type === 'controller' && dependencies > thresholds.fatControllerDependencies) {
      issues.push({
        id: `fat-controller:${node.id}`,
        type: 'fat-controller',
        severity: 'info',
        message: `${node.name} depends on ${dependencies} collaborators`,
        hint: 'A controller usually needs one service. Consider splitting the endpoints across controllers.',
        nodeIds: [node.id],
      });
      continue;
    }

    if (node.type !== 'service') {
      continue;
    }

    if (dependencies > thresholds.godServiceDependencies) {
      issues.push({
        id: `god-service:${node.id}`,
        type: 'god-service',
        severity: 'warning',
        message: `${node.name} depends on ${dependencies} other components`,
        hint: 'Split the responsibilities: a service with this many dependencies is doing several jobs.',
        nodeIds: [node.id],
      });
    } else if (dependents > thresholds.godServiceDependents) {
      issues.push({
        id: `high-coupling:${node.id}`,
        type: 'high-coupling',
        severity: 'info',
        message: `${node.name} is used by ${dependents} components`,
        hint: 'Widely used code is expensive to change. Keep its interface small and stable.',
        nodeIds: [node.id],
      });
    }
  }

  return issues;
}

/** Providers a module declares but nobody injects and the module does not export. */
function findUnusedProviders(graph: ArchitectureGraph): ArchitectureIssue[] {
  const used = new Set<string>();
  for (const edge of graph.edges) {
    if (DEPENDENCY_EDGES.has(edge.type)) {
      used.add(edge.target);
    }
  }

  const exported = new Set(
    graph.nodes.flatMap((node) => (node.metadata?.exports as string[] | undefined) ?? []),
  );

  const issues: ArchitectureIssue[] = [];
  for (const node of graph.nodes) {
    if (node.type !== 'service' || used.has(node.id) || exported.has(node.id)) {
      continue;
    }
    // Only providers a module actually declares; loose classes are not a finding.
    const declared = graph.edges.some((edge) => edge.type === 'contains' && edge.target === node.id);
    const owner = graph.nodes.find((candidate) => candidate.id === node.parentId);
    if (!declared || owner?.type !== 'module') {
      continue;
    }

    issues.push({
      id: `unused-service:${node.id}`,
      type: 'unused-service',
      severity: 'info',
      message: `${node.name} is declared by ${owner.name} but never injected or exported`,
      hint: 'Either it is dead code, or the module should export it.',
      nodeIds: [node.id, owner.id],
    });
  }

  return issues;
}

/** A component injecting a provider owned by another module that never exports it. */
function findCrossModuleAccess(graph: ArchitectureGraph): ArchitectureIssue[] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const issues: ArchitectureIssue[] = [];

  for (const edge of graph.edges) {
    if (edge.type !== 'injects') {
      continue;
    }
    const source = byId.get(edge.source);
    const target = byId.get(edge.target);
    if (!source?.parentId || !target?.parentId || source.parentId === target.parentId) {
      continue;
    }

    const owner = byId.get(target.parentId);
    if (owner?.type !== 'module') {
      continue;
    }

    const exports = (owner.metadata?.exports as string[] | undefined) ?? [];
    if (exports.includes(target.id)) {
      continue;
    }

    issues.push({
      id: `cross-module-access:${edge.id}`,
      type: 'cross-module-access',
      severity: 'warning',
      message: `${source.name} injects ${target.name}, which ${owner.name} does not export`,
      hint: `Add ${target.name} to the exports of ${owner.name}, or move it into a shared module.`,
      nodeIds: [source.id, target.id, owner.id],
    });
  }

  return issues;
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

function findCycles(graph: ArchitectureGraph, edgeType: 'injects' | 'imports'): ArchitectureIssue[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (edge.type !== edgeType || edge.metadata?.forwardRef) {
      continue;
    }
    const targets = adjacency.get(edge.source);
    if (targets) {
      targets.push(edge.target);
    } else {
      adjacency.set(edge.source, [edge.target]);
    }
  }

  const names = new Map(graph.nodes.map((node) => [node.id, node.name]));
  const issues: ArchitectureIssue[] = [];
  const seenCycles = new Set<string>();

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];

  const visit = (nodeId: string): void => {
    visiting.add(nodeId);
    stack.push(nodeId);

    for (const next of adjacency.get(nodeId) ?? []) {
      if (visiting.has(next)) {
        const cycle = stack.slice(stack.indexOf(next));
        const key = canonicalCycleKey(cycle);
        if (!seenCycles.has(key)) {
          seenCycles.add(key);
          issues.push({
            id: `circular-dependency:${edgeType}:${key}`,
            type: 'circular-dependency',
            severity: 'warning',
            message: `Circular ${edgeType === 'imports' ? 'module import' : 'dependency'}: ${[...cycle, next]
              .map((id) => names.get(id) ?? id)
              .join(' → ')}`,
            hint:
              edgeType === 'imports'
                ? 'Extract the shared part into a module both can import, or use forwardRef deliberately.'
                : 'Move the shared logic into a third component, or invert one of the dependencies.',
            nodeIds: cycle,
          });
        }
        continue;
      }
      if (!visited.has(next)) {
        visit(next);
      }
    }

    stack.pop();
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      visit(node.id);
    }
  }

  return issues;
}

/** Rotation independent key so `A→B→A` and `B→A→B` count as one cycle. */
function canonicalCycleKey(cycle: readonly string[]): string {
  if (cycle.length === 0) {
    return '';
  }
  const rotations = cycle.map((_, offset) => [...cycle.slice(offset), ...cycle.slice(0, offset)].join('->'));
  return rotations.sort()[0];
}
