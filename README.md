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
packages/core       @kestrel/core      deterministic architecture engine (scan → parse → profile → graph → analyse)
packages/ai         @kestrel/ai        architecture-aware chat and coding-agent context
packages/protocol   @kestrel/protocol  typed messages between a host and the canvas
packages/ui         @kestrel/ui        the canvas: graph, inspector, chat, settings
apps/extension      kestrel            VS Code extension, the first host (see its README)
```

`@kestrel/core/model` and `@kestrel/protocol` are browser-safe. Everything that
needs Node (ts-morph, the file system) is reachable only from `@kestrel/core`.

## Development

```bash
npm install
npm run typecheck           # every workspace
npm test                    # every package's tests
npm run build:extension     # bundle the VS Code extension
npm run package:extension   # produce the VSIX
```

## Roadmap

| Milestone | Outcome |
| --- | --- |
| **M0 Foundations** | Monorepo, headless engine, host-agnostic canvas *(done)* |
| **M1 Web shell** | Sign in, create from template or import from GitHub, sandbox with live preview, live canvas |
| **M2 Agent loop** | Prompt or graph selection → agent in the sandbox → code diff + architecture diff → commit / PR |
| **M3 Ship & observe** | One-click deploy, OpenTelemetry, production metrics and traces on the graph |
| **M4 Product & teams** | Analytics overlay, funnels, roles and permissions, growth assistant |

## License

MIT
