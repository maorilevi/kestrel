import type { ReactNode } from 'react';

import type { FlowDirection, FlowLeg } from '../state/data-flow';

import {
  LAYER_LABELS,
  PROJECT_KIND_LABELS,
  type ArchitectureGraph,
  type ArchitectureLayer,
  type ArchitectureNode,
  type ProjectProfile,
} from '../types/architecture';

export interface NodeDetailsProps {
  graph: ArchitectureGraph;
  selectedNodes: ArchitectureNode[];
  /** End-to-end paths of the current trace, longest first. */
  flowPaths: FlowLeg[][];
  flowDirection: FlowDirection;
  flowTruncated: boolean;
  isTracing: boolean;
  onOpenFile: (node: ArchitectureNode) => void;
  onSelect: (nodeId: string) => void;
  onDive: (nodeId: string) => void;
  onAskAgent: (nodeIds: string[]) => void;
  onTraceFlow: (nodeIds: string[], direction?: FlowDirection) => void;
}

interface Relation {
  node: ArchitectureNode;
  detail?: string;
}

/** Inspector for the current selection. Multi-selection is already supported. */
export function NodeDetails({
  graph,
  selectedNodes,
  flowPaths,
  flowDirection,
  flowTruncated,
  isTracing,
  onOpenFile,
  onSelect,
  onDive,
  onAskAgent,
  onTraceFlow,
}: NodeDetailsProps) {
  if (selectedNodes.length === 0) {
    return (
      <aside className="kestrel-inspector kestrel-inspector--empty">
        <h2>Inspector</h2>
        <p>Select a node to inspect it.</p>
        <p className="kestrel-hint">Double-click a module to dive into it.</p>
      </aside>
    );
  }

  if (selectedNodes.length > 1) {
    return (
      <aside className="kestrel-inspector">
        <h2>{selectedNodes.length} nodes selected</h2>
        <ul className="kestrel-relations">
          {selectedNodes.map((node) => (
            <li key={node.id}>
              <button type="button" onClick={() => onSelect(node.id)}>
                {node.name}
              </button>
              <span className="kestrel-relations__detail">{node.type}</span>
            </li>
          ))}
        </ul>
        {isTracing ? (
          <FlowSection
            flowPaths={flowPaths}
            flowDirection={flowDirection}
            flowTruncated={flowTruncated}
            seedIds={selectedNodes.map((selected) => selected.id)}
            onSelect={onSelect}
            onTraceFlow={onTraceFlow}
          />
        ) : null}

        <div className="kestrel-inspector__actions">
          <button type="button" onClick={() => onTraceFlow(selectedNodes.map((n) => n.id))}>
            Trace data flow
          </button>
          <button type="button" className="is-primary" onClick={() => onAskAgent(selectedNodes.map((n) => n.id))}>
            Ask Claude
          </button>
        </div>
        <p className="kestrel-hint">
          Copies the selected architecture as context for a coding agent. Deeper agent actions are on the roadmap.
        </p>
      </aside>
    );
  }

  const node = selectedNodes[0];
  const byId = new Map(graph.nodes.map((candidate) => [candidate.id, candidate]));

  const relate = (nodeId: string | undefined, detail?: string): Relation[] => {
    const related = nodeId ? byId.get(nodeId) : undefined;
    return related ? [{ node: related, detail }] : [];
  };

  const dependencies: Relation[] = graph.edges
    .filter((edge) => edge.source === node.id && (edge.type === 'injects' || edge.type === 'imports'))
    .flatMap((edge) => relate(edge.target, edge.metadata?.propertyName));

  const dependents: Relation[] = graph.edges
    .filter((edge) => edge.target === node.id && (edge.type === 'injects' || edge.type === 'imports'))
    .flatMap((edge) => relate(edge.source));

  const persists: Relation[] = graph.edges
    .filter((edge) => edge.source === node.id && edge.type === 'persists')
    .flatMap((edge) => relate(edge.target, edge.metadata?.via));

  const references: Relation[] = graph.edges
    .filter(
      (edge) =>
        edge.type === 'references' && (edge.source === node.id || edge.target === node.id),
    )
    .flatMap((edge) =>
      edge.source === node.id
        ? relate(edge.target, edge.metadata?.propertyName)
        : relate(edge.source, edge.metadata?.propertyName),
    );

  const persistedBy: Relation[] = graph.edges
    .filter((edge) => edge.target === node.id && edge.type === 'persists')
    .flatMap((edge) => relate(edge.source));

  const layer = node.metadata?.layer as ArchitectureLayer | undefined;
  const project = graph.metadata?.projects.find(
    (candidate) => candidate.id === node.metadata?.projectId,
  );

  const children: Relation[] = graph.edges
    .filter((edge) => edge.source === node.id && edge.type === 'contains')
    .flatMap((edge) => relate(edge.target));

  const parent = node.parentId ? byId.get(node.parentId) : undefined;
  const methods = node.metadata?.methods ?? [];

  return (
    <aside className="kestrel-inspector">
      <h2>{node.name}</h2>
      <div className="kestrel-inspector__type">
        {node.type.toUpperCase()}
        {node.metadata?.role && node.metadata.role !== node.type ? ` · ${String(node.metadata.role)}` : ''}
      </div>

      {node.filePath ? <code className="kestrel-inspector__path">{node.filePath}</code> : null}
      {node.metadata?.unresolved ? (
        <p className="kestrel-hint">
          Declared outside the workspace{node.metadata.packageName ? ` (${String(node.metadata.packageName)})` : ''}.
        </p>
      ) : null}

      {layer ? (
        <Section title="Layer">
          <span className={`kestrel-layer-chip kestrel-layer-chip--${layer} is-active`}>
            <span className="kestrel-layer-chip__dot" />
            {LAYER_LABELS[layer]}
          </span>
        </Section>
      ) : null}

      {node.type === 'application' ? <ApplicationSummary node={node} project={project} /> : null}

      {node.type === 'database' ? (
        <Section title="Datastore">
          <div>
            {String(node.metadata?.access ?? 'driver')} · {String(node.metadata?.databaseKind ?? 'unknown')}
          </div>
          <ul className="kestrel-relations">
            {(node.metadata?.evidence as string[] | undefined)?.map((entry) => (
              <li key={entry}>
                <span className="kestrel-relations__detail">{entry}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {node.metadata?.route !== undefined && node.type === 'controller' ? (
        <Section title="Route">
          <code>/{String(node.metadata.route)}</code>
        </Section>
      ) : null}

      {node.metadata?.role === 'entity' && node.metadata.source === 'prisma' ? (
        <Section title="Model">
          <div>
            {String(node.metadata.fieldCount ?? 0)} fields
            {node.metadata.tableName ? ` · table "${String(node.metadata.tableName)}"` : ''}
          </div>
        </Section>
      ) : null}

      {project && node.type !== 'application' ? (
        <Section title="Project">
          <span>
            {project.name} <span className="kestrel-relations__detail">{PROJECT_KIND_LABELS[project.kind]}</span>
          </span>
        </Section>
      ) : null}

      {parent ? (
        <Section title={parent.type === 'module' ? 'Module' : 'Parent'}>
          <button type="button" className="kestrel-link" onClick={() => onSelect(parent.id)}>
            {parent.name}
          </button>
        </Section>
      ) : null}

      <RelationList title="Dependencies" arrow="→" relations={dependencies} onSelect={onSelect} />
      <RelationList title="Used by" arrow="←" relations={dependents} onSelect={onSelect} />
      <RelationList title="Reads / writes" arrow="⇒" relations={persists} onSelect={onSelect} />
      <RelationList title="Written by" arrow="⇐" relations={persistedBy} onSelect={onSelect} />
      <RelationList title="Relations" arrow="↔" relations={references} onSelect={onSelect} />
      <RelationList title="Contains" arrow="·" relations={children} onSelect={onSelect} />

      {methods.length > 0 ? (
        <Section title="Endpoints">
          <ul className="kestrel-relations">
            {methods.map((method) => (
              <li key={method.name}>
                <span>{method.name}</span>
                <span className="kestrel-relations__detail">
                  {method.decorators.join(', ')}
                  {method.route ? ` /${method.route}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {isTracing ? (
        <FlowSection
          flowPaths={flowPaths}
          flowDirection={flowDirection}
          flowTruncated={flowTruncated}
          seedIds={[node.id]}
          onSelect={onSelect}
          onTraceFlow={onTraceFlow}
        />
      ) : null}

      <div className="kestrel-inspector__actions">
        <button
          type="button"
          className="is-primary"
          disabled={!node.filePath}
          onClick={() => onOpenFile(node)}
          title={node.filePath ?? 'This node has no source file'}
        >
          Open File
        </button>
        {children.length > 0 || node.type === 'module' ? (
          <button type="button" onClick={() => onDive(node.id)}>
            Dive in
          </button>
        ) : null}
        <button type="button" onClick={() => onTraceFlow([node.id])} title="Follow the data through this component">
          Trace data flow
        </button>
        <button type="button" onClick={() => onAskAgent([node.id])}>
          Ask Claude
        </button>
      </div>
      <p className="kestrel-hint">
        &quot;Ask Claude&quot; copies this node&apos;s architectural context to the clipboard — a preview of the
        agent integration.
      </p>
    </aside>
  );
}

function ApplicationSummary({
  node,
  project,
}: {
  node: ArchitectureNode;
  project: ProjectProfile | undefined;
}) {
  const kind = project?.kind ?? (node.metadata?.kind as ProjectProfile['kind'] | undefined);

  return (
    <>
      <Section title="Application type">
        <div>
          <strong>{project?.archetypeLabel ?? (kind ? PROJECT_KIND_LABELS[kind] : 'Unknown')}</strong>
          {project?.primaryFramework ? ` · ${project.primaryFramework}` : ''}
          {project ? (
            <span className="kestrel-relations__detail"> {project.archetypeConfidence}</span>
          ) : null}
        </div>
        {project?.evidence.length ? (
          <ul className="kestrel-relations">
            {project.evidence.map((entry) => (
              <li key={entry}>
                <span className="kestrel-relations__detail">{entry}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </Section>

      {project && project.frameworks.length > 0 ? (
        <Section title="Frameworks">
          <div className="kestrel-node__meta">
            {project.frameworks.map((framework) => (
              <span key={framework.id} className="kestrel-badge">
                {framework.label}
              </span>
            ))}
          </div>
        </Section>
      ) : null}

      {project && project.databases.length > 0 ? (
        <Section title="Databases">
          <ul className="kestrel-relations">
            {project.databases.map((database) => (
              <li key={database.id}>
                <span>{database.label}</span>
                <span className="kestrel-relations__detail">{database.access}</span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </>
  );
}

/** The traced paths, with direction controls. Shared by both inspector modes. */
function FlowSection({
  flowPaths,
  flowDirection,
  flowTruncated,
  seedIds,
  onSelect,
  onTraceFlow,
}: {
  flowPaths: FlowLeg[][];
  flowDirection: FlowDirection;
  flowTruncated: boolean;
  seedIds: string[];
  onSelect: (nodeId: string) => void;
  onTraceFlow: (nodeIds: string[], direction?: FlowDirection) => void;
}) {
  return (
    <Section title="Data flow">
      <div className="kestrel-flow-controls">
        {(['both', 'downstream', 'upstream'] as const).map((direction) => (
          <button
            key={direction}
            type="button"
            className={flowDirection === direction ? 'is-active' : ''}
            onClick={() => onTraceFlow(seedIds, direction)}
            title={
              direction === 'downstream'
                ? 'Where the data goes from here'
                : direction === 'upstream'
                  ? 'What reaches this component'
                  : 'Both directions through this component'
            }
          >
            {direction}
          </button>
        ))}
      </div>

      {flowPaths.length === 0 ? (
        <p className="kestrel-hint">No data path runs through this selection.</p>
      ) : (
        <ol className="kestrel-flow-path">
          {flowPaths.map((path, index) => (
            <li key={index}>
              {path.map((leg, legIndex) => (
                <div key={legIndex} className="kestrel-flow-leg">
                  {legIndex === 0 ? (
                    <button type="button" className="kestrel-link" onClick={() => onSelect(leg.fromId)}>
                      {leg.from}
                    </button>
                  ) : null}
                  <span className="kestrel-flow-leg__type">{leg.type}</span>
                  <span className="kestrel-relations__arrow">→</span>
                  <button type="button" className="kestrel-link" onClick={() => onSelect(leg.toId)}>
                    {leg.to}
                  </button>
                  {leg.detail ? <span className="kestrel-relations__detail">{leg.detail}</span> : null}
                </div>
              ))}
            </li>
          ))}
        </ol>
      )}

      {flowTruncated ? (
        <p className="kestrel-hint">The trace was cut short — the path continues beyond what is shown.</p>
      ) : null}
    </Section>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="kestrel-inspector__section">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function RelationList({
  title,
  arrow,
  relations,
  onSelect,
}: {
  title: string;
  arrow: string;
  relations: Relation[];
  onSelect: (nodeId: string) => void;
}) {
  if (relations.length === 0) {
    return null;
  }

  return (
    <Section title={title}>
      <ul className="kestrel-relations">
        {relations.map((relation) => (
          <li key={`${title}-${relation.node.id}`}>
            <span className="kestrel-relations__arrow">{arrow}</span>
            <button type="button" className="kestrel-link" onClick={() => onSelect(relation.node.id)}>
              {relation.node.name}
            </button>
            {relation.detail ? <span className="kestrel-relations__detail">{relation.detail}</span> : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}
