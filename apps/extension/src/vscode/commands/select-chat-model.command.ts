import * as vscode from 'vscode';

import { ANTHROPIC_MODELS, listVsCodeModels, updateSetting } from '../settings';

interface ModelItem extends vscode.QuickPickItem {
  provider: 'anthropic' | 'vscode';
  id: string;
}

/**
 * `KESTREL: Select Chat Model` — one list of every model that could actually
 * answer, from both providers, so choosing a model never means first choosing
 * a provider.
 */
export function registerSelectChatModelCommand(): vscode.Disposable {
  return vscode.commands.registerCommand('kestrel.selectChatModel', async () => {
    const items: ModelItem[] = [];

    items.push({
      label: 'Anthropic API',
      kind: vscode.QuickPickItemKind.Separator,
      provider: 'anthropic',
      id: '',
    });

    for (const model of ANTHROPIC_MODELS) {
      items.push({
        label: model.label,
        description: model.note,
        provider: 'anthropic',
        id: model.id,
      });
    }

    const vsCodeModels = await listVsCodeModels();
    if (vsCodeModels.length > 0) {
      items.push({
        label: 'Provided by VS Code',
        kind: vscode.QuickPickItemKind.Separator,
        provider: 'vscode',
        id: '',
      });

      for (const model of vsCodeModels) {
        items.push({
          label: model.available ? model.label : `${model.label} (unusable)`,
          description: model.note,
          provider: 'vscode',
          id: model.id,
        });
      }
    }

    const choice = await vscode.window.showQuickPick(items, {
      title: 'KESTREL — chat model',
      placeHolder: 'Pick the model that answers architecture questions',
      ignoreFocusOut: true,
    });

    if (!choice || choice.kind === vscode.QuickPickItemKind.Separator) {
      return;
    }

    // Pin both the provider and the model: picking a model implies the provider
    // it belongs to, and a silent mismatch would be worse than an extra prompt.
    if (choice.provider === 'anthropic') {
      await updateSetting('kestrel.chat.model', choice.id);
      await updateSetting('kestrel.chat.provider', 'anthropic');
    } else {
      await updateSetting('kestrel.chat.vsCodeModel', choice.id);
      await updateSetting('kestrel.chat.provider', 'vscode');
    }

    void vscode.window.showInformationMessage(`KESTREL: chat model set to ${choice.label}.`);
  });
}
