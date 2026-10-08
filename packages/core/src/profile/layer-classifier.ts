import type { ArchitectureLayer, ArchitectureNodeRole } from '../models/architecture-node';
import { PERSISTENCE_HANDLES } from './database-signals';

export interface LayerClassificationInput {
  role: ArchitectureNodeRole;
  name: string;
  /** Workspace relative posix path, used for folder based hints. */
  filePath?: string;
  /**
   * Directory of the owning project. Stripped before folder hints are applied
   * so a monorepo path like `apps/api/...` is not read as an `api` folder.
   */
  projectRoot?: string;
  /** Base class and implemented interfaces. */
  heritage?: readonly string[];
}

/**
 * Assigns an architectural layer to a node.
 *
 * Deterministic and explainable: the detected role decides first, then the
 * class name, then the folder it lives in. Nothing here guesses with AI, and a
 * node that cannot be placed confidently stays in the layer its role implies.
 */
export function classifyLayer(input: LayerClassificationInput): ArchitectureLayer | undefined {
  const decisive = DECISIVE_ROLE_LAYERS[input.role];
  if (decisive !== undefined) {
    return decisive ?? undefined;
  }

  // A class that *is* the database handle (PrismaService, PrismaClient) is data
  // access however it is named.
  if (PERSISTENCE_HANDLES[input.name]) {
    return 'data';
  }

  return (
    matchName(input.name) ??
    matchHeritage(input.heritage ?? []) ??
    matchFolder(stripProjectRoot(input.filePath, input.projectRoot)) ??
    AMBIGUOUS_ROLE_DEFAULTS[input.role] ??
    'business'
  );
}

/**
 * Roles whose layer never depends on naming.
 * `null` marks roles that intentionally have no layer (structural nodes).
 */
const DECISIVE_ROLE_LAYERS: Partial<Record<ArchitectureNodeRole, ArchitectureLayer | null>> = {
  controller: 'presentation',
  resolver: 'presentation',
  gateway: 'presentation',
  repository: 'data',
  entity: 'data',
  datastore: 'data',
  guard: 'infrastructure',
  interceptor: 'infrastructure',
  pipe: 'infrastructure',
  filter: 'infrastructure',
  middleware: 'infrastructure',
  strategy: 'infrastructure',
  worker: 'business',
  // Front-end: what the user sees is presentation, state is business logic,
  // and the API client is how the UI reaches its data.
  page: 'presentation',
  component: 'presentation',
  layout: 'presentation',
  hook: 'business',
  store: 'business',
  'context-provider': 'business',
  'api-client': 'data',
  application: null,
  module: null,
  feature: null,
  external: null,
};

const AMBIGUOUS_ROLE_DEFAULTS: Partial<Record<ArchitectureNodeRole, ArchitectureLayer>> = {
  service: 'business',
  provider: 'business',
};

/** Suffix → layer, longest and most specific first. */
const NAME_SUFFIXES: ReadonlyArray<[string, ArchitectureLayer]> = [
  ['Repository', 'data'],
  ['Dao', 'data'],
  ['DAO', 'data'],
  ['Entity', 'data'],
  ['Schema', 'data'],
  ['Migration', 'data'],
  ['Seeder', 'data'],
  ['Store', 'data'],
  ['UseCase', 'business'],
  ['Usecase', 'business'],
  ['Interactor', 'business'],
  ['Facade', 'business'],
  ['Manager', 'business'],
  ['Handler', 'business'],
  ['Saga', 'business'],
  ['Policy', 'business'],
  ['Workflow', 'business'],
  ['Controller', 'presentation'],
  ['Resolver', 'presentation'],
  ['Gateway', 'presentation'],
  ['Client', 'infrastructure'],
  ['Adapter', 'infrastructure'],
  ['Logger', 'infrastructure'],
  ['Mailer', 'infrastructure'],
  ['ConfigService', 'infrastructure'],
  ['Config', 'infrastructure'],
  ['HealthIndicator', 'infrastructure'],
  // Checked last: every more specific suffix above wins over a plain service.
  ['Service', 'business'],
];

const HERITAGE_MARKERS: ReadonlyArray<[string, ArchitectureLayer]> = [
  ['Repository', 'data'],
  ['BaseEntity', 'data'],
  ['Document', 'data'],
  ['HealthIndicator', 'infrastructure'],
];

/** Folder segment → layer. Matched on whole path segments only. */
const FOLDER_SEGMENTS: Readonly<Record<string, ArchitectureLayer>> = {
  controllers: 'presentation',
  controller: 'presentation',
  routes: 'presentation',
  http: 'presentation',
  api: 'presentation',
  graphql: 'presentation',
  resolvers: 'presentation',
  rest: 'presentation',

  services: 'business',
  service: 'business',
  domain: 'business',
  'use-cases': 'business',
  usecases: 'business',
  business: 'business',
  application: 'business',
  core: 'business',

  repositories: 'data',
  repository: 'data',
  entities: 'data',
  entity: 'data',
  models: 'data',
  schemas: 'data',
  dao: 'data',
  prisma: 'data',
  migrations: 'data',
  database: 'data',
  db: 'data',
  persistence: 'data',

  infra: 'infrastructure',
  infrastructure: 'infrastructure',
  config: 'infrastructure',
  clients: 'infrastructure',
  adapters: 'infrastructure',
  providers: 'infrastructure',
  middleware: 'infrastructure',
  guards: 'infrastructure',
  interceptors: 'infrastructure',
  filters: 'infrastructure',
  pipes: 'infrastructure',

  common: 'shared',
  shared: 'shared',
  utils: 'shared',
  helpers: 'shared',
};

function matchName(name: string): ArchitectureLayer | undefined {
  for (const [suffix, layer] of NAME_SUFFIXES) {
    if (name.endsWith(suffix)) {
      return layer;
    }
  }
  return undefined;
}

function matchHeritage(heritage: readonly string[]): ArchitectureLayer | undefined {
  for (const [marker, layer] of HERITAGE_MARKERS) {
    if (heritage.some((entry) => entry.includes(marker))) {
      return layer;
    }
  }
  return undefined;
}

function stripProjectRoot(filePath: string | undefined, projectRoot: string | undefined): string | undefined {
  if (!filePath || !projectRoot) {
    return filePath;
  }
  return filePath.startsWith(`${projectRoot}/`) ? filePath.slice(projectRoot.length + 1) : filePath;
}

function matchFolder(filePath: string | undefined): ArchitectureLayer | undefined {
  if (!filePath) {
    return undefined;
  }

  const segments = filePath.split('/').slice(0, -1);
  // The closest folder to the file wins.
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const layer = FOLDER_SEGMENTS[segments[index].toLowerCase()];
    if (layer) {
      return layer;
    }
  }

  return undefined;
}
