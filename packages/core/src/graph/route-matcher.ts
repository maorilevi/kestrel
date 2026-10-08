import type { ArchitectureNode, ArchitectureNodeMethod } from '../models';

export interface RouteTarget {
  nodeId: string;
  /** Controller base path, normalised. */
  basePath: string;
  /** Full paths served by the controller, base + method routes. */
  fullPaths: string[];
  name: string;
}

/**
 * Builds the route table of every controller in the graph, so a request path
 * seen in front-end code can be traced to the controller that serves it.
 */
export function buildRouteTable(nodes: readonly ArchitectureNode[]): RouteTarget[] {
  const targets: RouteTarget[] = [];

  for (const node of nodes) {
    if (node.type !== 'controller') {
      continue;
    }
    const basePath = normalizeRoute(String(node.metadata?.route ?? ''));
    const methods = (node.metadata?.methods ?? []) as ArchitectureNodeMethod[];

    const fullPaths = methods
      .filter((method) => method.route !== undefined)
      .map((method) => joinRoute(basePath, method.route ?? ''));

    targets.push({ nodeId: node.id, basePath, fullPaths, name: node.name });
  }

  return targets;
}

/**
 * Finds the controller serving a request path.
 *
 * An exact match on a declared endpoint wins; otherwise the longest controller
 * prefix wins, and a tie is broken by the controller whose name appears in the
 * path (`/api/v1/overview` → `OverviewController`). Ties beyond that are
 * resolved alphabetically so the graph stays deterministic.
 */
export function matchRoute(requestPath: string, table: readonly RouteTarget[]): RouteTarget | undefined {
  const path = normalizeRoute(requestPath);
  if (path.length === 0) {
    return undefined;
  }

  const exact = table
    .filter((target) => target.fullPaths.some((full) => routesEqual(full, path)))
    .sort((left, right) => left.nodeId.localeCompare(right.nodeId));
  if (exact.length > 0) {
    return exact[0];
  }

  const prefixed = table.filter(
    (target) => target.basePath.length > 0 && isPrefix(target.basePath, path),
  );
  if (prefixed.length === 0) {
    return undefined;
  }

  const longest = Math.max(...prefixed.map((target) => target.basePath.length));
  const candidates = prefixed.filter((target) => target.basePath.length === longest);
  if (candidates.length === 1) {
    return candidates[0];
  }

  const segments = path.split('/').filter(Boolean).map((segment) => segment.toLowerCase());
  const named = candidates.filter((target) => {
    const subject = target.name.replace(/Controller$/, '').toLowerCase();
    return subject.length > 0 && segments.some((segment) => segment.replace(/-/g, '') === subject);
  });

  const pool = named.length > 0 ? named : candidates;
  return [...pool].sort((left, right) => left.nodeId.localeCompare(right.nodeId))[0];
}

/** `users/:id` and `users/{}` compare equal — the parameter name is irrelevant. */
function routesEqual(left: string, right: string): boolean {
  const a = left.split('/');
  const b = right.split('/');
  if (a.length !== b.length) {
    return false;
  }
  return a.every((segment, index) => isParameter(segment) || isParameter(b[index]) || segment === b[index]);
}

function isParameter(segment: string): boolean {
  return segment.startsWith(':') || segment.startsWith('{') || segment.startsWith('*');
}

function isPrefix(base: string, path: string): boolean {
  return path === base || path.startsWith(`${base}/`);
}

export function normalizeRoute(route: string): string {
  const trimmed = route.trim().replace(/^\/+|\/+$/g, '');
  return trimmed.length === 0 ? '' : trimmed;
}

export function joinRoute(base: string, segment: string): string {
  const normalized = normalizeRoute(segment);
  if (base.length === 0) {
    return normalized;
  }
  return normalized.length === 0 ? base : `${base}/${normalized}`;
}
