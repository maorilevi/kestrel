import type { ViewLevel } from '../state/view-state';
import {
  ARCHETYPE_FAMILY,
  ARCHITECTURE_LAYERS,
  LAYER_LABELS,
  PROJECT_KIND_LABELS,
  type ArchitectureLayer,
  type ArchitectureStats,
  type ProjectProfile,
} from '../types/architecture';

export interface ToolbarProps {
  level: ViewLevel;
  stats?: ArchitectureStats;
  projects: ProjectProfile[];
  activeProjectId: string | null;
  issueCount: number;
  loading: boolean;
  search: string;
  showExternal: boolean;
  hiddenLayers: ArchitectureLayer[];
  /** How many nodes of each layer the whole graph contains. */
  layerCounts: Record<ArchitectureLayer, number>;
  /** True when the current level shows no layered node at all. */
  layersHiddenByLevel: boolean;
  canGoUp: boolean;
  onSearchChange: (value: string) => void;
  onToggleExternal: (value: boolean) => void;
  onToggleLayer: (layer: ArchitectureLayer) => void;
  onSelectProject: (projectId: string | null) => void;
  onLevelChange: (level: ViewLevel) => void;
  onRefresh: () => void;
  onFitView: () => void;
  onGoUp: () => void;
  chatCollapsed: boolean;
  onFocusChat: () => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
  canTrace: boolean;
  onTraceFlow: () => void;
}

const LEVELS: Array<{ id: ViewLevel; label: string; title: string }> = [
  { id: 'overview', label: 'Overview', title: "Bird's-eye view: applications, modules and datastores" },
  { id: 'layers', label: 'Layers', title: 'Components grouped by architectural layer' },
  { id: 'flow', label: 'Data flow', title: 'Follow the data through the system from the selection' },
  { id: 'full', label: 'Full graph', title: 'Everything KESTREL detected' },
];

