/**
 * Language level model produced by the TypeScript parser.
 *
 * This layer is deliberately framework agnostic: it describes *TypeScript*
 * (classes, decorators, constructor parameters, imports) and knows nothing
 * about NestJS. Framework detection happens one layer up.
 */

/**
 * A configuration call found inside a decorator argument, such as
 * `TypeOrmModule.forRoot({ type: 'postgres' })` or `forFeature([User])`.
 * Framework agnostic: the NestJS layer decides what the values mean.
 */
export interface ParsedCallReference {
  /** Left-most identifier of the callee, e.g. `TypeOrmModule`. */
  callee: string;
  /** Called member, e.g. `forRoot`. */
  method: string;
  /** Identifier arguments, e.g. `[User, Order]` for `forFeature`. */
  identifierArguments: string[];
  /** String literal arguments, e.g. a connection string. */
  stringArguments: string[];
  /** String valued properties of an options object, e.g. `{ type: 'postgres' }`. */
  stringOptions: Record<string, string>;
}

export interface DecoratorArgumentValue {
  /** Identifiers referenced by the argument, e.g. `AuthService`. */
  identifiers: string[];
  /** String literals contained in the argument, e.g. `'users'`. */
  strings: string[];
  /** Identifiers that were wrapped in `forwardRef(() => X)`. */
  forwardRefs: string[];
  /** Configuration calls, e.g. `TypeOrmModule.forRoot({...})`. */
  calls: ParsedCallReference[];
}

export interface ParsedDecorator {
  name: string;
  /** Top level string arguments, e.g. `@Controller('users')`. */
  stringArguments: string[];
  /** Top level identifier arguments, e.g. `@Catch(HttpException)`. */
  identifierArguments: string[];
  /** Properties of a top level object argument, e.g. `@Module({ ... })`. */
  properties: Record<string, DecoratorArgumentValue>;
}

export interface ParsedConstructorParameter {
  name: string;
  /** Base type name with generics stripped, e.g. `Repository` for `Repository<User>`. */
  typeName?: string;
  /** Type arguments, e.g. `['User']` for `Repository<User>`. */
  typeArguments: string[];
  /** Raw type text as written in the source. */
  typeText?: string;
  isOptional: boolean;
  /** Token passed to `@Inject('TOKEN')`, if any. */
  injectToken?: string;
  /** Class named by `@InjectRepository(User)` / `@InjectModel(User.name)`. */
  injectedEntity?: string;
}

/**
 * A `this.<member>.<property>` access somewhere in a class body.
 * Framework agnostic; the graph layer decides which member is a database
 * handle and what the property means.
 */
export interface ParsedMemberAccess {
  member: string;
  property: string;
}

export interface ParsedMethod {
  name: string;
  line: number;
  decorators: string[];
  route?: string;
}

export interface ParsedClass {
  name: string;
  /** Workspace relative posix path of the declaring file. */
  filePath: string;
  absolutePath: string;
  /** 1-based line of the class declaration. */
  line: number;
  isExported: boolean;
  isAbstract: boolean;
  decorators: ParsedDecorator[];
  constructorParameters: ParsedConstructorParameter[];
  methods: ParsedMethod[];
  /** `this.x.y` accesses, collected for classes that take dependencies. */
  memberAccess: ParsedMemberAccess[];
  extends?: string;
  implements: string[];
  workspaceName: string;
}

export interface ParsedImportBinding {
  /** Local name of the binding. */
  symbol: string;
  /** Original exported name when the import is aliased. */
  originalName: string;
  moduleSpecifier: string;
  /** Workspace relative path of the resolved module, when it lives in the workspace. */
  resolvedFilePath?: string;
}

/** A call with a literal request path, e.g. `api.get('/api/v1/overview')`. */
export interface ParsedHttpCall {
  method: string;
  path: string;
  /** Object the method was called on, e.g. `api` in `api.get(...)`. */
  receiver?: string;
  /**
   * True when the callee itself proves this is HTTP (`fetch`, `axios.get`).
   * Otherwise the caller has to establish that the receiver is an API client —
   * `navigate('/traces')` must not be mistaken for a request.
   */
  confident: boolean;
}

/**
 * A top level function or arrow-function constant.
 *
 * Front-end code is written with functions rather than classes, so the UI
 * architecture is invisible without this.
 */
export interface ParsedFunction {
  name: string;
  line: number;
  isExported: boolean;
  /** True when the body produces JSX — the test for "this is a component". */
  returnsJsx: boolean;
  /** PascalCase JSX tags used in the body. */
  jsxTags: string[];
  /** Identifiers called in the body (hook and helper usage). */
  calls: string[];
  httpCalls: ParsedHttpCall[];
  /** Factory the value was created from, e.g. `createContext`, `create`. */
  factory?: string;
}

/** A `<Route path="/x" element={<Y />} />` declaration. */
export interface ParsedRoute {
  path: string;
  component?: string;
  line: number;
}

export interface ParsedFile {
  filePath: string;
  absolutePath: string;
  workspaceName: string;
  classes: ParsedClass[];
  functions: ParsedFunction[];
  routes: ParsedRoute[];
  imports: ParsedImportBinding[];
  /** True when the file could not be parsed completely. */
  failed: boolean;
}

export interface ParseResult {
  files: ParsedFile[];
  failures: Array<{ filePath: string; message: string }>;
}

export function findDecorator(cls: ParsedClass, name: string): ParsedDecorator | undefined {
  return cls.decorators.find((decorator) => decorator.name === name);
}

export function hasDecorator(cls: ParsedClass, name: string): boolean {
  return findDecorator(cls, name) !== undefined;
}
