<p align="center">
  <h1 align="center">OpenAlerts</h1>
  <p align="center">
    Real-time monitoring & alerting for AI agent frameworks.
  </p>
</p>

<p align="center">
  <a href="https://pypi.org/project/openalerts"><img src="https://img.shields.io/pypi/v/openalerts?style=flat&color=blue" alt="PyPI"></a>
  <a href="https://pypi.org/project/openalerts"><img src="https://static.pepy.tech/personalized-badge/openalerts?period=month&units=international_system&left_color=grey&right_color=blue&left_text=downloads" alt="PyPI downloads"></a>
  <a href="https://www.npmjs.com/package/@steadwing/openalerts"><img src="https://img.shields.io/npm/v/@steadwing/openalerts?style=flat&color=blue" alt="npm"></a>
  <a href="https://www.npmjs.com/package/@steadwing/openalerts"><img src="https://img.shields.io/npm/dt/@steadwing/openalerts?style=flat&color=blue" alt="npm downloads"></a>
  <a href="https://discord.gg/4rUP86tSXn"><img src="https://img.shields.io/badge/discord-community-5865F2?style=flat" alt="Discord"></a>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> &middot;
  <a href="#dashboard">Dashboard</a> &middot;
  <a href="#alert-rules">Alert Rules</a> &middot;
  <a href="#llm-enriched-alerts">LLM Enrichment</a> &middot;
  <a href="#mcp-server">MCP Server</a> &middot;
  <a href="#commands">Commands</a>
</p>

---

AI agents fail silently. LLM errors, stuck sessions, token blowups - nobody knows until a user complains.

OpenAlerts watches your agent in real-time and alerts you the moment something goes wrong. Runs fully locally - no external services, no cloud dependencies, everything stays on your machine.

## Dashboard 
<p align="center">
  <img width="1728" height="919" alt="Screenshot 2026-02-25 at 8 30 59 AM" src="https://github.com/user-attachments/assets/f385477b-817a-47c2-8591-e4ef82529ade" />
</p>

## Quickstart

<details open>
<summary><b>Python</b> - for <a href="https://github.com/crewAIInc/crewAI">CrewAI</a>, <a href="https://github.com/FoundationAgents/OpenManus">OpenManus</a>, and <a href="https://github.com/HKUDS/nanobot">nanobot</a></summary>

### Install

```bash
pip install openalerts

# For CrewAI support
pip install openalerts crewai
```

<details open>
<summary><b>CrewAI</b></summary>

```python
import asyncio
import openalerts
from crewai import Agent, Task, Crew

async def main():
    # Dashboard starts at http://localhost:9464/openalerts
    await openalerts.init({"framework": "crewai"})

    # Use CrewAI as normal — automatically monitored
    researcher = Agent(
        role="Researcher",
        goal="Research topics thoroughly",
        backstory="You are an expert researcher.",
        llm="gpt-4o-mini",
    )
    task = Task(
        description="Research the benefits of AI monitoring",
        expected_output="A short summary",
        agent=researcher,
    )
    crew = Crew(agents=[researcher], tasks=[task])
    result = crew.kickoff()
    print(result)

asyncio.run(main())
```

The CrewAI adapter uses CrewAI's native event bus — no monkey-patching. Every crew run, agent execution, task step, tool call, and LLM call is tracked automatically with full session correlation (Crew = session, Agent = subagent, Task = step).

</details>

<details>
<summary><b>OpenManus</b></summary>

```python
import asyncio
import openalerts
from app.agent.manus import Manus

async def main():
    # Dashboard starts at http://localhost:9464/openalerts
    await openalerts.init({"framework": "openmanus"})

    # Use your agents as normal — they're automatically monitored
    agent = Manus()
    await agent.run("Research quantum computing")

asyncio.run(main())
```

</details>

<details>
<summary><b>nanobot</b></summary>

