import type { ArchitectureNodeRole, ArchitectureNodeType } from '../models/architecture-node';
import { STATE_FACTORIES } from './function-reader';
import { ROLE_TO_NODE_TYPE } from './nestjs-parser';
import type { ParsedFile, ParsedFunction, ParsedHttpCall } from './parsed-model';

/** One front-end building block. */
export interface UiElementDefinition {
  name: string;
  filePath: string;
  workspaceName: string;
  line: number;
  role: ArchitectureNodeRole;
  nodeType: ArchitectureNodeType;
  /** Route the page is mounted at, when it is reachable from the router. */
  route?: string;
  /** PascalCase tags rendered in the body. */
  jsxTags: string[];
  /** Identifiers called in the body. */
  calls: string[];
  httpCalls: ParsedHttpCall[];
}

export interface UiRoute {
  path: string;
  component: string;
  filePath: string;
}

export interface UiAnalysis {
  elements: UiElementDefinition[];
  routes: UiRoute[];
  /** True when any front-end building block was found. */
  detected: boolean;
}

/** Folder conventions that identify a role on their own. */
const FOLDER_ROLES: ReadonlyArray<[string, ArchitectureNodeRole]> = [
  ['pages', 'page'],
  ['views', 'page'],
  ['screens', 'page'],
  ['routes', 'page'],
  ['layouts', 'layout'],
  ['components', 'component'],
  ['widgets', 'component'],
  ['hooks', 'hook'],
  ['store', 'store'],
  ['stores', 'store'],
  ['state', 'store'],
  ['api', 'api-client'],
  ['data', 'api-client'],
  ['services', 'api-client'],
  ['queries', 'api-client'],
];

/**
 * Reads the front-end architecture out of parsed files.
 *
 * NestJS is described by decorators; React is described by conventions and by
 * what the code does — returning JSX, starting with `use`, calling an HTTP
 * endpoint. Those signals are read from the AST, never from file text.
 */
export class UiParser {
  /**
   * @param uiFilePaths Files belonging to projects that are UI or fullstack.
   * A NestJS service must never be mistaken for a React component.
   */
  analyze(files: readonly ParsedFile[], uiFilePaths: ReadonlySet<string>): UiAnalysis {
    const routes: UiRoute[] = [];
    const candidates: Array<{ file: ParsedFile; declaration: ParsedFunction }> = [];

    for (const file of files) {
      if (!uiFilePaths.has(file.filePath)) {
        continue;
      }

      for (const route of file.routes) {
        if (route.component) {
          routes.push({ path: route.path, component: route.component, filePath: file.filePath });
        }
      }

      for (const declaration of file.functions) {
        candidates.push({ file, declaration });
      }
    }

    const routedComponents = new Map<string, string>();
    for (const route of routes) {
      if (!routedComponents.has(route.component)) {
        routedComponents.set(route.component, route.path);
      }
    }

    // Files that provably make requests; used to tell `api.overviewRaw('/x')`
    // apart from `navigate('/x')`.
    const apiClientFiles = new Set(
      files
        .filter((file) => file.functions.some((fn) => fn.httpCalls.some((call) => call.confident)))
        .map((file) => file.filePath),
    );

    const elements: UiElementDefinition[] = [];
    for (const { file, declaration } of candidates) {
      const httpCalls = declaration.httpCalls.filter((call) =>
        isRequest(call, file, apiClientFiles),
      );
      const role = classifyUiElement({ ...declaration, httpCalls }, file.filePath, routedComponents);
      if (!role) {
        continue;
      }

      elements.push({
        name: declaration.name,
        filePath: file.filePath,
        workspaceName: file.workspaceName,
        line: declaration.line,
        role,
        nodeType: ROLE_TO_NODE_TYPE[role],
        route: routedComponents.get(declaration.name),
        jsxTags: declaration.jsxTags,
        calls: declaration.calls,
        httpCalls,
      });
    }

    return { elements: demoteRenderedPages(elements), routes, detected: elements.length > 0 };
  }
}

/**
 * A literal path is a request when the callee proves it (`fetch`), or when the
 * object it was called on comes from a module that provably makes requests.
 */
