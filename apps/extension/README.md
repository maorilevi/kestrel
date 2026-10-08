# KESTREL

**A bird's-eye view of your codebase.**

KESTREL is a VS Code extension that transforms your repository into an interactive architecture map.

Instead of understanding a system only through files and folders, KESTREL lets you explore modules, services, controllers and their relationships visually.

```
See the system → Understand relationships → Select architecture → Dive into code → Take action
```

---

## Product vision

Modern IDEs expose software through files, search results and text. KESTREL adds another navigation layer: **the architecture of the software itself**.

Longer term, KESTREL is meant to become a **visual control plane for AI coding agents**. Instead of telling an agent *"modify these six files"*, you select an architectural component and say *"refactor this"* — KESTREL supplies the architectural context automatically.

This first release focuses on the part that must be right before any of that is useful: **deterministic architecture discovery and visualization**.

---

## Current capabilities

- **Whole repository scan** of the open workspace (multi-root aware), skipping `node_modules`, `dist`, `build`, `out`, `coverage`, `.git`, declaration files and specs.
- **Application archetype** — what each application *is* at runtime: REST API, GraphQL API, Cloud Function, Lambda, Azure Function, Worker, CLI, SPA, SSR web app, static site, mobile app, desktop app, VS Code extension, test suite, library or workspace root — shown in the toolbar with the framework beside it (`REST API · NestJS`, `SPA · React`). A serverless runtime wins over the HTTP framework it embeds, and an inherited dependency can never name the archetype on its own.
- **Project detection** — is this a **backend API**, a **UI**, **fullstack**, or a library? Detected per `package.json`, so a monorepo is profiled per application (`apps/api` is an API on PostgreSQL while `apps/web` is a React UI), with the evidence behind every verdict shown in the UI.
- **Database detection** — engine *and* the library it is reached through (PostgreSQL via TypeORM, MongoDB via Mongoose, MySQL via Prisma, Redis as a cache…), from `package.json` drivers/ORMs, `TypeOrmModule.forRoot({ type })`, `prisma/schema.prisma` and `docker-compose` images.
- **Layer classification** — every component is placed in `presentation` / `business` / `data` / `infrastructure` / `shared`, derived from its role, name, base classes and folder. The dedicated **Layers view** shows the controller → service → repository → entity → database flow on its own.
- **AST analysis with ts-morph** — no regex parsing. Classes, decorators, imports, constructor parameters and decorated methods are read from the syntax tree.
- **NestJS detection**: `@Module` (imports / controllers / providers / exports, including `forwardRef` and `{ provide, useClass }` providers), `@Controller` with its route prefix and endpoints, injectable providers (`@Injectable`, `@Catch`, `@Resolver`, `@WebSocketGateway`, `@Processor`) and persisted models (`@Entity`, `@Schema`, `@Table`).
- **Dependency injection graph** from constructor parameters, including `@Inject('TOKEN')`.
- **Persistence graph** — `@InjectRepository(User)` / `Repository<User>` / `Model<User>` become `persists` edges to the entity, and entities are linked to the datastore they live in.
- **Front-end architecture** — React/Next code is read as architecture too: pages (with the route the router mounts them at), components, hooks, context providers and API clients, plus `renders` and `calls` edges between them and feature modules derived from the folder layout.
- **UI → API links** — a literal request path in front-end code (`api.get('/api/v1/traces')`) is matched against the controller that serves it, so a monorepo shows the client and the server in one graph.
- **Architecture style detection** — monorepo, client/server, modular monolith, layered, controller/service/model, repository pattern, clean/hexagonal, routed SPA, hooks-over-a-data-client, shared UI state — each with a confidence level and the counted evidence behind it.
- **Architecture feedback** — deterministic findings with a fix hint: circular dependencies, layer violations, controllers reading the database directly, god services, fat controllers, providers declared but never used, and reaching into a module's non-exported provider. Clicking a finding selects the nodes it is about.
- **Prisma data model** — `schema.prisma` is parsed into entity nodes (fields, mapped table, relations between models), and call sites such as `this.prisma.user.findMany()` connect each service to the models it actually touches. Opening a model jumps to its `model` block in the schema.
- **Data flow view** — trace how data actually moves: `Page → hook → API client → Controller → Service → model → PostgreSQL`, across the network boundary between applications. Only edges that carry data are followed (calls, injections, writes, model relations), the traced edges animate in the direction of the flow, and the inspector lists each path as clickable steps. Trace downstream, upstream, or both through any selection.
- **Answers that take you there** — a chat answer that names a component links to it, and **Show in graph** brings every component it mentioned on screen even when the current level was hiding them, then centres the viewport on them. **Trace data flow** turns an answer straight into a trace.
- **Architecture chat** — a permanent part of the panel, docked under the inspector and open from the moment KESTREL loads. It answers questions about the repository's structure. The architecture is assembled into the prompt automatically (applications, modules, layers, dependencies, datastores, findings), the current selection is added as focus, and answers stream back with component names as clickable links into the graph. Collapse it to its header to give the graph more room, drag the divider to resize it, and both choices are remembered between sessions. Backed by the Anthropic API — signed in through the Anthropic CLI, an `ANTHROPIC_API_KEY` in your environment, or a key stored in the OS keychain — or by any language model VS Code already has.
- **Architecture graph** with deterministic ids (`relative/path.ts#SymbolName`), de-duplicated nodes and edges.
- **Progressive dive**: bird's-eye overview → module → component, with breadcrumbs, plus layer and full-graph modes.
- **Interactive visualization**: React Flow with hierarchical (dagre) layout, zoom, pan, fit view, draggable nodes, multi-selection, minimap and search highlighting.
- **Node inspector**: type, role, layer, project, file, module, dependencies, used-by, reads/writes, contents, endpoints — with **Open File** jumping to the exact class.
- **Deterministic architecture checks**: circular dependency detection across injections and module imports (no AI involved).
- **Automatic refresh** on `**/*.{ts,tsx}` changes, debounced.
- **Activity bar overview**: detected projects (kind + databases), modules, controllers, services, entities, databases, dependencies, files scanned, detected issues.
- **KESTREL output channel** with a concise build log.

