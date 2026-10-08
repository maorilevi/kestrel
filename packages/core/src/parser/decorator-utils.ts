import { Node, type CallExpression, type Expression } from 'ts-morph';

import type { DecoratorArgumentValue, ParsedCallReference } from './parsed-model';

export function createDecoratorArgumentValue(): DecoratorArgumentValue {
  return { identifiers: [], strings: [], forwardRefs: [], calls: [] };
}

/**
 * Collects the class references and string literals contained in a decorator
 * argument expression.
 *
 * Handles the shapes that appear in real NestJS modules:
 *   - `AuthService`                          → identifier
 *   - `[A, B]`                               → array
 *   - `forwardRef(() => UsersModule)`        → forward reference
 *   - `ConfigModule.forRoot({...})`          → the module the call belongs to
 *   - `{ provide: TOKEN, useClass: Impl }`   → the implementation class
 *   - `'users'`                              → string literal
 */
export function collectReferences(
  expression: Expression | Node | undefined,
  out: DecoratorArgumentValue,
  insideForwardRef = false,
): void {
  if (!expression) {
    return;
  }

  if (Node.isArrayLiteralExpression(expression)) {
    for (const element of expression.getElements()) {
      collectReferences(element, out, insideForwardRef);
    }
    return;
  }

  if (Node.isStringLiteral(expression) || Node.isNoSubstitutionTemplateLiteral(expression)) {
    pushUnique(out.strings, expression.getLiteralValue());
    return;
  }

  if (Node.isIdentifier(expression)) {
    pushUnique(out.identifiers, expression.getText());
    if (insideForwardRef) {
      pushUnique(out.forwardRefs, expression.getText());
    }
    return;
  }

  if (Node.isPropertyAccessExpression(expression)) {
    // `ConfigModule.forRoot` → keep the left-most identifier.
    collectReferences(expression.getExpression(), out, insideForwardRef);
    return;
  }

  if (Node.isCallExpression(expression)) {
    const callee = expression.getExpression();
    if (Node.isIdentifier(callee) && callee.getText() === 'forwardRef') {
      for (const argument of expression.getArguments()) {
        if (Node.isArrowFunction(argument) || Node.isFunctionExpression(argument)) {
          const body = argument.getBody();
          collectReferences(body, out, true);
        } else {
          collectReferences(argument, out, true);
        }
      }
      return;
    }
    if (Node.isPropertyAccessExpression(callee)) {
      // `TypeOrmModule.forRoot({...})` / `TypeOrmModule.forFeature([User])`
      const reference = readCallReference(expression, callee.getName());
      if (reference) {
        out.calls.push(reference);
      }
    }

    collectReferences(callee, out, insideForwardRef);
    return;
  }

  if (Node.isObjectLiteralExpression(expression)) {
    // Custom providers: prefer the implementation over the injection token.
    for (const key of ['useClass', 'useExisting', 'provide']) {
      const property = expression.getProperty(key);
      if (property && Node.isPropertyAssignment(property)) {
        collectReferences(property.getInitializer(), out, insideForwardRef);
        return;
      }
    }
    return;
  }

  if (Node.isSpreadElement(expression)) {
    collectReferences(expression.getExpression(), out, insideForwardRef);
    return;
  }

  if (
    Node.isAsExpression(expression) ||
    Node.isParenthesizedExpression(expression) ||
    Node.isNonNullExpression(expression) ||
    Node.isTypeAssertion(expression)
  ) {
    collectReferences(expression.getExpression(), out, insideForwardRef);
    return;
  }

  if (Node.isBlock(expression)) {
    // `forwardRef(() => { return UsersModule; })`
    for (const statement of expression.getStatements()) {
      if (Node.isReturnStatement(statement)) {
        collectReferences(statement.getExpression(), out, insideForwardRef);
      }
    }
  }
}

/**
 * Reads a configuration call such as `TypeOrmModule.forRoot({ type: 'postgres' })`.
 * Only literal values are captured — anything computed at runtime is ignored.
 */
function readCallReference(expression: CallExpression, method: string): ParsedCallReference | undefined {
  const callee = leftMostIdentifier(expression.getExpression());
  if (!callee) {
    return undefined;
  }

  const reference: ParsedCallReference = {
    callee,
    method,
    identifierArguments: [],
    stringArguments: [],
    stringOptions: {},
  };

  for (const argument of expression.getArguments()) {
    if (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument)) {
      reference.stringArguments.push(argument.getLiteralValue());
      continue;
    }

    if (Node.isArrayLiteralExpression(argument)) {
      for (const element of argument.getElements()) {
        const identifier = leftMostIdentifier(element);
        if (identifier) {
          reference.identifierArguments.push(identifier);
        }
      }
      continue;
    }

    if (Node.isIdentifier(argument)) {
      reference.identifierArguments.push(argument.getText());
      continue;
    }

    if (Node.isObjectLiteralExpression(argument)) {
      for (const property of argument.getProperties()) {
        if (!Node.isPropertyAssignment(property)) {
          continue;
        }
        const initializer = property.getInitializer();
        if (
          initializer &&
          (Node.isStringLiteral(initializer) || Node.isNoSubstitutionTemplateLiteral(initializer))
        ) {
          reference.stringOptions[property.getName()] = initializer.getLiteralValue();
        }
      }
    }
  }

  return reference;
}

/** `User.name` → `User`, `User` → `User`, anything else → undefined. */
export function leftMostIdentifier(expression: Node | undefined): string | undefined {
  if (!expression) {
    return undefined;
  }
  if (Node.isIdentifier(expression)) {
    return expression.getText();
  }
  if (Node.isPropertyAccessExpression(expression)) {
    return leftMostIdentifier(expression.getExpression());
  }
  if (Node.isCallExpression(expression)) {
    return leftMostIdentifier(expression.getExpression());
  }
  return undefined;
}

const PRIMITIVE_TYPE_NAMES = new Set([
  'string',
  'number',
  'boolean',
  'bigint',
  'symbol',
  'any',
  'unknown',
  'never',
  'void',
  'null',
  'undefined',
  'object',
  'Date',
  'Array',
  'Promise',
  'Map',
  'Set',
  'Record',
  'Function',
  'Buffer',
]);

/**
 * Reduces a type annotation to a single referenceable class name.
 * Returns `undefined` for unions, primitives, literals and anonymous types.
 */
export function baseTypeName(typeText: string | undefined): string | undefined {
  if (!typeText) {
    return undefined;
  }

  const genericIndex = typeText.indexOf('<');
  const head = (genericIndex >= 0 ? typeText.slice(0, genericIndex) : typeText).trim();

  if (head.length === 0 || /[|&(){}[\]'"`=>]/.test(head)) {
    return undefined;
  }

  const segments = head.split('.');
  const name = segments[segments.length - 1];

  if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
    return undefined;
  }

  if (PRIMITIVE_TYPE_NAMES.has(name)) {
    return undefined;
  }

  // Injected dependencies are classes; a lower-cased head is a primitive alias.
  if (name[0] === name[0].toLowerCase()) {
    return undefined;
  }

  return name;
}

function pushUnique(target: string[], value: string): void {
  if (!target.includes(value)) {
    target.push(value);
  }
}
