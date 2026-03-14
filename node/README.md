# openalerts

Standalone monitoring daemon for [OpenClaw](https://openclaw.dev). Connects to your local OpenClaw gateway in real time, fires alerts via Telegram or webhook when something goes wrong, and serves a live dashboard at `http://localhost:4242`.

No code changes to OpenClaw needed — runs as a separate process alongside it.

---

## Install

```bash
npm install -g @steadwing/openalerts
```

> Requires **Node.js ≥ 22.5.0** (uses the built-in `node:sqlite` module — no native builds).

---

## Quick start

```bash
# 1. Create default config (auto-detects your OpenClaw gateway token)
openalerts init

# 2. Edit config to add your alert channel
#    ~/.openalerts/config.json

# 3. Start monitoring
openalerts start
```

Dashboard at **http://127.0.0.1:4242** — the gateway overlay dismisses automatically once connected.

---

## CLI

| Command  | Description                                               |
| -------- | --------------------------------------------------------- |
| `openalerts init`   | Create default config at `~/.openalerts/config.json` |
| `openalerts start`  | Start the monitoring daemon |
| `openalerts status` | Print live engine state (daemon must be running) |
| `openalerts test`   | Fire a test alert through all configured channels |
| `openalerts mcp`    | Start the MCP server (stdio) for AI assistant integration |

**Options for `start`:**

| Flag | Default | Description |
| ---- | ------- | ----------- |
| `--port N` | `4242` | HTTP server port |
| `--config PATH` | `~/.openalerts/config.json` | Config file path |

---

## Configuration

`~/.openalerts/config.json` (created by `openalerts init`):

```json
{
  "gatewayUrl": "ws://127.0.0.1:18789",
  "gatewayToken": "<auto-detected from ~/.openclaw/openclaw.json>",
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
    { "type": "webhook", "webhookUrl": "https://your-endpoint" },
    { "type": "console" }
  ],
  "quiet": false
}
```

**Gateway token** is auto-detected from `gateway.auth.token` in `~/.openclaw/openclaw.json` — no manual copy needed.

**Channels**: configure at least one. Falls back to `console` if none are set.

---

## What it monitors

Captures everything from the OpenClaw gateway WebSocket in real time:

| Event | What's captured |
| ----- | --------------- |
| Agent runs | Start, streaming, complete, error, aborted |
| Tool calls | Tool name, duration, result |
| LLM usage | Token counts, cost per call |
| Shell exec | Command, pid, output, exit code |
| Heartbeats | Gateway health, active sessions, queue depth |
| Cron jobs | Schedule, last run, next run, errors |
| Sessions | Active sessions, costs, message counts |
| Workspace docs | SOUL.md, HEARTBEAT.md, MEMORY.md per agent |

---

## Alert rules

Ten rules run against every event in real time. All thresholds and cooldowns are configurable via the `rules` key in config.

| Rule | Triggers when | Threshold | Cooldown |
| ---- | ------------- | --------- | -------- |
| `infra-errors` | `infra.error` events in 1 min | 1 | 15 min |
| `llm-errors` | `llm.error` or `agent.error` in 1 min | 1 | 15 min |
| `tool-errors` | `tool.error` in 1 min | 1 | 15 min |
| `heartbeat-fail` | Consecutive heartbeat failures | 3 | 30 min |
| `session-stuck` | Session idle too long | 120 s | 30 min |
| `high-error-rate` | Error % of last 20 calls | 50% | 30 min |
| `queue-depth` | Items in delivery queue | 10 | 15 min |
| `gateway-down` | No heartbeat from watchdog | 30 s | 60 min |
| `cost-hourly-spike` | LLM cost per hour | $5 | 30 min |
| `cost-daily-budget` | LLM cost per day | $20 | 6 h |

Override a rule threshold in config:

```json
{
  "rules": {
    "llm-errors": { "threshold": 5 },
    "gateway-down": { "enabled": false },
    "heartbeat-fail": { "cooldownMinutes": 60 }
  }
}
```

---

## Dashboard

Open **http://127.0.0.1:4242** after starting.

| Tab | What's shown |
| --- | ------------ |
| **Overview** | Gateway health log, live activity feed, 24h stats, recent alerts |
| **Workspaces** | Per-agent SOUL.md, HEARTBEAT.md, MEMORY.md, USER.md previews |
| **Alerts** | Full alert history with severity, rule ID, fingerprint |
| **Sessions** | Active sessions with status, token counts, cost |
| **Live Monitor** | Real-time per-run timeline — steps, tool calls, LLM responses, exec |
| **Cron Jobs** | Scheduled job status, last/next run, consecutive errors |
| **Diagnostics** | Raw engine event log |
| **Delivery Queue** | Pending/failed alert delivery items |

Live Monitor sidebar shows sessions colour-coded by status:
- Green pulse = active (idle, waiting for input)
- Yellow pulse = thinking (LLM streaming in progress)
- Grey = no recent activity

---

## REST API

All endpoints return JSON. CORS enabled.

| Method | Path | Description |
| ------ | ---- | ----------- |
| `GET` | `/api/state` | Full dashboard snapshot |
| `GET` | `/api/activity` | Unified activity log (actions + diagnostics merged) |
| `GET` | `/api/logs` | OpenClaw-style log format (`ts`, `level`, `subsystem`, `message`) |
| `GET` | `/api/actions` | Raw agent/tool/chat action rows |
| `GET` | `/api/heartbeats` | Gateway heartbeat history |
| `GET` | `/api/alerts` | Fired alert history |
| `GET` | `/api/diagnostics` | Engine diagnostic events |
| `GET` | `/api/engine` | Engine stats, uptime, gateway connection status |
| `POST` | `/api/test` | Fire a test alert |
| `GET` | `/events` | SSE stream (live push to dashboard) |
| `GET` | `/health` | `{ok, ts, sseClients, gatewayConnected}` |

Most list endpoints accept `?limit=N` (default 100, max 500) and `/api/activity`, `/api/actions`, `/api/logs` also accept `?session=KEY`.

### SSE events (`GET /events`)

| Event | Payload |
| ----- | ------- |
| `state` | Full dashboard snapshot — sent on connect and on file changes |
| `openalerts` | Alert fired: `{rule_id, severity, title, detail, ts, fingerprint}` |
| `action` | Agent step: `{id, runId, sessionKey, type, toolName, content, ts}` |
| `health` | Gateway heartbeat: `{queueDepth, activeSessions, sessions, ts}` |
| `diagnostic` | Engine event: `{event_type, ts, summary, session_key}` |
| `exec` | Shell command: `{type, runId, pid, command, output, exitCode, ts}` |

---

## MCP Server

OpenAlerts ships a [Model Context Protocol](https://modelcontextprotocol.io) server so any MCP-compatible AI assistant (Claude Code, Claude Desktop, Cursor, etc.) can query your monitoring data directly — no browser, no dashboard needed.

```bash
openalerts mcp           # start MCP server on stdio
openalerts mcp --port N  # connect to daemon on a custom port (default 4242)
```

Add to your MCP client config (e.g. `~/.claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "openalerts": {
      "command": "node",
      "args": ["--experimental-sqlite", "/path/to/node/dist/cli.js", "mcp"]
    }
  }
}
```

Or if installed globally:

```json
{
  "mcpServers": {
    "openalerts": {
      "command": "openalerts",
      "args": ["mcp"]
    }
  }
}
```

### Tools

| Tool | Description |
| ---- | ----------- |
| `summarize` | Narrative overview — sessions, alerts, activity, cost, gateway status |
| `get_status` | Daemon health, gateway connection, 24h stats |
| `get_alerts` | Recent fired alerts — filterable by severity or rule ID |
| `get_sessions` | Agent sessions with status, cost, token counts |
| `get_session_detail` | Full session + all its actions/events |
| `get_activity` | Unified activity feed — tool calls, LLM calls, agent steps |
| `get_rule_states` | All 10 rules with thresholds, cooldowns, last-fired time |
| `get_agents` | Known agents with IDs and names |
| `get_cron_jobs` | Scheduled jobs with last run status and next run time |
| `fire_test_alert` | Send a test alert through configured channels |

### Resources

| URI | Content |
| --- | ------- |
| `openalerts://status` | Engine health + 24h stats |
| `openalerts://alerts/recent` | Last 50 fired alerts |
| `openalerts://sessions/active` | Sessions active in the last 15 minutes |
| `openalerts://rules` | All rules with last-fired info |

**Works without the daemon** — if `openalerts start` isn't running, the MCP server falls back to reading SQLite directly from `~/.openalerts/openalerts.db`.

---

## Architecture

```
openalerts
├── cli.ts                  Entry point — wires everything together
├── config.ts               Config loading + gateway token auto-detection
├── core/
│   ├── engine.ts           Alert engine — ingests events, evaluates rules, fires alerts
│   ├── evaluator.ts        Sliding-window + cooldown rule state
│   ├── rules.ts            10 alert rule definitions
│   └── types.ts            Event and alert type definitions
├── watchers/
│   ├── gateway.ts          WebSocket client for OpenClaw gateway
│   ├── gateway-adapter.ts  Translates gateway frames → engine events + SSE payloads
│   └── files.ts            node:fs watcher for OpenClaw workspace files
├── readers/
│   └── openclaw.ts         Reads SOUL.md, cron jobs, sessions, delivery queue, config
├── channels/
│   ├── telegram.ts         Telegram Bot API (no SDK, direct HTTP)
│   ├── webhook.ts          HTTP POST to any webhook URL
│   └── console.ts          Console fallback
├── server/
│   ├── index.ts            HTTP server bootstrap
│   ├── routes.ts           All REST + SSE route handlers
│   ├── sse.ts              SSE manager (15s keepalive, broadcast)
│   └── dashboard.ts        Embedded dashboard HTML (vanilla JS, zero framework)
├── mcp/
│   ├── index.ts            MCP server bootstrap + tool/resource registration
│   ├── client.ts           REST API client with SQLite fallback
│   ├── tools.ts            10 tool handler implementations
│   └── resources.ts        4 resource handlers
└── db/
    ├── index.ts            SQLite open + periodic prune
    ├── schema.ts           12 tables: sessions, actions, alerts, heartbeats, cron_jobs…
    └── queries.ts          Typed query functions including getActivityLog (UNION query)
```

**Storage**: SQLite at `~/.openalerts/openalerts.db` using Node 22's built-in `node:sqlite` — no native build step, no binaries to compile.

**Zero heavy dependencies**: only `ws` (WebSocket client). No Express, no ORM, no native modules.

---

## Data flow

```
OpenClaw gateway (ws://127.0.0.1:18789)
    │  health, agent, chat, exec events
    ▼
gateway-adapter.ts ──► engine.ingest() ──► rule evaluation ──► Telegram / webhook
    │                        │
    │                   SQLite DB              JSONL event store
    │                (actions, alerts,         (warm-start rule
    │                 heartbeats, sessions)     state on restart)
    ▼
SSE broadcast ──► dashboard live updates

OpenClaw workspace files (~/.openclaw/)
    │  SOUL.md, HEARTBEAT.md, cron/jobs.json, sessions.json…
    ▼
openclaw.ts reader ──► SQLite (agent_info, cron_jobs, sessions)
    │
node:fs watcher triggers re-reads on change
```

---

## License

Apache-2.0
