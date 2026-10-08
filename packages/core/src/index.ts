/**
 * Public API of the KESTREL architecture engine.
 *
 * Hosts (the VS Code extension, the web control plane, a CLI or a sandbox
 * worker) supply a `RepositoryScanner` and a `Logger`; everything else is here.
 */
export * from './model';
export * from './architecture.service';
export * from './emitter';
export * from './logger';
export * from './scanner/repository-scanner';
export * from './scanner/fs-repository-scanner';
export * from './graph/graph-builder';
export * from './graph/route-matcher';
export * from './analysis/architecture-analyzer';
export * from './analysis/architecture-style';
export * from './parser/typescript-parser';
export * from './parser/nestjs-parser';
export * from './parser/prisma-parser';
export * from './parser/ui-parser';
export * from './profile/project-profiler';
export * from './profile/layer-classifier';
export { detectArchetype, type ArchetypeInput, type ArchetypeResult, type PackageFacts } from './profile/application-archetype';
