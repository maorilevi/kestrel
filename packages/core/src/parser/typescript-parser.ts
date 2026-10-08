import {
  ClassDeclaration,
  Node,
  ParameterDeclaration,
  Project,
  SourceFile,
  ts,
  type Decorator,
  type TypeNode,
} from 'ts-morph';

import { noopLogger, type Logger } from '../logger';
import type { ScannedFile } from '../scanner/repository-scanner';
import { readFunctions, readGlobalPrefix, readRoutes } from './function-reader';
import {
  baseTypeName,
  collectReferences,
  createDecoratorArgumentValue,
  leftMostIdentifier,
} from './decorator-utils';
import type {
  ParseResult,
  ParsedClass,
  ParsedConstructorParameter,
  ParsedDecorator,
  ParsedFile,
  ParsedImportBinding,
  ParsedMemberAccess,
  ParsedMethod,
} from './parsed-model';

const HTTP_METHOD_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head', 'All']);

/**
 * AST based TypeScript reader built on ts-morph.
 *
 * Only syntax is inspected (never the type checker) which keeps whole-repository
 * scans fast, and a failure in one file never aborts the run.
 */
export class TypeScriptParser {
  constructor(private readonly logger: Logger = noopLogger) {}

  /** Parses files discovered by a {@link RepositoryScanner}. */
  parse(files: readonly ScannedFile[]): ParseResult {
    const project = createProject();
    const byPath = new Map<string, ScannedFile>();
    const sourceFiles: SourceFile[] = [];
    const failures: ParseResult['failures'] = [];

    for (const file of files) {
      try {
        const sourceFile = project.addSourceFileAtPath(file.absolutePath);
        byPath.set(normalizePath(sourceFile.getFilePath()), file);
        sourceFiles.push(sourceFile);
      } catch (error) {
        failures.push({ filePath: file.relativePath, message: describeError(error) });
        this.logger.warn(`Could not read ${file.relativePath}: ${describeError(error)}`);
      }
    }

    const result = this.parseSourceFiles(sourceFiles, (sourceFile) => byPath.get(normalizePath(sourceFile.getFilePath())));
    result.failures.push(...failures);
    return result;
  }

  /**
   * Parses in-memory sources. Keys are treated as workspace relative paths.
   * Used by the unit tests and available to future non-VS Code front ends.
   */
  parseSources(sources: Record<string, string>, workspaceName = 'workspace'): ParseResult {
    const project = createProject({ inMemory: true });
    const sourceFiles: SourceFile[] = [];

    for (const [relativePath, content] of Object.entries(sources)) {
      sourceFiles.push(project.createSourceFile(`/${stripLeadingSlash(relativePath)}`, content, { overwrite: true }));
    }

    return this.parseSourceFiles(sourceFiles, (sourceFile) => ({
      absolutePath: sourceFile.getFilePath(),
      relativePath: stripLeadingSlash(sourceFile.getFilePath()),
      workspaceRoot: '/',
      workspaceName,
    }));
  }

  private parseSourceFiles(
    sourceFiles: readonly SourceFile[],
    describe: (sourceFile: SourceFile) => ScannedFile | undefined,
  ): ParseResult {
    const files: ParsedFile[] = [];
    const failures: ParseResult['failures'] = [];

    for (const sourceFile of sourceFiles) {
      const descriptor = describe(sourceFile);
      if (!descriptor) {
        continue;
      }

      try {
        files.push(this.parseSourceFile(sourceFile, descriptor, describe));
      } catch (error) {
        failures.push({ filePath: descriptor.relativePath, message: describeError(error) });
        this.logger.warn(`Skipped ${descriptor.relativePath}: ${describeError(error)}`);
        files.push({
          filePath: descriptor.relativePath,
          absolutePath: descriptor.absolutePath,
          workspaceName: descriptor.workspaceName,
          classes: [],
          functions: [],
          routes: [],
          imports: [],
          failed: true,
        });
      }
    }

    return { files, failures };
  }

