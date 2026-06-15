# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## Commands

### Development

```bash
# Backend (NestJS)
cd server && npm install && npm run start:dev

# Frontend (React + Vite)
cd client && npm install && npm run dev

# Production (Docker Compose)
docker compose up --build -d
```

### Build

```bash
cd server && npm run build   # NestJS → dist/
cd client && npm run build   # Vite → dist/
```

### Lint

```bash
cd server && npm run lint
cd client && npm run lint
```

### Tests

```bash
cd server && npm run test          # unit tests (Jest, *.spec.ts)
cd server && npm run test:e2e      # e2e tests
cd server && npm run test:cov      # with coverage
cd server && npm run test -- --testPathPattern=app.controller  # run single test file
```

## Architecture

### Deployment

Single-server Docker Compose stack:
- `rwm-postgres` — PostgreSQL 18
- `rwm-backend` — NestJS on port 3000
- `rwm-frontend` — nginx serving React SPA on port 80; proxies `/api/*` and WebSocket `/api/terminal` to backend

### Backend (`server/src/`)

NestJS application. All routes are protected by a global `JwtAuthGuard` (`APP_GUARD`). Public routes use `@Public()` decorator.

**Modules:**
- `auth` — JWT login/logout, admin profile, `@Public()` decorator
- `settings` — universal JSON key-value store (`Setting` entity); all app state goes here
- `rotation` — scheduled inbound rotation (cron runs `EVERY_MINUTE`); 3 modes: `interval`, `schedule`, `days-of-week`; sends Telegram notifications on result
- `remnawave` — Remnawave panel API client (native `fetch`); reads `remnawave_url` + `remnawave_api_key` from settings at runtime each call
- `inbounds` — generates Xray inbound configs for: `vless-tcp-reality`, `vless-xhttp-reality`, `vless-grpc-reality`, `vless-ws`, `shadowsocks-tcp`, `trojan-tcp-reality`; also builds shareable proxy links (vless/vmess/ss/trojan)
- `domains` — SNI domain whitelist (`Domain` entity, separate DB table); used as random SNI pool during rotation
- `nodes` — SSH node installation wizard; creates the Remnawave node via API then runs Docker install over SSH; stores SSH credentials by calling `ScriptsService.addSshNodeFromInstall`
- `scripts` — SSH node registry + script runner; seeds built-in scripts on startup (`OnModuleInit`); job queue in memory; variable substitution `{{ name | label }}`; log masking
- `secrets` — AES-256-GCM encrypted secret store (stored in `settings` table as `secrets` key)
- `terminal` — WebSocket SSH terminal (`/api/terminal`); one-time ticket auth for popup mode
- `telegram` — Telegram Bot notifications (reads config from `settings` table at runtime)

**Rate limiting:** `ThrottlerGuard` is a global guard — 60 requests per minute per IP. Keep this in mind when writing e2e tests or scripts that hammer the API.

**Database:** Two TypeORM entities — `Setting` (key/value JSON) and `Domain`. TypeORM `synchronize: true` — schema auto-migrates on startup. Everything else serialised into `settings` rows.

**Encryption:** `SECRET_ENCRYPTION_KEY` env var (32-byte hex). Secrets stored as `enc:<iv>:<tag>:<ciphertext>` in AES-256-GCM. Missing key → plain text + warning log.

### Frontend (`client/src/`)

React 19 + Vite + MUI v7. Single-page app, all routes client-side. Detailed per-page state and API reference is in `FRONTEND.md`.

**MUI v7 note:** uses `slotProps` instead of the deprecated `InputProps`/`InputLabelProps`.

**Key files:**
- `api.ts` — axios instance with `baseURL: /api`; JWT token injected via `Authorization: Bearer` header
- `auth/AuthContext.tsx` — JWT token in `localStorage`, shared via context
- `auth/AxiosInterceptor.tsx` — 401 response → clears token and redirects to `/login`
- `App.tsx` — router; `AuthProvider` wraps everything; redirects to `/login` if unauthenticated

**Pages:** `LoginPage`, `DashboardPage`, `ProfilesPage`, `DomainsPage`, `NodesPage`, `ScriptsPage`, `SettingsPage`, `TerminalPopupPage` (standalone popup for SSH terminal)

