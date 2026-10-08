/**
 * The webview consumes the same architecture model as the extension.
 *
 * These are pure types (erased at build time) plus a few label constants; the
 * visualization layer adapts them to React Flow in `components/graph`, never
 * the other way around.
 */
export type {
  ArchitectureEdge,
  ArchitectureEdgeType,
  ArchitectureGraph,
  ArchitectureIssue,
  ArchitectureStyle,
  ArchitectureLayer,
  ArchitectureNode,
  ArchitectureNodeMethod,
  ArchitectureNodeRole,
  ArchitectureNodeType,
  ArchitectureStats,
  ApplicationArchetype,
  DetectedDatabase,
  DetectedFramework,
  ProjectKind,
  ProjectProfile,
  ArchitectureDiff,
} from '@kestrel/core/model';

export { ARCHETYPE_FAMILY, ARCHETYPE_LABELS, ARCHITECTURE_LAYERS, LAYER_LABELS, PROJECT_KIND_LABELS } from '@kestrel/core/model';

export type { ExtensionMessage, WebviewRequest } from '@kestrel/protocol';
export type { ModelChoice, SettingsSnapshot } from '@kestrel/protocol';
