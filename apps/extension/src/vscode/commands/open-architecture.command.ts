import * as vscode from 'vscode';

import { hasWorkspace, offerToOpenFolder } from '../workspace-prompt';

import { KestrelPanel, type KestrelPanelDependencies } from '../webview/kestrel-panel';

/** `KESTREL: Open Architecture` — opens the panel and builds the graph if needed. */
export function registerOpenArchitectureCommand(dependencies: KestrelPanelDependencies): vscode.Disposable {
  return vscode.commands.registerCommand('kestrel.openArchitecture', async () => {
    if (!hasWorkspace()) {
      await offerToOpenFolder();
      return;
    }

    const panel = KestrelPanel.createOrShow(dependencies);

    if (dependencies.service.getGraph().nodes.length === 0) {
      await panel.refresh();
    }
  });
}