### Screenshots

> _Screenshots placeholder — run KESTREL on your own NestJS project and drop images here._
>
> - `docs/screenshot-overview.png` — bird's-eye module view
> - `docs/screenshot-module.png` — module dive with the inspector open

---

## Supported frameworks

| Stack | Architecture graph | Project & database detection |
| --- | --- | --- |
| NestJS | Full — modules, controllers, providers, DI, entities | Yes |
| Plain TypeScript | Partial — classes referenced by a module | Yes (reported as a library) |
| React (+ React Router) | Pages, components, hooks, stores, API clients | Yes |
| Next.js / Angular / Vue / Svelte | Partial — component detection is React shaped | Yes — detected and reported as a UI project |
| Express / Fastify / Koa / Hapi | Not yet | Yes — detected as an API project |

**Datastores recognised:** PostgreSQL, MySQL, MariaDB, SQLite, SQL Server, Oracle, CockroachDB, MongoDB, Redis, Elasticsearch, DynamoDB, Cassandra, Neo4j — through TypeORM, Prisma, Mongoose, Sequelize, MikroORM, Drizzle, Knex, Kysely or a raw driver.

---

## Installation

### From a local VSIX

From the repository root:

```bash
npm install
npm run package:extension   # writes apps/extension/kestrel-0.0.1.vsix
```

Then in VS Code: **Extensions → ... (menu) → Install from VSIX...** and pick `kestrel-0.0.1.vsix`.

---

## Local development

From the repository root:

```bash
npm install
npm run build:extension   # bundles the extension and the webview into apps/extension/dist/
```

Then press **F5** in VS Code (the `Run KESTREL Extension` launch configuration). This opens an **Extension Development Host** window. Open a NestJS project there and run:

```
KESTREL: Open Architecture
```

Useful scripts:

```bash
npm run watch -w kestrel    # esbuild watch for extension + webview
npm run typecheck           # strict tsc for every workspace
npm test                    # vitest — every package's tests
npm run package:extension   # produces apps/extension/kestrel-0.0.1.vsix
```

### Settings inside the panel

The gear in the toolbar opens KESTREL's own settings: the model provider,
which model answers, reasoning effort, request timeout, and the scanning
options. Every control writes the same configuration key the VS Code settings
editor would, so the two can never disagree — and the webview may only write a
fixed list of `kestrel.*` keys, never an arbitrary setting.

`KESTREL: Select Chat Model` offers the same choice from the command palette,
listing Anthropic models and the models your editor provides in one list, with
unusable ones marked.

### Icons

Both marks — the activity bar silhouette and the marketplace icon — are generated
from a single description of the bird in `apps/extension/media/generate-icons.js`, so they can
never drift apart:

```bash
npm i -D @resvg/resvg-js
node apps/extension/media/generate-icons.js ./preview apps/extension/media
```

The rasteriser is only needed to regenerate the artwork, never to build or run
the extension.

### Commands

