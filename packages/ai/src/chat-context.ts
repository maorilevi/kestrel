import type { ArchitectureGraph, ArchitectureNode } from '@kestrel/core';

/**
 * Turns the architecture graph into the context a language model reads.
 *
 * This is where KESTREL earns its keep over a generic chat: the model never
 * sees the repository, only a compact, accurate description of its structure —
 * so answers are grounded in what was actually parsed rather than guessed from
 * file names.
 */

export interface ChatContextOptions {
  /** Nodes the user has selected; they get the deepest detail. */
  selectedNodeIds?: readonly string[];
  /** Project the view is scoped to, if any. */
  projectId?: string | null;
  /** Rough character budget for the whole brief (~4 characters per token). */
  characterBudget?: number;
}

export interface ChatContext {
  /**
   * The stable part of the prompt: the architecture itself. Identical between
   * turns of a conversation so it can be cached by the API — which is why it
   * deliberately carries no timestamp.
   */
  brief: string;
  /** The volatile part: what the user currently has selected. */
  focus: string;
  /** Node names the model may cite, used to turn citations into links. */
  citableNames: string[];
  truncated: boolean;
}

const DEFAULT_BUDGET = 24_000;

export const CHAT_SYSTEM_PROMPT = `You are KESTREL, an architecture assistant embedded in a VS Code extension.

You answer questions about the architecture of the repository the developer has open. The architecture below was extracted deterministically from the source code by static analysis — it is accurate about structure, but it does not contain method bodies or business rules.

How to answer:
- Ground every claim in the architecture provided. If it does not contain the answer, say so plainly and name what would be needed.
- Never invent components, endpoints, tables or relationships that are not listed.
- When you name a component that appears in the architecture, wrap it in double square brackets, like [[UsersService]]. The UI turns those into links the developer can click.
- Be concrete and brief. Lead with the answer, then the reasoning.
- When asked to change something, describe the change in terms of components and their relationships, and name the files involved. You cannot edit files yourself.
- Distinguish what is certain (a dependency edge exists) from what is inferred (a naming convention suggests a role).`;

export function buildChatContext(
  graph: ArchitectureGraph,
  options: ChatContextOptions = {},
): ChatContext {
  const budget = options.characterBudget ?? DEFAULT_BUDGET;
  const sections: string[] = [];
  let truncated = false;

  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const inScope = (node: ArchitectureNode): boolean =>
    !options.projectId || node.metadata?.projectId === options.projectId;

  const nodes = graph.nodes.filter(inScope);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));

  const nameOf = (id: string): string => byId.get(id)?.name ?? id;

  // 1. Applications — the most valuable few hundred characters in the brief.
  const projects = (graph.metadata?.projects ?? []).filter(
    (project) => !options.projectId || project.id === options.projectId,
  );
  if (projects.length > 0) {
    const lines = projects.map((project) => {
      const databases = project.databases.map((db) => `${db.label} via ${db.access}`).join(', ');
      return [
        `- ${project.name} — ${project.archetypeLabel}`,
        project.primaryFramework ? ` (${project.primaryFramework})` : '',
        `, path \`${project.rootPath || '.'}\`, ${project.fileCount} files`,
        databases ? `, datastores: ${databases}` : '',
      ].join('');
    });
    sections.push(`## Applications\n${lines.join('\n')}`);
  }

  // 2. Recognised styles and open findings.
  const styles = graph.metadata?.styles ?? [];
  if (styles.length > 0) {
    sections.push(
      `## Detected architecture styles\n${styles
        .map((style) => `- ${style.label} (${style.confidence}) — ${style.evidence.join('; ')}`)
        .join('\n')}`,
    );
  }

  const issues = graph.metadata?.issues ?? [];
  if (issues.length > 0) {
    sections.push(
      `## Known findings\n${issues
        .map((issue) => `- [${issue.severity}] ${issue.message}${issue.hint ? ` — ${issue.hint}` : ''}`)
        .join('\n')}`,
    );
  }

  // 3. Modules and what each contains.
  const modules = nodes.filter((node) => node.type === 'module');
  if (modules.length > 0) {
    const lines = modules.map((module) => {
      const children = edges
        .filter((edge) => edge.type === 'contains' && edge.source === module.id)
        .map((edge) => nameOf(edge.target));
      const imports = edges
        .filter((edge) => edge.type === 'imports' && edge.source === module.id)
        .map((edge) => nameOf(edge.target));
      return [
        `- ${module.name}`,
        module.filePath ? ` (\`${module.filePath}\`)` : '',
        children.length > 0 ? `\n    contains: ${children.join(', ')}` : '',
        imports.length > 0 ? `\n    imports: ${imports.join(', ')}` : '',
      ].join('');
    });
    sections.push(`## Modules\n${lines.join('\n')}`);
  }

  // 4. Components, grouped by layer so the model can reason about layering.
  const componentTypes = new Set([
    'controller',
    'service',
    'repository',
    'page',
    'component',
    'hook',
    'store',
    'api-client',
    'class',
  ]);
  const components = nodes.filter((node) => componentTypes.has(node.type));

  const byLayer = new Map<string, ArchitectureNode[]>();
  for (const component of components) {
    const layer = component.metadata?.layer ?? 'unassigned';
    const bucket = byLayer.get(layer);
    if (bucket) {
      bucket.push(component);
    } else {
      byLayer.set(layer, [component]);
    }
  }

  for (const [layer, members] of byLayer) {
    const lines = members.map((node) => describeNode(node, edges, nameOf));
    sections.push(`## Layer: ${layer}\n${lines.join('\n')}`);
  }

  // 5. Datastores and the models they hold.
  const databases = nodes.filter((node) => node.type === 'database');
  if (databases.length > 0) {
    const lines = databases.map((database) => {
      const stored = edges
        .filter((edge) => edge.type === 'persists' && edge.target === database.id)
        .map((edge) => nameOf(edge.source));
      return `- ${database.name} (${String(database.metadata?.access ?? 'driver')})${
        stored.length > 0 ? `\n    holds: ${stored.join(', ')}` : ''
      }`;
    });
    sections.push(`## Datastores\n${lines.join('\n')}`);
  }

  // Assemble within budget, keeping the most valuable sections.
  let brief = '';
  for (const section of sections) {
    if (brief.length + section.length > budget) {
      truncated = true;
      break;
    }
    brief += (brief.length > 0 ? '\n\n' : '') + section;
  }

  if (truncated) {
    brief += '\n\n(Some detail was omitted to fit the context budget.)';
  }

  return {
    brief: `# Architecture of this repository\n\n${brief}`,
    focus: describeSelection(graph, options.selectedNodeIds ?? [], nameOf),
    citableNames: [...new Set(graph.nodes.map((node) => node.name))],
    truncated,
  };
}

