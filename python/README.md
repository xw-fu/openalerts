# OpenAlerts

Real-time monitoring & alerting SDK for AI agent frameworks. Currently supports [OpenManus](https://github.com/FoundationAgents/OpenManus).

Every LLM call, tool execution, agent step, and error is tracked automatically. When things go wrong, you get an alert. A real-time dashboard is included.

## Install

```bash
pip install openalerts
```

## Usage

```python
import asyncio
import openalerts
from app.agent.manus import Manus

async def main():
    # Dashboard starts at http://localhost:9464/openalerts
    await openalerts.init({})

    # Use your agents as normal — they're automatically monitored
    agent = Manus()
    await agent.run("Research quantum computing")

asyncio.run(main())
```

That's it. A real-time dashboard starts at [http://localhost:9464/openalerts](http://localhost:9464/openalerts). OpenAlerts monkey-patches OpenManus internals (`BaseAgent.run`, `ReActAgent.step`, `ToolCallAgent.execute_tool`, `LLM.ask_tool`, `LLM.ask`) so every event flows through the monitoring engine. Cleanup happens automatically on exit. All events are persisted to `~/.openalerts/` as JSONL.

Optionally, add [channels](#channels) (Slack, Discord, webhooks) to get alerts delivered when things go wrong.

## Standalone Dashboard

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

## Channels

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

## Configuration

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

## Alert Rules

| Rule | Fires When | Severity |
|---|---|---|
| `llm-errors` | LLM API failures in 1-min window | ERROR |
| `tool-errors` | Tool execution failures in 1-min window | WARN |
| `agent-stuck` | Agent enters stuck state | WARN |
| `token-limit` | Token limit exceeded | ERROR |
| `step-limit-warning` | Agent reaches 80% of max_steps | WARN |
| `high-error-rate` | >50% of last 20 tool calls failed | ERROR |

## API

```python
engine = await openalerts.init({...})   # async init
engine = openalerts.init_sync({...})    # sync init
await openalerts.send_test_alert()      # verify channels
engine = openalerts.get_engine()        # get engine instance
await openalerts.shutdown()             # optional — runs automatically on exit
```

Full documentation: [github.com/steadwing/openalerts](https://github.com/steadwing/openalerts)
