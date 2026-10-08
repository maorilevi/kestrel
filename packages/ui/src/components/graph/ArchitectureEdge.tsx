import { BaseEdge, getSmoothStepPath, type Edge, type EdgeProps } from '@xyflow/react';

import type { ArchitectureEdgeType } from '../../types/architecture';

export type ArchitectureFlowEdgeData = {
  archType: ArchitectureEdgeType;
  dimmed: boolean;
  /** True when this edge is part of the current data-flow trace. */
  onFlow?: boolean;
};

export type ArchitectureFlowEdge = Edge<ArchitectureFlowEdgeData, 'architecture'>;

/**
 * Edge renderer. The architecture edge type is encoded visually
 * (containment = dashed, imports = accent, injects = solid) instead of with
 * labels, which keeps large graphs readable.
 */
export function ArchitectureEdgeView({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
  selected,
}: EdgeProps<ArchitectureFlowEdge>) {
  const [path] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    borderRadius: 8,
  });

  const archType = data?.archType ?? 'calls';
  const className = [
    'kestrel-edge',
    `kestrel-edge--${archType}`,
    data?.onFlow ? 'is-flowing' : '',
    selected ? 'is-selected' : '',
    data?.dimmed ? 'is-dimmed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return <BaseEdge path={path} markerEnd={markerEnd} className={className} />;
}
