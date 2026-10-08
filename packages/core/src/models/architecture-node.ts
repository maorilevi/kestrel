/**
 * Framework independent architecture node model.
 *
 * Nothing in this file may depend on VS Code, React Flow, ts-morph or any other
 * infrastructure. The architecture model is the contract shared between the
 * extension, the webview and (in the future) CLI tools and coding agents.
 */

export type ArchitectureNodeType =
  | 'application'
  | 'module'
  | 'controller'
  | 'service'
  | 'repository'
  | 'component'
  | 'page'
  | 'hook'
  | 'store'
  | 'api-client'
  | 'class'
  | 'database'
  | 'queue'
  | 'external';

/**
 * Finer grained role of a node. The MVP maps most NestJS providers onto the
 * `service` node type, but keeps the detected role so future versions can
 * promote roles to first class node types without re-writing the parser.
 */
export type ArchitectureNodeRole =
  | 'application'
  | 'module'
  | 'controller'
  | 'service'
  | 'repository'
  | 'entity'
  | 'guard'
  | 'interceptor'
  | 'pipe'
  | 'filter'
  | 'middleware'
  | 'strategy'
  | 'resolver'
  | 'gateway'
  | 'worker'
  | 'provider'
  | 'datastore'
  // Front-end roles
  | 'page'
  | 'component'
  | 'layout'
  | 'hook'
  | 'store'
  | 'context-provider'
  | 'api-client'
  | 'feature'
  | 'external';

/**
 * Architectural layer a node belongs to.
 *
 * Layers are derived deterministically from the detected role, the class name,
 * its heritage and its folder — never from AI. `undefined` is used for nodes
 * that are not part of a layer (applications, modules, external symbols).
 */
export type ArchitectureLayer =
  | 'presentation'
  | 'business'
  | 'data'
  | 'infrastructure'
  | 'shared';

export const ARCHITECTURE_LAYERS: readonly ArchitectureLayer[] = [
  'presentation',
  'business',
  'data',
  'infrastructure',
  'shared',
];

export const LAYER_LABELS: Readonly<Record<ArchitectureLayer, string>> = {
  presentation: 'Presentation / API',
  business: 'Business logic',
  data: 'Data access',
  infrastructure: 'Infrastructure',
  shared: 'Shared',
};

export interface ArchitectureNodeMethod {
  name: string;
  line: number;
  /** Decorator names attached to the method, e.g. `Get`, `Post`. */
  decorators: string[];
  /** Route fragment declared by an HTTP method decorator, when present. */
  route?: string;
}

export interface ArchitectureNodeMetadata {
  role?: ArchitectureNodeRole;
  /** Architectural layer, when the node belongs to one. */
  layer?: ArchitectureLayer;
  /** Id of the {@link ProjectProfile} the node belongs to. */
  projectId?: string;
  /** True when the class talks to a datastore directly. */
  accessesDatabase?: boolean;
  /** Route prefix declared by `@Controller('users')`. */
  route?: string;
  /** Prefix the application adds to every route (`app.setGlobalPrefix('api')`). */
  globalPrefix?: string;
  /** 1-based line of the class declaration, used when opening the file. */
  line?: number;
  /** Name of the workspace folder the node was discovered in. */
  workspaceName?: string;
  /** Node ids exported by a module (`@Module({ exports: [...] })`). */
  exports?: string[];
  /** Public methods, currently populated for controllers. */
  methods?: ArchitectureNodeMethod[];
  /** True when the symbol could not be resolved to a file in the workspace. */
  unresolved?: boolean;
  /** Package the external symbol most likely originates from. */
  packageName?: string;
  [key: string]: unknown;
}

export interface ArchitectureNode {
  /** Deterministic id: `<relative-file-path>#<SymbolName>`. */
  id: string;
  name: string;
  type: ArchitectureNodeType;

  /** Workspace relative, posix separated path. Absent for synthetic nodes. */
  filePath?: string;
  parentId?: string;

  metadata?: ArchitectureNodeMetadata;
}

/** Deterministic id for a symbol declared in a workspace file. */
export function createSymbolId(relativeFilePath: string, symbolName: string): string {
  return `${normalizeRelativePath(relativeFilePath)}#${symbolName}`;
}

/** Deterministic id for a symbol that could not be resolved inside the workspace. */
export function createExternalId(symbolName: string): string {
  return `external#${symbolName}`;
}

/** Deterministic id for a project's application root node (`.` for the root). */
export function createApplicationId(projectId: string): string {
  return `application#${projectId}`;
}

export function normalizeRelativePath(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\.\//, '');
}
