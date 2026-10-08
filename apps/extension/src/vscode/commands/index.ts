import * as vscode from 'vscode';

import type { CodingAgentAdapter } from '@kestrel/ai';
import type { ArchitectureService } from '@kestrel/core';
import type { KestrelPanelDependencies } from '../webview/kestrel-panel';
import { registerCopyAgentContextCommand } from './copy-agent-context.command';
import { registerOpenArchitectureCommand } from './open-architecture.command';
import { registerOpenFileCommand } from './open-file.command';
import { registerRefreshArchitectureCommand } from './refresh-architecture.command';

export function registerCommands(
  dependencies: KestrelPanelDependencies,
  service: ArchitectureService,
  agent: CodingAgentAdapter,
): vscode.Disposable[] {
  return [
    registerOpenArchitectureCommand(dependencies),
    registerRefreshArchitectureCommand(service),
    registerOpenFileCommand(service),
    registerCopyAgentContextCommand(service, agent),
  ];
}

export { registerCopyAgentContextCommand, registerOpenArchitectureCommand, registerOpenFileCommand, registerRefreshArchitectureCommand };
