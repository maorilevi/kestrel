import * as vscode from 'vscode';

import type { CodingAgentAdapter } from '@kestrel/ai';
import type { ArchitectureService } from '@kestrel/core';
import { KestrelPanel } from '../webview/kestrel-panel';

export interface CopyAgentContextRequest {
  nodeIds?: string[];
  prompt?: string;
}

/**
 * `kestrel.copyAgentContext` — hands the selected architecture to a coding
 * agent through the {@link CodingAgentAdapter} port.
 */
export function registerCopyAgentContextCommand(
  service: ArchitectureService,
  agent: CodingAgentAdapter,
): vscode.Disposable {
  return vscode.commands.registerCommand(
    'kestrel.copyAgentContext',
    async (request: CopyAgentContextRequest = {}) => {
      const graph = service.getGraph();
      const nodeIds = request.nodeIds?.length ? request.nodeIds : (KestrelPanel.current?.getSelectedNodeIds() ?? []);
      const nodes = nodeIds
        .map((nodeId) => service.getNode(nodeId))
        .filter((node): node is NonNullable<typeof node> => node !== undefined);

      if (nodes.length === 0) {
        void vscode.window.showWarningMessage('KESTREL: select an architecture node first.');
        return;
      }

      const prompt = request.prompt ?? 'Explain this part of the architecture.';
      if (agent.askAboutNodes) {
        await agent.askAboutNodes(nodes, graph, prompt);
        return;
      }
      await agent.askAboutNode(nodes[0], graph, prompt);
    },
  );
}
