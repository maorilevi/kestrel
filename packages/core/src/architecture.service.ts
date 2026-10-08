import { ArchitectureAnalyzer } from './analysis/architecture-analyzer';
import { ArchitectureStyleDetector } from './analysis/architecture-style';
import { Emitter } from './emitter';
import { GraphBuilder } from './graph/graph-builder';
import { noopLogger, type Logger } from './logger';
import {
  createEmptyGraph,
  findNode,
  type ArchitectureGraph,
  type ArchitectureNode,
  type ProjectProfile,
} from './models';
import { NestJsParser } from './parser/nestjs-parser';
import { PrismaParser } from './parser/prisma-parser';
import { UiParser } from './parser/ui-parser';
import { TypeScriptParser } from './parser/typescript-parser';
import { ProjectProfiler } from './profile/project-profiler';
import type { ParsedFile } from './parser/parsed-model';
import { ownsPath } from './profile/project-profiler';
import type { RepositoryScanner, ScannedFile } from './scanner/repository-scanner';

export interface ArchitectureServiceDependencies {
  typescriptParser?: TypeScriptParser;
  nestParser?: NestJsParser;
  prismaParser?: PrismaParser;
  uiParser?: UiParser;
  profiler?: ProjectProfiler;
  graphBuilder?: GraphBuilder;
  analyzer?: ArchitectureAnalyzer;
  styleDetector?: ArchitectureStyleDetector;
}

/**
 * Orchestrates scan → parse → detect → build → analyse.
 *
 * The service owns the current architecture graph and notifies subscribers when
 * it changes. It is intentionally free of VS Code types: the editor integration
 * supplies a scanner and a logger, nothing else.
 */
export class ArchitectureService {
  private graph: ArchitectureGraph = createEmptyGraph();
  private absolutePaths = new Map<string, string>();
  private inFlight?: Promise<ArchitectureGraph>;

  private readonly typescriptParser: TypeScriptParser;
  private readonly nestParser: NestJsParser;
  private readonly prismaParser: PrismaParser;
  private readonly uiParser: UiParser;
  private readonly profiler: ProjectProfiler;
  private readonly graphBuilder: GraphBuilder;
  private readonly analyzer: ArchitectureAnalyzer;
  private readonly styleDetector: ArchitectureStyleDetector;

  readonly onDidChangeArchitecture = new Emitter<ArchitectureGraph>();
  readonly onDidFail = new Emitter<Error>();

  constructor(
    private readonly scanner: RepositoryScanner,
    private readonly logger: Logger = noopLogger,
    dependencies: ArchitectureServiceDependencies = {},
  ) {
    this.typescriptParser = dependencies.typescriptParser ?? new TypeScriptParser(logger);
    this.nestParser = dependencies.nestParser ?? new NestJsParser();
    this.prismaParser = dependencies.prismaParser ?? new PrismaParser();
    this.uiParser = dependencies.uiParser ?? new UiParser();
    this.profiler = dependencies.profiler ?? new ProjectProfiler();
    this.graphBuilder = dependencies.graphBuilder ?? new GraphBuilder();
    this.analyzer = dependencies.analyzer ?? new ArchitectureAnalyzer();
    this.styleDetector = dependencies.styleDetector ?? new ArchitectureStyleDetector();
  }

  getGraph(): ArchitectureGraph {
    return this.graph;
  }

  getNode(nodeId: string): ArchitectureNode | undefined {
    return findNode(this.graph, nodeId);
  }

  /** Absolute path for a workspace relative path discovered during the last scan. */
  resolveAbsolutePath(relativePath: string, workspaceName?: string): string | undefined {
    if (workspaceName) {
      const scoped = this.absolutePaths.get(pathKey(relativePath, workspaceName));
      if (scoped) {
        return scoped;
      }
    }
    return this.absolutePaths.get(pathKey(relativePath));
  }

  /**
   * Rebuilds the architecture. Concurrent calls share a single run so a burst
   * of file changes cannot start overlapping scans.
   */
  async build(): Promise<ArchitectureGraph> {
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.runBuild().finally(() => {
      this.inFlight = undefined;
    });

    return this.inFlight;
  }

