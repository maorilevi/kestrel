import {
  createApplicationId,
  createEdgeId,
  createExternalId,
  createSymbolId,
  type ArchitectureEdge,
  type ArchitectureEdgeMetadata,
  type ArchitectureEdgeType,
  type ArchitectureGraph,
  type ArchitectureNode,
  type ArchitectureNodeMetadata,
  type ArchitectureNodeRole,
  type ArchitectureNodeType,
  type DetectedDatabase,
  type ProjectProfile,
} from '../models';
import type { NestAnalysis } from '../parser/nestjs-parser';
import type { ParsedClass, ParsedFile } from '../parser/parsed-model';
import { delegateName, type PrismaModelDefinition } from '../parser/prisma-parser';
import { featureFolder, type UiAnalysis } from '../parser/ui-parser';
import { buildRouteTable, matchRoute } from './route-matcher';
import { PERSISTENCE_HANDLES } from '../profile/database-signals';
import { classifyLayer } from '../profile/layer-classifier';
import { ownsPath } from '../profile/project-profiler';
import { SymbolIndex } from './symbol-index';

export interface GraphBuildInput {
  workspaceName: string;
  files: readonly ParsedFile[];
  analysis: NestAnalysis;
  /** Detected projects; at least one is always present. */
  projects: readonly ProjectProfile[];
  /** Models declared outside TypeScript, currently Prisma schemas. */
  dataModels?: readonly PrismaModelDefinition[];
  /** Front-end building blocks. */
  ui?: UiAnalysis;
  scannedFileCount: number;
  parseFailureCount: number;
  durationMs?: number;
  generatedAt?: string;
}

/**
 * Turns detected NestJS elements into the architecture graph.
 *
 * Node ids are deterministic (`<relative-path>#<Symbol>`), so two runs over the
 * same sources produce identical graphs and the webview can keep its selection
 * across refreshes. Nodes and edges are de-duplicated by id.
 */
