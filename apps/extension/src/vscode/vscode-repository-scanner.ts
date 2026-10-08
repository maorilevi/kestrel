import * as path from 'path';
import * as vscode from 'vscode';

import type { Logger } from '@kestrel/core';
import {
  DEFAULT_EXCLUDE_GLOBS,
  MANIFEST_GLOB,
  MANIFEST_LIMIT,
  type RepositoryScanner,
  type ScanResult,
  type ScannedFile,
  type ScannedManifest,
} from '@kestrel/core';

export interface VsCodeScannerOptions {
  /** Extra exclude globs contributed by `kestrel.exclude`. */
  extraExcludes?: readonly string[];
  /** Safety limit per workspace folder. */
  maxFiles?: number;
}

/**
 * Scans every workspace folder for TypeScript sources using the VS Code
 * workspace API, so virtual and multi-root workspaces keep working.
 */
export class VsCodeRepositoryScanner implements RepositoryScanner {
  /**
   * Options are resolved per scan so changes to the KESTREL settings take
   * effect on the next refresh instead of on the next window reload.
   */
  constructor(
    private readonly logger: Logger,
    private readonly resolveOptions: () => VsCodeScannerOptions = () => ({}),
  ) {}

  async scan(): Promise<ScanResult> {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (folders.length === 0) {
      throw new NoWorkspaceError();
    }

    const options = this.resolveOptions();
    const maxFiles = options.maxFiles ?? 5000;
    const exclude = `{${[...DEFAULT_EXCLUDE_GLOBS, ...(options.extraExcludes ?? [])].join(',')}}`;

    const files: ScannedFile[] = [];
    const manifests: ScannedManifest[] = [];
    let truncated = false;

    for (const folder of folders) {
      manifests.push(...(await this.readManifests(folder, exclude)));

      const include = new vscode.RelativePattern(folder, '**/*.{ts,tsx}');
      const uris = await vscode.workspace.findFiles(include, exclude, maxFiles + 1);

      if (uris.length > maxFiles) {
        truncated = true;
        this.logger.warn(
          `Workspace folder "${folder.name}" exceeds the ${maxFiles} file limit; the scan was truncated.`,
        );
      }

      for (const uri of uris.slice(0, maxFiles)) {
        if (uri.scheme !== 'file') {
          continue;
        }
        files.push({
          absolutePath: uri.fsPath,
          relativePath: toPosix(path.relative(folder.uri.fsPath, uri.fsPath)),
          workspaceRoot: folder.uri.fsPath,
          workspaceName: folder.name,
        });
      }
    }

    return {
      workspaceName: folders.length === 1 ? folders[0].name : folders.map((f) => f.name).join(' + '),
      files,
      manifests,
      truncated,
    };
  }

  /**
   * Reads the manifests used for project detection. A manifest that cannot be
   * read is skipped: project detection degrades, the architecture still builds.
   */
  private async readManifests(
    folder: vscode.WorkspaceFolder,
    exclude: string,
  ): Promise<ScannedManifest[]> {
    const manifests: ScannedManifest[] = [];
    const decoder = new TextDecoder('utf-8');

    let uris: vscode.Uri[];
    try {
      uris = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, MANIFEST_GLOB),
        exclude,
        MANIFEST_LIMIT,
      );
    } catch (error) {
      this.logger.warn(`Could not list manifests in "${folder.name}": ${describeError(error)}`);
      return manifests;
    }

    for (const uri of uris) {
      try {
        const bytes = await vscode.workspace.fs.readFile(uri);
        manifests.push({
          absolutePath: uri.fsPath,
          relativePath: toPosix(path.relative(folder.uri.fsPath, uri.fsPath)),
          workspaceRoot: folder.uri.fsPath,
          workspaceName: folder.name,
          content: decoder.decode(bytes),
        });
      } catch (error) {
        this.logger.warn(`Could not read ${uri.fsPath}: ${describeError(error)}`);
      }
    }

    return manifests;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class NoWorkspaceError extends Error {
  constructor() {
    super('No folder is open. Open a TypeScript project before running KESTREL.');
    this.name = 'NoWorkspaceError';
  }
}

function toPosix(filePath: string): string {
  return filePath.replace(/\\/g, '/');
}
