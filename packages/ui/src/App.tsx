import type { ReactFlowInstance } from '@xyflow/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Breadcrumbs } from './components/Breadcrumbs';
import { Chat } from './components/Chat';
import { Sidebar } from './components/Sidebar';
import { Insights } from './components/Insights';
import { Settings } from './components/Settings';
import { NodeDetails } from './components/NodeDetails';
import { Toolbar } from './components/Toolbar';
import { ArchitectureGraph } from './components/graph/ArchitectureGraph';
import type { ArchitectureFlowEdge } from './components/graph/ArchitectureEdge';
import type { ArchitectureFlowNode } from './components/graph/ArchitectureNode';
import { describeFlowPaths, traceDataFlow, type FlowDirection } from './state/data-flow';
import {
  computeBreadcrumbs,
  computeVisibleGraph,
  initialViewState,
  type Breadcrumb,
  type ViewLevel,
  type ViewState,
} from './state/view-state';
import type {
  ArchitectureDiff,
  ArchitectureGraph as ArchitectureGraphModel,
  ArchitectureLayer,
  ArchitectureNode,
} from './types/architecture';
import { getPersistedState, onExtensionMessage, persistState, postRequest } from './host/host';

/** Panel preferences that survive a reload of the webview. */
interface PersistedPreferences {
  chatCollapsed: boolean;
  chatSplit: number;
}

const DEFAULT_PREFERENCES: PersistedPreferences = { chatCollapsed: false, chatSplit: 0.45 };

const EMPTY_GRAPH: ArchitectureGraphModel = { nodes: [], edges: [] };

