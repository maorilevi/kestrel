export type ArchitectureEdgeType =
  | 'contains'
  | 'imports'
  | 'injects'
  | 'calls'
  /** Reads from and/or writes to a datastore. Refined into reads/writes later. */
  | 'persists'
  /** A data model referencing another (a foreign key or relation field). */
  | 'references'
  /** A UI element rendering another (JSX composition). */
  | 'renders'
  | 'reads'
  | 'writes'
  | 'publishes'
  | 'subscribes';

export interface ArchitectureEdgeMetadata {
  /** Constructor parameter name that produced an `injects` edge. */
  propertyName?: string;
  /** Handle a `persists` edge was derived from, e.g. `Repository<User>`. */
  via?: string;
  /** Injection token when the dependency is injected via `@Inject('TOKEN')`. */
  token?: string;
  /** True when the module entry was declared through `forwardRef(() => X)`. */
  forwardRef?: boolean;
  [key: string]: unknown;
}

export interface ArchitectureEdge {
  /** Deterministic id: `<type>:<source>-><target>`. */
  id: string;

  source: string;
  target: string;

  type: ArchitectureEdgeType;

  metadata?: ArchitectureEdgeMetadata;
}

export function createEdgeId(type: ArchitectureEdgeType, source: string, target: string): string {
  return `${type}:${source}->${target}`;
}
