import {
  Node,
  type ArrowFunction,
  type FunctionDeclaration,
  type FunctionExpression,
  type SourceFile,
} from 'ts-morph';

import type { ParsedFunction, ParsedHttpCall, ParsedRoute } from './parsed-model';

type FunctionLike = FunctionDeclaration | ArrowFunction | FunctionExpression;

/** Call names that prove on their own that a request is being made. */
const HTTP_CALLEES = new Set([
  'fetch',
  'request',
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'del',
  'head',
  'options',
]);

/** Factories that create shared state rather than a component. */
export const STATE_FACTORIES: ReadonlySet<string> = new Set([
  'createContext',
  'createSlice',
  'createStore',
  'configureStore',
  'create',
  'atom',
  'atomWithStorage',
  'proxy',
  'signal',
  'writable',
  'readable',
  'createSignal',
]);

/**
 * Reads the top level functions of a file: components, hooks, stores and API
 * clients all live here rather than in classes.
 *
 * One AST pass per declaration; nothing is inferred from file text.
 */
export function readFunctions(sourceFile: SourceFile): ParsedFunction[] {
  const functions: ParsedFunction[] = [];

  for (const declaration of sourceFile.getFunctions()) {
    const name = declaration.getName();
    if (name) {
      functions.push(readFunction(name, declaration, declaration.isExported(), declaration.getStartLineNumber()));
    }
  }

  for (const statement of sourceFile.getVariableStatements()) {
    const isExported = statement.isExported();
    for (const declaration of statement.getDeclarations()) {
      const initializer = declaration.getInitializer();
      if (!initializer) {
        continue;
      }

      const line = declaration.getStartLineNumber();
      const name = declaration.getName();

      if (Node.isArrowFunction(initializer) || Node.isFunctionExpression(initializer)) {
        functions.push(readFunction(name, initializer, isExported, line));
        continue;
      }

      // `export const api = { me: () => request('/api/v1/me'), ... }` — an API
      // client is usually an object of small arrow functions, not a function.
      if (Node.isObjectLiteralExpression(initializer)) {
        const collected = collectFrom(initializer);
        if (collected.httpCalls.length > 0 || collected.calls.length > 0) {
          functions.push({
            name,
            line,
            isExported,
            returnsJsx: collected.returnsJsx,
            jsxTags: collected.jsxTags,
            calls: collected.calls,
            httpCalls: collected.httpCalls,
          });
        }
        continue;
      }

      // A value produced by a call: `const Ctx = createContext(null)`, but also
      // `export const api = onRequest(...)` — the shape every serverless entry
      // point takes. The factory name is what identifies which it is.
      if (Node.isCallExpression(initializer)) {
        const factory = calleeName(initializer);
        if (factory) {
          const collected = collectFrom(initializer);
          functions.push({
            name,
            line,
            isExported,
            returnsJsx: collected.returnsJsx,
            jsxTags: collected.jsxTags,
            calls: [factory, ...collected.calls.filter((call) => call !== factory)],
            httpCalls: collected.httpCalls,
            factory,
          });
        }
      }
    }
  }

  return functions;
}

/** Reads `<Route path="/x" element={<Y />} />` declarations anywhere in a file. */
export function readRoutes(sourceFile: SourceFile): ParsedRoute[] {
  const routes: ParsedRoute[] = [];

  sourceFile.forEachDescendant((node) => {
    let attributes: ReturnType<typeof getAttributes> | undefined;

    if (Node.isJsxSelfClosingElement(node) && node.getTagNameNode().getText() === 'Route') {
      attributes = getAttributes(node.getAttributes());
    } else if (Node.isJsxOpeningElement(node) && node.getTagNameNode().getText() === 'Route') {
      attributes = getAttributes(node.getAttributes());
    }

    if (attributes && (attributes.path !== undefined || attributes.component !== undefined)) {
      routes.push({
        path: attributes.path ?? '',
        component: attributes.component,
        line: node.getStartLineNumber(),
      });
    }
  });

  return routes;
}

function getAttributes(attributes: ReturnType<JsxLike['getAttributes']>): {
  path?: string;
  component?: string;
} {
  const result: { path?: string; component?: string } = {};

  for (const attribute of attributes) {
    if (!Node.isJsxAttribute(attribute)) {
      continue;
    }
    const name = attribute.getNameNode().getText();
    const initializer = attribute.getInitializer();
    if (!initializer) {
      continue;
    }

    if (name === 'path' && Node.isStringLiteral(initializer)) {
      result.path = initializer.getLiteralValue();
      continue;
    }

    if ((name === 'element' || name === 'component') && Node.isJsxExpression(initializer)) {
      const expression = initializer.getExpression();
      if (expression && Node.isJsxSelfClosingElement(expression)) {
        result.component = expression.getTagNameNode().getText();
      } else if (expression && Node.isJsxElement(expression)) {
        result.component = expression.getOpeningElement().getTagNameNode().getText();
      } else if (expression && Node.isIdentifier(expression)) {
        result.component = expression.getText();
      }
    }
  }

  return result;
}