  private parseSourceFile(
    sourceFile: SourceFile,
    descriptor: ScannedFile,
    describe: (sourceFile: SourceFile) => ScannedFile | undefined,
  ): ParsedFile {
    const imports = readImports(sourceFile, describe);
    const classes: ParsedClass[] = [];

    for (const declaration of sourceFile.getClasses()) {
      const name = declaration.getName();
      if (!name) {
        continue;
      }
      try {
        classes.push(readClass(declaration, name, descriptor));
      } catch (error) {
        this.logger.warn(`Skipped class ${name} in ${descriptor.relativePath}: ${describeError(error)}`);
      }
    }

    return {
      filePath: descriptor.relativePath,
      absolutePath: descriptor.absolutePath,
      workspaceName: descriptor.workspaceName,
      classes,
      functions: readFunctions(sourceFile),
      routes: readRoutes(sourceFile),
      imports,
      globalPrefix: readGlobalPrefix(sourceFile),
      failed: false,
    };
  }
}

function createProject(options: { inMemory?: boolean } = {}): Project {
  return new Project({
    useInMemoryFileSystem: options.inMemory === true,
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
    // ts-morph only allows skipping lib files on the in-memory file system.
    skipLoadingLibFiles: options.inMemory === true,
    compilerOptions: {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      allowJs: false,
      noResolve: false,
      experimentalDecorators: true,
      strict: false,
    },
  });
}

function readImports(
  sourceFile: SourceFile,
  describe: (sourceFile: SourceFile) => ScannedFile | undefined,
): ParsedImportBinding[] {
  const bindings: ParsedImportBinding[] = [];

  for (const declaration of sourceFile.getImportDeclarations()) {
    const moduleSpecifier = declaration.getModuleSpecifierValue();
    let resolvedFilePath: string | undefined;

    try {
      const target = declaration.getModuleSpecifierSourceFile();
      resolvedFilePath = target ? describe(target)?.relativePath : undefined;
    } catch {
      resolvedFilePath = undefined;
    }

    const push = (symbol: string, originalName: string): void => {
      bindings.push({ symbol, originalName, moduleSpecifier, resolvedFilePath });
    };

    const defaultImport = declaration.getDefaultImport();
    if (defaultImport) {
      push(defaultImport.getText(), 'default');
    }

    for (const named of declaration.getNamedImports()) {
      push(named.getAliasNode()?.getText() ?? named.getName(), named.getName());
    }
  }

  return bindings;
}

function readClass(declaration: ClassDeclaration, name: string, descriptor: ScannedFile): ParsedClass {
  const constructorParameters = readConstructorParameters(declaration);

  return {
    name,
    filePath: descriptor.relativePath,
    absolutePath: descriptor.absolutePath,
    line: declaration.getStartLineNumber(),
    isExported: declaration.isExported(),
    isAbstract: declaration.isAbstract(),
    decorators: declaration.getDecorators().map(readDecorator),
    constructorParameters,
    methods: readMethods(declaration),
    // Only classes that take dependencies can be using one, so the body walk is
    // skipped for everything else.
    memberAccess: constructorParameters.length > 0 ? readMemberAccess(declaration) : [],
    extends: declaration.getExtends()?.getExpression().getText(),
    implements: declaration.getImplements().map((node) => node.getExpression().getText()),
    workspaceName: descriptor.workspaceName,
  };
}

function readDecorator(decorator: Decorator): ParsedDecorator {
  const parsed: ParsedDecorator = {
    name: decorator.getName(),
    stringArguments: [],
    identifierArguments: [],
    properties: {},
  };

  if (!decorator.isDecoratorFactory()) {
    return parsed;
  }

  for (const argument of decorator.getArguments()) {
    if (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument)) {
      parsed.stringArguments.push(argument.getLiteralValue());
      continue;
    }

    if (Node.isArrayLiteralExpression(argument)) {
      const value = createDecoratorArgumentValue();
      collectReferences(argument, value);
      parsed.stringArguments.push(...value.strings);
      parsed.identifierArguments.push(...value.identifiers);
      continue;
    }

    if (Node.isIdentifier(argument)) {
      parsed.identifierArguments.push(argument.getText());
      continue;
    }

    if (Node.isObjectLiteralExpression(argument)) {
      for (const property of argument.getProperties()) {
        if (!Node.isPropertyAssignment(property)) {
          continue;
        }
        const value = createDecoratorArgumentValue();
        collectReferences(property.getInitializer(), value);
        parsed.properties[property.getName()] = value;
      }
    }
  }

  return parsed;
}

