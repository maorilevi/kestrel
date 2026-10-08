import type { ArchitectureEdge, ArchitectureEdgeType, ArchitectureGraph } from '../types/architecture';

/**
 * Traces how data moves through the system.
 *
 * Only edges that actually carry data are followed: a call, an injected
 * collaborator, a write to a model, a relation between models. Containment and
 * JSX composition describe structure, not flow, so they are left out — that is
 * what keeps a trace readable instead of collapsing into the whole graph.
 */

export const DATA_FLOW_EDGES: ReadonlySet<ArchitectureEdgeType> = new Set<ArchitectureEdgeType>([
  'calls',
  'injects',
  'persists',
  'references',
]);

export type FlowDirection = 'downstream' | 'upstream' | 'both';

export interface FlowStep {
  edge: ArchitectureEdge;
  /** Hops from the nearest seed; 1 is a direct neighbour. */
  depth: number;
  direction: 'downstream' | 'upstream';
}

export interface DataFlow {
  /** Every node on the trace, seeds included. */
  nodeIds: Set<string>;
  /** Every edge on the trace. */
  edgeIds: Set<string>;
  steps: FlowStep[];
  /** True when the trace hit its depth or size limit. */
  truncated: boolean;
}

export interface TraceOptions {
  direction?: FlowDirection;
  maxDepth?: number;
  maxNodes?: number;
}

export function traceDataFlow(
  graph: ArchitectureGraph,
  seedIds: readonly string[],
  options: TraceOptions = {},
): DataFlow {
  const direction = options.direction ?? 'both';
  const maxDepth = options.maxDepth ?? 6;
  const maxNodes = options.maxNodes ?? 80;

  const outgoing = new Map<string, ArchitectureEdge[]>();
  const incoming = new Map<string, ArchitectureEdge[]>();

  for (const edge of graph.edges) {
    if (!DATA_FLOW_EDGES.has(edge.type)) {
      continue;
    }
    push(outgoing, edge.source, edge);
    push(incoming, edge.target, edge);
  }

  const nodeIds = new Set<string>(seedIds);
  const edgeIds = new Set<string>();
  const steps: FlowStep[] = [];
  let truncated = false;

  const walk = (way: 'downstream' | 'upstream'): void => {
    const adjacency = way === 'downstream' ? outgoing : incoming;
    const seen = new Set<string>(seedIds);
    let frontier = [...seedIds];

    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
      const next: string[] = [];

      for (const nodeId of frontier) {
        for (const edge of adjacency.get(nodeId) ?? []) {
          const neighbour = way === 'downstream' ? edge.target : edge.source;

          if (!edgeIds.has(edge.id)) {
            edgeIds.add(edge.id);
            steps.push({ edge, depth, direction: way });
          }

          if (seen.has(neighbour)) {
            continue;
          }
          if (nodeIds.size >= maxNodes) {
            truncated = true;
            continue;
          }

          seen.add(neighbour);
          nodeIds.add(neighbour);
          next.push(neighbour);
        }
      }

      if (depth === maxDepth && next.length > 0) {
        truncated = true;
      }
      frontier = next;
    }
  };

  if (direction === 'downstream' || direction === 'both') {
    walk('downstream');
  }
  if (direction === 'upstream' || direction === 'both') {
    walk('upstream');
  }

  steps.sort((left, right) => left.depth - right.depth || left.edge.id.localeCompare(right.edge.id));

  return { nodeIds, edgeIds, steps, truncated };
}

export interface FlowLeg {
  fromId: string;
  toId: string;
  from: string;
  to: string;
  type: ArchitectureEdgeType;
  detail?: string;
}

/**
 * The longest end-to-end chains in a trace, as readable paths — the shape a
 * developer actually wants: entry point → … → datastore.
 */
export function describeFlowPaths(
  graph: ArchitectureGraph,
  flow: DataFlow,
  seedIds: readonly string[],
  limit = 6,
): FlowLeg[][] {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const nameOf = (id: string): string => byId.get(id)?.name ?? id;

  const outgoing = new Map<string, ArchitectureEdge[]>();
  for (const step of flow.steps) {
    push(outgoing, step.edge.source, step.edge);
  }

  // Entry points: nodes on the trace that nothing else on the trace reaches.
  const reached = new Set(flow.steps.map((step) => step.edge.target));
  const entries = [...flow.nodeIds].filter((id) => !reached.has(id));
  const starts = entries.length > 0 ? entries : [...seedIds];

  const paths: FlowLeg[][] = [];

  const walk = (nodeId: string, legs: FlowLeg[], visited: Set<string>): void => {
    if (paths.length >= limit) {
      return;
    }
    const next = (outgoing.get(nodeId) ?? []).filter((edge) => !visited.has(edge.target));

    if (next.length === 0) {
      if (legs.length > 0) {
        paths.push(legs);
      }
      return;
    }

    for (const edge of next) {
      walk(
        edge.target,
        [
          ...legs,
          {
            fromId: edge.source,
            toId: edge.target,
            from: nameOf(edge.source),
            to: nameOf(edge.target),
            type: edge.type,
            detail: edge.metadata?.propertyName ?? edge.metadata?.via,
          },
        ],
        new Set([...visited, edge.target]),
      );
    }
  };

  for (const start of starts) {
    walk(start, [], new Set([start]));
  }

  // Longest first: the most complete story about the data.
  return paths.sort((left, right) => right.length - left.length).slice(0, limit);
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}
