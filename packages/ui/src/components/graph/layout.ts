import dagre from '@dagrejs/dagre';

import type { ArchitectureEdge, ArchitectureNode, ArchitectureNodeType } from '../../types/architecture';

export interface NodeSize {
  width: number;
  height: number;
}

export interface LayoutPosition {
  x: number;
  y: number;
}

const DEFAULT_SIZE: NodeSize = { width: 210, height: 64 };

const SIZES: Partial<Record<ArchitectureNodeType, NodeSize>> = {
  application: { width: 230, height: 64 },
  module: { width: 220, height: 68 },
  external: { width: 190, height: 56 },
};

export function nodeSize(type: ArchitectureNodeType): NodeSize {
  return SIZES[type] ?? DEFAULT_SIZE;
}

/**
 * Hierarchical top-to-bottom layout.
 *
 * Containment edges drive the hierarchy; dependency edges are laid out with a
 * lower weight so they bend around the tree instead of distorting it. This is
 * what keeps the bird's-eye view readable rather than a spaghetti graph.
 */
export function layoutGraph(
  nodes: readonly ArchitectureNode[],
  edges: readonly ArchitectureEdge[],
): Map<string, LayoutPosition> {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({
    rankdir: 'TB',
    nodesep: 48,
    ranksep: 96,
    marginx: 32,
    marginy: 32,
    ranker: 'tight-tree',
  });

  for (const node of nodes) {
    const size = nodeSize(node.type);
    graph.setNode(node.id, { width: size.width, height: size.height });
  }

  for (const edge of edges) {
    if (!graph.hasNode(edge.source) || !graph.hasNode(edge.target)) {
      continue;
    }
    graph.setEdge(
      edge.source,
      edge.target,
      { weight: edge.type === 'contains' ? 4 : 1, minlen: 1 },
      edge.id,
    );
  }

  dagre.layout(graph);

  const positions = new Map<string, LayoutPosition>();
  for (const node of nodes) {
    const laidOut = graph.node(node.id) as { x?: number; y?: number } | undefined;
    const size = nodeSize(node.type);
    positions.set(node.id, {
      x: (laidOut?.x ?? 0) - size.width / 2,
      y: (laidOut?.y ?? 0) - size.height / 2,
    });
  }

  return wrapWideRows(nodes, positions);
}

/** Beyond this many siblings on one rank, a row is wrapped into a block. */
const MAX_NODES_PER_ROW = 7;
const ROW_GAP = 28;
const COLUMN_GAP = 28;

/**
 * Dagre puts every sibling on a single rank, so a module with twenty children
 * becomes a strip thousands of pixels wide that is illegible once fitted to the
 * viewport. Wide ranks are re-flowed into a compact block and everything below
 * is pushed down to make room.
 */
function wrapWideRows(
  nodes: readonly ArchitectureNode[],
  positions: Map<string, LayoutPosition>,
): Map<string, LayoutPosition> {
  const ranks = new Map<number, ArchitectureNode[]>();
  for (const node of nodes) {
    const y = Math.round(positions.get(node.id)?.y ?? 0);
    const rank = ranks.get(y);
    if (rank) {
      rank.push(node);
    } else {
      ranks.set(y, [node]);
    }
  }

  const orderedRanks = [...ranks.entries()].sort((left, right) => left[0] - right[0]);
  let shift = 0;

  for (const [top, rankNodes] of orderedRanks) {
    for (const node of rankNodes) {
      const position = positions.get(node.id);
      if (position) {
        position.y += shift;
      }
    }

    if (rankNodes.length <= MAX_NODES_PER_ROW) {
      continue;
    }

    const sorted = [...rankNodes].sort(
      (left, right) => (positions.get(left.id)?.x ?? 0) - (positions.get(right.id)?.x ?? 0),
    );
    const columnWidth = Math.max(...sorted.map((node) => nodeSize(node.type).width)) + COLUMN_GAP;
    const rowHeight = Math.max(...sorted.map((node) => nodeSize(node.type).height)) + ROW_GAP;
    const columns = Math.ceil(Math.sqrt(sorted.length));
    const perRow = Math.max(MAX_NODES_PER_ROW, Math.min(columns, sorted.length));
    const rows = Math.ceil(sorted.length / perRow);

    const centre = average(sorted.map((node) => positions.get(node.id)?.x ?? 0));
    const left = centre - ((perRow - 1) * columnWidth) / 2;

    sorted.forEach((node, index) => {
      const position = positions.get(node.id);
      if (!position) {
        return;
      }
      position.x = left + (index % perRow) * columnWidth;
      position.y = top + shift + Math.floor(index / perRow) * rowHeight;
    });

    shift += (rows - 1) * rowHeight;
  }

  return positions;
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}
