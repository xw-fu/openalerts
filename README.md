<p align="center">
  <h1 align="center">OpenAlerts</h1>
  <p align="center">
    Real-time monitoring & alerting for AI agent frameworks.
  </p>
</p>

<p align="center">
  <a href="https://pypi.org/project/openalerts"><img src="https://img.shields.io/pypi/v/openalerts?style=flat&color=blue" alt="PyPI"></a>
  <a href="https://pypi.org/project/openalerts"><img src="https://img.shields.io/pypi/dm/openalerts?style=flat&color=blue" alt="PyPI downloads"></a>
  <a href="https://www.npmjs.com/package/@steadwing/openalerts"><img src="https://img.shields.io/npm/v/@steadwing/openalerts?style=flat&color=blue" alt="npm"></a>
  <a href="https://www.npmjs.com/package/@steadwing/openalerts"><img src="https://img.shields.io/npm/dt/@steadwing/openalerts?style=flat&color=blue" alt="npm downloads"></a>
  <a href="https://github.com/steadwing/openalerts/stargazers"><img src="https://img.shields.io/github/stars/steadwing/openalerts?style=flat" alt="GitHub stars"></a>
  <a href="https://discord.gg/4rUP86tSXn"><img src="https://img.shields.io/badge/discord-community-5865F2?style=flat" alt="Discord"></a>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> &middot;
  <a href="#dashboard">Dashboard</a> &middot;
  <a href="#alert-rules">Alert Rules</a> &middot;
  <a href="#llm-enriched-alerts">LLM Enrichment</a> &middot;
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
<summary><b>Python</b> - for <a href="https://github.com/FoundationAgents/OpenManus">OpenManus</a></summary>

### Install

```bash
pip install openalerts
```

### Usage

```python
import asyncio
import openalerts
from app.agent.manus import Manus

async def main():
    await openalerts.init({
        "channels": [
            {"type": "slack", "webhook_url": "https://hooks.slack.com/services/..."},
        ]
    })

    # Use your agents as normal — they're automatically monitored
    agent = Manus()
    await agent.run("Research quantum computing")

asyncio.run(main())
```

That's it. OpenAlerts monkey-patches OpenManus internals (`BaseAgent.run`, `ReActAgent.step`, `ToolCallAgent.execute_tool`, `LLM.ask_tool`, `LLM.ask`) so every event flows through the monitoring engine. Cleanup happens automatically on exit. All events are persisted to `~/.openalerts/` as JSONL.

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

# Generic webhook
{"type": "webhook", "webhook_url": "https://your-server.com/alerts", "headers": {"Authorization": "Bearer ..."}}
```

Or via environment variables (no code changes needed):

```bash
OPENALERTS_SLACK_WEBHOOK_URL="https://hooks.slack.com/services/..."
OPENALERTS_DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
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
openclaw plugins install @steadwing/openalerts
```

### Configure

If you already have a channel paired with OpenClaw (e.g. Telegram via `openclaw pair`), **no config is needed** - OpenAlerts auto-detects where to send alerts.

Otherwise, set it explicitly in `openclaw.json`:

```jsonc
{
  "plugins": {
    "entries": {
      "openalerts": {
        "enabled": true,
        "config": {
          "alertChannel": "telegram", // telegram | discord | slack | whatsapp | signal
          "alertTo": "YOUR_CHAT_ID"
        }
      }
    }
  }
}
```

**Auto-detection priority:** explicit config > static `allowFrom` in channel config > pairing store.

### Restart & verify

```bash
openclaw gateway stop && openclaw gateway run
```

Send `/health` to your bot. You should get a live status report back - zero LLM tokens consumed.

</details>

## Dashboard

A real-time web dashboard starts automatically and shows everything happening inside your agents:

- **Activity** - Step-by-step execution timeline with tool calls, LLM usage, costs
- **Health** - Rule status, alert history, system stats
- **Debug** - State snapshot for troubleshooting

Python: [http://localhost:9464/openalerts](http://localhost:9464/openalerts) | Node: `http://127.0.0.1:18789/openalerts`

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

## Commands

Zero-token chat commands available in any connected channel (Node plugin):

| Command | What it does |
|---|---|
| `/health` | System health snapshot — uptime, active alerts, stats |
| `/alerts` | Recent alert history with severity and timestamps |
| `/dashboard` | Returns the dashboard URL |

## Roadmap

- [x] [OpenClaw](https://github.com/openclaw/openclaw) adapter (Node)
- [x] [OpenManus](https://github.com/FoundationAgents/OpenManus) adapter (Python)
- [ ] [nanobot](https://github.com/HKUDS/nanobot) adapter

## Development

```bash
# Node plugin
npm install && npm run build

# Python package
cd python && pip install -e ".[dev]"
pytest
```

## License

Apache-2.0

---

<p align="center">Made by <a href="https://github.com/steadwing">Steadwing</a></p>
