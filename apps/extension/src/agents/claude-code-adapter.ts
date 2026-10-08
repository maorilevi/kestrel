import * as vscode from 'vscode';

import type { ArchitectureGraph, ArchitectureNode } from '@kestrel/core';
import { buildAgentContext, type CodingAgentAdapter } from '@kestrel/ai';

/**
 * Claude Code integration, preview stage.
 *
 * KESTREL deliberately uses no undocumented Claude Code APIs. The adapter
 * assembles the architectural context and hands it to the developer through
 * documented VS Code APIs (clipboard + a preview document), which works whether
 * or not Claude Code is installed. When a supported extension API becomes
 * available this class is the only file that has to change.
 */
export class ClaudeCodeAdapter implements CodingAgentAdapter {
  readonly id = 'claude-code';
  readonly label = 'Claude Code';

  async askAboutNode(node: ArchitectureNode, graph: ArchitectureGraph, prompt: string): Promise<void> {
    return this.askAboutNodes([node], graph, prompt);
  }

  async askAboutNodes(nodes: ArchitectureNode[], graph: ArchitectureGraph, prompt: string): Promise<void> {
    if (nodes.length === 0) {
      void vscode.window.showWarningMessage('KESTREL: select a node first.');
      return;
    }

    const context = buildAgentContext(nodes, graph, prompt);
    await vscode.env.clipboard.writeText(context);

    const choice = await vscode.window.showInformationMessage(
      `KESTREL: architectural context for ${describe(nodes)} copied to the clipboard.`,
      'Preview context',
    );

    if (choice === 'Preview context') {
      const document = await vscode.workspace.openTextDocument({ content: context, language: 'markdown' });
      await vscode.window.showTextDocument(document, { preview: true });
    }
  }
}

function describe(nodes: readonly ArchitectureNode[]): string {
  return nodes.length === 1 ? nodes[0].name : `${nodes.length} nodes`;
}