export function Toolbar({
  level,
  stats,
  projects,
  activeProjectId,
  issueCount,
  loading,
  search,
  showExternal,
  hiddenLayers,
  layerCounts,
  layersHiddenByLevel,
  canGoUp,
  onSearchChange,
  onToggleExternal,
  onToggleLayer,
  onSelectProject,
  onLevelChange,
  onRefresh,
  onFitView,
  onGoUp,
  chatCollapsed,
  onFocusChat,
  settingsOpen,
  onToggleSettings,
  canTrace,
  onTraceFlow,
}: ToolbarProps) {
  return (
    <header className="kestrel-toolbar">
      <div className="kestrel-toolbar__row">
        <div className="kestrel-toolbar__brand">
          <span className="kestrel-toolbar__title">KESTREL</span>
          <span className="kestrel-toolbar__tagline">A bird&apos;s-eye view of your codebase.</span>
        </div>

        <div className="kestrel-toolbar__group">
          <button type="button" onClick={onGoUp} disabled={!canGoUp} title="Back to the level above">
            ↑ Up
          </button>
          <div className="kestrel-segmented" role="group" aria-label="Architecture level">
            {LEVELS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                title={
                  entry.id === 'flow' && !canTrace
                    ? 'Select a component first, then trace the data through it'
                    : entry.title
                }
                className={level === entry.id ? 'is-active' : ''}
                disabled={entry.id === 'flow' && !canTrace && level !== 'flow'}
                onClick={() => (entry.id === 'flow' ? onTraceFlow() : onLevelChange(entry.id))}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        <div className="kestrel-toolbar__group kestrel-toolbar__group--grow">
          <input
            type="search"
            className="kestrel-search"
            placeholder="Filter by name or file..."
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
          />
          <label className="kestrel-checkbox">
            <input
              type="checkbox"
              checked={showExternal}
              onChange={(event) => onToggleExternal(event.target.checked)}
            />
            External
          </label>
        </div>

        <div className="kestrel-toolbar__group">
          {stats ? (
            <span className="kestrel-stats" title={`Built in ${stats.durationMs}ms`}>
              {stats.moduleCount} modules · {stats.controllerCount} controllers · {stats.serviceCount}{' '}
              services · {stats.dependencyCount} deps
            </span>
          ) : null}
          {issueCount > 0 ? (
            <span className="kestrel-stats kestrel-stats--warning">⚠ {issueCount} issues</span>
          ) : null}
          <button type="button" onClick={onFitView} title="Fit the graph to the viewport">
            Fit
          </button>
          <button
            type="button"
            className={`kestrel-chat-toggle${chatCollapsed ? '' : ' is-active'}`}
            onClick={onFocusChat}
            title="Put the cursor in the chat"
          >
            <span aria-hidden="true">💬</span> Ask AI
          </button>
          <button
            type="button"
            className={settingsOpen ? 'is-active' : ''}
            onClick={onToggleSettings}
            title="Model, provider and scanning settings"
            aria-pressed={settingsOpen}
          >
            <span aria-hidden="true">⚙</span>
          </button>
          <button type="button" className="is-primary" onClick={onRefresh} disabled={loading}>
            {loading ? 'Refreshing...' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="kestrel-toolbar__row kestrel-toolbar__row--secondary">
        <ProjectChips projects={projects} activeProjectId={activeProjectId} onSelect={onSelectProject} />

        <LayerFilter
          hiddenLayers={hiddenLayers}
          layerCounts={layerCounts}
          layersHiddenByLevel={layersHiddenByLevel}
          onToggleLayer={onToggleLayer}
          onShowLayers={() => onLevelChange('layers')}
        />
      </div>
    </header>
  );
}

/**
 * Layer filter and legend in one. Each chip carries the number of nodes in that
 * layer, so "no layers were found" is never confused with "this level has none".
 */
function LayerFilter({
  hiddenLayers,
  layerCounts,
  layersHiddenByLevel,
  onToggleLayer,
  onShowLayers,
}: {
  hiddenLayers: ArchitectureLayer[];
  layerCounts: Record<ArchitectureLayer, number>;
  layersHiddenByLevel: boolean;
  onToggleLayer: (layer: ArchitectureLayer) => void;
  onShowLayers: () => void;
}) {
  const detected = ARCHITECTURE_LAYERS.filter((layer) => layerCounts[layer] > 0);

  if (detected.length === 0) {
    return (
      <div className="kestrel-layer-filter">
        <span className="kestrel-stats">No layered components detected</span>
      </div>
    );
  }

  return (
    <div className="kestrel-layer-filter" role="group" aria-label="Layers">
      {layersHiddenByLevel ? (
        <button type="button" className="kestrel-layer-hint" onClick={onShowLayers}>
          Layers apply to components — open the Layers view
        </button>
      ) : null}

      {detected.map((layer) => {
        const active = !hiddenLayers.includes(layer);
        return (
          <button
            key={layer}
            type="button"
            className={`kestrel-layer-chip kestrel-layer-chip--${layer}${active ? ' is-active' : ''}`}
            title={`${LAYER_LABELS[layer]}: ${layerCounts[layer]} node(s) — click to ${
              active ? 'hide' : 'show'
            }`}
            onClick={() => onToggleLayer(layer)}
          >
            <span className="kestrel-layer-chip__dot" />
            {layer}
            <span className="kestrel-layer-chip__count">{layerCounts[layer]}</span>
          </button>
        );
      })}
    </div>
  );
}

function ProjectChips({
  projects,
  activeProjectId,
  onSelect,
}: {
  projects: ProjectProfile[];
  activeProjectId: string | null;
  onSelect: (projectId: string | null) => void;
}) {
  if (projects.length === 0) {
    return <div className="kestrel-project-chips" />;
  }

  return (
    <div className="kestrel-project-chips">
      {projects.length > 1 ? (
        <button
          type="button"
          className={`kestrel-chip${activeProjectId === null ? ' is-active' : ''}`}
          onClick={() => onSelect(null)}
        >
          All projects
        </button>
      ) : null}

      {projects.map((project) => {
        const databases = project.databases.map((database) => database.label).join(', ');
        const frameworks = project.frameworks.map((framework) => framework.label).join(', ');
        const active = activeProjectId === project.id || projects.length === 1;
        const family = ARCHETYPE_FAMILY[project.archetype];

        return (
          <button
            key={project.id}
            type="button"
            className={`kestrel-chip kestrel-chip--${family}${active ? ' is-active' : ''}`}
            title={[
              `${project.archetypeLabel} · ${PROJECT_KIND_LABELS[project.kind]} · ${project.fileCount} files`,
              `Confidence: ${project.archetypeConfidence}`,
              frameworks ? `Frameworks: ${frameworks}` : null,
              databases ? `Databases: ${databases}` : null,
              project.evidence.length > 0 ? `Detected from — ${project.evidence.join('; ')}` : null,
            ]
              .filter(Boolean)
              .join('\n')}
            onClick={() => onSelect(projects.length === 1 ? null : project.id)}
          >
            <span className="kestrel-chip__kind">{project.archetypeLabel}</span>
            {project.name}
            {project.primaryFramework ? (
              <span className="kestrel-chip__framework">{project.primaryFramework}</span>
            ) : null}
            {databases ? <span className="kestrel-chip__detail">🗄 {databases}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
