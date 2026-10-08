import * as vscode from 'vscode';

import { hasWorkspace, offerToOpenFolder } from '../workspace-prompt';

import type { ArchitectureService } from '@kestrel/core';
import { KestrelPanel } from '../webview/kestrel-panel';

/** `KESTREL: Refresh Architecture` — full rescan of the workspace. */
export function registerRefreshArchitectureCommand(service: ArchitectureService): vscode.Disposable {
  return vscode.commands.registerCommand('kestrel.refreshArchitecture', async () => {
    if (!hasWorkspace()) {
      await offerToOpenFolder();
      return;
    }

    const panel = KestrelPanel.current;
    if (panel) {
      await panel.refresh();
      return;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Window, title: 'KESTREL: building architecture...' },
      async () => {
        try {
          await service.build();
        } catch (error) {
          void vscode.window.showErrorMessage(
            `KESTREL: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    );
  });
}
