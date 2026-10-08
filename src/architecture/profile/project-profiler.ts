import {
  DATABASE_LABELS,
  createDatabaseId,
  type DatabaseKind,
  type DetectedDatabase,
  type DetectedFramework,
  type ProjectKind,
  type ProjectProfile,
} from '../models/architecture-project';
import type { NestAnalysis } from '../parser/nestjs-parser';
import {
  ARCHETYPE_LABELS,
  detectArchetype,
  type ArchetypeResult,
  type PackageFacts,
} from './application-archetype';
import type { ParsedFile } from '../parser/parsed-model';
import type { ScannedManifest } from '../scanner/repository-scanner';
import {
  BACKEND_PACKAGES,
  DIALECT_VALUES,
  DRIVER_PACKAGES,
  FRONTEND_PACKAGES,
  IMAGE_SIGNALS,
  MODULE_ACCESS,
  ORM_PACKAGES,
  PRIMARY_ENGINES,
} from './database-signals';

export interface ProjectProfilerInput {
  workspaceName: string;
  manifests: readonly ScannedManifest[];
  files: readonly ParsedFile[];
  analysis: NestAnalysis;
}

interface ProjectDraft {
  id: string;
  name: string;
  rootPath: string;
  workspaceName: string;
  dependencies: Record<string, string>;
  facts: PackageFacts;
  hasOwnDependencies: boolean;
  /** True when another project lives inside this one (a workspace root). */
  hasChildren: boolean;
  files: ParsedFile[];
  callNames: Set<string>;
  exportNames: Set<string>;
  tsxCount: number;
  controllerCount: number;
  moduleCount: number;
  entityCount: number;
}

/**
 * Answers three questions about a repository, deterministically:
 *   - is this an API, a UI, or both?
 *   - which frameworks are in play?
 *   - which databases does it talk to, and through what?
 *
 * A "project" is one `package.json`, so a monorepo is profiled per application
 * instead of being collapsed into a single verdict.
 */
export class ProjectProfiler {
  profile(input: ProjectProfilerInput): ProjectProfile[] {
    const drafts = this.createDrafts(input);
    this.assignFiles(drafts, input);

    const kept = drafts.filter((draft) => draft.files.length > 0);
    const projects = kept.length > 0 ? kept : drafts.slice(0, 1);

    for (const draft of projects) {
      draft.hasChildren = projects.some(
        (candidate) => candidate !== draft && ownsPath(draft.rootPath, candidate.rootPath),
      );
    }

    const composeImages = readComposeImages(input.manifests);
    const prismaProviders = readPrismaProviders(input.manifests);

    return projects.map((draft) => {
      // Ancestors are looked up among *all* manifests, not just the projects
      // that survived: a workspace root with no sources of its own is dropped
      // from the list but still hoists everything its packages rely on.
      const inherited = this.inheritedDependencies(draft, drafts);
      const { kind, evidence } = detectKind(draft, inherited);
      const frameworks = frameworksFor(draft, inherited, kind);
      const archetype = detectArchetype({
        facts: draft.facts,
        ownDependencies: draft.dependencies,
        inheritedDependencies: inherited,
        manifests: input.manifests.filter((manifest) => ownsPath(draft.rootPath, manifest.relativePath)),
        hasChildren: draft.hasChildren,
        controllerCount: draft.controllerCount,
        moduleCount: draft.moduleCount,
        tsxCount: draft.tsxCount,
        fileCount: draft.files.length,
        callNames: draft.callNames,
        exportNames: draft.exportNames,
      });

      return {
        id: draft.id,
        name: draft.name,
        rootPath: draft.rootPath,
        workspaceName: draft.workspaceName,
        kind,
        archetype: archetype.archetype,
        archetypeLabel: ARCHETYPE_LABELS[archetype.archetype],
        archetypeConfidence: archetype.confidence,
        primaryFramework: archetype.primaryFramework ?? frameworks[0]?.label,
        frameworks,
        databases: detectDatabases({
          draft,
          ownDependencies: draft.dependencies,
          inheritedDependencies: inherited,
          kind,
          analysis: input.analysis,
          composeImages,
          prismaProviders,
        }),
        evidence: mergeEvidence(evidence, archetype),
        fileCount: draft.files.length,
      };
    });
  }