**Terminal:** xterm.js + WebSocket to `/api/terminal`. Two modes:
1. Floating window — token + nodeId in WS query params
2. Popup (`TerminalPopupPage`) — one-time ticket from `POST /terminal/ticket/:nodeId`, then `?ticket=<uuid>`; ticket is single-use and expires in 60 seconds

**Secret picker pattern:** `secretMenuAnchor: { el: HTMLElement; onPick: (v: string) => void } | null` — universal callback reused across all credential fields (node password, SSH key, API key, Telegram token, script variables). Uses a Dialog (not Menu) to remain visible inside other Dialogs.

**Theme:** `ThemeContext.tsx` wraps the app and provides dark/light MUI theme toggle stored in `localStorage`.

## Key Patterns

- **Settings storage:** `GET/POST /settings` with key `ssh_nodes`, `secrets`, `rotation_config`, `managed_profiles`, `telegram_config`, `snl_whitelist`, `remnawave_url`, `remnawave_api_key`, `rotation_history`, `scripts`, `script_history` etc.
- **Script variables:** `{{ varName | Label }}` syntax extracted on frontend, substituted on backend before SSH execution
- **Log masking:** sensitive variable values replaced with `***` in all job log entries; applies to both `ScriptsService` and `NodesService` log streams
- **Job lifecycle:** in-memory `Map<jobId, JobStatus>` in `ScriptsService`; cleaned up 1 hour after completion via `setTimeout`. `NodesService` has its own in-memory `Map` for install jobs (no auto-cleanup)
- **Ticket cleanup:** `setInterval` every 60s removes expired tickets from `TerminalService.tickets` Map
- **Built-in scripts:** defined in `ScriptsService` as `BUILT_IN_SCRIPTS[]`; seeded/updated on every module init; cannot be edited or deleted by the user
- **NodesService ↔ ScriptsService:** `NodesService` calls `ScriptsService.addSshNodeFromInstall` to persist SSH credentials after a successful node install — they share the same `ssh_nodes` settings key
- **Inbound tags:** all built-in inbounds use `*-rwm` suffix (e.g. `vless-tcp-reality-rwm`); a random `tagSuffix` hex is appended per-profile inbound config for uniqueness; migrated automatically on startup if missing
- **Random port range:** rotation picks ports in `10000–60000`; `excludedPorts` per profile lets you reserve specific ports
- **Script execution modes:** `ScriptsService.executeScript` — parallel across nodes (`POST /scripts/execute`); `executeSequence` — runs multiple scripts sequentially on each node, stops on first error per node (`POST /scripts/execute-sequence`)
- **Script history:** stored as `script_history` settings key (up to 100 entries); `HistoryListItem` includes `logPreview` (last meaningful log line, 120 chars). Endpoints: `GET /scripts/history`, `GET /scripts/history/by-script/:scriptId`, `GET /scripts/history/:id`, `DELETE /scripts/history`
- **Built-in script revert:** `POST /scripts/scripts/:id/revert` resets a modified built-in script to its original content (clears `isModified` flag)
- **Per-node variable overrides:** `executeScript` accepts optional `variablesPerNode: Record<nodeId, Record<varName, value>>` to pass different values per node alongside global `variables`
- **Per-profile domain override:** `ManagedProfile.profileDomains[]` takes priority over the global `Domain` table for SNI selection; empty array falls back to DB
- **Host template variables:** `hostTemplate` string supports `{countryCode}`, `{nodeName}`, `{inboundType}` placeholders when syncing Remnawave hosts after rotation

## Environment Variables (server)

| Variable | Description |
|----------|-------------|
| `DB_*` | PostgreSQL connection (`DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`) |
| `JWT_SECRET` | JWT signing secret — **change in production** |
| `ADMIN_LOGIN` / `ADMIN_PASSWORD` | Initial admin credentials |
| `SECRET_ENCRYPTION_KEY` | 32-byte hex key for secrets AES-256-GCM encryption |
| `COUNTRY_FLAG` | URL-encoded flag emoji prepended to proxy links (default: `%F0%9F%92%AF`) |
