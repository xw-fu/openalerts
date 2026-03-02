"""Shared fixtures for OpenAlerts tests."""

from __future__ import annotations

import asyncio
import sys
import types
from typing import Any
from unittest.mock import AsyncMock

import pytest

from openalerts.core.config import OpenAlertsConfig
from openalerts.core.engine import OpenAlertsEngine
from openalerts.core.types import OpenAlertsEvent


# ---------------------------------------------------------------------------
# Mock nanobot module hierarchy
# ---------------------------------------------------------------------------

def _make_nanobot_modules() -> dict[str, types.ModuleType]:
    """Build a fake nanobot package with the classes the adapter expects."""

    # --- AgentLoop ---
    class AgentLoop:
        name = "test-agent"

        async def _process_message(self, message: str, *args: Any, **kwargs: Any) -> str:
            return f"echo:{message}"

        async def _run_agent_loop(self, *args: Any, **kwargs: Any) -> None:
            pass

    # --- LLMProvider ---
    class _LLMResponse:
        def __init__(self, usage: dict | None = None) -> None:
            self.usage = usage or {}

    class LLMProvider:
        model = "mock-model"

        async def chat(self, *args: Any, **kwargs: Any) -> _LLMResponse:
            return _LLMResponse({"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15})

    # --- ToolRegistry ---
    class ToolRegistry:
        async def execute(self, *args: Any, **kwargs: Any) -> str:
            return "ok"

    # --- SubagentManager ---
    class SubagentManager:
        async def spawn(self, *args: Any, **kwargs: Any) -> Any:
            return {"id": "sub-1"}

        async def _run_subagent(self, *args: Any, **kwargs: Any) -> str:
            return "sub-result"

    # Build module tree
    mod_nanobot = types.ModuleType("nanobot")
    mod_agent = types.ModuleType("nanobot.agent")
    mod_loop = types.ModuleType("nanobot.agent.loop")
    mod_tools = types.ModuleType("nanobot.agent.tools")
    mod_registry = types.ModuleType("nanobot.agent.tools.registry")
    mod_subagent = types.ModuleType("nanobot.agent.subagent")
    mod_providers = types.ModuleType("nanobot.providers")
    mod_providers_base = types.ModuleType("nanobot.providers.base")

    mod_loop.AgentLoop = AgentLoop  # type: ignore[attr-defined]
    mod_providers_base.LLMProvider = LLMProvider  # type: ignore[attr-defined]
    mod_registry.ToolRegistry = ToolRegistry  # type: ignore[attr-defined]
    mod_subagent.SubagentManager = SubagentManager  # type: ignore[attr-defined]

    # Also expose helpers for tests
    mod_loop._LLMResponse = _LLMResponse  # type: ignore[attr-defined]

    return {
        "nanobot": mod_nanobot,
        "nanobot.agent": mod_agent,
        "nanobot.agent.loop": mod_loop,
        "nanobot.agent.tools": mod_tools,
        "nanobot.agent.tools.registry": mod_registry,
        "nanobot.agent.subagent": mod_subagent,
        "nanobot.providers": mod_providers,
        "nanobot.providers.base": mod_providers_base,
    }


@pytest.fixture()
def mock_nanobot_modules():
    """Install fake nanobot modules into sys.modules, yield, then remove them."""
    mods = _make_nanobot_modules()
    originals = {k: sys.modules.get(k) for k in mods}
    sys.modules.update(mods)
    yield mods
    # Cleanup
    for key, orig in originals.items():
        if orig is None:
            sys.modules.pop(key, None)
        else:
            sys.modules[key] = orig


# ---------------------------------------------------------------------------
# Engine fixture (no persistence, no dashboard)
# ---------------------------------------------------------------------------

@pytest.fixture()
async def engine(tmp_path):
    """Create a real OpenAlertsEngine with persist=False and dashboard=False."""
    cfg = OpenAlertsConfig(
        framework="openmanus",
        persist=False,
        dashboard=False,
        quiet=True,
        state_dir=str(tmp_path / "openalerts"),
    )
    eng = OpenAlertsEngine(cfg)
    await eng.start()
    yield eng
    await eng.stop()


# ---------------------------------------------------------------------------
# Event collector
# ---------------------------------------------------------------------------

@pytest.fixture()
def collected_events(engine: OpenAlertsEngine) -> list[OpenAlertsEvent]:
    """Attach a listener that collects all events emitted through the engine bus."""
    events: list[OpenAlertsEvent] = []

    async def _collect(event: OpenAlertsEvent) -> None:
        events.append(event)

    engine.bus.on(_collect)
    return events
