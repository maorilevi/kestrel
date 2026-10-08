import type { ArchitectureNodeRole, ArchitectureNodeType } from '../models/architecture-node';
import {
  findDecorator,
  type ParsedCallReference,
  type ParsedClass,
  type ParsedFile,
} from './parsed-model';

/** A `@Module()` declaration and the symbol names it references. */
export interface NestModuleDefinition {
  declaration: ParsedClass;
  imports: string[];
  controllers: string[];
  providers: string[];
  exports: string[];
  /** Subset of `imports` that were declared through `forwardRef(() => X)`. */
  forwardRefs: string[];
  /** Configuration calls in `imports`, e.g. `TypeOrmModule.forRoot({...})`. */
  configCalls: ParsedCallReference[];
  isGlobal: boolean;
}

/** A controller / provider participating in the architecture. */
export interface NestComponentDefinition {
  declaration: ParsedClass;
  role: ArchitectureNodeRole;
  nodeType: ArchitectureNodeType;
  /** Route prefix for controllers. */
  route?: string;
}

export interface NestAnalysis {
  modules: NestModuleDefinition[];
  components: NestComponentDefinition[];
  /** True when at least one NestJS building block was detected. */
  frameworkDetected: boolean;
}

const MODULE_DECORATORS = new Set(['Module']);
const CONTROLLER_DECORATORS = new Set(['Controller']);

/**
 * Decorators that mark a class as an injectable provider. The value is the
 * role reported for the node; the MVP renders every role as a `service` node
 * (see {@link ROLE_TO_NODE_TYPE}) but keeps the role in metadata so future
 * versions can promote roles to first class node types.
 */
const PROVIDER_DECORATORS: ReadonlyMap<string, ArchitectureNodeRole> = new Map<string, ArchitectureNodeRole>([
  ['Injectable', 'service'],
  ['Catch', 'filter'],
  ['Resolver', 'resolver'],
  ['WebSocketGateway', 'gateway'],
  ['Processor', 'worker'],
]);

/**
 * Decorators that mark a persisted model: TypeORM (`@Entity`, `@ViewEntity`),
 * Mongoose via `@nestjs/mongoose` (`@Schema`) and Sequelize (`@Table`).
 */
const ENTITY_DECORATORS = new Set(['Entity', 'ViewEntity', 'Schema', 'Table']);

/** Name suffix heuristics, applied only to classes already known to be providers. */
const ROLE_SUFFIXES: ReadonlyArray<[string, ArchitectureNodeRole]> = [
  ['Repository', 'repository'],
  ['Guard', 'guard'],
  ['Interceptor', 'interceptor'],
  ['Pipe', 'pipe'],
  ['Filter', 'filter'],
  ['Middleware', 'middleware'],
  ['Strategy', 'strategy'],
  ['Resolver', 'resolver'],
  ['Gateway', 'gateway'],
  ['Processor', 'worker'],
  ['Consumer', 'worker'],
  ['Service', 'service'],
];

/** Base classes / interfaces that identify a role even without a name suffix. */
const ROLE_HERITAGE: ReadonlyArray<[string, ArchitectureNodeRole]> = [
  ['CanActivate', 'guard'],
  ['NestInterceptor', 'interceptor'],
  ['PipeTransform', 'pipe'],
  ['ExceptionFilter', 'filter'],
  ['NestMiddleware', 'middleware'],
  ['PassportStrategy', 'strategy'],
];

/**
 * MVP mapping from role to architecture node type.
 *
 * Everything injectable is presented as a `service` for now; flipping an entry
 * here is all that is required to surface repositories, guards or resolvers as
 * their own node type later.
 */
