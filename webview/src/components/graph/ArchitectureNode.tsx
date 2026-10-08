import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import type { ArchitectureNode, ArchitectureNodeType } from '../../types/architecture';

export type ArchitectureFlowNodeData = {
  arch: ArchitectureNode;
  dimmed: boolean;
  isFocus: boolean;
  childCount: number;
  dependencyCount: number;
};

export type ArchitectureFlowNode = Node<ArchitectureFlowNodeData, 'architecture'>;

/** Routes are stored without a leading slash on the backend, with one on the UI. */
function formatRoute(route: string): string {
  return route.startsWith('/') ? route : `/${route}`;
}

const TYPE_LABELS: Record<ArchitectureNodeType, string> = {
  application: 'APPLICATION',
  module: 'MODULE',
  controller: 'CONTROLLER',
  service: 'SERVICE',
  repository: 'REPOSITORY',
  component: 'COMPONENT',
  page: 'PAGE',
  hook: 'HOOK',
  store: 'STORE',
  'api-client': 'API CLIENT',
  class: 'CLASS',
  database: 'DATABASE',
  queue: 'QUEUE',
  external: 'EXTERNAL',
};

/** Visual representation of one architecture node. */
export function ArchitectureNodeView({ data, selected }: NodeProps<ArchitectureFlowNode>) {
  const { arch } = data;
  const role = arch.metadata?.role;
  const typeLabel = TYPE_LABELS[arch.type] ?? arch.type.toUpperCase();
  const subtitle = role && role !== arch.type ? `${typeLabel} · ${String(role).toUpperCase()}` : typeLabel;

  const layer = arch.metadata?.layer;
  const classNames = [
    'kestrel-node',
    `kestrel-node--${arch.type}`,
    layer ? `kestrel-node--layer-${layer}` : '',
    selected ? 'is-selected' : '',
    data.dimmed ? 'is-dimmed' : '',
    data.isFocus ? 'is-focus' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classNames} title={arch.filePath ?? arch.name}>
      <Handle type="target" position={Position.Top} className="kestrel-handle" />

      <div className="kestrel-node__type">{subtitle}</div>
      <div className="kestrel-node__name">{arch.name}</div>

      <div className="kestrel-node__meta">
        {layer ? <span className={`kestrel-badge kestrel-badge--${layer}`}>{layer}</span> : null}
        {arch.type === 'application' && arch.metadata?.archetypeLabel ? (
          <span className="kestrel-badge">{String(arch.metadata.archetypeLabel)}</span>
        ) : null}
        {arch.type === 'application' && arch.metadata?.primaryFramework ? (
          <span className="kestrel-badge">{String(arch.metadata.primaryFramework)}</span>
        ) : null}
        {arch.type === 'database' && arch.metadata?.access ? (
          <span className="kestrel-badge">{String(arch.metadata.access)}</span>
        ) : null}
        {arch.metadata?.accessesDatabase ? <span className="kestrel-badge">db</span> : null}
        {arch.metadata?.role === 'entity' && typeof arch.metadata.fieldCount === 'number' ? (
          <span className="kestrel-badge">{arch.metadata.fieldCount} fields</span>
        ) : null}
        {arch.metadata?.route !== undefined && (arch.type === 'controller' || arch.type === 'page') ? (
          <span className="kestrel-badge">{formatRoute(String(arch.metadata.route))}</span>
        ) : null}
        {Array.isArray(arch.metadata?.endpoints) && arch.metadata.endpoints.length > 0 ? (
          <span className="kestrel-badge">{arch.metadata.endpoints.length} endpoint(s)</span>
        ) : null}
        {data.childCount > 0 ? <span className="kestrel-badge">{data.childCount} inside</span> : null}
        {data.dependencyCount > 0 ? (
          <span className="kestrel-badge">{data.dependencyCount} deps</span>
        ) : null}
        {arch.metadata?.unresolved ? <span className="kestrel-badge">external</span> : null}
      </div>

      <Handle type="source" position={Position.Bottom} className="kestrel-handle" />
    </div>
  );
}
