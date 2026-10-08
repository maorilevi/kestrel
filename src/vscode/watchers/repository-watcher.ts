import * as vscode from 'vscode';

import type { ArchitectureService } from '../../architecture/architecture.service';
import type { Logger } from '../../architecture/logger';
import { isIgnoredFile } from '../../architecture/scanner/repository-scanner';

/**
 * Rebuilds the architecture when TypeScript files change.
 *
 * Changes are debounced (default 700ms) so typing never triggers a scan, and a
 * rebuild is skipped entirely when nothing architectural changed on disk.
 */
export class RepositoryWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pendingFiles = new Set<string>();

  constructor(
    private readonly service: ArchitectureService,
    private readonly logger: Logger,
  ) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{ts,tsx}');
    this.disposables.push(
      watcher,
      watcher.onDidCreate((uri) => this.schedule(uri)),
      watcher.onDidChange((uri) => this.schedule(uri)),
      watcher.onDidDelete((uri) => this.schedule(uri)),
    );
  }

  private get enabled(): boolean {
    return vscode.workspace.getConfiguration('kestrel').get<boolean>('autoRefresh', true);
  }

  private get debounceMs(): number {
    return vscode.workspace.getConfiguration('kestrel').get<number>('refreshDebounceMs', 700);
  }

  private schedule(uri: vscode.Uri): void {
    // Nothing has been built yet: the first build is triggered by the user.
    if (!this.enabled || this.service.getGraph().nodes.length === 0) {
      return;
    }

    const relative = vscode.workspace.asRelativePath(uri, false).replace(/\\/g, '/');
    if (isIgnoredFile(relative) || /\.d\.ts$/.test(relative)) {
      return;
    }

    this.pendingFiles.add(relative);

    if (this.timer) {
      clearTimeout(this.timer);
    }

    this.timer = setTimeout(() => {
      const count = this.pendingFiles.size;
      this.pendingFiles.clear();
      this.timer = undefined;
      this.logger.info(`Detected ${count} changed file(s); rebuilding architecture.`);
      void this.service.build().catch((error: unknown) => {
        this.logger.error('Automatic refresh failed.', error);
      });
    }, this.debounceMs);
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
  }
}