const ROLE_TO_NODE_TYPE: Readonly<Record<ArchitectureNodeRole, ArchitectureNodeType>> = {
  application: 'application',
  module: 'module',
  controller: 'controller',
  service: 'service',
  repository: 'service',
  entity: 'class',
  datastore: 'database',
  guard: 'service',
  interceptor: 'service',
  pipe: 'service',
  filter: 'service',
  middleware: 'service',
  strategy: 'service',
  resolver: 'service',
  gateway: 'service',
  worker: 'service',
  provider: 'service',
  // Front-end roles keep their own node types: a page is not a service.
  page: 'page',
  component: 'component',
  layout: 'component',
  hook: 'hook',
  store: 'store',
  'context-provider': 'store',
  'api-client': 'api-client',
  feature: 'module',
  external: 'external',
};

/**
 * Turns the language level model into NestJS architecture elements.
 * Purely functional and framework free — no VS Code, no ts-morph.
 */
export class NestJsParser {
  analyze(files: readonly ParsedFile[]): NestAnalysis {
    const modules: NestModuleDefinition[] = [];
    const components: NestComponentDefinition[] = [];

    for (const file of files) {
      for (const declaration of file.classes) {
        const moduleDefinition = readModule(declaration);
        if (moduleDefinition) {
          modules.push(moduleDefinition);
          continue;
        }

        const component = readComponent(declaration);
        if (component) {
          components.push(component);
        }
      }
    }

    return {
      modules,
      components,
      frameworkDetected: modules.length > 0 || components.length > 0,
    };
  }
}

function readModule(declaration: ParsedClass): NestModuleDefinition | undefined {
  const decorator = declaration.decorators.find((candidate) => MODULE_DECORATORS.has(candidate.name));
  if (!decorator) {
    return undefined;
  }

  const read = (key: string): string[] => decorator.properties[key]?.identifiers ?? [];

  return {
    declaration,
    imports: read('imports'),
    controllers: read('controllers'),
    providers: read('providers'),
    exports: read('exports'),
    forwardRefs: decorator.properties.imports?.forwardRefs ?? [],
    configCalls: Object.values(decorator.properties).flatMap((property) => property.calls),
    isGlobal: findDecorator(declaration, 'Global') !== undefined,
  };
}

function readComponent(declaration: ParsedClass): NestComponentDefinition | undefined {
  const controllerDecorator = declaration.decorators.find((candidate) =>
    CONTROLLER_DECORATORS.has(candidate.name),
  );

  if (controllerDecorator) {
    const route =
      controllerDecorator.stringArguments[0] ??
      controllerDecorator.properties.path?.strings[0] ??
      '';
    return {
      declaration,
      role: 'controller',
      nodeType: ROLE_TO_NODE_TYPE.controller,
      route,
    };
  }

  const entityDecorator = declaration.decorators.find((candidate) =>
    ENTITY_DECORATORS.has(candidate.name),
  );

  if (entityDecorator) {
    return {
      declaration,
      role: 'entity',
      nodeType: ROLE_TO_NODE_TYPE.entity,
    };
  }

  const providerDecorator = declaration.decorators.find((candidate) =>
    PROVIDER_DECORATORS.has(candidate.name),
  );

  if (!providerDecorator) {
    return undefined;
  }

  const role = classifyProvider(declaration, PROVIDER_DECORATORS.get(providerDecorator.name) ?? 'provider');

  return {
    declaration,
    role,
    nodeType: ROLE_TO_NODE_TYPE[role],
  };
}

/**
 * Determines the finer grained role of an injectable provider.
 * Decorator evidence wins over heritage, heritage wins over name suffixes.
 */
export function classifyProvider(
  declaration: ParsedClass,
  decoratorRole: ArchitectureNodeRole,
): ArchitectureNodeRole {
  if (decoratorRole !== 'service') {
    return decoratorRole;
  }

  const heritage = [declaration.extends, ...declaration.implements].filter(
    (value): value is string => typeof value === 'string',
  );

  for (const [marker, role] of ROLE_HERITAGE) {
    if (heritage.some((entry) => entry.includes(marker))) {
      return role;
    }
  }

  for (const [suffix, role] of ROLE_SUFFIXES) {
    if (declaration.name.endsWith(suffix)) {
      return role;
    }
  }

  return 'service';
}

export { ROLE_TO_NODE_TYPE };