| Command | ID |
| --- | --- |
| KESTREL: Open Architecture | `kestrel.openArchitecture` |
| KESTREL: Refresh Architecture | `kestrel.refreshArchitecture` |
| KESTREL: Sign in to Anthropic | `kestrel.signIn` |
| KESTREL: Set Anthropic API Key | `kestrel.setApiKey` |
| KESTREL: Test Chat Connection | `kestrel.testChat` |
| KESTREL: Select Chat Model | `kestrel.selectChatModel` |

### Settings

| Setting | Default | Description |
| --- | --- | --- |
| `kestrel.autoRefresh` | `true` | Rebuild the architecture when TypeScript files change |
| `kestrel.refreshDebounceMs` | `700` | Debounce window for file changes |
| `kestrel.exclude` | `[]` | Extra glob patterns to exclude from the scan |
| `kestrel.maxFiles` | `5000` | Safety limit per workspace folder |
| `kestrel.chat.provider` | `auto` | Which provider answers: `auto`, `anthropic`, `vscode` |
| `kestrel.chat.model` | `claude-opus-5` | Anthropic model used by the architecture chat |
| `kestrel.chat.vsCodeModel` | `` | Pinned VS Code model id; empty picks the best available |
| `kestrel.chat.effort` | `high` | How much reasoning an answer gets |
| `kestrel.chat.timeoutMs` | `120000` | How long to wait for an answer before giving up |

---

## Architecture overview

KESTREL keeps three models strictly separated:

```
Repository Model  →  Architecture Model  →  Visualization Model
   (scanner)           (parser + graph)        (React Flow)
```

The architecture graph is framework independent: it does not know about React Flow, and React Flow does not know about NestJS. That separation is what will let the same graph feed CLI tools, CI checks, GitHub integrations and coding agents later.

The engine, the AI layer, the message contract and the canvas are workspace
packages shared with the KESTREL web platform; this extension is one host of them.

```
packages/core/src/                   @kestrel/core: the architecture engine
  architecture.service.ts            scan → parse → detect → build → analyse
  model.ts                           browser-safe entry: model types + labels
  emitter.ts, logger.ts              framework-free ports
  models/                            ArchitectureNode / Edge / Graph (+ id helpers)
  scanner/
    repository-scanner.ts            scanning port + exclude rules
    fs-repository-scanner.ts         plain file system scanner (CLI, sandbox, CI)
  profile/                           project, archetype, layer and database detection
  parser/                            ts-morph AST, NestJS, UI, Prisma readers
  graph/                             graph builder, symbol index, route matching
  analysis/                          deterministic findings + architecture styles
  testing.ts                         in-memory fixtures shared by every package's tests
packages/ai/src/                     @kestrel/ai: chat context, providers, agent context
packages/protocol/src/               @kestrel/protocol: typed host ↔ canvas messages
packages/ui/src/                     @kestrel/ui: the canvas
  App.tsx                            state, message handling, level navigation
  mount.tsx, main.tsx                mount API + VS Code webview entry
  host/host.ts                       pluggable host transport (VS Code, web)
  state/                             progressive dive, breadcrumbs, data flow
  components/                        graph, inspector, chat, toolbar, settings

apps/extension/src/                  this extension
  extension.ts                       activation, wiring, disposal
  vscode/
    vscode-repository-scanner.ts     VS Code workspace + manifest reading
    commands/                        open / refresh / open-file / agent context
    webview/kestrel-panel.ts         panel + typed message handling
    webview/html.ts                  CSP, nonce, asWebviewUri
    watchers/repository-watcher.ts   debounced FileSystemWatcher
    views/overview-tree.ts           activity bar overview
    output-logger.ts                 KESTREL OutputChannel
  chat/vscode-lm-provider.ts         VS Code language model provider
  agents/claude-code-adapter.ts      Claude Code integration (preview)
```

### Design decisions