export function App() {
  const [graph, setGraph] = useState<ArchitectureGraphModel>(EMPTY_GRAPH);
  const [view, setView] = useState<ViewState>(initialViewState);
  const [preferences, setPreferences] = useState<PersistedPreferences>(
    () => ({ ...DEFAULT_PREFERENCES, ...(getPersistedState<Partial<PersistedPreferences>>() ?? {}) }),
  );
  const [focusChat, setFocusChat] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  /** What the last agent run changed; highlighted until the host clears it or the user dismisses it. */
  const [diff, setDiff] = useState<ArchitectureDiff | null>(null);
  const instance = useRef<ReactFlowInstance<ArchitectureFlowNode, ArchitectureFlowEdge> | null>(null);
  /** Nodes to centre on once they are actually on screen. */
  const [pendingReveal, setPendingReveal] = useState<string[]>([]);

  useEffect(() => {
    const unsubscribe = onExtensionMessage((message) => {
      switch (message.type) {
        case 'ARCHITECTURE_LOADING':
          setLoading(true);
          setError(null);
          break;
        case 'ARCHITECTURE_UPDATED':
          setGraph(message.payload);
          setLoading(false);
          setError(null);
          break;
        case 'ERROR':
          setError(message.message);
          setLoading(false);
          break;
        case 'SHOW_SETTINGS':
          setSettingsOpen(true);
          break;
        case 'ARCHITECTURE_DIFF':
          setDiff(message.payload);
          break;
      }
    });

    postRequest({ type: 'READY' });
    return unsubscribe;
  }, []);

  const changes = useMemo(() => changeMarks(graph, diff), [graph, diff]);

  // Drop stale focus/selection when a rebuild removes nodes.
  useEffect(() => {
    setView((current) => {
      const ids = new Set(graph.nodes.map((node) => node.id));
      const focusId = current.focusId && ids.has(current.focusId) ? current.focusId : null;
      const selectedNodeIds = current.selectedNodeIds.filter((id) => ids.has(id));
      if (focusId === current.focusId && selectedNodeIds.length === current.selectedNodeIds.length) {
        return current;
      }
      return {
        ...current,
        focusId,
        level: focusId ? current.level : current.level === 'full' ? 'full' : 'overview',
        selectedNodeIds,
      };
    });
  }, [graph]);

  const visible = useMemo(() => computeVisibleGraph(graph, view), [graph, view]);
  const crumbs = useMemo(() => computeBreadcrumbs(graph, view), [graph, view]);

  const selectedNodes = useMemo(
    () =>
      view.selectedNodeIds
        .map((id) => graph.nodes.find((node) => node.id === id))
        .filter((node): node is ArchitectureNode => node !== undefined),
    [graph, view.selectedNodeIds],
  );

  const handleSelectionChange = useCallback((nodeIds: string[]) => {
    setView((current) =>
      sameIds(current.selectedNodeIds, nodeIds) ? current : { ...current, selectedNodeIds: nodeIds },
    );
    postRequest({ type: 'SELECT_NODE', nodeId: nodeIds[0] ?? null });
  }, []);

  /** Selects a set of nodes, e.g. everything a finding refers to. */
  const selectNodes = useCallback((nodeIds: string[]) => {
    if (nodeIds.length === 0) {
      return;
    }
    setView((current) => ({
      ...current,
      // Findings can span modules, so widen the view to where they live.
      level: current.level === 'overview' ? 'full' : current.level,
      selectedNodeIds: nodeIds,
    }));
    postRequest({ type: 'SELECT_NODE', nodeId: nodeIds[0] });
  }, []);

  /**
   * Takes the developer to a node: makes sure it is on screen at all, selects
   * it, and centres the viewport on it. Selecting a node that the current level
   * filters out would otherwise look like nothing happened.
   */
  const revealNodes = useCallback(
    (nodeIds: string[]) => {
      const known = nodeIds.filter((id) => graph.nodes.some((node) => node.id === id));
      if (known.length === 0) {
        return;
      }

      setView((current) => {
        const visibleNow = computeVisibleGraph(graph, current);
        const alreadyShown = known.every((id) => visibleNow.nodes.some((node) => node.id === id));

        if (alreadyShown) {
          return { ...current, selectedNodeIds: known };
        }

        // Show exactly what was asked for, plus how those nodes connect.
        return {
          ...current,
          level: 'flow',
          flowSeedIds: known,
          flowDirection: known.length > 1 ? 'both' : 'both',
          flowDepth: known.length > 1 ? 1 : 6,
          selectedNodeIds: known,
        };
      });

      setPendingReveal(known);
      postRequest({ type: 'SELECT_NODE', nodeId: known[0] });
    },
    [graph],
  );

  const traceFlow = useCallback((nodeIds: string[], direction: FlowDirection = 'both') => {
    if (nodeIds.length === 0) {
      return;
    }
    setView((current) => ({
      ...current,
      level: 'flow',
      flowSeedIds: nodeIds,
      flowDirection: direction,
      flowDepth: 6,
      selectedNodeIds: nodeIds,
    }));
    setPendingReveal(nodeIds);
  }, []);

  const dive = useCallback(
    (nodeId: string) => {
      const node = graph.nodes.find((candidate) => candidate.id === nodeId);
      if (!node) {
        return;
      }
      if (node.type === 'application') {
        // Diving into an application means "show me this project".
        const projectId = typeof node.metadata?.projectId === 'string' ? node.metadata.projectId : null;
        setView((current) => ({ ...current, level: 'overview', focusId: null, projectId }));
        return;
      }
      setView((current) => ({
        ...current,
        level: node.type === 'module' ? 'module' : 'component',
        focusId: node.id,
        selectedNodeIds: [node.id],
      }));
    },
    [graph],
  );

  const goUp = useCallback(() => {
    setView((current) => {
      if (current.level === 'overview') {
        return current;
      }
      const focus = current.focusId ? graph.nodes.find((node) => node.id === current.focusId) : undefined;
      const parent = focus?.parentId ? graph.nodes.find((node) => node.id === focus.parentId) : undefined;

      if (parent && parent.type === 'module') {
        return { ...current, level: 'module', focusId: parent.id };
      }
      return { ...current, level: 'overview', focusId: null };
    });
  }, [graph]);

  const navigate = useCallback(
    (crumb: Breadcrumb) => {
      if (crumb.id === null) {
        setView((current) => ({
          ...current,
          level: 'overview',
          focusId: null,
          projectId: crumb.projectId ?? null,
        }));
        return;
      }
      dive(crumb.id);
    },
    [dive],
  );

  const changeLevel = useCallback((level: ViewLevel) => {
    setView((current) => ({ ...current, level, focusId: level === 'full' ? current.focusId : null }));
  }, []);

  const toggleLayer = useCallback((layer: ArchitectureLayer) => {
    setView((current) => ({
      ...current,
      hiddenLayers: current.hiddenLayers.includes(layer)
        ? current.hiddenLayers.filter((entry) => entry !== layer)
        : [...current.hiddenLayers, layer],
    }));
  }, []);

  const selectProject = useCallback((projectId: string | null) => {
    setView((current) => ({ ...current, projectId, focusId: null }));
  }, []);

  const refresh = useCallback(() => {
    setLoading(true);
    postRequest({ type: 'REFRESH_ARCHITECTURE' });
  }, []);

  const openFile = useCallback((node: ArchitectureNode) => {
    if (!node.filePath) {
      return;
    }
    postRequest({
      type: 'OPEN_FILE',
      filePath: node.filePath,
      line: typeof node.metadata?.line === 'number' ? node.metadata.line : undefined,
      workspaceName:
        typeof node.metadata?.workspaceName === 'string' ? node.metadata.workspaceName : undefined,
    });
  }, []);

  const askAgent = useCallback((nodeIds: string[]) => {
    postRequest({ type: 'ASK_AGENT', nodeIds });
  }, []);

  const fitView = useCallback(() => {
    void instance.current?.fitView({ padding: 0.2, duration: 200 });
  }, []);

  useEffect(() => {
    if (pendingReveal.length === 0) {
      return;
    }
    const onScreen = pendingReveal.filter((id) => visible.nodes.some((node) => node.id === id));
    if (onScreen.length === 0) {
      return;
    }
    const timer = setTimeout(() => {
      void instance.current?.fitView({
        nodes: onScreen.map((id) => ({ id })),
        padding: 0.45,
        duration: 400,
        maxZoom: 1.2,
      });
      setPendingReveal([]);
    }, 60);
    return () => clearTimeout(timer);
  }, [pendingReveal, visible]);

  const flow = useMemo(
    () =>
      view.level === 'flow' && view.flowSeedIds.length > 0
        ? traceDataFlow(graph, view.flowSeedIds, {
            direction: view.flowDirection,
            maxDepth: view.flowDepth,
          })
        : undefined,
    [graph, view.level, view.flowSeedIds, view.flowDirection, view.flowDepth],
  );

  const flowPaths = useMemo(
    () => (flow ? describeFlowPaths(graph, flow, view.flowSeedIds) : []),
    [graph, flow, view.flowSeedIds],
  );

  // Preferences are remembered so the panel opens the way it was left.
  useEffect(() => {
    persistState(preferences);
  }, [preferences]);

  const stats = graph.metadata?.stats;
  const issues = graph.metadata?.issues ?? [];
  const hasGraph = graph.nodes.length > 0;

  const layerCounts = useMemo(() => {
    const counts: Record<ArchitectureLayer, number> = {
      presentation: 0,
      business: 0,
      data: 0,
      infrastructure: 0,
      shared: 0,
    };
    for (const node of graph.nodes) {
      const layer = node.metadata?.layer;
      if (layer) {
        counts[layer] += 1;
      }
    }
    return counts;
  }, [graph]);

  // Overview shows applications, modules and datastores — none of which belong
  // to a layer, so the filter would look broken without this hint.
  const layersHiddenByLevel =
    Object.values(layerCounts).some((count) => count > 0) &&
    !visible.nodes.some((node) => node.metadata?.layer);

  // Bring what the agent changed into view once the rebuilt graph contains it.
  const revealedDiff = useRef<ArchitectureDiff | null>(null);
  useEffect(() => {
    if (!diff || revealedDiff.current === diff) {
      return;
    }
    const ids = [...diff.addedNodes, ...diff.changedNodes].map((node) => node.id);
    if (ids.length > 0 && ids.every((id) => graph.nodes.some((node) => node.id === id))) {
      revealedDiff.current = diff;
      revealNodes(ids);
    }
  }, [diff, graph, revealNodes]);

  return (
    <div className="kestrel-app">
      <Toolbar
        level={view.level}
        stats={stats}
        projects={graph.metadata?.projects ?? []}
        activeProjectId={view.projectId}
        issueCount={issues.length}
        loading={loading}
        search={view.search}
        showExternal={view.showExternal}
        hiddenLayers={view.hiddenLayers}
        layerCounts={layerCounts}
        layersHiddenByLevel={layersHiddenByLevel}
        canGoUp={view.level === 'module' || view.level === 'component'}
        onSearchChange={(search) => setView((current) => ({ ...current, search }))}
        onToggleExternal={(showExternal) => setView((current) => ({ ...current, showExternal }))}
        onToggleLayer={toggleLayer}
        onSelectProject={selectProject}
        onLevelChange={changeLevel}
        canTrace={view.selectedNodeIds.length > 0}
        onTraceFlow={() => traceFlow(view.selectedNodeIds)}
        onRefresh={refresh}
        onFitView={fitView}
        onGoUp={goUp}
        chatCollapsed={preferences.chatCollapsed}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen((open) => !open)}
        onFocusChat={() => {
          setPreferences((current) => ({ ...current, chatCollapsed: false }));
          setFocusChat((signal) => signal + 1);
        }}
      />

      <Breadcrumbs crumbs={crumbs} onNavigate={navigate} />

      {error ? <div className="kestrel-banner kestrel-banner--error">{error}</div> : null}
      {!error && hasGraph && graph.metadata?.frameworkDetected === false ? (
        <div className="kestrel-banner">
          {describeNonNestWorkspace(graph)} KESTREL scanned {stats?.fileCount ?? 0} TypeScript files; the
          architecture graph currently understands NestJS modules, controllers and providers.
        </div>
      ) : null}
      {diff ? (
        <div className="kestrel-banner kestrel-banner--change">
          <span>
            Last agent run: {describeDiff(diff)}
          </span>
          <button type="button" onClick={() => revealNodes([...diff.addedNodes, ...diff.changedNodes].map((node) => node.id))}>
            Show
          </button>
          <button type="button" onClick={() => setDiff(null)}>
            Dismiss
          </button>
        </div>
      ) : null}
      {hasGraph ? <Insights graph={graph} onSelectNodes={selectNodes} /> : null}

      <main className="kestrel-main">
        {settingsOpen ? <Settings onClose={() => setSettingsOpen(false)} /> : null}
        {hasGraph ? (
          <ArchitectureGraph
            visible={visible}
            focusId={view.focusId}
            selectedNodeIds={view.selectedNodeIds}
            onSelectionChange={handleSelectionChange}
            onDive={dive}
            onReady={(value) => {
              instance.current = value;
            }}
            changes={changes}
          />
        ) : (
          <div className="kestrel-graph kestrel-graph--empty">
            <p>{loading ? 'Building architecture...' : 'No architecture available yet.'}</p>
            {!loading ? (
              <button type="button" className="is-primary" onClick={refresh}>
                Scan workspace
              </button>
            ) : null}
          </div>
        )}

        <Sidebar
          split={preferences.chatSplit}
          collapsed={preferences.chatCollapsed}
          onSplitChange={(chatSplit) => setPreferences((current) => ({ ...current, chatSplit }))}
          top={
            <NodeDetails
              graph={graph}
              selectedNodes={selectedNodes}
              flowPaths={flowPaths}
              flowDirection={view.flowDirection}
              flowTruncated={visible.flowTruncated}
              isTracing={view.level === 'flow'}
              onOpenFile={openFile}
              onSelect={(id) => revealNodes([id])}
              onDive={dive}
              onAskAgent={askAgent}
              onTraceFlow={traceFlow}
            />
          }
          bottom={
            <Chat
              nodes={graph.nodes}
              selectedNodeIds={view.selectedNodeIds}
              projectId={view.projectId}
              onSelectNode={(nodeId) => revealNodes([nodeId])}
              onRevealNodes={revealNodes}
              onTraceFlow={(nodeIds) => traceFlow(nodeIds)}
              collapsed={preferences.chatCollapsed}
              onToggleCollapsed={() =>
                setPreferences((current) => ({ ...current, chatCollapsed: !current.chatCollapsed }))
              }
              focusSignal={focusChat}
            />
          }
        />
      </main>
    </div>
  );
}

