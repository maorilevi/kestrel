import { GraphBuilder } from './graph/graph-builder';
import type { ArchitectureGraph, ProjectProfile } from './models';
import { NestJsParser } from './parser/nestjs-parser';
import { PrismaParser } from './parser/prisma-parser';
import { UiParser } from './parser/ui-parser';
import { TypeScriptParser } from './parser/typescript-parser';
import { ProjectProfiler, ownsPath } from './profile/project-profiler';
import type { ScannedManifest } from './scanner/repository-scanner';

/** Turns `path → content` into the manifest shape the scanner produces. */
export function toManifests(
  manifests: Record<string, string>,
  workspaceName = 'test-workspace',
): ScannedManifest[] {
  return Object.entries(manifests).map(([relativePath, content]) => ({
    absolutePath: `/${relativePath}`,
    relativePath,
    workspaceRoot: '/',
    workspaceName,
    content,
  }));
}

/** Runs the full engine (parse → detect → profile → build) over in-memory sources. */
export function buildGraphFromSources(
  sources: Record<string, string>,
  workspaceName = 'test-workspace',
  manifests: Record<string, string> = {},
): ArchitectureGraph {
  const parsed = new TypeScriptParser().parseSources(sources, workspaceName);
  const analysis = new NestJsParser().analyze(parsed.files);
  const scannedManifests = toManifests(manifests, workspaceName);
  const projects = new ProjectProfiler().profile({
    workspaceName,
    manifests: scannedManifests,
    files: parsed.files,
    analysis,
  });

  return new GraphBuilder().build({
    workspaceName,
    files: parsed.files,
    analysis,
    projects,
    dataModels: new PrismaParser().parse(scannedManifests),
    ui: new UiParser().analyze(
      parsed.files,
      new Set(
        parsed.files
          .filter((file) =>
            projects.some(
              (project) =>
                (project.kind === 'ui' || project.kind === 'fullstack') &&
                ownsPath(project.rootPath, file.filePath),
            ),
          )
          .map((file) => file.filePath),
      ),
    ),
    scannedFileCount: Object.keys(sources).length,
    parseFailureCount: parsed.failures.length,
    durationMs: 0,
    generatedAt: '1970-01-01T00:00:00.000Z',
  });
}

/** Profiles a repository without building the graph. */
export function profileSources(
  sources: Record<string, string>,
  manifests: Record<string, string>,
  workspaceName = 'test-workspace',
): ProjectProfile[] {
  const parsed = new TypeScriptParser().parseSources(sources, workspaceName);
  const analysis = new NestJsParser().analyze(parsed.files);
  return new ProjectProfiler().profile({
    workspaceName,
    manifests: toManifests(manifests, workspaceName),
    files: parsed.files,
    analysis,
  });
}

export function nodeByName(graph: ArchitectureGraph, name: string) {
  const node = graph.nodes.find((candidate) => candidate.name === name);
  if (!node) {
    throw new Error(`Node ${name} not found. Available: ${graph.nodes.map((n) => n.name).join(', ')}`);
  }
  return node;
}

export function hasEdge(
  graph: ArchitectureGraph,
  type: string,
  sourceName: string,
  targetName: string,
): boolean {
  const source = graph.nodes.find((node) => node.name === sourceName);
  const target = graph.nodes.find((node) => node.name === targetName);
  if (!source || !target) {
    return false;
  }
  return graph.edges.some(
    (edge) => edge.type === type && edge.source === source.id && edge.target === target.id,
  );
}

export function edgesBetween(
  graph: ArchitectureGraph,
  type: string,
  sourceName: string,
  targetName: string,
): number {
  const source = graph.nodes.find((node) => node.name === sourceName);
  const target = graph.nodes.find((node) => node.name === targetName);
  if (!source || !target) {
    return 0;
  }
  return graph.edges.filter(
    (edge) => edge.type === type && edge.source === source.id && edge.target === target.id,
  ).length;
}

/** The single-file example from the KESTREL specification. */
export const SINGLE_FILE_APP: Record<string, string> = {
  'src/auth/auth.module.ts': `
import { Module, Controller, Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {}

@Injectable()
export class TokenService {}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}
}

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
  ) {}
}

@Module({
  controllers: [AuthController],
  providers: [AuthService, UsersService, TokenService],
})
export class AuthModule {}
`,
};

/** A realistic multi-file, multi-module application. */
export const MULTI_MODULE_APP: Record<string, string> = {
  'src/users/users.service.ts': `
import { Injectable } from '@nestjs/common';

@Injectable()
export class UsersService {}
`,
  'src/users/users.module.ts': `
import { Module } from '@nestjs/common';
import { UsersService } from './users.service';

@Module({
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
`,
  'src/auth/token.service.ts': `
import { Injectable } from '@nestjs/common';

@Injectable()
export class TokenService {}
`,
  'src/auth/auth.service.ts': `
import { Injectable } from '@nestjs/common';
import { UsersService } from '../users/users.service';
import { TokenService } from './token.service';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
  ) {}
}
`,
  'src/auth/auth.controller.ts': `
import { Controller, Get } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('profile')
  getProfile(): string {
    return 'profile';
  }
}
`,
  'src/auth/auth.module.ts': `
import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

@Module({
  imports: [UsersModule],
  controllers: [AuthController],
  providers: [AuthService, TokenService],
  exports: [AuthService],
})
export class AuthModule {}
`,
  'src/app.module.ts': `
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [ConfigModule.forRoot(), AuthModule, UsersModule],
})
export class AppModule {}
`,
};
