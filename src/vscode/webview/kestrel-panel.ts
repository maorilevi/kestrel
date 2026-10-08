import * as vscode from 'vscode';

import type { CodingAgentAdapter } from '../../agents/coding-agent-adapter';
import type { ArchitectureService } from '../../architecture/architecture.service';
import type { ChatService } from '../../chat/chat-service';
import { API_KEY_SECRET } from '../commands/set-api-key.command';
import type { Logger } from '../../architecture/logger';
import { isWebviewRequest, type ExtensionMessage, type WebviewRequest } from '../../shared/protocol';
import { readSettings, updateSetting } from '../settings';
import { renderWebviewHtml } from './html';

const VIEW_TYPE = 'kestrel.architecture';

export interface KestrelPanelDependencies {
  context: vscode.ExtensionContext;
  service: ArchitectureService;
  logger: Logger;
  agent: CodingAgentAdapter;
  chat: ChatService;
}

/**
 * Single architecture panel. All extension ↔ webview traffic goes through the
 * typed protocol in `src/shared/protocol.ts`; the webview never sees Node APIs.
 */
export class KestrelPanel {
  private static instance: KestrelPanel | undefined;

  private readonly disposables: vscode.Disposable[] = [];
  private selectedNodeIds: string[] = [];

  static createOrShow(dependencies: KestrelPanelDependencies): KestrelPanel {
    const column = vscode.window.activeTextEditor?.viewColumn ?? vscode.ViewColumn.One;

    if (KestrelPanel.instance) {
      KestrelPanel.instance.panel.reveal(column);
      return KestrelPanel.instance;
    }

    const panel = vscode.window.createWebviewPanel(VIEW_TYPE, 'KESTREL', column, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(dependencies.context.extensionUri, 'dist', 'webview')],
    });

    KestrelPanel.instance = new KestrelPanel(panel, dependencies);
    return KestrelPanel.instance;
  }

  static get current(): KestrelPanel | undefined {
    return KestrelPanel.instance;
  }

  private constructor(
    private readonly panel: vscode.WebviewPanel,
    private readonly dependencies: KestrelPanelDependencies,
  ) {
    const distUri = vscode.Uri.joinPath(dependencies.context.extensionUri, 'dist', 'webview');
    this.panel.webview.html = renderWebviewHtml(this.panel.webview, distUri);

    this.disposables.push(
      this.panel.webview.onDidReceiveMessage((message: unknown) => {
        void this.handleMessage(message);
      }),
    );

    this.disposables.push(
      this.dependencies.service.onDidChangeArchitecture.on((graph) => {
        this.post({ type: 'ARCHITECTURE_UPDATED', payload: graph });
      }),
    );

    this.disposables.push(
      this.dependencies.service.onDidFail.on((error) => {
        this.post({ type: 'ERROR', message: error.message });
      }),
    );

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
  }

  /** Node ids currently selected in the graph; used by the agent commands. */
  getSelectedNodeIds(): string[] {
    return [...this.selectedNodeIds];
  }

  /** Reveals the settings pane inside the panel. */
  showSettings(): void {
    this.panel.reveal();
    this.post({ type: 'SHOW_SETTINGS' });
  }

  async refresh(): Promise<void> {
    this.post({ type: 'ARCHITECTURE_LOADING' });
    try {
      await this.dependencies.service.build();
    } catch (error) {
      this.post({ type: 'ERROR', message: describeError(error) });
    }
  }

  private async handleMessage(message: unknown): Promise<void> {
    if (!isWebviewRequest(message)) {
      this.dependencies.logger.warn(`Ignored unknown webview message: ${JSON.stringify(message)}`);
      return;
    }

    const request: WebviewRequest = message;

    switch (request.type) {
      case 'READY':
      case 'GET_ARCHITECTURE': {
        const graph = this.dependencies.service.getGraph();
        if (graph.nodes.length > 0) {
          this.post({ type: 'ARCHITECTURE_UPDATED', payload: graph });
          return;
        }
        await this.refresh();
        return;
      }

      case 'REFRESH_ARCHITECTURE':
        await this.refresh();
        return;

      case 'OPEN_FILE':
        await vscode.commands.executeCommand('kestrel.openFile', {
          filePath: request.filePath,
          line: request.line,
          workspaceName: request.workspaceName,
        });
        return;

      case 'SELECT_NODE':
        this.selectedNodeIds = request.nodeId ? [request.nodeId] : [];
        return;

      case 'ASK_AGENT': {
        const graph = this.dependencies.service.getGraph();
        const nodes = request.nodeIds
          .map((nodeId) => graph.nodes.find((node) => node.id === nodeId))
          .filter((node): node is NonNullable<typeof node> => node !== undefined);

        const prompt = request.prompt ?? 'Explain this part of the architecture.';
        const adapter = this.dependencies.agent;
        await (adapter.askAboutNodes
          ? adapter.askAboutNodes(nodes, graph, prompt)
          : Promise.all(nodes.map((node) => adapter.askAboutNode(node, graph, prompt))));
        return;
      }

      case 'CHAT_STATUS': {
        const status = await this.dependencies.chat.status();
        this.post({
          type: 'CHAT_STATUS',
          ready: status.ready,
          provider: status.provider,
          message: status.message,
          remedyCommand: status.remedyCommand,
        });
        return;
      }

      case 'CHAT_SEND': {
        await this.dependencies.chat.ask(
          { question: request.text, selectedNodeIds: request.nodeIds, projectId: request.projectId },
          {
            onDelta: (text) => this.post({ type: 'CHAT_DELTA', text }),
            onDone: (usage) =>
              this.post({
                type: 'CHAT_DONE',
                provider: usage.provider,
                inputTokens: usage.inputTokens,
                outputTokens: usage.outputTokens,
                cachedTokens: usage.cachedTokens,
              }),
            onError: (message, remedyCommand) =>
              this.post({ type: 'CHAT_ERROR', message, remedyCommand }),
          },
        );
        return;
      }

      case 'CHAT_CANCEL':
        this.dependencies.chat.cancel();
        return;

      case 'CHAT_CLEAR':
        this.dependencies.chat.clear();
        return;

      case 'RUN_COMMAND': {
        // Only KESTREL's own commands may be triggered from the webview.
        if (!request.command.startsWith('kestrel.')) {
          this.dependencies.logger.warn(`Refused to run command ${request.command} from the webview.`);
          return;
        }
        await vscode.commands.executeCommand(request.command);
        const status = await this.dependencies.chat.status();
        this.post({
          type: 'CHAT_STATUS',
          ready: status.ready,
          provider: status.provider,
          message: status.message,
          remedyCommand: status.remedyCommand,
        });
        return;
      }

      case 'GET_SETTINGS':
        await this.postSettings();
        return;

      case 'UPDATE_SETTING': {
        try {
          await updateSetting(request.key, request.value);
        } catch (error) {
          this.dependencies.logger.warn(describeError(error));
        }
        await this.postSettings();
        return;
      }

      default: {
        const exhaustive: never = request;
        this.dependencies.logger.warn(`Unhandled webview request: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  /** Sends the current settings plus what is actually available right now. */
  private async postSettings(): Promise<void> {
    const status = await this.dependencies.chat.status();
    const settings = await readSettings(
      async () => this.dependencies.context.secrets.get(API_KEY_SECRET),
      status.provider,
    );
    this.post({ type: 'SETTINGS', payload: settings });
  }

  private post(message: ExtensionMessage): void {
    void this.panel.webview.postMessage(message);
  }

  dispose(): void {
    KestrelPanel.instance = undefined;
    while (this.disposables.length > 0) {
      this.disposables.pop()?.dispose();
    }
    this.panel.dispose();
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
