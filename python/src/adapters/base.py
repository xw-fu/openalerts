from __future__ import annotations

import asyncio
import contextvars
import uuid
from abc import ABC, abstractmethod
from typing import Any

from openalerts.core.engine import OpenAlertsEngine
from openalerts.core.types import OpenAlertsEvent

# Context variables shared across all adapters for session tracking
_current_session_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "_current_session_id", default=None
)
_seq_counter: contextvars.ContextVar[int] = contextvars.ContextVar(
    "_seq_counter", default=0
)
_current_agent_name: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "_current_agent_name", default=None
)
_current_agent_class: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "_current_agent_class", default=None
)


class BaseAdapter(ABC):
    """Abstract base class for framework adapters.

    Provides shared infrastructure for monkey-patching adapters:
    - Context variable management for session/agent tracking
    - Sequence numbering for event ordering
    - Fire-and-forget emit helpers for sync method wrappers
    """

    def __init__(self) -> None:
        self._originals: dict[str, Any] = {}
        self._engine: OpenAlertsEngine | None = None

    @property
    @abstractmethod
    def name(self) -> str:
        """Framework name (e.g. 'openmanus', 'nanobot')."""
        ...

    @abstractmethod
    def patch(self, engine: OpenAlertsEngine) -> None:
        """Install monkey-patches on the framework classes."""
        ...

    @abstractmethod
    def unpatch(self) -> None:
        """Restore all original methods."""
        ...

    # ------------------------------------------------------------------
    # Sequence counter
    # ------------------------------------------------------------------
    @staticmethod
    def _next_seq() -> int:
        """Increment and return the next sequence number for the current session."""
        val = _seq_counter.get(0) + 1
        _seq_counter.set(val)
        return val

    # ------------------------------------------------------------------
    # Session helpers
    # ------------------------------------------------------------------
    @staticmethod
    def _new_session() -> str:
        """Generate a new UUID session id."""
        return str(uuid.uuid4())

    @staticmethod
    def _get_session_id() -> str | None:
        return _current_session_id.get(None)

    @staticmethod
    def _get_agent_name() -> str | None:
        return _current_agent_name.get(None)

    @staticmethod
    def _get_agent_class() -> str | None:
        return _current_agent_class.get(None)

    @staticmethod
    def _set_session_context(
        session_id: str,
        agent_name: str | None = None,
        agent_class: str | None = None,
    ) -> tuple[Any, Any, Any, Any]:
        """Set all four context vars. Returns tokens for reset."""
        sid_token = _current_session_id.set(session_id)
        seq_token = _seq_counter.set(0)
        name_token = _current_agent_name.set(agent_name)
        class_token = _current_agent_class.set(agent_class)
        return sid_token, seq_token, name_token, class_token

    @staticmethod
    def _reset_session_context(tokens: tuple[Any, Any, Any, Any]) -> None:
        """Reset all four context vars from saved tokens."""
        sid_token, seq_token, name_token, class_token = tokens
        _current_session_id.reset(sid_token)
        _seq_counter.reset(seq_token)
        _current_agent_name.reset(name_token)
        _current_agent_class.reset(class_token)

    # ------------------------------------------------------------------
    # Event emission
    # ------------------------------------------------------------------
    async def _emit(self, event: OpenAlertsEvent) -> None:
        """Emit an event to the engine (async)."""
        if self._engine:
            await self._engine.ingest(event)

    def _emit_fire_and_forget(self, event: OpenAlertsEvent) -> None:
        """Emit an event from a sync context (fire-and-forget)."""
        if not self._engine:
            return
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._engine.ingest(event))
        except RuntimeError:
            pass

    # ------------------------------------------------------------------
    # Meta builder
    # ------------------------------------------------------------------
    @staticmethod
    def _make_meta(**extra: Any) -> dict[str, Any]:
        """Build meta dict with seq number and optional extras."""
        session_id = _current_session_id.get(None)
        meta: dict[str, Any] = {}
        if session_id:
            meta["seq"] = BaseAdapter._next_seq()
        meta.update(extra)
        return meta if meta else {}