- **Deterministic ids.** Nodes are identified by `relative/file/path.ts#SymbolName`, never by class name alone — two `PaymentService` classes in different folders stay distinct, and selection survives a rebuild.
- **One project per `package.json`.** Project kind, frameworks and databases are decided per manifest rather than per workspace, which is what makes a monorepo readable. Hoisted root dependencies are only inherited when a package declares no framework of its own, so the web app's React is never attributed to the API beside it.
- **Explainable detection.** Every verdict carries its evidence (`package.json: pg`, `TypeOrmModule.forRoot()`, `docker-compose.yml: postgres:16`) and is visible in the inspector and the activity bar. No AI is involved in any of it.
- **Layers from roles first, names second, folders last.** Folder hints are applied relative to the project root, so `apps/api/src/...` is not mistaken for an `api` layer folder.
- **Parsing runs in the extension host.** The webview receives a plain JSON graph; it never touches the file system, `ts-morph` or Node APIs.
- **Syntax-only AST reads.** The type checker is never invoked, which keeps whole-repository scans fast.
- **Failure isolation.** A malformed file is skipped and reported; the rest of the repository is still analysed.
- **Symbol resolution order.** Same file → import binding that resolves inside the workspace → globally unique class name. Anything else becomes an explicit `external` node instead of a guess.
- **No localhost server.** All communication uses VS Code webview message passing.
- **Three ways to connect, only one of which involves handling a secret.** KESTREL asks the Anthropic SDK to resolve credentials the way it normally does: a key stored in VS Code SecretStorage wins, then `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` from the environment. The panel reports which one it used. If neither is present it falls back to any language model VS Code itself provides — a GitHub Copilot subscription answers architecture questions with no Anthropic account at all. Anthropic ships no sign-in CLI, so there is nothing to log into from a terminal.
- **The chat never sees your source code.** Only the extracted architecture — names, types, relationships, file paths — is sent to a model, and only when you ask a question. The API key lives in VS Code SecretStorage (the OS keychain), never in settings and never in the webview; every request is made from the extension host.
- **The architecture brief is prompt-cached.** It is byte-identical between turns of a conversation (which is why it carries no timestamp), so follow-up questions are billed at a fraction of the first.
- **Webview security.** Strict CSP (`default-src 'none'`), per-render script nonce, `asWebviewUri` for every asset, `localResourceRoots` limited to `dist/webview`, no inline scripts, no Node integration. The webview sends *workspace relative* paths; the extension resolves them against the paths discovered by the last scan, so a crafted message cannot open arbitrary files.

---

## Current limitations

- The front-end reader is React shaped: components are functions returning JSX and routes come from `<Route path element>`. Next.js file-system routing and Angular/Vue templates are not read yet.
- A UI element is classified from behaviour first and folder convention second; something exported from a `pages/` folder that nothing renders and that owns its file is treated as a page even if it is really a widget.
- Backend graphs are NestJS only. Plain TypeScript projects produce an application node and a notice; classes are only surfaced when a module references them.
- Layer classification is heuristic. Roles are decisive, names and folders are hints — a service that is really a repository but named `FooService` in `src/` lands in the business layer. The layer is always visible in the inspector so it can be sanity-checked.
- Database detection is static: it reports the engines a project is *wired* to, not connections opened at runtime from configuration it cannot see. An ORM configured entirely through `forRootAsync` with no driver dependency is reported as `Database (<ORM>)`.
- Prisma call sites are matched on `this.<handle>.<model>`; a delegate reached through a local variable or a generic wrapper falls back to a link to the database rather than to a specific model.
- `persists` edges say "reads and/or writes"; KESTREL does not yet analyse method bodies to separate reads from writes.
- Path aliases (`tsconfig` `paths`) are not resolved. Imports that miss fall back to a globally unique class name, or become `external` nodes.
- Providers declared only through factories (`useFactory`) are represented by their token, not by the produced class.
- Every injectable is rendered as a `service` node; the finer role (repository, guard, strategy, resolver, ...) is detected and drives the layer and the inspector, but does not yet get its own node type.
- File changes trigger a full rebuild (debounced). Incremental updates are not implemented yet, though the engine is structured for them.
- Dynamic modules (`SomeModule.forRoot()`) are attributed to the module class they are called on.
- The `Ask Claude` action is a preview: it copies the architectural context to the clipboard for pasting into an agent. There is no automated agent execution yet.
- Findings use fixed thresholds (a service is "god" past 8 dependencies); they are not configurable yet.
- Style detection reports what the code looks like, not whether it is the right choice.

---

## Roadmap

- **Framework coverage** — Next.js file routing, Angular, Vue, Express, Fastify, and generic TypeScript module graphs.
- **Configurable rules** — thresholds and per-project layer policies, enforceable in CI.
- **Richer node types** — promote repositories, guards, gateways and queues to first class nodes.
- **Reads vs writes** — analyse repository call sites so `persists` splits into `reads` and `writes`.
- **Incremental rebuilds** — re-parse only changed files instead of the whole workspace.
- **Deeper analysis** — high coupling, god services, unused providers, cross-domain dependencies, layer violations.
- **Architecture diff** — show how a branch changes the architecture, not just the files.
- **Agent actions** — Explain, Refactor, Add feature, Generate tests, Find problems, driven from a selection.
- **Visual architecture editing** — draw a dependency and let an agent implement it following the project's existing conventions.
- **Multi-selection prompts** — select several components and ask "can this architecture be simplified?".
- **CI integration** — validate architecture rules from the same graph.

---

## License

MIT