  private createDrafts(input: ProjectProfilerInput): ProjectDraft[] {
    const drafts: ProjectDraft[] = [];

    for (const manifest of input.manifests) {
      if (basename(manifest.relativePath) !== 'package.json') {
        continue;
      }

      const parsed = parseJson(manifest.content);
      const rootPath = dirname(manifest.relativePath);
      const dependencies = {
        ...asRecord(parsed?.dependencies),
        ...asRecord(parsed?.devDependencies),
        ...asRecord(parsed?.peerDependencies),
      };

      drafts.push({
        id: rootPath === '' ? '.' : rootPath,
        name:
          typeof parsed?.name === 'string' && parsed.name.length > 0
            ? parsed.name
            : rootPath === ''
              ? manifest.workspaceName
              : basename(rootPath),
        rootPath,
        workspaceName: manifest.workspaceName,
        dependencies,
        facts: readPackageFacts(parsed, rootPath, manifest.workspaceName),
        hasOwnDependencies: Object.keys(dependencies).length > 0,
        hasChildren: false,
        files: [],
        callNames: new Set(),
        exportNames: new Set(),
        tsxCount: 0,
        controllerCount: 0,
        moduleCount: 0,
        entityCount: 0,
      });
    }

    if (drafts.length === 0) {
      drafts.push({
        id: '.',
        name: input.workspaceName,
        rootPath: '',
        workspaceName: input.workspaceName,
        dependencies: {},
        facts: readPackageFacts(undefined, '', input.workspaceName),
        hasOwnDependencies: false,
        hasChildren: false,
        files: [],
        callNames: new Set(),
        exportNames: new Set(),
        tsxCount: 0,
        controllerCount: 0,
        moduleCount: 0,
        entityCount: 0,
      });
    }

    // Longest root first so nested projects win over the repository root.
    return drafts.sort((left, right) => right.rootPath.length - left.rootPath.length);
  }

  private assignFiles(drafts: ProjectDraft[], input: ProjectProfilerInput): void {
    const controllerFiles = new Set(
      input.analysis.components
        .filter((component) => component.role === 'controller')
        .map((component) => component.declaration.filePath),
    );
    const entityFiles = new Set(
      input.analysis.components
        .filter((component) => component.role === 'entity')
        .map((component) => component.declaration.filePath),
    );
    const moduleFiles = new Set(input.analysis.modules.map((module) => module.declaration.filePath));

    for (const file of input.files) {
      const draft = drafts.find((candidate) => ownsPath(candidate.rootPath, file.filePath));
      if (!draft) {
        continue;
      }
      draft.files.push(file);
      if (file.filePath.endsWith('.tsx')) {
        draft.tsxCount += 1;
      }
      if (controllerFiles.has(file.filePath)) {
        draft.controllerCount += 1;
      }
      if (moduleFiles.has(file.filePath)) {
        draft.moduleCount += 1;
      }
      if (entityFiles.has(file.filePath)) {
        draft.entityCount += 1;
      }
      // Runtime signals: `functions.https.onRequest(...)`, `export const handler`.
      for (const fn of file.functions) {
        draft.exportNames.add(fn.name);
        for (const call of fn.calls) {
          draft.callNames.add(call);
        }
      }
    }
  }

  /**
   * Dependencies hoisted to an ancestor `package.json`.
   *
   * In an Nx or npm-workspaces repository every package may declare nothing at
   * all while the root declares NestJS, React and Prisma together. Those are
   * the dependencies of the *children*, so they are kept separate from the
   * project's own and only ever used as weak evidence.
   */
  private inheritedDependencies(
    draft: ProjectDraft,
    candidates: readonly ProjectDraft[],
  ): Record<string, string> {
    const ancestors = candidates
      .filter((candidate) => candidate !== draft && ownsPath(candidate.rootPath, draft.rootPath))
      .sort((left, right) => left.rootPath.length - right.rootPath.length);

    const inherited: Record<string, string> = {};
    for (const ancestor of ancestors) {
      Object.assign(inherited, ancestor.dependencies);
    }
    return inherited;
  }
}

