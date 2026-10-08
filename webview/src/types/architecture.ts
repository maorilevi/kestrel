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
} from '../../../src/architecture/models';

export { ARCHITECTURE_LAYERS, LAYER_LABELS } from '../../../src/architecture/models/architecture-node';
export { PROJECT_KIND_LABELS } from '../../../src/architecture/models/architecture-project';
export {
  ARCHETYPE_FAMILY,
  ARCHETYPE_LABELS,
} from '../../../src/architecture/profile/application-archetype';

export type { ExtensionMessage, WebviewRequest } from '../../../src/shared/protocol';
export type { ModelChoice, SettingsSnapshot } from '../../../src/shared/settings-model';
