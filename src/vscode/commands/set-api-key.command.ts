import * as vscode from 'vscode';

/** Key name in SecretStorage. The key never reaches settings or the webview. */
export const API_KEY_SECRET = 'kestrel.anthropicApiKey';

/**
 * `KESTREL: Set Anthropic API Key` — stores the key in VS Code SecretStorage,
 * which is encrypted by the OS keychain. Settings would sync it in plain text.
 */
export function registerSetApiKeyCommand(context: vscode.ExtensionContext): vscode.Disposable {
  return vscode.commands.registerCommand('kestrel.setApiKey', async () => {
    const existing = await context.secrets.get(API_KEY_SECRET);

    const key = await vscode.window.showInputBox({
      title: 'KESTREL — Anthropic API key',
      prompt: 'Stored in the OS keychain, never in settings. Leave empty to remove the stored key.',
      placeHolder: existing ? 'A key is already stored — type a new one to replace it' : 'sk-ant-...',
      password: true,
      ignoreFocusOut: true,
    });

    if (key === undefined) {
      return;
    }

    if (key.trim().length === 0) {
      await context.secrets.delete(API_KEY_SECRET);
      void vscode.window.showInformationMessage('KESTREL: stored API key removed.');
      return;
    }

    await context.secrets.store(API_KEY_SECRET, key.trim());
    void vscode.window.showInformationMessage('KESTREL: API key stored. The chat panel is ready.');
  });
}