/** Says what KESTREL *did* detect when no NestJS building blocks were found. */
/** Highlights per node: what changed, and the containers that hold a change. */
function changeMarks(graph: ArchitectureGraphModel, diff: ArchitectureDiff | null): Map<string, 'added' | 'changed' | 'inside'> {
  const marks = new Map<string, 'added' | 'changed' | 'inside'>();
  if (!diff) {
    return marks;
  }
  const parents = new Map(graph.nodes.map((node) => [node.id, node.parentId]));
  const markAncestors = (id: string): void => {
    for (let parent = parents.get(id); parent; parent = parents.get(parent)) {
      if (!marks.has(parent)) {
        marks.set(parent, 'inside');
      }
    }
  };
  for (const node of diff.addedNodes) {
    marks.set(node.id, 'added');
  }
  for (const node of diff.changedNodes) {
    if (!marks.has(node.id) || marks.get(node.id) === 'inside') {
      marks.set(node.id, 'changed');
    }
  }
  for (const node of [...diff.addedNodes, ...diff.changedNodes]) {
    markAncestors(node.id);
  }
  return marks;
}

function describeDiff(diff: ArchitectureDiff): string {
  const parts: string[] = [];
  const count = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  if (diff.addedNodes.length > 0) parts.push(`${count(diff.addedNodes.length, 'component')} added`);
  if (diff.changedNodes.length > 0) parts.push(`${diff.changedNodes.length} changed`);
  if (diff.removedNodes.length > 0) parts.push(`${diff.removedNodes.length} removed`);
  if (diff.addedEdges.length + diff.removedEdges.length > 0) {
    parts.push(count(diff.addedEdges.length + diff.removedEdges.length, 'connection') + ' rewired');
  }
  return parts.length > 0 ? parts.join(', ') : 'no architectural change';
}

function describeNonNestWorkspace(graph: ArchitectureGraphModel): string {
  const projects = graph.metadata?.projects ?? [];
  const ui = projects.filter((project) => project.kind === 'ui' || project.kind === 'fullstack');

  if (ui.length > 0) {
    const frameworks = [
      ...new Set(
        ui.flatMap((project) =>
          project.frameworks.filter((framework) => framework.category === 'frontend').map((f) => f.label),
        ),
      ),
    ];
    return `Detected ${ui.length === 1 ? 'a UI project' : `${ui.length} UI projects`}${
      frameworks.length > 0 ? ` (${frameworks.join(', ')})` : ''
    }.`;
  }

  return 'No NestJS building blocks were detected.';
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