export class GraphBuilder {
  build(input: GraphBuildInput): ArchitectureGraph {
    const index = new SymbolIndex(input.files);
    const nodes = new Map<string, ArchitectureNode>();
    const edges = new Map<string, ArchitectureEdge>();

    const componentsByClass = new Map(
      input.analysis.components.map((component) => [component.declaration, component]),
    );
    const moduleClasses = new Set(input.analysis.modules.map((module) => module.declaration));

    /** Classes referenced by a module but not decorated still deserve a node. */
    const describeClass = (
      declaration: ParsedClass,
    ): { type: ArchitectureNodeType; role: ArchitectureNodeRole } => {
      const component = componentsByClass.get(declaration);
      if (component) {
        return { type: component.nodeType, role: component.role };
      }
      return moduleClasses.has(declaration)
        ? { type: 'module', role: 'module' }
        : { type: 'class', role: 'provider' };
    };

    const addNode = (node: ArchitectureNode): ArchitectureNode => {
      const existing = nodes.get(node.id);
      if (existing) {
        existing.metadata = { ...existing.metadata, ...node.metadata };
        return existing;
      }
      nodes.set(node.id, node);
      return node;
    };

    const addEdge = (
      type: ArchitectureEdgeType,
      source: string,
      target: string,
      metadata?: ArchitectureEdgeMetadata,
    ): void => {
      if (source === target) {
        return;
      }
      const id = createEdgeId(type, source, target);
      const existing = edges.get(id);
      if (existing) {
        if (metadata) {
          existing.metadata = { ...existing.metadata, ...metadata };
        }
        return;
      }
      edges.set(id, { id, source, target, type, metadata });
    };

    const setParent = (node: ArchitectureNode, parentId: string): void => {
      if (!node.parentId && node.id !== parentId) {
        node.parentId = parentId;
      }
    };

    // Longest root first so a nested project wins over the repository root.
    const projects = [...input.projects].sort(
      (left, right) => right.rootPath.length - left.rootPath.length,
    );
    const fallbackProject = projects[projects.length - 1];

    const projectFor = (filePath: string | undefined): ProjectProfile =>
      (filePath ? projects.find((project) => ownsPath(project.rootPath, filePath)) : undefined) ??
      fallbackProject;

    const classNode = (
      declaration: ParsedClass,
      type: ArchitectureNodeType,
      metadata: ArchitectureNodeMetadata,
    ): ArchitectureNode => {
      const role = metadata.role ?? 'provider';
      const project = projectFor(declaration.filePath);
      return addNode({
        id: createSymbolId(declaration.filePath, declaration.name),
        name: declaration.name,
        type,
        filePath: declaration.filePath,
        metadata: {
          line: declaration.line,
          workspaceName: declaration.workspaceName,
          projectId: project.id,
          layer: classifyLayer({
            role,
            name: declaration.name,
            filePath: declaration.filePath,
            projectRoot: project.rootPath,
            heritage: [declaration.extends, ...declaration.implements].filter(
              (value): value is string => typeof value === 'string',
            ),
          }),
          ...metadata,
        },
      });
    };

    const externalNode = (name: string, fromFilePath: string | undefined, role: string): ArchitectureNode =>
      addNode({
        id: createExternalId(name),
        name,
        type: 'external',
        metadata: {
          role: 'external',
          unresolved: true,
          externalRole: role,
          packageName: index.resolvePackage(fromFilePath, name),
        },
      });

    // 1. One application node per detected project, with its datastores.
    const databaseNodeIds = new Map<string, string[]>();
    for (const project of projects) {
      const applicationId = createApplicationId(project.id);
      addNode({
        id: applicationId,
        name: project.name,
        type: 'application',
        metadata: {
          role: 'application',
          projectId: project.id,
          kind: project.kind,
          archetype: project.archetype,
          archetypeLabel: project.archetypeLabel,
          primaryFramework: project.primaryFramework,
          frameworks: project.frameworks.map((framework) => framework.label),
          evidence: project.evidence,
          fileCount: project.fileCount,
          rootPath: project.rootPath,
        },
      });

      const ids: string[] = [];
      for (const database of project.databases) {
        const node = addNode({
          id: database.id,
          name: database.label,
          type: 'database',
          metadata: {
            role: 'datastore',
            layer: 'data',
            projectId: project.id,
            databaseKind: database.kind,
            access: database.access,
            evidence: database.evidence,
          },
        });
        node.parentId = applicationId;
        addEdge('contains', applicationId, node.id);
        ids.push(node.id);
      }
      databaseNodeIds.set(project.id, ids);
    }

    const databaseFor = (projectId: string, preferredAccess?: string): string | undefined => {
      const project = projects.find((candidate) => candidate.id === projectId);
      if (!project || project.databases.length === 0) {
        return undefined;
      }
      const matching = preferredAccess
        ? project.databases.filter((database) => database.access === preferredAccess)
        : [];
      const preferred = matching.find((database) => database.kind !== 'unknown') ?? matching[0];
      return (preferred ?? primaryDatabase(project.databases)).id;
    };

    // 2. Models declared in a Prisma schema become entities of the project that
    //    owns that schema — Prisma repositories have no `@Entity` classes.
    const modelNodeIds = new Map<string, string>();
    const modelDelegates = new Map<string, string>();

    for (const model of input.dataModels ?? []) {
      const owner =
        projects.find((project) =>
          project.databases.some((database) => database.schemaPath === model.filePath),
        ) ?? projectFor(model.filePath);

      const node = addNode({
        id: createSymbolId(model.filePath, model.name),
        name: model.name,
        type: 'class',
        filePath: model.filePath,
        metadata: {
          role: 'entity',
          layer: 'data',
          projectId: owner.id,
          line: model.line,
          source: 'prisma',
          fieldCount: model.scalarFieldCount,
          tableName: model.tableName,
          workspaceName: owner.workspaceName,
        },
      });

      const applicationId = createApplicationId(owner.id);
      node.parentId = applicationId;
      addEdge('contains', applicationId, node.id);

      const databaseId = databaseFor(owner.id, 'Prisma');
      if (databaseId) {
        addEdge('persists', node.id, databaseId);
      }

      modelNodeIds.set(model.name, node.id);
      modelDelegates.set(delegateName(model.name), node.id);
    }

    // Relations between models, from the side holding the foreign key.
    for (const model of input.dataModels ?? []) {
      const sourceId = modelNodeIds.get(model.name);
      if (!sourceId) {
        continue;
      }
      for (const relation of model.relations) {
        const targetId = modelNodeIds.get(relation.targetModel);
        if (!targetId) {
          continue;
        }
        // Prisma declares both sides; keep the one that owns the key, and for
        // implicit relations keep a single deterministic direction.
        const keep = relation.ownsForeignKey || (!relation.isList && model.name < relation.targetModel);
        if (keep) {
          addEdge('references', sourceId, targetId, { propertyName: relation.fieldName });
        }
      }
    }

    // A global prefix belongs to the application whose bootstrap declares it.
    const globalPrefixes = new Map<string, string>();
    for (const file of input.files) {
      if (file.globalPrefix) {
        globalPrefixes.set(projectFor(file.filePath).id, file.globalPrefix);
      }
    }

    // 3. Controllers, providers and entities.
    for (const component of input.analysis.components) {
      classNode(component.declaration, component.nodeType, {
        role: component.role,
        route: component.route,
        globalPrefix:
          component.nodeType === 'controller'
            ? globalPrefixes.get(projectFor(component.declaration.filePath).id)
            : undefined,
        methods: component.declaration.methods.filter((method) => method.decorators.length > 0),
      });
    }

    // 3. Modules.
    const moduleIds = new Map<(typeof input.analysis.modules)[number], string>();
    for (const definition of input.analysis.modules) {
      const node = classNode(definition.declaration, 'module', {
        role: 'module',
        isGlobal: definition.isGlobal,
      });
      moduleIds.set(definition, node.id);
    }

    // 4. Containment: modules own their controllers, providers and entities.
    for (const definition of input.analysis.modules) {
      const moduleId = moduleIds.get(definition);
      if (!moduleId) {
        continue;
      }
      const fromFile = definition.declaration.filePath;
      const exportedIds: string[] = [];

      const contain = (symbolName: string): void => {
        const resolved = index.resolve(fromFile, symbolName);
        const described = resolved ? describeClass(resolved) : undefined;
        const target =
          resolved && described
            ? classNode(resolved, described.type, { role: described.role })
            : externalNode(symbolName, fromFile, 'provider');

        addEdge('contains', moduleId, target.id);
        setParent(target, moduleId);
      };

      for (const symbolName of [...definition.controllers, ...definition.providers]) {
        contain(symbolName);
      }

      // `TypeOrmModule.forFeature([User])` registers entities with the module.
      for (const call of definition.configCalls) {
        for (const symbolName of call.identifierArguments) {
          const resolved = index.resolve(fromFile, symbolName);
          if (resolved && describeClass(resolved).role === 'entity') {
            contain(symbolName);
          }
        }
      }

      for (const symbolName of definition.exports) {
        const resolved = index.resolve(fromFile, symbolName);
        exportedIds.push(
          resolved ? createSymbolId(resolved.filePath, resolved.name) : createExternalId(symbolName),
        );
      }

      const moduleNode = nodes.get(moduleId);
      if (moduleNode) {
        moduleNode.metadata = { ...moduleNode.metadata, exports: exportedIds };
      }

      // 5. Module imports.
      for (const symbolName of definition.imports) {
        const resolved = index.resolve(fromFile, symbolName);
        const target = resolved
          ? classNode(resolved, 'module', { role: 'module' })
          : externalNode(symbolName, fromFile, 'module');

        addEdge('imports', moduleId, target.id, {
          forwardRef: definition.forwardRefs.includes(symbolName) || undefined,
        });
      }
    }

    // 6. Constructor injection, and persistence handles it reveals.
    for (const component of input.analysis.components) {
      const sourceId = createSymbolId(component.declaration.filePath, component.declaration.name);
      const fromFile = component.declaration.filePath;
      const projectId = projectFor(fromFile).id;

      for (const parameter of component.declaration.constructorParameters) {
        const handleAccess = parameter.typeName ? PERSISTENCE_HANDLES[parameter.typeName] : undefined;

        if (handleAccess || parameter.injectedEntity) {
          const sourceNode = nodes.get(sourceId);
          if (sourceNode) {
            sourceNode.metadata = { ...sourceNode.metadata, accessesDatabase: true };
          }

          // `@InjectRepository(User)` / `Repository<User>` → the entity itself.
          const entityName = parameter.injectedEntity ?? parameter.typeArguments[0];
          const entity = entityName ? index.resolve(fromFile, entityName) : undefined;

          if (entity) {
            const described = describeClass(entity);
            const target = classNode(entity, described.type, { role: described.role });
            addEdge('persists', sourceId, target.id, {
              via: parameter.typeText ?? parameter.typeName,
              propertyName: parameter.name,
            });
            continue;
          }

          // `this.prisma.user.findMany()` names the model at the call site.
          const touched = component.declaration.memberAccess
            .filter((access) => access.member === parameter.name)
            .map((access) => modelDelegates.get(access.property))
            .filter((id): id is string => id !== undefined);

          if (touched.length > 0) {
            for (const targetId of new Set(touched)) {
              addEdge('persists', sourceId, targetId, {
                via: parameter.typeName,
                propertyName: parameter.name,
              });
            }
            continue;
          }

          const databaseId = databaseFor(projectId, handleAccess);
          if (databaseId) {
            addEdge('persists', sourceId, databaseId, {
              via: parameter.typeText ?? parameter.typeName,
              propertyName: parameter.name,
            });
          }
          // A persistence handle is infrastructure, not an architectural peer:
          // no `external` node is created for `Repository` or `Model`.
          continue;
        }

        const symbolName = parameter.typeName;
        const resolved = symbolName ? index.resolve(fromFile, symbolName) : undefined;

        let targetId: string;
        if (resolved) {
          const described = describeClass(resolved);
          targetId = classNode(resolved, described.type, { role: described.role }).id;
        } else {
          const externalName = parameter.injectToken ?? symbolName;
          if (!externalName) {
            continue;
          }
          targetId = externalNode(externalName, fromFile, 'provider').id;
        }

        addEdge('injects', sourceId, targetId, {
          propertyName: parameter.name,
          token: parameter.injectToken,
        });
      }
    }

    // 7. Entities are stored in their project's database.
    for (const component of input.analysis.components) {
      if (component.role !== 'entity') {
        continue;
      }
      const projectId = projectFor(component.declaration.filePath).id;
      const databaseId = databaseFor(projectId, entityAccess(component.declaration));
      if (!databaseId) {
        continue;
      }
      addEdge(
        'persists',
        createSymbolId(component.declaration.filePath, component.declaration.name),
        databaseId,
      );
    }

    // 8. Front-end architecture: pages, components, hooks, stores, API clients.
    const uiElements = input.ui?.elements ?? [];
    const uiNodeIds = new Map<string, string>();
    const featureNodes = new Map<string, ArchitectureNode>();

    for (const element of uiElements) {
      const project = projectFor(element.filePath);
      const node = addNode({
        id: createSymbolId(element.filePath, element.name),
        name: element.name,
        type: element.nodeType,
        filePath: element.filePath,
        metadata: {
          role: element.role,
          layer: classifyLayer({
            role: element.role,
            name: element.name,
            filePath: element.filePath,
            projectRoot: project.rootPath,
          }),
          line: element.line,
          projectId: project.id,
          workspaceName: element.workspaceName,
          route: element.route,
          endpoints: element.httpCalls.length > 0 ? element.httpCalls.map((call) => call.path) : undefined,
        },
      });
      uiNodeIds.set(node.id, node.id);

      // Feature modules give a front-end its bird's-eye view.
      const folder = featureFolder(element.filePath, project.rootPath);
      if (folder) {
        const featureId = `feature#${project.id}:${folder}`;
        const feature =
          featureNodes.get(featureId) ??
          addNode({
            id: featureId,
            name: folder,
            type: 'module',
            metadata: { role: 'feature', projectId: project.id, folder },
          });
        featureNodes.set(featureId, feature);

        const applicationId = createApplicationId(project.id);
        feature.parentId = applicationId;
        addEdge('contains', applicationId, featureId);
        addEdge('contains', featureId, node.id);
        setParent(node, featureId);
      }
    }

    // Composition, hook usage and the calls that leave the browser.
    const routeTable = buildRouteTable([...nodes.values()]);

    for (const element of uiElements) {
      const sourceId = createSymbolId(element.filePath, element.name);

      for (const tag of element.jsxTags) {
        const target = index.resolveDeclaration(element.filePath, tag);
        const targetId = target ? createSymbolId(target.filePath, target.name) : undefined;
        if (targetId && uiNodeIds.has(targetId)) {
          addEdge('renders', sourceId, targetId);
        }
      }

      for (const call of element.calls) {
        const target = index.resolveDeclaration(element.filePath, call);
        const targetId = target ? createSymbolId(target.filePath, target.name) : undefined;
        if (targetId && uiNodeIds.has(targetId) && targetId !== sourceId) {
          addEdge('calls', sourceId, targetId, { propertyName: call });
        }
      }

      for (const httpCall of element.httpCalls) {
        const match = matchRoute(httpCall.path, routeTable);
        if (match) {
          addEdge('calls', sourceId, match.nodeId, { propertyName: `${httpCall.method} /${match.basePath}` });
        }
      }
    }

    // 9. Attach modules to the application node of their project.
    const allModuleIds = [...moduleIds.values()];
    const importedModuleIds = new Set(
      [...edges.values()]
        .filter((edge) => edge.type === 'imports' && allModuleIds.includes(edge.target))
        .map((edge) => edge.target),
    );

    let rootModuleIds = allModuleIds.filter((id) => !importedModuleIds.has(id));
    if (rootModuleIds.length === 0 && allModuleIds.length > 0) {
      // Every module is imported by another (cycle): fall back to AppModule.
      const appModule = allModuleIds.find((id) => id.endsWith('#AppModule')) ?? allModuleIds[0];
      rootModuleIds = [appModule];
    }

    for (const moduleId of rootModuleIds) {
      const node = nodes.get(moduleId);
      const applicationId = createApplicationId(projectFor(node?.filePath).id);
      addEdge('contains', applicationId, moduleId);
      if (node) {
        setParent(node, applicationId);
      }
    }

    // Nested modules get their first importer as parent so breadcrumbs work.
    for (const edge of edges.values()) {
      if (edge.type !== 'imports') {
        continue;
      }
      const target = nodes.get(edge.target);
      if (target?.type === 'module') {
        setParent(target, edge.source);
      }
    }

    // Anything still unparented (components outside a module) hangs off the app.
    for (const node of nodes.values()) {
      if (node.type === 'application' || node.type === 'external' || node.parentId) {
        continue;
      }
      const applicationId = createApplicationId(projectFor(node.filePath).id);
      if (node.id === applicationId) {
        continue;
      }
      addEdge('contains', applicationId, node.id);
      node.parentId = applicationId;
    }

    const nodeList = [...nodes.values()];
    const edgeList = [...edges.values()];

    return {
      nodes: nodeList,
      edges: edgeList,
      metadata: {
        workspaceName: input.workspaceName,
        generatedAt: input.generatedAt ?? new Date().toISOString(),
        frameworkDetected: input.analysis.frameworkDetected,
        projects: [...input.projects],
        stats: {
          fileCount: input.scannedFileCount,
          parsedFileCount: input.files.length,
          parseFailureCount: input.parseFailureCount,
          moduleCount: nodeList.filter((node) => node.type === 'module').length,
          controllerCount: nodeList.filter((node) => node.type === 'controller').length,
          serviceCount: nodeList.filter((node) => node.type === 'service').length,
          uiElementCount: nodeList.filter((node) =>
            ['page', 'component', 'hook', 'store', 'api-client'].includes(node.type),
          ).length,
          entityCount: nodeList.filter((node) => node.metadata?.role === 'entity').length,
          databaseCount: nodeList.filter((node) => node.type === 'database').length,
          externalCount: nodeList.filter((node) => node.type === 'external').length,
          dependencyCount: edgeList.filter((edge) => edge.type === 'injects').length,
          durationMs: input.durationMs ?? 0,
        },
        issues: [],
        styles: [],
      },
    };
  }
}

/** Prefer a real engine over an ORM whose dialect could not be resolved. */
function primaryDatabase(databases: readonly DetectedDatabase[]): DetectedDatabase {
  return databases.find((database) => database.kind !== 'unknown' && database.kind !== 'redis') ?? databases[0];
}

/** The library an entity is bound to, inferred from its decorator. */
function entityAccess(declaration: ParsedClass): string | undefined {
  const names = declaration.decorators.map((decorator) => decorator.name);
  if (names.includes('Schema')) {
    return 'Mongoose';
  }
  if (names.includes('Table')) {
    return 'Sequelize';
  }
  if (names.includes('Entity') || names.includes('ViewEntity')) {
    return 'TypeORM';
  }
  return undefined;
}
