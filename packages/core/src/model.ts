/**
 * Browser-safe entry point: the architecture model types and label constants.
 *
 * Nothing reachable from here may import ts-morph or Node built-ins, so a
 * canvas running in a browser can depend on it.
 */
export * from './models';
export { ARCHETYPE_FAMILY, ARCHETYPE_LABELS, type ArchetypeFamily } from './profile/application-archetype';
