import * as vscode from 'vscode';

import type { CodingAgentAdapter } from '../../agents/coding-agent-adapter';
import type { ArchitectureService } from '../../architecture/architecture.service';
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
