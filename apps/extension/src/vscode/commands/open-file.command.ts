import * as vscode from 'vscode';

import type { ArchitectureService } from '@kestrel/core';

export interface OpenFileRequest {
  /** Workspace relative path, as stored on architecture nodes. */
  filePath: string;
  /** 1-based line to reveal. */
  line?: number;
  workspaceName?: string;
}

/**
 * `kestrel.openFile` — the only bridge from the webview to the file system.
 *
 * The webview never receives absolute paths: it sends the workspace relative
 * path of a node and the extension resolves it against the paths discovered by
 * the last scan, so a crafted message cannot open arbitrary files.
 */
export function registerOpenFileCommand(service: ArchitectureService): vscode.Disposable {
  return vscode.commands.registerCommand('kestrel.openFile', async (request: OpenFileRequest) => {
    if (!request?.filePath) {
      return;
    }

    const absolutePath = service.resolveAbsolutePath(request.filePath, request.workspaceName);
    if (!absolutePath) {
      void vscode.window.showWarningMessage(
        `KESTREL: ${request.filePath} is not part of the analysed workspace. Try refreshing the architecture.`,
      );
      return;
    }

    try {
      const document = await vscode.workspace.openTextDocument(vscode.Uri.file(absolutePath));
      const editor = await vscode.window.showTextDocument(document, { preview: false });

      const line = Math.max(0, (request.line ?? 1) - 1);
      const position = new vscode.Position(Math.min(line, document.lineCount - 1), 0);
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    } catch (error) {
      void vscode.window.showErrorMessage(
        `KESTREL: could not open ${request.filePath} (${error instanceof Error ? error.message : String(error)}).`,
      );
    }
  });
}