interface JsxLike {
  getAttributes(): Node[];
}

function readFunction(
  name: string,
  declaration: FunctionLike,
  isExported: boolean,
  line: number,
): ParsedFunction {
  const collected = collectFrom(declaration);
  return {
    name,
    line,
    isExported,
    returnsJsx: collected.returnsJsx,
    jsxTags: collected.jsxTags,
    calls: collected.calls,
    httpCalls: collected.httpCalls,
  };
}

interface CollectedBody {
  returnsJsx: boolean;
  jsxTags: string[];
  calls: string[];
  httpCalls: ParsedHttpCall[];
}

/** Single AST pass collecting everything the UI model needs from a body. */
function collectFrom(root: Node): CollectedBody {
  const jsxTags = new Set<string>();
  const calls = new Set<string>();
  const httpCalls: ParsedHttpCall[] = [];
  let returnsJsx = false;

  root.forEachDescendant((node) => {
    if (Node.isJsxSelfClosingElement(node) || Node.isJsxOpeningElement(node)) {
      returnsJsx = true;
      const tag = node.getTagNameNode().getText();
      // Lower-cased tags are DOM elements, not architecture.
      if (/^[A-Z]/.test(tag.split('.')[0]) || tag.includes('.')) {
        jsxTags.add(lastSegment(tag));
      }
      return;
    }

    if (Node.isJsxFragment(node)) {
      returnsJsx = true;
      return;
    }

    if (Node.isCallExpression(node)) {
      const callee = calleeName(node);
      if (!callee) {
        return;
      }
      calls.add(callee);

      const path = literalPath(node);
      if (path) {
        httpCalls.push({
          method: httpMethod(callee),
          path,
          receiver: receiverName(node),
          confident: HTTP_CALLEES.has(callee),
        });
      }
    }
  });

  return { returnsJsx, jsxTags: [...jsxTags], calls: [...calls], httpCalls };
}

/** `S.OrganizationSection` → `OrganizationSection`. */
function lastSegment(tag: string): string {
  const segments = tag.split('.');
  return segments[segments.length - 1];
}

/** `api.get(...)` → `api`. */
function receiverName(call: Node): string | undefined {
  if (!Node.isCallExpression(call)) {
    return undefined;
  }
  const expression = call.getExpression();
  if (Node.isPropertyAccessExpression(expression)) {
    const target = expression.getExpression();
    return Node.isIdentifier(target) ? target.getText() : undefined;
  }
  return undefined;
}

/** `api.get(...)` → `get`, `fetch(...)` → `fetch`. */
function calleeName(call: Node): string | undefined {
  if (!Node.isCallExpression(call)) {
    return undefined;
  }
  const expression = call.getExpression();
  if (Node.isIdentifier(expression)) {
    return expression.getText();
  }
  if (Node.isPropertyAccessExpression(expression)) {
    return expression.getName();
  }
  return undefined;
}

/**
 * First argument that looks like a request path. Template literals are read
 * through their static text so `` `${API_URL}/api/v1/traces` `` still resolves.
 */
function literalPath(call: Node): string | undefined {
  if (!Node.isCallExpression(call)) {
    return undefined;
  }

  for (const argument of call.getArguments()) {
    if (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument)) {
      const value = argument.getLiteralValue();
      if (looksLikePath(value)) {
        return normalizePath(value);
      }
      continue;
    }

    if (Node.isTemplateExpression(argument)) {
      const text = [
        argument.getHead().getLiteralText(),
        ...argument.getTemplateSpans().map((span) => span.getLiteral().getLiteralText()),
      ].join('{}');
      if (looksLikePath(text)) {
        return normalizePath(text);
      }
    }
  }

  return undefined;
}

function looksLikePath(value: string): boolean {
  return /^\/[\w{}\-./:]*$/.test(value) || value.startsWith('http');
}

/** Drops the origin and the query string, keeping the route path. */
function normalizePath(value: string): string {
  const withoutOrigin = value.replace(/^https?:\/\/[^/]*/, '');
  const withoutQuery = withoutOrigin.split('?')[0].split('#')[0];
  return withoutQuery.length === 0 ? '/' : withoutQuery;
}

function httpMethod(callee: string): string {
  switch (callee) {
    case 'get':
    case 'post':
    case 'put':
    case 'patch':
    case 'head':
    case 'options':
      return callee.toUpperCase();
    case 'delete':
    case 'del':
      return 'DELETE';
    default:
      return 'ANY';
  }
}