/**
 * Frameworks the project itself is built with.
 *
 * A workspace root hoists its packages' dependencies, so it reports none of its
 * own. Everywhere else, inherited frameworks are only kept when they fit what
 * the project turned out to be — a React app in the same repo must not make the
 * API look like a React app.
 */
function frameworksFor(
  draft: ProjectDraft,
  inherited: Record<string, string>,
  kind: ProjectKind,
): DetectedFramework[] {
  if (draft.hasChildren) {
    return [];
  }

  const allowed: Readonly<Record<ProjectKind, ReadonlyArray<DetectedFramework['category']>>> = {
    api: ['backend', 'orm'],
    ui: ['frontend'],
    fullstack: ['backend', 'frontend', 'orm'],
    library: [],
    unknown: [],
  };

  const frameworks = new Map<string, DetectedFramework>();
  for (const framework of detectFrameworks(draft.dependencies)) {
    frameworks.set(framework.label, framework);
  }
  for (const framework of detectFrameworks(inherited)) {
    if (allowed[kind].includes(framework.category)) {
      frameworks.set(framework.label, framework);
    }
  }

  return [...frameworks.values()];
}

/** Facts a `package.json` states about how it is meant to be run. */
function readPackageFacts(
  parsed: Record<string, unknown> | undefined,
  rootPath: string,
  workspaceName: string,
): PackageFacts {
  const engines = parsed?.engines;
  const scripts = parsed?.scripts;

  return {
    name:
      typeof parsed?.name === 'string' && parsed.name.length > 0
        ? parsed.name
        : rootPath === ''
          ? workspaceName
          : basename(rootPath),
    hasBin: parsed?.bin !== undefined,
    hasEntryPoint: parsed?.main !== undefined || parsed?.exports !== undefined || parsed?.types !== undefined,
    vsCodeEngine:
      typeof engines === 'object' && engines !== null && 'vscode' in (engines as Record<string, unknown>),
    hasContributes: parsed?.contributes !== undefined,
    workspaces: parsed?.workspaces !== undefined,
    scripts: typeof scripts === 'object' && scripts !== null ? Object.keys(scripts) : [],
  };
}

/** The archetype's evidence leads: it is the more specific verdict. */
function mergeEvidence(kindEvidence: readonly string[], archetype: ArchetypeResult): string[] {
  const merged = [...archetype.evidence];
  for (const entry of kindEvidence) {
    if (!merged.includes(entry)) {
      merged.push(entry);
    }
  }
  return merged;
}

function detectFrameworks(dependencies: Record<string, string>): DetectedFramework[] {
  const frameworks = new Map<string, DetectedFramework>();

  for (const [packageName, label] of Object.entries(BACKEND_PACKAGES)) {
    if (dependencies[packageName]) {
      frameworks.set(label, { id: label.toLowerCase(), label, category: 'backend' });
    }
  }
  for (const [packageName, label] of Object.entries(FRONTEND_PACKAGES)) {
    if (dependencies[packageName]) {
      frameworks.set(label, { id: label.toLowerCase(), label, category: 'frontend' });
    }
  }
  for (const [packageName, orm] of Object.entries(ORM_PACKAGES)) {
    if (dependencies[packageName]) {
      frameworks.set(orm.access, { id: orm.access.toLowerCase(), label: orm.access, category: 'orm' });
    }
  }

  return [...frameworks.values()];
}

/**
 * Scores backend against frontend evidence.
 *
 * Evidence a project owns (its own dependencies, its own sources) is decisive;
 * dependencies hoisted to an ancestor are worth a single point and can never
 * on their own make a package "fullstack" — otherwise every package in an Nx
 * monorepo inherits the union of every framework in the repository.
 */
