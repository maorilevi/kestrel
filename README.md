# KESTREL

**An AI-native, architecture-first development platform.**

Build a product with AI the way an architect sees it: from above. KESTREL keeps
one live model of the system, the **system graph**, and puts development,
DevOps, production monitoring and product analytics on top of it as overlays.
You change the system by selecting parts of the architecture and telling an
agent what you want. The graph shows what will change, what shipped, and how
it behaves in production.

| Overlay | What lands on the graph | Source |
| --- | --- | --- |
| Code | applications, modules, services, endpoints, entities, data flow | AST analysis (`@kestrel/core`) |
| Infra / DevOps | where each application runs, pipelines, environments | Docker, compose, k8s, Terraform, CI |
| Production | latency, error rate, throughput, live traces | OpenTelemetry, Sentry |
| Product | analytics events on pages and endpoints, funnels | PostHog, Segment |

Two ways in, one canvas: founders start from a prompt or a template
(greenfield), and teams connect an existing GitHub repository (brownfield).

## Repository layout

```
packages/core       @kestrel/core      deterministic architecture engine + the kestrel-scan CLI a sandbox runs
packages/ai         @kestrel/ai        architecture-aware chat and coding-agent context
packages/protocol   @kestrel/protocol  typed messages between a host and the canvas, plus platform messages
packages/ui         @kestrel/ui        the canvas: graph, inspector, chat, settings (host-agnostic)
packages/sandbox    @kestrel/sandbox   project runtimes: local folders (development) and E2B (production)
apps/server         @kestrel/server    control plane: auth, organizations, projects, sandboxes, live channel
apps/web            @kestrel/web       Next.js app: landing, projects, workspace (canvas + preview + logs)
apps/extension      kestrel            VS Code extension, the first host (see its README)
templates/          starter projects a new project is created from
```

### How a project runs

```
browser ──HTTP /api──▶ Next.js (rewrite) ──▶ control plane ──▶ sandbox (local folder or E2B VM)
   │                                              │              ├─ npm run dev   → preview URL
   └──────────── WebSocket /ws/projects ──────────┘              └─ kestrel-scan --watch → graph (JSON lines)
```

The control plane never parses code itself: the scanner runs inside the sandbox
next to the code and streams graphs, which the channel forwards to the canvas.

### How an agent run works

1. You select components on the canvas and choose **Ask agent**, or just type a request.
2. The coding agent (`@kestrel/ai`, a streaming Messages API tool loop on `claude-opus-5`) gets the
   architecture brief and your focus, and works in the sandbox with list/read/write/edit/run tools.
3. Every step streams to everyone watching the project.
4. The run becomes one git commit, the scanner rebuilds the graph, and the canvas highlights what
   was added or changed. The latest run can be undone.

`@kestrel/core/model` and `@kestrel/protocol` are browser-safe. Everything that
needs Node (ts-morph, the file system) is reachable only from `@kestrel/core`.

## Development

```bash
npm install
npm run dev                 # control plane on :4000 + web app on :3000
npm run typecheck           # every workspace
npm test                    # every package's tests
npm run build:extension     # bundle the VS Code extension
npm run package:extension   # produce the VSIX
```

`npm run dev` works with no configuration: SQLite under `apps/server/data`, a
generated auth secret, and the **local** sandbox provider, which runs project
code on your machine without isolation. Copy `apps/server/.env.example` to
`apps/server/.env` to configure it; set `ANTHROPIC_API_KEY` for the
architecture chat, and `SANDBOX_PROVIDER=e2b` with `E2B_API_KEY` for isolated
sandboxes. Production requires `BETTER_AUTH_SECRET`, a Postgres
`DATABASE_URL` and E2B; the server refuses to start in production otherwise.

## Roadmap

| Milestone | Outcome |
| --- | --- |
| **M0 Foundations** | Monorepo, headless engine, host-agnostic canvas *(done)* |
| **M1 Web shell** | Sign in, create from template or import from GitHub, sandbox with live preview, live canvas *(done)* |
| **M2 Agent loop** | Prompt or graph selection → agent in the sandbox → commit + architecture diff on the canvas, undo *(done; GitHub PRs next)* |
| **M3 Ship & observe** | One-click deploy, OpenTelemetry, production metrics and traces on the graph |
| **M4 Product & teams** | Analytics overlay, funnels, roles and permissions, growth assistant |

## License

MIT