/** One line per component: what it is, where it lives, and what it touches. */
function describeNode(
  node: ArchitectureNode,
  edges: ArchitectureGraph['edges'],
  nameOf: (id: string) => string,
): string {
  const relations = (type: string, direction: 'out' | 'in'): string[] =>
    edges
      .filter((edge) => edge.type === type && (direction === 'out' ? edge.source : edge.target) === node.id)
      .map((edge) => nameOf(direction === 'out' ? edge.target : edge.source));

  const parts = [`- ${node.name} [${node.metadata?.role ?? node.type}]`];
  if (node.filePath) {
    parts.push(` \`${node.filePath}\``);
  }
  if (node.metadata?.route !== undefined) {
    parts.push(` route: ${String(node.metadata.route) || '/'}`);
  }

  const uses = [...relations('injects', 'out'), ...relations('calls', 'out')];
  const usedBy = [...relations('injects', 'in'), ...relations('calls', 'in')];
  const writes = relations('persists', 'out');
  const renders = relations('renders', 'out');

  if (uses.length > 0) {
    parts.push(`\n    uses: ${uses.join(', ')}`);
  }
  if (usedBy.length > 0) {
    parts.push(`\n    used by: ${usedBy.join(', ')}`);
  }
  if (writes.length > 0) {
    parts.push(`\n    reads/writes: ${writes.join(', ')}`);
  }
  if (renders.length > 0) {
    parts.push(`\n    renders: ${renders.join(', ')}`);
  }

  return parts.join('');
}

/** The volatile half of the prompt: what the developer is pointing at. */
function describeSelection(
  graph: ArchitectureGraph,
  selectedNodeIds: readonly string[],
  nameOf: (id: string) => string,
): string {
  if (selectedNodeIds.length === 0) {
    return '';
  }

  const selected = selectedNodeIds
    .map((id) => graph.nodes.find((node) => node.id === id))
    .filter((node): node is ArchitectureNode => node !== undefined);

  if (selected.length === 0) {
    return '';
  }

  const lines = selected.map((node) => {
    const neighbours = graph.edges
      .filter((edge) => edge.source === node.id || edge.target === node.id)
      .map((edge) =>
        edge.source === node.id
          ? `    ${edge.type} → ${nameOf(edge.target)}`
          : `    ${nameOf(edge.source)} → ${edge.type} → ${node.name}`,
      );

    return [
      `- ${node.name} (${node.type})`,
      node.filePath ? ` — \`${node.filePath}\`` : '',
      neighbours.length > 0 ? `\n${[...new Set(neighbours)].join('\n')}` : '',
    ].join('');
  });

  return `The developer currently has these selected:\n${lines.join('\n')}`;
}
