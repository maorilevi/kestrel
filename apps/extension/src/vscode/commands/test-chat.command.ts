import * as vscode from 'vscode';

import type { ArchitectureService } from '@kestrel/core';
import type { ChatService } from '@kestrel/ai';
import type { OutputChannelLogger } from '../output-logger';

/**
 * `KESTREL: Test Chat Connection` — answers the only question that matters when
 * the chat stays silent: which provider was chosen, and what happened when it
 * was actually called.
 */
export function registerTestChatCommand(
  chat: ChatService,
  architecture: ArchitectureService,
  logger: OutputChannelLogger,
): vscode.Disposable {
  return vscode.commands.registerCommand('kestrel.testChat', async () => {
    logger.show();
    logger.info('--- Chat connection test ---');

    // The chat answers from the architecture, so a test with no architecture
    // fails for a reason that has nothing to do with the connection.
    if (architecture.getGraph().nodes.length === 0) {
      logger.info('No architecture yet — building it before the test.');
      try {
        await architecture.build();
      } catch (error) {
        logger.error('Could not build the architecture.', error);
        void vscode.window.showErrorMessage(
          `KESTREL: could not build the architecture — ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        return;
      }
    }

    const status = await chat.status();
    logger.info(`Provider: ${status.provider ?? 'none available'}`);

    if (!status.ready) {
      logger.warn(status.message ?? 'No provider is configured.');
      const action = await vscode.window.showWarningMessage(
        `KESTREL: ${status.message ?? 'No language model is configured.'}`,
        'Set API key',
      );
      if (action === 'Set API key') {
        await vscode.commands.executeCommand('kestrel.setApiKey');
      }
      return;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: `KESTREL: testing ${status.provider}...` },
      async () => {
        const started = Date.now();
        let reply = '';

        await chat.ask(
          { question: 'Reply with the single word: ready', selectedNodeIds: [], projectId: null },
          {
            onDelta: (text) => {
              reply += text;
            },
            onDone: () => {
              const elapsed = Date.now() - started;
              if (reply.trim().length === 0) {
                logger.warn(`No text came back after ${elapsed}ms.`);
                void vscode.window.showWarningMessage(
                  'KESTREL: the model returned an empty reply. See the KESTREL output channel.',
                );
                return;
              }
              logger.info(`Reply after ${elapsed}ms: ${reply.trim()}`);
              void vscode.window.showInformationMessage(
                `KESTREL: chat is working via ${status.provider} (${elapsed}ms).`,
              );
            },
            onError: (message, remedyCommand) => {
              logger.error(`Chat test failed: ${message}`);
              void vscode.window
                .showErrorMessage(`KESTREL: ${message}`, ...(remedyCommand ? ['Set API key'] : []))
                .then((action) => {
                  if (action === 'Set API key' && remedyCommand) {
                    void vscode.commands.executeCommand(remedyCommand);
                  }
                });
            },
          },
        );

        // The test conversation must not become the first turn of a real one.
        chat.clear();
      },
    );
  });
}