  private async runBuild(): Promise<ArchitectureGraph> {
    const startedAt = Date.now();

    try {
      this.logger.info('Scanning workspace...');
      const scan = await this.scanner.scan();
      this.logger.info(`Found ${scan.files.length} TypeScript files.`);

      // Manifests are indexed too so "Open File" works on a Prisma model.
      this.absolutePaths = indexAbsolutePaths([...scan.files, ...scan.manifests]);

      const parsed = this.typescriptParser.parse(scan.files);
      const analysis = this.nestParser.analyze(parsed.files);
      const projects = this.profiler.profile({
        workspaceName: scan.workspaceName,
        manifests: scan.manifests,
        files: parsed.files,
        analysis,
      });

      const graph = this.graphBuilder.build({
        workspaceName: scan.workspaceName,
        files: parsed.files,
        analysis,
        projects,
        dataModels: this.prismaParser.parse(scan.manifests),
        ui: this.uiParser.analyze(parsed.files, uiFilePaths(projects, parsed.files)),
        scannedFileCount: scan.files.length,
        parseFailureCount: parsed.failures.length,
        durationMs: Date.now() - startedAt,
      });

      if (graph.metadata) {
        graph.metadata.issues = this.analyzer.analyze(graph);
        graph.metadata.styles = this.styleDetector.detect(graph);
        graph.metadata.stats.durationMs = Date.now() - startedAt;
      }

      this.graph = graph;
      this.logSummary(graph);
      this.onDidChangeArchitecture.emit(graph);
      return graph;
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.logger.error('Architecture build failed.', failure);
      this.onDidFail.emit(failure);
      throw failure;
    }
  }

  private logSummary(graph: ArchitectureGraph): void {
    const stats = graph.metadata?.stats;
    if (!stats) {
      return;
    }

    for (const project of graph.metadata?.projects ?? []) {
      const frameworks = project.frameworks.map((framework) => framework.label).join(', ') || 'none';
      const databases =
        project.databases.map((database) => `${database.label} (${database.access})`).join(', ') || 'none';
      this.logger.info(
        `Project ${project.name} [${project.archetypeLabel}` +
          `${project.primaryFramework ? ` / ${project.primaryFramework}` : ''}] — ` +
          `frameworks: ${frameworks}; databases: ${databases}`,
      );
    }

    if (!graph.metadata?.frameworkDetected) {
      this.logger.warn('No NestJS building blocks were detected in this workspace.');
    }

    this.logger.info(
      [
        'Detected:',
        `${stats.moduleCount} modules`,
        `${stats.controllerCount} controllers`,
        `${stats.serviceCount} services`,
        `${stats.uiElementCount} UI elements`,
        `${stats.entityCount} entities`,
        `${stats.dependencyCount} dependencies`,
      ].join(' '),
    );

    if (stats.parseFailureCount > 0) {
      this.logger.warn(`${stats.parseFailureCount} file(s) could not be parsed and were skipped.`);
    }

    const issueCount = graph.metadata?.issues.length ?? 0;
    if (issueCount > 0) {
      this.logger.warn(`${issueCount} architecture issue(s) detected.`);
    }

    this.logger.info(`Architecture built in ${stats.durationMs}ms.`);
  }

  dispose(): void {
    this.onDidChangeArchitecture.dispose();
    this.onDidFail.dispose();
  }
}

/** Files belonging to a project that renders a user interface. */
function uiFilePaths(
  projects: readonly ProjectProfile[],
  files: readonly ParsedFile[],
): Set<string> {
  const roots = projects
    .filter((project) => project.kind === 'ui' || project.kind === 'fullstack')
    .map((project) => project.rootPath);

  return new Set(
    files
      .filter((file) => roots.some((root) => ownsPath(root, file.filePath)))
      .map((file) => file.filePath),
  );
}

function indexAbsolutePaths(files: readonly ScannedFile[]): Map<string, string> {
  const index = new Map<string, string>();
  for (const file of files) {
    index.set(pathKey(file.relativePath, file.workspaceName), file.absolutePath);
    if (!index.has(pathKey(file.relativePath))) {
      index.set(pathKey(file.relativePath), file.absolutePath);
    }
  }
  return index;
}

function pathKey(relativePath: string, workspaceName?: string): string {
  const normalized = relativePath.replace(/\\/g, '/');
  return workspaceName ? `${workspaceName}::${normalized}` : normalized;
}
