import * as vscode from 'vscode';

import { hasEnvironmentCredentials } from '../../chat/credentials';
import { updateSetting } from '../settings';

const CONSOLE_KEYS_URL = 'https://console.anthropic.com/settings/keys';

interface ConnectItem extends vscode.QuickPickItem {
  id: 'key' | 'vscode' | 'console';
}

/**
 * `KESTREL: Connect Chat` — every route that actually exists.
 *
 * Anthropic has no sign-in CLI and no OAuth flow an extension can drive, so the
 * honest set of choices is: a key KESTREL keeps in the OS keychain, a key
 * already in the environment, or a language model VS Code itself provides —
 * which needs no Anthropic account at all.
 */
export function registerSignInCommand(): vscode.Disposable {
  return vscode.commands.registerCommand('kestrel.signIn', async () => {
    if (hasEnvironmentCredentials()) {
      const action = await vscode.window.showInformationMessage(
        'KESTREL: using the ANTHROPIC_API_KEY from your environment. Nothing to sign in to.',
        'Test chat connection',
        'Use a different key',
      );
      if (action === 'Test chat connection') {
        await vscode.commands.executeCommand('kestrel.testChat');
        return;
      }
      if (action !== 'Use a different key') {
        return;
      }
    }

    const items: ConnectItem[] = [
      {
        label: '$(key) Paste an Anthropic API key',
        description: 'Stored in the OS keychain',
        detail: 'KESTREL keeps it in VS Code SecretStorage — never in settings, never in the panel.',
        id: 'key',
      },
      {
        label: '$(copilot) Use a model VS Code provides',
        description: 'No Anthropic account needed',
        detail: 'Answers through your GitHub Copilot subscription instead of the Anthropic API.',
        id: 'vscode',
      },
      {
        label: '$(link-external) Get an API key',
        description: CONSOLE_KEYS_URL,
        detail: 'Opens the Anthropic Console, where keys are created.',
        id: 'console',
      },
    ];

    const choice = await vscode.window.showQuickPick(items, {
      title: 'KESTREL — connect the chat',
      placeHolder: 'Choose how architecture questions get answered',
      ignoreFocusOut: true,
    });

    if (!choice) {
      return;
    }

    if (choice.id === 'key') {
      await vscode.commands.executeCommand('kestrel.setApiKey');
      return;
    }

    if (choice.id === 'console') {
      await vscode.env.openExternal(vscode.Uri.parse(CONSOLE_KEYS_URL));
      return;
    }

    await updateSetting('kestrel.chat.provider', 'vscode');
    await vscode.commands.executeCommand('kestrel.selectChatModel');
  });
}
