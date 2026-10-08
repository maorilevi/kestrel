import * as vscode from 'vscode';

import { ClaudeCodeAdapter } from './agents/claude-code-adapter';
import { ArchitectureService } from './architecture/architecture.service';
import { VsCodeRepositoryScanner } from './architecture/scanner/vscode-repository-scanner';
import { AnthropicChatProvider } from './chat/anthropic-provider';
import { ChatService } from './chat/chat-service';
import { VsCodeLanguageModelProvider } from './chat/vscode-lm-provider';
import { registerCommands } from './vscode/commands';
import { API_KEY_SECRET, registerSetApiKeyCommand } from './vscode/commands/set-api-key.command';
import { registerSelectChatModelCommand } from './vscode/commands/select-chat-model.command';
import { registerSignInCommand } from './vscode/commands/sign-in.command';
import { registerTestChatCommand } from './vscode/commands/test-chat.command';
import { OutputChannelLogger } from './vscode/output-logger';
import { hasWorkspace } from './vscode/workspace-prompt';
import { OverviewTreeProvider } from './vscode/views/overview-tree';
import { RepositoryWatcher } from './vscode/watchers/repository-watcher';
import { KestrelPanel, type KestrelPanelDependencies } from './vscode/webview/kestrel-panel';

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel('KESTREL');
  const logger = new OutputChannelLogger(channel);
  context.subscriptions.push(channel);

  const scanner = new VsCodeRepositoryScanner(logger, () => {
    const configuration = vscode.workspace.getConfiguration('kestrel');
    return {
      extraExcludes: configuration.get<string[]>('exclude', []),
      maxFiles: configuration.get<number>('maxFiles', 5000),
    };
  });

  const service = new ArchitectureService(scanner, logger);
  const agent = new ClaudeCodeAdapter();

  const chatConfiguration = (): vscode.WorkspaceConfiguration =>
    vscode.workspace.getConfiguration('kestrel.chat');

  const chat = new ChatService(
    service,
    [
      new AnthropicChatProvider({
        getApiKey: async () => context.secrets.get(API_KEY_SECRET),
        getModel: () => chatConfiguration().get<string>('model', 'claude-opus-5'),
        getEffort: () =>
          chatConfiguration().get<'low' | 'medium' | 'high' | 'xhigh' | 'max'>('effort', 'high'),
        getTimeoutMs: () => chatConfiguration().get<number>('timeoutMs', 120_000),
      }),
      new VsCodeLanguageModelProvider(logger, () =>
        chatConfiguration().get<string>('vsCodeModel', ''),
      ),
    ],
    logger,
    () => chatConfiguration().get<'auto' | 'anthropic' | 'vscode'>('provider', 'auto'),
  );

  const dependencies: KestrelPanelDependencies = { context, service, logger, agent, chat };

  const overview = new OverviewTreeProvider(service);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('kestrel.overview', overview),
    { dispose: () => overview.dispose() },
    service.onDidChangeArchitecture.on(() => overview.refresh()),
    ...registerCommands(dependencies, service, agent),
    registerSetApiKeyCommand(context),
    registerTestChatCommand(chat, service, logger),
    registerSignInCommand(),
    registerSelectChatModelCommand(),
    // Opening settings means opening KESTREL's own panel, where the model lives.
    vscode.commands.registerCommand('kestrel.openSettings', async () => {
      // Changing a model must not require a repository: without a folder there
      // is no panel to host the settings, so fall back to VS Code's own editor.
      if (!hasWorkspace()) {
        await vscode.commands.executeCommand(
          'workbench.action.openSettings',
          '@ext:kestrel-dev.kestrel',
        );
        return;
      }

      KestrelPanel.createOrShow(dependencies).showSettings();
    }),
    new RepositoryWatcher(service, logger),
    { dispose: () => KestrelPanel.current?.dispose() },
    { dispose: () => service.dispose() },
  );

  logger.info('KESTREL activated. Run "KESTREL: Open Architecture" to build the architecture graph.');
}

export function deactivate(): void {
  // Everything is disposed through context.subscriptions.
}