function detectKind(
  draft: ProjectDraft,
  inherited: Record<string, string>,
): { kind: ProjectKind; evidence: string[] } {
  const evidence: string[] = [];
  let backend = 0;
  let frontend = 0;

  // A workspace root hoists dependencies for its packages; they say nothing
  // about the root itself.
  if (!draft.hasChildren) {
    const backendPackages = Object.keys(BACKEND_PACKAGES).filter((name) => draft.dependencies[name]);
    const frontendPackages = Object.keys(FRONTEND_PACKAGES).filter((name) => draft.dependencies[name]);

    if (backendPackages.length > 0) {
      backend += 2;
      evidence.push(`package.json: ${backendPackages.slice(0, 3).join(', ')}`);
    }
    if (frontendPackages.length > 0) {
      frontend += 2;
      evidence.push(`package.json: ${frontendPackages.slice(0, 3).join(', ')}`);
    }
  }

  if (draft.controllerCount > 0) {
    backend += 2;
    evidence.push(`${draft.controllerCount} controller(s)`);
  } else if (draft.moduleCount > 0) {
    backend += 1;
    evidence.push(`${draft.moduleCount} NestJS module(s)`);
  }
  if (draft.tsxCount > 0) {
    frontend += 2;
    evidence.push(`${draft.tsxCount} .tsx file(s)`);
  }

  // Weak fallback: nothing about the project itself was conclusive.
  if (backend === 0 && frontend === 0 && !draft.hasChildren) {
    const inheritedBackend = Object.keys(BACKEND_PACKAGES).filter((name) => inherited[name]);
    const inheritedFrontend = Object.keys(FRONTEND_PACKAGES).filter((name) => inherited[name]);
    if (inheritedBackend.length > 0) {
      backend += 1;
      evidence.push(`inherited: ${inheritedBackend.slice(0, 2).join(', ')}`);
    }
    if (inheritedFrontend.length > 0) {
      frontend += 1;
      evidence.push(`inherited: ${inheritedFrontend.slice(0, 2).join(', ')}`);
    }
  }

  let kind: ProjectKind;
  if (backend >= 2 && frontend >= 2) {
    kind = 'fullstack';
  } else if (backend > frontend && backend >= 2) {
    kind = 'api';
  } else if (frontend > backend && frontend >= 2) {
    kind = 'ui';
  } else if (backend > frontend) {
    kind = 'api';
  } else if (frontend > backend) {
    kind = 'ui';
  } else if (draft.files.length > 0) {
    // Nothing decisive, or inherited evidence pointing both ways at once.
    kind = 'library';
    evidence.push(
      backend > 0 ? 'Inherited dependencies are inconclusive' : 'No web framework detected',
    );
  } else {
    kind = 'unknown';
  }

  if (evidence.length === 0) {
    evidence.push('No framework signals found');
  }

  return { kind, evidence };
}

interface DatabaseDetectionInput {
  draft: ProjectDraft;
  ownDependencies: Record<string, string>;
  inheritedDependencies: Record<string, string>;
  kind: ProjectKind;
  analysis: NestAnalysis;
  composeImages: Array<{ kind: DatabaseKind; source: string }>;
  prismaProviders: Array<{ filePath: string; scope: string; kind: DatabaseKind; source: string }>;
}

