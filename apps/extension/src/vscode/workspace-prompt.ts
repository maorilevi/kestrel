import * as vscode from 'vscode';

/**
 * KESTREL maps the repository you have open, so it needs one.
 *
 * Saying so is not enough — the message carries the action that fixes it.
 */
export async function offerToOpenFolder(): Promise<void> {
  const action = await vscode.window.showWarningMessage(
    'KESTREL maps the repository you have open — open a folder to build its architecture.',
    'Open Folder...',
  );

  if (action === 'Open Folder...') {
    await vscode.commands.executeCommand('workbench.action.files.openFolder');
  }
}

export function hasWorkspace(): boolean {
  return Boolean(vscode.workspace.workspaceFolders?.length);
}
