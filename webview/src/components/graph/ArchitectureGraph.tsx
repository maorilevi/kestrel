import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type OnSelectionChangeParams,
  type ReactFlowInstance,
} from '@xyflow/react';
import { useCallback, useEffect, useMemo } from 'react';

import type { VisibleGraph } from '../../state/view-state';
import type { ArchitectureNodeType } from '../../types/architecture';
import { ArchitectureEdgeView, type ArchitectureFlowEdge } from './ArchitectureEdge';
import { ArchitectureNodeView, type ArchitectureFlowNode } from './ArchitectureNode';
import { layoutGraph, nodeSize } from './layout';

const nodeTypes = { architecture: ArchitectureNodeView };
const edgeTypes = { architecture: ArchitectureEdgeView };

const MINIMAP_COLORS: Partial<Record<ArchitectureNodeType, string>> = {
  application: '#c8a2ff',
  module: '#7aa2f7',
  controller: '#7dcfff',
  service: '#9ece6a',
  page: '#7dcfff',
  component: '#89ddff',
  hook: '#9ece6a',
  store: '#9ece6a',
  'api-client': '#e0af68',
  database: '#e0af68',
  external: '#8a8f98',
};

export interface ArchitectureGraphProps {
  visible: VisibleGraph;
  focusId: string | null;
  selectedNodeIds: string[];
  onSelectionChange: (nodeIds: string[]) => void;
  onDive: (nodeId: string) => void;
  onReady: (instance: ReactFlowInstance<ArchitectureFlowNode, ArchitectureFlowEdge>) => void;
}

/**
 * React Flow is confined to this component: it receives an already-filtered
 * architecture graph and converts it into a visualization model.
 */
export function ArchitectureGraph({
  visible,
  focusId,
  selectedNodeIds,
  onSelectionChange,
  onDive,
  onReady,
}: ArchitectureGraphProps) {
  const { flowNodes, flowEdges, signature } = useMemo(() => {
    const positions = layoutGraph(visible.nodes, visible.edges);
    const hasSearch = visible.highlighted.size > 0;

    const childCounts = new Map<string, number>();
    const dependencyCounts = new Map<string, number>();
    for (const edge of visible.edges) {
      if (edge.type === 'contains') {
        childCounts.set(edge.source, (childCounts.get(edge.source) ?? 0) + 1);
      } else if (edge.type === 'injects' || edge.type === 'imports') {
        dependencyCounts.set(edge.source, (dependencyCounts.get(edge.source) ?? 0) + 1);
      }
    }

    const nodes: ArchitectureFlowNode[] = visible.nodes.map((node) => {
      const size = nodeSize(node.type);
      return {
        id: node.id,
        type: 'architecture',
        position: positions.get(node.id) ?? { x: 0, y: 0 },
        width: size.width,
        height: size.height,
        selected: selectedNodeIds.includes(node.id),
        data: {
          arch: node,
          dimmed: hasSearch && !visible.highlighted.has(node.id),
          isFocus: node.id === focusId,
          childCount: childCounts.get(node.id) ?? 0,
          dependencyCount: dependencyCounts.get(node.id) ?? 0,
        },
      };
    });

    const edges: ArchitectureFlowEdge[] = visible.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'architecture',
      // Edges on a data-flow trace animate, so the direction of the data reads
      // at a glance instead of having to follow arrowheads.
      animated: visible.flowEdgeIds.has(edge.id),
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      data: {
        archType: edge.type,
        onFlow: visible.flowEdgeIds.has(edge.id),
        dimmed:
          hasSearch && !(visible.highlighted.has(edge.source) || visible.highlighted.has(edge.target)),
      },
    }));

    return {
      flowNodes: nodes,
      flowEdges: edges,
      signature: `${visible.nodes.map((node) => node.id).join('|')}::${visible.edges
        .map((edge) => edge.id)
        .join('|')}`,
    };
  }, [visible, focusId, selectedNodeIds]);

  const [nodes, setNodes, onNodesChange] = useNodesState<ArchitectureFlowNode>(flowNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState<ArchitectureFlowEdge>(flowEdges);

  // Re-layout only when the visible set changes; dragging survives re-renders.
  useEffect(() => {
    setNodes(flowNodes);
    setEdges(flowEdges);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  // Keep selection and highlighting in sync without discarding node positions.
  useEffect(() => {
    setNodes((current) =>
      current.map((node) => {
        const next = flowNodes.find((candidate) => candidate.id === node.id);
        return next ? { ...node, selected: next.selected, data: next.data } : node;
      }),
    );
    setEdges((current) =>
      current.map((edge) => {
        const next = flowEdges.find((candidate) => candidate.id === edge.id);
        return next ? { ...edge, data: next.data, animated: next.animated } : edge;
      }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowNodes, flowEdges]);

  const handleSelectionChange = useCallback(
    (params: OnSelectionChangeParams<ArchitectureFlowNode>) => {
      onSelectionChange(params.nodes.map((node) => node.id));
    },
    [onSelectionChange],
  );

  if (visible.nodes.length === 0) {
    return (
      <div className="kestrel-graph kestrel-graph--empty">
        <p>Nothing to display at this level.</p>
      </div>
    );
  }

  return (
    <div className="kestrel-graph">
      <ReactFlow<ArchitectureFlowNode, ArchitectureFlowEdge>
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onSelectionChange={handleSelectionChange}
        onNodeDoubleClick={(_event, node) => onDive(node.id)}
        onInit={onReady}
        fitView
        // Never zoom out past readability: panning beats an unreadable strip.
        fitViewOptions={{ padding: 0.2, minZoom: 0.45, maxZoom: 1.1 }}
        minZoom={0.1}
        maxZoom={2}
        nodesDraggable
        elementsSelectable
        multiSelectionKeyCode={['Meta', 'Control']}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="kestrel-background" />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          className="kestrel-minimap"
          nodeColor={(node) =>
            MINIMAP_COLORS[(node as ArchitectureFlowNode).data.arch.type] ?? '#8a8f98'
          }
        />
      </ReactFlow>
    </div>
  );
}
