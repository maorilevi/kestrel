import type { ArchitectureEdgeType } from './architecture-edge';
import type { ArchitectureGraph } from './architecture-graph';
import type { ArchitectureNodeType } from './architecture-node';

export interface DiffNode {
  id: string;
  name: string;
  type: ArchitectureNodeType;
}

export interface DiffEdge {
  source: string;
  target: string;
  type: ArchitectureEdgeType;
}

/**
 * How the architecture changed between two builds. This is what an agent's
 * work looks like from above: which components appeared, disappeared or
 * changed shape, and which relationships were made or broken.
 */
export interface ArchitectureDiff {
  addedNodes: DiffNode[];
  removedNodes: DiffNode[];
  /** Same id, different shape: kind, parent, routes, endpoints or methods. */
  changedNodes: DiffNode[];
  addedEdges: DiffEdge[];
  removedEdges: DiffEdge[];
}

/** Containment is layout, not architecture; it changes whenever a node does. */
const IGNORED_EDGES: ReadonlySet<ArchitectureEdgeType> = new Set(['contains']);

/** Metadata that describes a node's shape. Lines move on every edit and are not compared. */
const SHAPE_KEYS = ['role', 'layer', 'route', 'globalPrefix', 'methods', 'endpoints', 'archetype', 'kind'] as const;

export function diffGraphs(before: ArchitectureGraph, after: ArchitectureGraph): ArchitectureDiff {
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const summary = (node: { id: string; name: string; type: ArchitectureNodeType }): DiffNode => ({
    id: node.id,
    name: node.name,
    type: node.type,
  });

  const addedNodes: DiffNode[] = [];
  const changedNodes: DiffNode[] = [];
  for (const node of after.nodes) {
    const previous = beforeNodes.get(node.id);
    if (!previous) {
      addedNodes.push(summary(node));
    } else if (shapeOf(previous) !== shapeOf(node)) {
      changedNodes.push(summary(node));
    }
  }
  const removedNodes = before.nodes.filter((node) => !afterNodes.has(node.id)).map(summary);

  const edgeKey = (edge: DiffEdge): string => `${edge.type}|${edge.source}|${edge.target}`;
  const edgesOf = (graph: ArchitectureGraph): Map<string, DiffEdge> =>
    new Map(
      graph.edges
        .filter((edge) => !IGNORED_EDGES.has(edge.type))
        .map((edge) => {
          const summaryEdge = { source: edge.source, target: edge.target, type: edge.type };
          return [edgeKey(summaryEdge), summaryEdge];
        }),
    );
  const beforeEdges = edgesOf(before);
  const afterEdges = edgesOf(after);

  // A node whose dependencies changed has changed shape too.
  const touched = new Set<string>();
  const addedEdges = [...afterEdges].filter(([key]) => !beforeEdges.has(key)).map(([, edge]) => edge);
  const removedEdges = [...beforeEdges].filter(([key]) => !afterEdges.has(key)).map(([, edge]) => edge);
  for (const edge of [...addedEdges, ...removedEdges]) {
    touched.add(edge.source);
  }
  const known = new Set([...addedNodes, ...changedNodes].map((node) => node.id));
  for (const id of touched) {
    const node = afterNodes.get(id);
    if (node && beforeNodes.has(id) && !known.has(id)) {
      changedNodes.push(summary(node));
    }
  }

  return { addedNodes, removedNodes, changedNodes, addedEdges, removedEdges };
}

export function isEmptyDiff(diff: ArchitectureDiff): boolean {
  return (
    diff.addedNodes.length === 0 &&
    diff.removedNodes.length === 0 &&
    diff.changedNodes.length === 0 &&
    diff.addedEdges.length === 0 &&
    diff.removedEdges.length === 0
  );
}

function shapeOf(node: ArchitectureGraph['nodes'][number]): string {
  const metadata = (node.metadata ?? {}) as Record<string, unknown>;
  return JSON.stringify([node.type, node.parentId ?? null, ...SHAPE_KEYS.map((key) => metadata[key] ?? null)]);
}
