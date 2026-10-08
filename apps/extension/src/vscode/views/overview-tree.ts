import * as vscode from 'vscode';

import type { ArchitectureService } from '@kestrel/core';
import {
  PROJECT_KIND_LABELS,
  type ArchitectureGraph,
  type ArchitectureIssue,
  type ProjectProfile,
} from '@kestrel/core';

type OverviewItem = StatItem | IssueItem | ActionItem | MessageItem | ProjectItem;

interface ProjectItem {
  kind: 'project';
  project: ProjectProfile;
}

interface StatItem {
  kind: 'stat';
  label: string;
  value: number;
  icon: string;
}

interface IssueItem {
  kind: 'issue';
  issue: ArchitectureIssue;
}

interface ActionItem {
  kind: 'action';
  label: string;
  command: string;
  icon: string;
}

interface MessageItem {
  kind: 'message';
  label: string;
  icon: string;
}

/** Activity bar icon per application archetype. */
const ARCHETYPE_ICONS: Readonly<Record<string, string>> = {
  'rest-api': 'server-process',
  'graphql-api': 'server-process',
  'cloud-function': 'cloud',
  'lambda-function': 'cloud',
  'azure-function': 'cloud',
  worker: 'gear',
  cli: 'terminal',
  spa: 'browser',
  'ssr-web': 'browser',
  'static-site': 'globe',
  'mobile-app': 'device-mobile',
  'desktop-app': 'device-desktop',
  'vscode-extension': 'extensions',
  'test-suite': 'beaker',
  library: 'library',
  'workspace-root': 'root-folder',
  unknown: 'question',
};

/**
 * KESTREL activity bar view: detected projects, totals, issues and the two MVP
 * actions. Secondary to the graph, so it stays intentionally small.
 */
export class OverviewTreeProvider implements vscode.TreeDataProvider<OverviewItem> {
  private readonly emitter = new vscode.EventEmitter<OverviewItem | undefined>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly service: ArchitectureService) {}

  refresh(): void {
    this.emitter.fire(undefined);
  }

  getTreeItem(element: OverviewItem): vscode.TreeItem {
    switch (element.kind) {
      case 'stat': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.description = String(element.value);
        item.iconPath = new vscode.ThemeIcon(element.icon);
        return item;
      }
      case 'issue': {
        const item = new vscode.TreeItem(element.issue.message, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon('warning');
        item.tooltip = element.issue.message;
        return item;
      }
      case 'action': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.command = { command: element.command, title: element.label };
        item.iconPath = new vscode.ThemeIcon(element.icon);
        return item;
      }
      case 'message': {
        const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(element.icon);
        return item;
      }
      case 'project': {
        const { project } = element;
        const databases = project.databases.map((database) => database.label).join(', ');
        const item = new vscode.TreeItem(project.name, vscode.TreeItemCollapsibleState.None);
        item.description = [project.archetypeLabel, project.primaryFramework, databases]
          .filter(Boolean)
          .join(' · ');
        item.iconPath = new vscode.ThemeIcon(ARCHETYPE_ICONS[project.archetype] ?? 'question');
        item.tooltip = new vscode.MarkdownString(
          [
            `**${project.name}** — ${project.archetypeLabel}` +
              (project.primaryFramework ? ` (${project.primaryFramework})` : ''),
            `_${PROJECT_KIND_LABELS[project.kind]} · confidence: ${project.archetypeConfidence}_`,
            '',
            `- Path: \`${project.rootPath || '.'}\``,
            `- Files: ${project.fileCount}`,
            `- Frameworks: ${project.frameworks.map((f) => f.label).join(', ') || 'none detected'}`,
            `- Databases: ${
              project.databases.map((d) => `${d.label} (${d.access})`).join(', ') || 'none detected'
            }`,
            project.evidence.length > 0 ? `- Detected from: ${project.evidence.join('; ')}` : '',
          ].join('\n'),
        );
        return item;
      }
    }
  }

  getChildren(element?: OverviewItem): OverviewItem[] {
    if (element) {
      return [];
    }

    const graph: ArchitectureGraph = this.service.getGraph();
    const stats = graph.metadata?.stats;
    const items: OverviewItem[] = [];

    if (!stats || graph.nodes.length === 0) {
      items.push({ kind: 'message', label: 'No architecture built yet', icon: 'info' });
    } else {
      for (const project of graph.metadata?.projects ?? []) {
        items.push({ kind: 'project', project });
      }

      items.push(
        { kind: 'stat', label: 'Modules', value: stats.moduleCount, icon: 'package' },
        { kind: 'stat', label: 'Controllers', value: stats.controllerCount, icon: 'symbol-interface' },
        { kind: 'stat', label: 'Services', value: stats.serviceCount, icon: 'symbol-method' },
        { kind: 'stat', label: 'Entities', value: stats.entityCount, icon: 'symbol-structure' },
        { kind: 'stat', label: 'Databases', value: stats.databaseCount, icon: 'database' },
        { kind: 'stat', label: 'Dependencies', value: stats.dependencyCount, icon: 'references' },
        { kind: 'stat', label: 'Files scanned', value: stats.fileCount, icon: 'file-code' },
      );

      const issues = graph.metadata?.issues ?? [];
      if (issues.length === 0) {
        items.push({ kind: 'message', label: 'No architecture issues', icon: 'pass' });
      } else {
        for (const issue of issues) {
          items.push({ kind: 'issue', issue });
        }
      }
    }

    items.push(
      { kind: 'action', label: 'Open Architecture', command: 'kestrel.openArchitecture', icon: 'type-hierarchy' },
      { kind: 'action', label: 'Refresh', command: 'kestrel.refreshArchitecture', icon: 'refresh' },
    );

    return items;
  }

  dispose(): void {
    this.emitter.dispose();
  }
}
