# openalerts

Standalone monitoring daemon for [OpenClaw](https://openclaw.dev) — watches your local OpenClaw gateway in real time, fires alerts via Telegram/webhook when things go wrong, and serves a live dashboard at `http://localhost:4242`.

Works alongside your existing OpenClaw installation. No code changes to OpenClaw needed.

---

## What it does

- **Connects to the OpenClaw gateway WebSocket** — receives all agent runs, tool calls, LLM responses, and heartbeats in real time
- **Reads OpenClaw workspace files** — SOUL.md, HEARTBEAT.md, MEMORY.md, cron jobs, sessions, delivery queue, and agent configs
- **Evaluates 10 alert rules** — fires Telegram/webhook alerts when thresholds are breached
- **Serves a live dashboard** at `http://localhost:4242` with an overview, live monitor, agent workspace docs, alerts, cron jobs, and diagnostics
- **Exposes a REST API** — all data accessible as JSON for external tools

---

## Requirements

- Node.js **≥ 22.5.0** (uses built-in `node:sqlite`)
- OpenClaw installed and running locally

---

## Quick start

```bash
# 1. Build
cd openalerts/standalone
npm install
npm run build

# 2. Create config (auto-detects OpenClaw token)
node --experimental-sqlite dist/cli.js init

# 3. Edit config if needed
# C:\Users\<you>\.openalerts\config.json

# 4. Start
node --experimental-sqlite dist/cli.js start
```

Dashboard opens at **http://127.0.0.1:4242**

On first load the dashboard shows a "Connecting to OpenClaw…" gate screen. It automatically transitions to the full dashboard once the gateway WebSocket connects.

---

## CLI

```
node --experimental-sqlite dist/cli.js <command> [options]
```

| Command | Description |
|---------|-------------|
| `init` | Create default config file at `~/.openalerts/config.json` |
| `start` | Start the monitoring daemon |
| `status` | Print current engine state (daemon must be running) |
| `test` | Fire a test alert through all configured channels |

**Options for `start`:**

| Flag | Default | Description |
|------|---------|-------------|
| `--port N` | `4242` | HTTP server port |
| `--config PATH` | `~/.openalerts/config.json` | Config file path |

---

## Configuration

Config file at `~/.openalerts/config.json` (created by `init`):

```json
{
  "gatewayUrl": "ws://127.0.0.1:18789",
  "gatewayToken": "<auto-detected from openclaw.json>",
  "stateDir": "~/.openalerts",
  "watch": {
    "openclawDir": "~/.openclaw",
    "workspaces": ["workspace", "workspace-study"]
  },
  "server": {
    "port": 4242,
    "host": "127.0.0.1"
  },
  "channels": [
    { "type": "telegram", "token": "BOT_TOKEN", "chatId": "CHAT_ID" },
    { "type": "webhook", "webhookUrl": "https://..." },
    { "type": "console" }
  ],
  "quiet": false
}
```

**Gateway token**: auto-detected on `init` from `gateway.auth.token` in `~/.openclaw/openclaw.json`. Do not use device pairing tokens from `devices/paired.json`.

**Alert channels**: at least one must be configured. Falls back to `console` if none are set.

---

## Connected apps & message capture

openalerts captures user messages and agent responses from all OpenClaw-connected channels:

| Source | Captured as |
|--------|-------------|
| Telegram message in | `user_message` step in Live Monitor (purple 💬) |
| Webchat message in | `user_message` step |
| LLM streaming response | `streaming` → coalesces into single "Thinking…" step |
| LLM final response | `complete` step with token counts |
| Tool call | `tool_call` step with tool name |
| Shell exec | `exec` step with command + exit code |
| Agent run start/end | `start` / `complete` lifecycle steps |

Platform (telegram/webchat) is auto-detected from the session key and shown as a badge on user message steps.


## Alert rules

| Rule | Triggers when | Threshold | Cooldown |
|------|--------------|-----------|---------|
| `infra-errors` | `infra.error` events in 1 min | 1 | 15 min |
| `llm-errors` | `llm.error` or `agent.error` in 1 min | 1 | 15 min |
| `session-stuck` | Session idle too long | 120 s | 30 min |
| `heartbeat-fail` | Consecutive heartbeat failures | 3 | 30 min |
| `queue-depth` | Items queued | 10 | 15 min |
| `high-error-rate` | Error % of last 20 calls | 50% | 30 min |
| `tool-errors` | `tool.error` in 1 min | 1 | 15 min |
| `gateway-down` | No heartbeat from watchdog | 30 s | 60 min |
| `cost-hourly-spike` | Cost per hour | $5 | 30 min |
| `cost-daily-budget` | Cost per day | $20 | 6 h |

---

## Dashboard

Open **http://127.0.0.1:4242** after starting.

| Tab | What's shown |
|-----|-------------|
| **Overview** | Gateway health log, live activity feed, 24h stats, recent alerts |
| **Workspaces** | Per-agent SOUL.md, HEARTBEAT.md, MEMORY.md, USER.md previews |
| **Alerts** | Full alert history with severity, rule, fingerprint |
| **Sessions** | Active sessions with status, tokens, cost |
| **▶ Live Monitor** | Real-time per-run timeline — agent steps, tool calls, LLM responses, exec commands |
| **Cron Jobs** | Scheduled job status, last run, next run, error history |
| **Diagnostics** | Raw engine event log |
| **Delivery Queue** | Pending/failed alert delivery items |

**Live Monitor** sidebar shows sessions colour-coded by status:
- 🟢 Green pulse = active
- 🟡 Yellow pulse = thinking (LLM streaming)
- ⚫ Grey = idle

---

## REST API

All endpoints return JSON. CORS enabled (`*`).

| Method | Path | Description | Query params |
|--------|------|-------------|--------------|
| `GET` | `/api/state` | Full dashboard snapshot | — |
| `GET` | `/api/activity` | Unified activity log (actions + diagnostics) | `?limit=N&session=KEY` |
| `GET` | `/api/logs` | OpenClaw-style log format (`ts`, `level`, `subsystem`, `message`) | `?limit=N&session=KEY&subsystem=agent` |
| `GET` | `/api/actions` | Raw action rows (agent/tool/chat events) | `?limit=N&session=KEY` |
| `GET` | `/api/heartbeats` | Gateway heartbeat history | `?limit=N` |
| `GET` | `/api/alerts` | Fired alert history | `?limit=N` |
| `GET` | `/api/diagnostics` | Engine diagnostic events | `?limit=N` |
| `GET` | `/api/engine` | Engine stats, uptime, gateway status | — |
| `POST` | `/api/test` | Fire a test alert | — |
| `GET` | `/events` | SSE stream (live push to dashboard) | — |
| `GET` | `/health` | Health check: `{ok, ts, sseClients, gatewayConnected}` | — |

### `/api/logs` response format

Matches OpenClaw's `/logs` format — usable as a drop-in substitute:

```json
{
  "entries": [
    {
      "ts": "2026-02-23T12:10:22.701Z",
      "tsMs": 1771848622701,
      "level": "INFO",
      "subsystem": "agent",
      "message": "response complete",
      "sessionKey": "workspace:abc123",
      "runId": "381cca9d-...",
      "durationMs": 7177
    }
  ],
  "total": 1
}
```

**Subsystem values**: `agent`, `tool`, `llm`, `infra`, `session`, `exec`, `sys`
**Level values**: `DEBUG` (heartbeats), `INFO` (normal events), `ERROR` (errors/failures)

### SSE event types

Connect to `GET /events` to receive live push:

| Event | Payload |
|-------|---------|
| `state` | Full dashboard snapshot (sent on connect + file changes) |
| `openalerts` | Alert fired: `{rule_id, severity, title, detail, ts, fingerprint}` |
| `diagnostic` | Engine event: `{event_type, ts, summary, session_key}` |
| `action` | Agent step: `{id, runId, sessionKey, type, eventType, toolName, content, ts}` |
| `health` | Gateway heartbeat: `{queueDepth, activeSessions, sessions, ts}` |
| `exec` | Shell command: `{type, runId, pid, command, output, exitCode, ts}` |

---

## Architecture

```
openalerts
├── cli.ts              Entry point — arg parsing, wires everything together
├── config.ts           Config loading + token auto-detection
├── core/               Alert engine (framework-agnostic, shared with OpenClaw plugin)
│   ├── engine.ts       OpenAlertsEngine — ingests events, evaluates rules, fires alerts
│   ├── evaluator.ts    Sliding-window + cooldown rule state
│   ├── rules.ts        10 alert rule definitions
│   ├── types.ts        Event and alert type definitions
│   └── store.ts        JSONL append-only event persistence
├── watchers/
│   ├── gateway.ts      WebSocket client for OpenClaw gateway
│   ├── gateway-adapter.ts  Translates gateway frames → OpenAlertsEvents + SSE payloads
│   └── files.ts        node:fs watcher for OpenClaw workspace files
├── readers/
│   └── openclaw.ts     Reads SOUL.md, HEARTBEAT.md, MEMORY.md, cron jobs, sessions…
├── channels/
│   ├── telegram.ts     Direct Telegram Bot API (no SDK)
│   ├── webhook.ts      HTTP POST to any webhook URL
│   └── console.ts      Console fallback
├── server/
│   ├── index.ts        HTTP server bootstrap
│   ├── routes.ts       All API route handlers
│   ├── sse.ts          SSE manager (15s keepalive, broadcast)
│   └── dashboard.ts    Embedded dashboard HTML (vanilla JS, no framework)
└── db/
    ├── index.ts        SQLite open + prune
    ├── schema.ts       12 tables: sessions, actions, alerts, heartbeats, cron_jobs…
    └── queries.ts      All typed query functions incl. getActivityLog (UNION query)
```

**Storage**: SQLite at `~/.openalerts/openalerts.db` (Node 22 built-in `node:sqlite`, no native build step). Events also persisted as JSONL for warm-start rule state.

**Zero runtime dependencies** beyond `ws` (WebSocket client) — no Express, no ORM, no native modules.

---

## Data flow

```
OpenClaw gateway (ws://127.0.0.1:18789)
    │  health/tick, agent, chat, exec.*
    ▼
gateway-adapter.ts ──► engine.ingest()  ──► rule evaluation ──► Telegram/webhook
    │                       │
    │                  SQLite (actions,        JSONL store
    │                  diagnostics,            (warm-start)
    │                  heartbeats)
    ▼
SSE broadcast ──► dashboard live updates

OpenClaw workspace files (~/.openclaw/)
    │  SOUL.md, HEARTBEAT.md, cron/jobs.json, sessions.json, …
    ▼
openclaw.ts reader ──► SQLite (agent_info, cron_jobs, sessions)
    │
file watcher (node:fs) triggers re-reads on change
```
