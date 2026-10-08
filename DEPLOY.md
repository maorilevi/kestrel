# Deploying KESTREL (private beta)

The platform runs as two Fly.io apps, plus two external services:

| Piece | Where | Notes |
| --- | --- | --- |
| Control plane (`apps/server`) | Fly app `kestrel-server` | One machine, always on: projects, agent runs and channels live in memory |
| Web app (`apps/web`) | Fly app `kestrel-web` | Proxies `/api` to the control plane; the browser opens WebSockets to it directly |
| Database | Neon (Postgres) | Users, organizations, projects, agent runs |
| Sandboxes | E2B | One VM per project, paused when idle and resumed on the next visit |
| Models | Anthropic API | The coding agent and the architecture chat |

Commands below run from the repository root, in PowerShell.

## 1. Accounts and keys

- **Fly.io**: sign up at fly.io and add a payment method.
- **E2B**: sign up at e2b.dev and create an API key.
- **Neon**: create a project at neon.tech and copy its connection string (`postgresql://…?sslmode=require`).
- **Anthropic**: an API key from console.anthropic.com.

## 2. Build the sandbox image (once)

```powershell
$env:E2B_API_KEY = "e2b_..."
npm run e2b:template -w @kestrel/sandbox
```

This creates the `kestrel-node` template (Node 24, npm, git) in your E2B account. Run it again
only when `packages/sandbox/e2b/template.ts` changes.

## 3. Install flyctl and sign in

```powershell
iwr https://fly.io/install.ps1 -useb | iex
fly auth login
```

## 4. Create the apps

```powershell
fly apps create kestrel-server
fly apps create kestrel-web
```

App names are global. If one is taken, pick another name and update it everywhere it appears:
`app =` in both `fly.*.toml` files, `WEB_ORIGIN` / `BETTER_AUTH_URL` in `fly.server.toml`, and the
two build args in `fly.web.toml`.

## 5. Set the control plane's secrets

```powershell
$secret = -join ((1..32) | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) })
fly secrets set -c fly.server.toml `
  BETTER_AUTH_SECRET=$secret `
  DATABASE_URL="postgresql://...?sslmode=require" `
  E2B_API_KEY="e2b_..." `
  ANTHROPIC_API_KEY="sk-ant-..." `
  KESTREL_ALLOWED_EMAILS="you@example.com"
```

`KESTREL_ALLOWED_EMAILS` is the beta guest list: comma-separated addresses, or `@company.com` for a
whole domain. The server refuses to start in production without it.

## 6. Deploy

```powershell
fly deploy -c fly.server.toml --ha=false
fly deploy -c fly.web.toml --ha=false
```

`--ha=false` matters for the control plane: it keeps state in memory, so it must run as exactly
one machine. The database tables are created on the first start.

## 7. Check it

1. Open https://kestrel-web.fly.dev and sign up with an address from the guest list.
2. Create a project from the template. The first start takes a minute or two: E2B boots the VM
   and installs dependencies.
3. When it shows **Running**, try the preview, the canvas, and an agent request.

Logs: `fly logs -c fly.server.toml` and `fly logs -c fly.web.toml`.

## Everyday operations

- **Invite someone**: `fly secrets set -c fly.server.toml KESTREL_ALLOWED_EMAILS="a@x.com,b@y.com"`.
  Changing a secret restarts the control plane; running projects stop and start again when reopened,
  and their sandboxes and code are kept.
- **Deploy a new version**: the two `fly deploy` commands again.
- **Costs to watch**: E2B bills running sandboxes (projects stop 10 minutes after the last viewer
  leaves, and E2B pauses them 15 minutes after that), and Anthropic bills agent and chat tokens.

## Known limits of the beta

- A project's code lives in its E2B sandbox; pushing to GitHub is not built yet.
- No email verification or password reset yet: guests are trusted addresses.
- One control-plane machine: a deploy or restart briefly disconnects open workspaces, and they
  reconnect by themselves.
