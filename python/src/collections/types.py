from __future__ import annotations

import time
from typing import Any, Literal

from pydantic import BaseModel, Field


class MonitorSession(BaseModel):
    """Tracks a single agent run (maps to BaseAgent.run() invocation)."""

    session_id: str
    agent_name: str | None = None
    agent_class: str | None = None
    status: Literal["idle", "active", "completed", "error"] = "idle"
    started_at: float = Field(default_factory=time.time)
    ended_at: float | None = None
    duration_ms: float | None = None
    last_activity_at: float = Field(default_factory=time.time)
    step_count: int = 0
    tool_call_count: int = 0
    llm_call_count: int = 0
    total_cost_usd: float = 0.0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    error: str | None = None


class MonitorAction(BaseModel):
    """Individual event within a session (step, tool call, LLM call, etc.)."""

    id: str
    session_id: str
    seq: int = 0
    type: str  # EventType value e.g. "agent.start", "llm.call"
    timestamp: float = Field(default_factory=time.time)
    duration_ms: float | None = None
    agent_name: str | None = None
    tool_name: str | None = None
    token_count: int | None = None
    error: str | None = None
    meta: dict[str, Any] | None = None


class CollectionStats(BaseModel):
    """Summary stats for monitoring collections."""

    sessions: int = 0
    actions: int = 0
    total_cost_usd: float = 0.0