function detectDatabases(input: DatabaseDetectionInput): DetectedDatabase[] {
  const { draft } = input;

  // A workspace root that is only a container declares dependencies on behalf
  // of its packages; the datastore belongs to whichever of them serves traffic.
  if (draft.hasChildren && (input.kind === 'library' || input.kind === 'unknown')) {
    return [];
  }

  const found = new Map<string, DetectedDatabase>();

  // Shared infrastructure (hoisted dependencies, a root compose file, a root
  // Prisma schema) belongs to whatever actually serves requests. A UI or a
  // library only reports a datastore it depends on itself.
  const usesSharedInfrastructure = input.kind === 'api' || input.kind === 'fullstack';
  const dependencies = usesSharedInfrastructure
    ? { ...input.inheritedDependencies, ...input.ownDependencies }
    : input.ownDependencies;

  const add = (kind: DatabaseKind, access: string, evidence: string, schemaPath?: string): void => {
    const id = createDatabaseId(draft.id, kind, access);
    const existing = found.get(id);
    if (existing) {
      if (!existing.evidence.includes(evidence)) {
        existing.evidence.push(evidence);
      }
      existing.schemaPath = existing.schemaPath ?? schemaPath;
      return;
    }
    found.set(id, {
      id,
      kind,
      label: DATABASE_LABELS[kind],
      access,
      schemaPath,
      evidence: [evidence],
    });
  };

  const drivers: Array<{ kind: DatabaseKind; source: string }> = [];
  for (const [packageName, kind] of Object.entries(DRIVER_PACKAGES)) {
    if (dependencies[packageName]) {
      drivers.push({ kind, source: `package.json: ${packageName}` });
    }
  }

  const orms: Array<{ access: string; kind?: DatabaseKind; source: string }> = [];
  for (const [packageName, orm] of Object.entries(ORM_PACKAGES)) {
    if (dependencies[packageName]) {
      orms.push({ ...orm, source: `package.json: ${packageName}` });
    }
  }

  // NestJS dynamic modules declare the engine directly: TypeOrmModule.forRoot({ type: 'postgres' }).
  const projectModules = input.analysis.modules.filter((module) =>
    ownsPath(draft.rootPath, module.declaration.filePath),
  );
  for (const module of projectModules) {
    for (const call of module.configCalls) {
      const access = MODULE_ACCESS[call.callee];
      // Only connection setup describes an engine; `forFeature` merely
      // registers entities with a module.
      if (!access || !call.method.startsWith('forRoot')) {
        continue;
      }
      const declared =
        DIALECT_VALUES[(call.stringOptions.type ?? call.stringOptions.dialect ?? '').toLowerCase()] ??
        engineFromConnectionString(call.stringArguments[0]) ??
        access.kind;

      add(declared ?? 'unknown', access.access, `${call.callee}.${call.method}()`);
    }
  }

  // A monorepo keeps one `prisma/schema.prisma` at the root for every service,
  // so a schema in an ancestor directory counts too — the closest one wins.
  const usesPrisma = Boolean(dependencies['@prisma/client'] ?? dependencies.prisma);
  const prisma = usesPrisma
    ? input.prismaProviders
        .filter(
          (provider) =>
            ownsPath(draft.rootPath, provider.filePath) || ownsPath(provider.scope, draft.rootPath),
        )
        .sort((left, right) => right.scope.length - left.scope.length)[0]
    : undefined;
  if (prisma) {
    add(prisma.kind, 'Prisma', prisma.source, prisma.filePath);
  }

  const primaryDrivers = drivers.filter((driver) => PRIMARY_ENGINES.has(driver.kind));
  const standaloneDrivers = drivers.filter((driver) => !PRIMARY_ENGINES.has(driver.kind));
  const generalOrms = orms.filter((orm) => orm.access !== 'Prisma' || !prisma);

  for (const orm of generalOrms) {
    if (orm.kind) {
      add(orm.kind, orm.access, orm.source);
      continue;
    }
    if (primaryDrivers.length === 0) {
      add('unknown', orm.access, orm.source);
      continue;
    }
    for (const driver of primaryDrivers) {
      add(driver.kind, orm.access, driver.source);
      add(driver.kind, orm.access, orm.source);
    }
  }

  if (generalOrms.length === 0) {
    for (const driver of primaryDrivers) {
      add(driver.kind, driverAccessLabel(driver.kind), driver.source);
    }
  }

  for (const driver of standaloneDrivers) {
    add(driver.kind, driverAccessLabel(driver.kind), driver.source);
  }

  // docker-compose is workspace level evidence: only used for server side
  // projects, and only for engines nothing else revealed.
  if (usesSharedInfrastructure) {
    const knownKinds = new Set([...found.values()].map((database) => database.kind));
    for (const image of input.composeImages) {
      if (!knownKinds.has(image.kind)) {
        add(image.kind, driverAccessLabel(image.kind), image.source);
      }
    }
  }

  return mergeUnknownEngines([...found.values()]).sort((left, right) =>
    left.label.localeCompare(right.label),
  );
}