```python
import asyncio
import openalerts
from nanobot.agent.loop import AgentLoop
from nanobot.bus.queue import MessageBus
from nanobot.providers.litellm_provider import LiteLLMProvider

async def main():
    await openalerts.init({"framework": "nanobot"})

    provider = LiteLLMProvider(api_key="sk-...", default_model="gpt-4o-mini")
    agent = AgentLoop(
        bus=MessageBus(),
        provider=provider,
        workspace="./workspace",
    )
    response = await agent.process_direct("Research quantum computing")
    print(response)

asyncio.run(main())
```

The nanobot adapter also tracks **subagent lifecycle** — `subagent.spawn`, `subagent.end`, and `subagent.error` events are captured automatically when `SubagentManager` is used, with parent/child session correlation.

</details>

That's it. A real-time dashboard starts at [http://localhost:9464/openalerts](http://localhost:9464/openalerts). OpenAlerts auto-instruments the configured framework so every event flows through the monitoring engine. Cleanup happens automatically on exit. All events are persisted to `~/.openalerts/` as JSONL.

Optionally, add [channels](#channels) (Slack, Discord, Feishu, webhooks) to get alerts delivered when things go wrong.

### Standalone Dashboard

By default, the dashboard runs in-process - when your agent exits, the dashboard dies too. For a **persistent dashboard** that survives agent restarts:

```bash
# Terminal 1 — start persistent dashboard (stays running)
openalerts serve

# Terminal 2 — run your agent (writes events, no dashboard of its own)
python my_agent.py
```

Disable the in-process dashboard when using standalone mode:

```python
await openalerts.init({
    "dashboard": False,
    "channels": [...]
})
```

```
openalerts serve [--port 9464] [--state-dir ~/.openalerts] [--log-level INFO]
```

Also works via `python -m openalerts serve`.

### Channels

```python
# Slack
{"type": "slack", "webhook_url": "https://hooks.slack.com/services/..."}

# Discord
{"type": "discord", "webhook_url": "https://discord.com/api/webhooks/..."}

# Feishu (custom bot webhook)
{"type": "feishu", "webhook_url": "https://open.feishu.cn/open-apis/bot/v2/hook/xxx", "keyword": "alert"}

# Generic webhook
{"type": "webhook", "webhook_url": "https://your-server.com/alerts", "headers": {"Authorization": "Bearer ..."}}
```

Or via environment variables (no code changes needed):

```bash
OPENALERTS_SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
OPENALERTS_DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
OPENALERTS_FEISHU_WEBHOOK_URL="https://open.feishu.cn/open-apis/bot/v2/hook/xxx"
OPENALERTS_WEBHOOK_URL="https://your-server.com/alerts"
```

### Configuration

```python
await openalerts.init({
    "channels": [...],
    "rules": {
        "llm-errors": {"threshold": 3},
        "high-error-rate": {"enabled": False},
        "tool-errors": {"cooldown_seconds": 1800},
    },
    "cooldown_seconds": 900,
    "max_alerts_per_hour": 5,
    "quiet": False,
    "dashboard": True,
    "dashboard_port": 9464,
    "state_dir": "~/.openalerts",
    "log_level": "INFO",
})
```

### API

```python
engine = await openalerts.init({...})   # async init
engine = openalerts.init_sync({...})    # sync init
await openalerts.send_test_alert()      # verify channels
engine = openalerts.get_engine()        # get engine instance
await openalerts.shutdown()             # optional — runs automatically on exit
```

</details>

<details>
<summary><b>Node</b> - for <a href="https://github.com/openclaw/openclaw">OpenClaw</a></summary>

### Install

```bash
npm install -g @steadwing/openalerts
```

> Requires **Node.js >= 22.5.0** (uses the built-in `node:sqlite` module — no native builds).

### Usage

```bash
# 1. Create default config (auto-detects your OpenClaw gateway token)
openalerts init

# 2. Edit config to add your alert channel
#    ~/.openalerts/config.json

# 3. Start monitoring
openalerts start
```

Dashboard at **http://127.0.0.1:4242** — the gateway overlay dismisses automatically once connected. No code changes to OpenClaw needed — runs as a separate process alongside it.

### CLI

| Command | Description |
|---|---|
| `openalerts init` | Create default config at `~/.openalerts/config.json` |
| `openalerts start` | Start the monitoring daemon |
| `openalerts status` | Print live engine state (daemon must be running) |
| `openalerts test` | Fire a test alert through all configured channels |
| `openalerts mcp` | Start the MCP server for AI assistant integration (stdio) |

### Configuration

`~/.openalerts/config.json` (created by `openalerts init`):

```json
{
  "gatewayUrl": "ws://127.0.0.1:18789",
  "gatewayToken": "<auto-detected from ~/.openclaw/openclaw.json>",
  "stateDir": "~/.openalerts",
  "server": { "port": 4242, "host": "127.0.0.1" },
  "channels": [
    { "type": "telegram", "token": "BOT_TOKEN", "chatId": "CHAT_ID" },
    { "type": "webhook", "webhookUrl": "https://your-endpoint" },
    { "type": "console" }
  ],
  "quiet": false
}
```

</details>

## Dashboard

A real-time web dashboard starts automatically and shows everything happening inside your agents:

- **Activity** - Step-by-step execution timeline with tool calls, LLM usage, costs
- **Health** - Rule status, alert history, system stats
- **Debug** - State snapshot for troubleshooting

Python: [http://localhost:9464/openalerts](http://localhost:9464/openalerts) | Node: [http://127.0.0.1:4242](http://127.0.0.1:4242)

## Alert Rules

All rules run against every event in real-time. Thresholds and cooldowns are configurable.

| Rule | Watches for | Severity | Default threshold |
|---|---|---|---|
| `llm-errors` | LLM/agent failures in 1-min window | ERROR | `1` error |
| `tool-errors` | Tool execution failures in 1-min window | WARN | `1` error |
| `high-error-rate` | Failure rate over last 20 calls | ERROR | `50`% |
| `agent-stuck` / `session-stuck` | Agent idle too long | WARN | `120000` ms |
| `token-limit` | Token limit exceeded | ERROR | - |
| `step-limit-warning` | Agent reaches 80% of max_steps | WARN | - |
| `subagent-errors` | Subagent failures in 1-min window (Python) | WARN | `1` error |
| `infra-errors` | Infrastructure errors (Node) | ERROR | `1` error |
| `gateway-down` | No heartbeat received (Node) | CRITICAL | `30000` ms |
| `queue-depth` | Queued items piling up (Node) | WARN | `10` items |
| `heartbeat-fail` | Consecutive heartbeat failures (Node) | ERROR | `3` failures |

Every rule also accepts:

- **`enabled`** - `false` to disable (default: `true`)
- **`cooldown`** - time before the same rule can fire again (default: 15 min)

## LLM-Enriched Alerts

OpenAlerts can optionally use your configured LLM to enrich alerts with a human-friendly summary and an actionable suggestion. **Disabled by default** - opt in with `"llmEnriched": true` (Node plugin).

```
1 agent error(s) on unknown in the last minute. Last: 401 Incorrect API key...

Summary: Your OpenAI API key is invalid or expired — the agent cannot make LLM calls.
Action: Update your API key with a valid key from platform.openai.com/api-keys
```

## MCP Server

The Node package ships an [MCP](https://modelcontextprotocol.io) server so AI assistants can query your monitoring data directly — active sessions, recent alerts, agent activity, costs — without opening the dashboard.

```bash
openalerts mcp
```

10 tools available: `summarize`, `get_status`, `get_alerts`, `get_sessions`, `get_session_detail`, `get_activity`, `get_rule_states`, `get_agents`, `get_cron_jobs`, `fire_test_alert`.

Falls back to SQLite automatically if the daemon isn't running. See [node/README.md](node/README.md#mcp-server) for full setup and config.

---

## Commands

Zero-token chat commands available in any connected channel (Node plugin):

| Command | What it does |
|---|---|
| `/health` | System health snapshot — uptime, active alerts, stats |
| `/alerts` | Recent alert history with severity and timestamps |
| `/dashboard` | Returns the dashboard URL |

---

<p align="center">Made with ❤️ by Steadwing Team</p>
