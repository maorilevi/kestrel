/**
 * Repository scanning port.
 *
 * The architecture engine only knows about this interface; the VS Code backed
 * implementation lives in `vscode-repository-scanner.ts`. Tests (and a future
 * CLI) can supply their own scanner without booting an editor.
 */

export interface ScannedFile {
  /** Absolute filesystem path. */
  absolutePath: string;
  /** Posix separated path relative to the owning workspace folder. */
  relativePath: string;
  /** Absolute path of the owning workspace folder. */
  workspaceRoot: string;
  /** Display name of the owning workspace folder. */
  workspaceName: string;
}

/**
 * A non-TypeScript file read for project detection: `package.json`,
 * `prisma/schema.prisma`, `docker-compose*.yml`.
 */
export interface ScannedManifest extends ScannedFile {
  content: string;
}

export interface ScanResult {
  /** Display name for the whole scan (single folder name, or a joined list). */
  workspaceName: string;
  files: ScannedFile[];
  /** Manifests used to detect project kind, frameworks and databases. */
  manifests: ScannedManifest[];
  /** True when at least one folder hit the configured file limit. */
  truncated: boolean;
}

/** Globs of the non-source files KESTREL reads for project detection. */
export const MANIFEST_GLOB =
  '**/{package.json,prisma/schema.prisma,docker-compose.yml,docker-compose.yaml,docker-compose.*.yml,' +
  'firebase.json,serverless.yml,serverless.yaml,template.yaml,template.yml,host.json,angular.json,nest-cli.json}';

export const MANIFEST_LIMIT = 200;

export interface RepositoryScanner {
  scan(): Promise<ScanResult>;
}

export const DEFAULT_EXCLUDE_GLOBS: readonly string[] = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/out/**',
  '**/coverage/**',
  '**/.git/**',
  '**/.next/**',
  '**/.turbo/**',
  '**/*.d.ts',
  '**/*.spec.ts',
  '**/*.test.ts',
  '**/*.e2e-spec.ts',
];

/** Files that carry no architectural signal even when they are not excluded. */
export function isIgnoredFile(relativePath: string): boolean {
  return /(^|\/)(node_modules|dist|build|out|coverage|\.git)\//.test(relativePath);
}