/**
 * `TypeOrmModule.forRoot(configFactory)` reveals the ORM but not the engine.
 * When another signal did identify the engine for that same ORM, the two are
 * the same connection: keep the specific one and fold the evidence into it.
 */
function mergeUnknownEngines(databases: DetectedDatabase[]): DetectedDatabase[] {
  return databases.filter((database) => {
    if (database.kind !== 'unknown') {
      return true;
    }
    const resolved = databases.find(
      (candidate) => candidate.kind !== 'unknown' && candidate.access === database.access,
    );
    if (!resolved) {
      return true;
    }
    for (const entry of database.evidence) {
      if (!resolved.evidence.includes(entry)) {
        resolved.evidence.push(entry);
      }
    }
    return false;
  });
}

function driverAccessLabel(kind: DatabaseKind): string {
  switch (kind) {
    case 'redis':
      return 'Redis client';
    case 'elasticsearch':
      return 'Elasticsearch client';
    case 'dynamodb':
      return 'AWS SDK';
    default:
      return 'driver';
  }
}

function engineFromConnectionString(value: string | undefined): DatabaseKind | undefined {
  if (!value) {
    return undefined;
  }
  const scheme = /^([a-z+]+):\/\//i.exec(value)?.[1]?.toLowerCase();
  if (!scheme) {
    return undefined;
  }
  if (scheme.startsWith('mongodb')) {
    return 'mongodb';
  }
  if (scheme.startsWith('postgres')) {
    return 'postgres';
  }
  if (scheme.startsWith('mysql')) {
    return 'mysql';
  }
  if (scheme.startsWith('redis') || scheme.startsWith('rediss')) {
    return 'redis';
  }
  return undefined;
}

function readComposeImages(
  manifests: readonly ScannedManifest[],
): Array<{ kind: DatabaseKind; source: string }> {
  const images: Array<{ kind: DatabaseKind; source: string }> = [];

  for (const manifest of manifests) {
    if (!/docker-compose[\w.-]*\.ya?ml$/.test(manifest.relativePath)) {
      continue;
    }
    for (const match of manifest.content.matchAll(/^\s*image:\s*["']?([^\s"']+)/gm)) {
      const image = match[1];
      for (const [pattern, kind] of IMAGE_SIGNALS) {
        if (pattern.test(image)) {
          images.push({ kind, source: `${manifest.relativePath}: ${image}` });
          break;
        }
      }
    }
  }

  return images;
}

function readPrismaProviders(
  manifests: readonly ScannedManifest[],
): Array<{ filePath: string; scope: string; kind: DatabaseKind; source: string }> {
  const providers: Array<{ filePath: string; scope: string; kind: DatabaseKind; source: string }> = [];

  for (const manifest of manifests) {
    if (basename(manifest.relativePath) !== 'schema.prisma') {
      continue;
    }
    const provider = /datasource\s+\w+\s*\{[^}]*?provider\s*=\s*"([^"]+)"/s.exec(manifest.content)?.[1];
    const kind = provider ? DIALECT_VALUES[provider.toLowerCase()] : undefined;
    if (kind) {
      const directory = dirname(manifest.relativePath);
      providers.push({
        filePath: manifest.relativePath,
        // `apps/api/prisma/schema.prisma` serves everything under `apps/api`.
        scope: basename(directory) === 'prisma' ? dirname(directory) : directory,
        kind,
        source: `${manifest.relativePath}: provider = "${provider}"`,
      });
    }
  }

  return providers;
}

/** True when `rootPath` contains `filePath` (`''` owns the whole workspace). */
export function ownsPath(rootPath: string, filePath: string): boolean {
  return rootPath === '' || filePath === rootPath || filePath.startsWith(`${rootPath}/`);
}

function parseJson(content: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(content);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') {
      result[key] = entry;
    }
  }
  return result;
}

function dirname(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? '' : filePath.slice(0, index);
}

function basename(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index === -1 ? filePath : filePath.slice(index + 1);
}