function readConstructorParameters(declaration: ClassDeclaration): ParsedConstructorParameter[] {
  const constructors = declaration.getConstructors();
  const implementation = constructors.find((ctor) => ctor.getBody() !== undefined) ?? constructors[0];
  if (!implementation) {
    return [];
  }

  return implementation.getParameters().map(readParameter);
}

/** Decorators that name the entity a persistence handle is bound to. */
const ENTITY_INJECT_DECORATORS = new Set([
  'InjectRepository',
  'InjectModel',
  'InjectEntityManager',
  'InjectDataSource',
]);

function readParameter(parameter: ParameterDeclaration): ParsedConstructorParameter {
  const typeNode = parameter.getTypeNode();
  const typeText = typeNode?.getText();
  const decorators = parameter.getDecorators();

  let injectToken: string | undefined;
  let injectedClass: string | undefined;
  let injectedEntity: string | undefined;

  for (const decorator of decorators) {
    const name = decorator.getName();

    if (name === 'Inject') {
      const value = createDecoratorArgumentValue();
      for (const argument of decorator.getArguments()) {
        collectReferences(argument, value);
      }
      injectToken = value.strings[0] ?? value.identifiers[0];
      injectedClass = value.forwardRefs[0];
      continue;
    }

    if (ENTITY_INJECT_DECORATORS.has(name)) {
      // `@InjectRepository(User)` and `@InjectModel(User.name)` both name `User`.
      injectedEntity = decorator
        .getArguments()
        .map((argument) => leftMostIdentifier(argument))
        .find((value): value is string => value !== undefined);
    }
  }

  const isOptional =
    parameter.hasQuestionToken() || decorators.some((decorator) => decorator.getName() === 'Optional');

  return {
    name: parameter.getName(),
    typeName: injectedClass ?? baseTypeName(typeText),
    typeArguments: readTypeArguments(typeNode),
    typeText,
    isOptional,
    injectToken,
    injectedEntity,
  };
}

/** `Repository<User>` → `['User']`. Non-class type arguments are dropped. */
function readTypeArguments(typeNode: TypeNode | undefined): string[] {
  if (!typeNode || !Node.isTypeReference(typeNode)) {
    return [];
  }

  return typeNode
    .getTypeArguments()
    .map((argument) => baseTypeName(argument.getText()))
    .filter((value): value is string => value !== undefined);
}

/**
 * Collects `this.<member>.<property>` accesses in a class body.
 *
 * This is what turns "UsersService injects PrismaService" into "UsersService
 * reads and writes the User model": `this.prisma.user.findMany()` names the
 * model at the call site, and only the AST can tell that apart from a string.
 */
function readMemberAccess(declaration: ClassDeclaration): ParsedMemberAccess[] {
  const seen = new Set<string>();
  const accesses: ParsedMemberAccess[] = [];

  declaration.forEachDescendant((node) => {
    if (!Node.isPropertyAccessExpression(node)) {
      return;
    }
    const inner = node.getExpression();
    if (!Node.isPropertyAccessExpression(inner) || inner.getExpression().getKind() !== ts.SyntaxKind.ThisKeyword) {
      return;
    }

    const member = inner.getName();
    const property = node.getName();
    const key = `${member}.${property}`;
    if (!seen.has(key)) {
      seen.add(key);
      accesses.push({ member, property });
    }
  });

  return accesses;
}

function readMethods(declaration: ClassDeclaration): ParsedMethod[] {
  const methods: ParsedMethod[] = [];

  for (const method of declaration.getMethods()) {
    if (method.getScope() !== 'public') {
      continue;
    }

    const decorators = method.getDecorators().map((decorator) => decorator.getName());
    let route: string | undefined;

    for (const decorator of method.getDecorators()) {
      if (!HTTP_METHOD_DECORATORS.has(decorator.getName())) {
        continue;
      }
      const value = createDecoratorArgumentValue();
      for (const argument of decorator.getArguments()) {
        collectReferences(argument, value);
      }
      route = value.strings[0] ?? '';
    }

    methods.push({ name: method.getName(), line: method.getStartLineNumber(), decorators, route });
  }

  return methods;
}

function normalizePath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function stripLeadingSlash(filePath: string): string {
  return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
