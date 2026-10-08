import type { ArchitectureEdge, ArchitectureEdgeType } from './architecture-edge';
import type { ArchitectureNode, ArchitectureNodeType } from './architecture-node';
import type { ProjectProfile } from './architecture-project';

export type ArchitectureIssueType =
  | 'circular-dependency'
  | 'high-coupling'
  | 'god-service'
  | 'unused-service'
  | 'layer-violation'
  | 'fat-controller'
  | 'direct-data-access'
  | 'cross-module-access'
  | 'orphan-module'
  | 'ui-data-access';

export interface ArchitectureIssue {
  id: string;
  type: ArchitectureIssueType;
  severity: 'info' | 'warning' | 'error';
  message: string;
  /** What to do about it. Deterministic advice, never generated prose. */
  hint?: string;
  /** Nodes participating in the issue, in cycle order where applicable. */
  nodeIds: string[];
}

/** A recognised architectural style, with the evidence behind it. */
export interface ArchitectureStyle {
  id: string;
  label: string;
  /** `workspace`, or the id of the project it applies to. */
  scope: string;
  confidence: 'high' | 'medium' | 'low';
  description: string;
  evidence: string[];
}

export interface ArchitectureStats {
  fileCount: number;
  parsedFileCount: number;
  parseFailureCount: number;
  moduleCount: number;
  controllerCount: number;
  serviceCount: number;
  uiElementCount: number;
  entityCount: number;
  databaseCount: number;
  externalCount: number;
  dependencyCount: number;
  durationMs: number;
}

export interface ArchitectureGraphMetadata {
  /** Display name of the analysed workspace. */
  workspaceName: string;
  /** ISO timestamp of the build. */
  generatedAt: string;
  /** False when no NestJS building blocks were found in the workspace. */
  frameworkDetected: boolean;
  /** One entry per detected project (`package.json`). */
  projects: ProjectProfile[];
  stats: ArchitectureStats;
  issues: ArchitectureIssue[];
  /** Architectural styles KESTREL recognised. */
  styles: ArchitectureStyle[];
}

export interface ArchitectureGraph {
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
  metadata?: ArchitectureGraphMetadata;
}

export function createEmptyGraph(workspaceName = 'workspace'): ArchitectureGraph {
  return {
    nodes: [],
    edges: [],
    metadata: {
      workspaceName,
      generatedAt: new Date(0).toISOString(),
      frameworkDetected: false,
      projects: [],
      stats: {
        fileCount: 0,
        parsedFileCount: 0,
        parseFailureCount: 0,
        moduleCount: 0,
        controllerCount: 0,
        serviceCount: 0,
        uiElementCount: 0,
        entityCount: 0,
        databaseCount: 0,
        externalCount: 0,
        dependencyCount: 0,
        durationMs: 0,
      },
      issues: [],
      styles: [],
    },
  };
}

export function findNode(graph: ArchitectureGraph, nodeId: string): ArchitectureNode | undefined {
  return graph.nodes.find((node) => node.id === nodeId);
}

export function nodesOfType(graph: ArchitectureGraph, type: ArchitectureNodeType): ArchitectureNode[] {
  return graph.nodes.filter((node) => node.type === type);
}

export function edgesOfType(graph: ArchitectureGraph, type: ArchitectureEdgeType): ArchitectureEdge[] {
  return graph.edges.filter((edge) => edge.type === type);
}

/** Outgoing dependencies of a node (`injects` / `imports`). */
export function outgoingDependencies(graph: ArchitectureGraph, nodeId: string): ArchitectureEdge[] {
  return graph.edges.filter(
    (edge) => edge.source === nodeId && (edge.type === 'injects' || edge.type === 'imports'),
  );
}

/** Incoming dependencies of a node (`injects` / `imports`). */
export function incomingDependencies(graph: ArchitectureGraph, nodeId: string): ArchitectureEdge[] {
  return graph.edges.filter(
    (edge) => edge.target === nodeId && (edge.type === 'injects' || edge.type === 'imports'),
  );
}
