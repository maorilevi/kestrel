import { promises as fs } from 'fs';
import * as path from 'path';

import { noopLogger, type Logger } from '../logger';
import {
  DEFAULT_EXCLUDE_GLOBS,
  MANIFEST_GLOB,
  MANIFEST_LIMIT,
  type RepositoryScanner,
  type ScanResult,
  type ScannedFile,
  type ScannedManifest,
} from './repository-scanner';

export interface FsScannerRoot {
  /** Absolute path of the folder to scan. */
  path: string;
  /** Display name; defaults to the folder's base name. */
  name?: string;
}

export interface FsScannerOptions {
  /** Extra exclude globs, matched against the root-relative posix path. */
  extraExcludes?: readonly string[];
  /** Safety limit for source files per root. */
  maxFiles?: number;
}

const SOURCE_GLOB = '**/*.{ts,tsx}';

/** Directories that are never descended into, whatever the excludes say. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.next', '.turbo']);

/**
 * Scans plain directories on disk with Node's file system API.
 *
 * This is the scanner every host without VS Code uses: the web control plane's
 * sandbox worker, a CLI, CI. It applies the same excludes, manifest glob and
 * limits as the editor scanner so both produce the same graph for a repository.
 */
export class FsRepositoryScanner implements RepositoryScanner {
  private readonly roots: FsScannerRoot[];

  constructor(
    roots: string | FsScannerRoot | readonly (string | FsScannerRoot)[],
    private readonly options: FsScannerOptions = {},
    private readonly logger: Logger = noopLogger,
  ) {
    const list = Array.isArray(roots) ? roots : [roots];
    this.roots = list.map((root) => (typeof root === 'string' ? { path: root } : root));
  }

  async scan(): Promise<ScanResult> {
    const maxFiles = this.options.maxFiles ?? 5000;
    const excludes = [...DEFAULT_EXCLUDE_GLOBS, ...(this.options.extraExcludes ?? [])];
    const isExcluded = (relativePath: string): boolean =>
      excludes.some((glob) => path.posix.matchesGlob(relativePath, glob));

    const files: ScannedFile[] = [];
    const manifests: ScannedManifest[] = [];
    let truncated = false;
    const names: string[] = [];

    for (const root of this.roots) {
      const workspaceRoot = path.resolve(root.path);
      const workspaceName = root.name ?? path.basename(workspaceRoot);
      names.push(workspaceName);

      const sources: string[] = [];
      const manifestPaths: string[] = [];
      await this.walk(workspaceRoot, '', (relativePath) => {
        if (isExcluded(relativePath)) {
          return;
        }
        if (path.posix.matchesGlob(relativePath, SOURCE_GLOB)) {
          sources.push(relativePath);
        } else if (manifestPaths.length < MANIFEST_LIMIT && path.posix.matchesGlob(relativePath, MANIFEST_GLOB)) {
          manifestPaths.push(relativePath);
        }
      });

      // Sorted so a scan is deterministic regardless of directory order on disk.
      sources.sort();
      manifestPaths.sort();

      if (sources.length > maxFiles) {
        truncated = true;
        this.logger.warn(`"${workspaceName}" exceeds the ${maxFiles} file limit; the scan was truncated.`);
      }

      for (const relativePath of sources.slice(0, maxFiles)) {
        files.push({
          absolutePath: path.join(workspaceRoot, relativePath),
          relativePath,
          workspaceRoot,
          workspaceName,
        });
      }

      for (const relativePath of manifestPaths) {
        const absolutePath = path.join(workspaceRoot, relativePath);
        try {
          manifests.push({
            absolutePath,
            relativePath,
            workspaceRoot,
            workspaceName,
            content: await fs.readFile(absolutePath, 'utf8'),
          });
        } catch (error) {
          this.logger.warn(`Could not read ${absolutePath}: ${describeError(error)}`);
        }
      }
    }

    return { workspaceName: names.join(' + '), files, manifests, truncated };
  }

  private async walk(root: string, relativeDir: string, visit: (relativePath: string) => void): Promise<void> {
    let entries;
    try {
      entries = await fs.readdir(path.join(root, relativeDir), { withFileTypes: true });
    } catch (error) {
      this.logger.warn(`Could not list ${path.join(root, relativeDir)}: ${describeError(error)}`);
      return;
    }

    for (const entry of entries) {
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) {
          await this.walk(root, relativePath, visit);
        }
      } else if (entry.isFile()) {
        visit(relativePath);
      }
    }
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
