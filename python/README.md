# OpenAlerts

Real-time monitoring & alerting SDK for AI agent frameworks. Supports [CrewAI](https://github.com/crewAIInc/crewAI), [OpenManus](https://github.com/FoundationAgents/OpenManus), and [nanobot](https://github.com/HKUDS/nanobot).

Every LLM call, tool execution, agent step, and error is tracked automatically. When things go wrong, you get an alert. A real-time dashboard is included.

## Install

```bash
pip install openalerts

# For CrewAI support
pip install openalerts crewai
```

## Usage

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
| `subagent-errors` | Subagent failures in 1-min window | WARN |

## API

```python
engine = await openalerts.init({...})   # async init
engine = openalerts.init_sync({...})    # sync init
await openalerts.send_test_alert()      # verify channels
engine = openalerts.get_engine()        # get engine instance
await openalerts.shutdown()             # optional — runs automatically on exit
```

Full documentation: [github.com/steadwing/openalerts](https://github.com/steadwing/openalerts)