function isRequest(
  call: ParsedHttpCall,
  file: ParsedFile,
  apiClientFiles: ReadonlySet<string>,
): boolean {
  if (call.confident) {
    return true;
  }
  if (!call.receiver) {
    return false;
  }

  const binding = file.imports.find((candidate) => candidate.symbol === call.receiver);
  if (binding?.resolvedFilePath) {
    return apiClientFiles.has(binding.resolvedFilePath);
  }

  // Declared in this file, which is itself an API client.
  return apiClientFiles.has(file.filePath);
}

/**
 * A folder convention is weaker than evidence: something in `pages/` that
 * another component renders is a component, whatever folder it sits in. Only
 * elements the router mounts keep their route.
 */
function demoteRenderedPages(elements: readonly UiElementDefinition[]): UiElementDefinition[] {
  const rendered = new Set(elements.flatMap((element) => element.jsxTags));

  return elements.map((element) => {
    if (element.role !== 'page' || element.route !== undefined || !rendered.has(element.name)) {
      return element;
    }
    return { ...element, role: 'component', nodeType: ROLE_TO_NODE_TYPE.component };
  });
}

/**
 * Decides what a function is. Behaviour first (JSX, `use` prefix, HTTP calls),
 * folder conventions second — a component in `pages/` is a page, but a helper
 * in `pages/` that renders nothing is not.
 */
export function classifyUiElement(
  declaration: ParsedFunction,
  filePath: string,
  routedComponents: ReadonlyMap<string, string> = new Map(),
): ArchitectureNodeRole | undefined {
  const folderRole = matchFolderRole(filePath);

  // A value built by a call is shared state only when the factory says so;
  // `export const api = onRequest(...)` is not a store.
  if (declaration.factory && STATE_FACTORIES.has(declaration.factory)) {
    return declaration.factory === 'createContext' ? 'context-provider' : 'store';
  }

  if (/^use[A-Z]/.test(declaration.name)) {
    return 'hook';
  }

  if (declaration.returnsJsx) {
    if (routedComponents.has(declaration.name)) {
      return 'page';
    }
    if (/Provider$/.test(declaration.name)) {
      return 'context-provider';
    }
    if (/Layout$/.test(declaration.name)) {
      return 'layout';
    }
    // A page owns its file: `pages/Login.tsx` exports `Login`. Helpers that
    // happen to live in the same folder (`pages/settings/primitives.tsx`) are
    // components, not pages.
    if (folderRole === 'page' && declaration.isExported && matchesFileName(declaration.name, filePath)) {
      return 'page';
    }
    return 'component';
  }

  if (declaration.httpCalls.length > 0) {
    return 'api-client';
  }

  // An exported function in a data folder is part of the data access seam even
  // when the request itself happens one call deeper.
  if (folderRole === 'api-client' && declaration.isExported) {
    return 'api-client';
  }

  return undefined;
}

/** `pages/Login.tsx` ↔ `Login`, ignoring case and separators. */
function matchesFileName(name: string, filePath: string): boolean {
  const base = (filePath.split('/').pop() ?? '').replace(/\.[jt]sx?$/, '');
  const normalize = (value: string): string => value.replace(/[-_.]/g, '').toLowerCase();
  return normalize(base) === normalize(name) || normalize(base) === 'index';
}

function matchFolderRole(filePath: string): ArchitectureNodeRole | undefined {
  const segments = filePath.split('/').slice(0, -1);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index].toLowerCase();
    const match = FOLDER_ROLES.find(([folder]) => folder === segment);
    if (match) {
      return match[1];
    }
  }
  return undefined;
}

/**
 * Groups UI files into feature modules from the folder they live in, so a
 * front-end still has a bird's-eye view. `apps/web/src/app/pages/Overview.tsx`
 * belongs to the `pages` feature.
 */
export function featureFolder(filePath: string, projectRoot: string): string | undefined {
  const relative = projectRoot && filePath.startsWith(`${projectRoot}/`)
    ? filePath.slice(projectRoot.length + 1)
    : filePath;

  const segments = relative.split('/').slice(0, -1);
  const meaningful = segments.filter((segment) => !CONVENTIONAL_ROOTS.has(segment.toLowerCase()));

  return meaningful[0];
}

const CONVENTIONAL_ROOTS = new Set(['src', 'app', 'source']);
