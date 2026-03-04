from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any

from openalerts.adapters.base import BaseAdapter
from openalerts.core.engine import OpenAlertsEngine
from openalerts.core.types import EventType, OpenAlertsEvent, Severity

logger = logging.getLogger("openalerts.adapters.crewai")

_MAX_DICT_SIZE = 1000


def _bounded_set(d: dict, key: Any, value: Any) -> None:
    """Set a key in a dict, evicting oldest entry if over the size limit."""
    if len(d) >= _MAX_DICT_SIZE and key not in d:
        try:
            oldest = next(iter(d))
            del d[oldest]
        except StopIteration:
            pass
    d[key] = value


@dataclass
class _CrewSession:
    session_id: str
    crew_name: str | None = None
    start_time: float = field(default_factory=time.time)
    total_tasks: int = 0


@dataclass
class _AgentSession:
    session_id: str
    parent_session_id: str | None = None
    agent_name: str | None = None
    start_time: float = field(default_factory=time.time)


class CrewAIAdapter(BaseAdapter):
    """Event-bus adapter for the CrewAI multi-agent framework.

    Subscribes to CrewAI's native event bus via a BaseEventListener subclass,
    using the ``@bus.on(EventType)`` decorator pattern.

    Handlers run in CrewAI's thread-pool executor, so all event emission
    uses ``asyncio.run_coroutine_threadsafe`` with the loop captured at
    ``patch()`` time.

    Conceptual mapping:
      Crew      -> session  (agent.start / agent.end)
      Agent     -> subagent (subagent.spawn / subagent.end)
      Task      -> agent.step
      Tool use  -> tool.call / tool.error
      LLM call  -> llm.call / llm.error / llm.token_usage
    """

    def __init__(self) -> None:
        super().__init__()
        self._active: bool = False
        self._listener: Any = None
        self._loop: asyncio.AbstractEventLoop | None = None
        self._crew_sessions: dict[str, _CrewSession] = {}
        self._agent_sessions: dict[str, _AgentSession] = {}
        self._llm_start_times: dict[str, float] = {}
        self._step_counters: dict[str, int] = {}

    @property
    def name(self) -> str:
        return "crewai"

    # ------------------------------------------------------------------
    # Thread-safe emit
    # ------------------------------------------------------------------
    def _emit_safe(self, event: OpenAlertsEvent) -> None:
        """Emit an event from any thread (thread-safe).

        - From within a running event loop: uses ``loop.create_task()``.
        - From a thread-pool worker (real CrewAI): uses
          ``asyncio.run_coroutine_threadsafe()`` with the loop captured at
          ``patch()`` time.
        """
        if not self._engine or not self._active:
            return
        # Fast path: called from within an async context (tests, or async code)
        try:
            loop = asyncio.get_running_loop()
            loop.create_task(self._engine.ingest(event))
            return
        except RuntimeError:
            pass
        # Slow path: called from a thread-pool worker (real CrewAI handlers)
        if self._loop and self._loop.is_running():
            asyncio.run_coroutine_threadsafe(self._engine.ingest(event), self._loop)

    # ------------------------------------------------------------------
    # Patch / Unpatch
    # ------------------------------------------------------------------
    def patch(self, engine: OpenAlertsEngine) -> None:
        self._engine = engine
        self._active = True

        # Capture the running event loop for thread-safe emission
        try:
            self._loop = asyncio.get_running_loop()
        except RuntimeError:
            self._loop = None

        try:
            from crewai.events.base_event_listener import BaseEventListener
        except ImportError as e:
            raise ImportError(
                "crewai not found. Install it: pip install 'crewai>=1.9.0'"
            ) from e

        adapter = self

        class _OpenAlertsListener(BaseEventListener):
            def setup_listeners(self_, bus: Any) -> None:  # noqa: N805
                from crewai.events import (
                    CrewKickoffCompletedEvent,
                    CrewKickoffFailedEvent,
                    CrewKickoffStartedEvent,
                    LLMCallCompletedEvent,
                    LLMCallFailedEvent,
                    LLMCallStartedEvent,
                    TaskFailedEvent,
                    TaskStartedEvent,
                    ToolUsageErrorEvent,
                    ToolUsageFinishedEvent,
                    ToolUsageStartedEvent,
                )
                from crewai.events.types.agent_events import (
                    AgentExecutionCompletedEvent,
                    AgentExecutionErrorEvent,
                    AgentExecutionStartedEvent,
                )

                # --- Crew lifecycle ---
                @bus.on(CrewKickoffStartedEvent)
                def on_crew_started(source: Any, event: Any) -> None:
                    adapter._handle_crew_started(source, event)

                @bus.on(CrewKickoffCompletedEvent)
                def on_crew_completed(source: Any, event: Any) -> None:
                    adapter._handle_crew_completed(source, event)

                @bus.on(CrewKickoffFailedEvent)
                def on_crew_failed(source: Any, event: Any) -> None:
                    adapter._handle_crew_failed(source, event)

                # --- Agent lifecycle ---
                @bus.on(AgentExecutionStartedEvent)
                def on_agent_started(source: Any, event: Any) -> None:
                    adapter._handle_agent_started(source, event)

                @bus.on(AgentExecutionCompletedEvent)
                def on_agent_completed(source: Any, event: Any) -> None:
                    adapter._handle_agent_completed(source, event)

                @bus.on(AgentExecutionErrorEvent)
                def on_agent_error(source: Any, event: Any) -> None:
                    adapter._handle_agent_error(source, event)

                # --- Task lifecycle ---
                @bus.on(TaskStartedEvent)
                def on_task_started(source: Any, event: Any) -> None:
                    adapter._handle_task_started(source, event)

                @bus.on(TaskFailedEvent)
                def on_task_failed(source: Any, event: Any) -> None:
                    adapter._handle_task_failed(source, event)

                # --- Tool lifecycle ---
                @bus.on(ToolUsageStartedEvent)
                def on_tool_started(source: Any, event: Any) -> None:
                    adapter._handle_tool_started(source, event)

                @bus.on(ToolUsageFinishedEvent)
                def on_tool_finished(source: Any, event: Any) -> None:
                    adapter._handle_tool_finished(source, event)

                @bus.on(ToolUsageErrorEvent)
                def on_tool_error(source: Any, event: Any) -> None:
                    adapter._handle_tool_error(source, event)

                # --- LLM lifecycle ---
                @bus.on(LLMCallStartedEvent)
                def on_llm_started(source: Any, event: Any) -> None:
                    adapter._handle_llm_started(source, event)

                @bus.on(LLMCallCompletedEvent)
                def on_llm_completed(source: Any, event: Any) -> None:
                    adapter._handle_llm_completed(source, event)

                @bus.on(LLMCallFailedEvent)
                def on_llm_failed(source: Any, event: Any) -> None:
                    adapter._handle_llm_failed(source, event)

        self._listener = _OpenAlertsListener()
        logger.info("CrewAI adapter patched (event bus listener connected)")

    def unpatch(self) -> None:
        self._active = False
        self._listener = None
        self._crew_sessions.clear()
        self._agent_sessions.clear()
        self._llm_start_times.clear()
        self._step_counters.clear()
        self._engine = None
        self._loop = None
        logger.info("CrewAI adapter unpatched")

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _crew_key(self, source: Any) -> str:
        """Get a stable key for a Crew object."""
        return str(getattr(source, "id", None) or id(source))

    def _agent_key(self, agent: Any) -> str:
        return str(getattr(agent, "id", None) or getattr(agent, "role", None) or id(agent))

    def _find_crew_session_from_source(self, source: Any) -> _CrewSession | None:
        return self._crew_sessions.get(self._crew_key(source))

    def _find_any_crew_session(self) -> _CrewSession | None:
        """Fallback: return any active crew session."""
        for cs in self._crew_sessions.values():
            return cs
        return None

    # ------------------------------------------------------------------
    # Crew handlers
    # ------------------------------------------------------------------
    def _handle_crew_started(self, source: Any, event: Any) -> None:
        if not self._active:
            return
        key = self._crew_key(source)
        session_id = self._new_session()
        crew_name = getattr(event, "crew_name", None) or getattr(source, "name", None) or "Crew"
        total_tasks = len(getattr(source, "tasks", []))

        cs = _CrewSession(
            session_id=session_id,
            crew_name=crew_name,
            start_time=time.time(),
            total_tasks=total_tasks,
        )
        _bounded_set(self._crew_sessions, key, cs)
        _bounded_set(self._step_counters, session_id, 0)

        self._emit_safe(OpenAlertsEvent(
            type=EventType.AGENT_START,
            session_id=session_id,
            agent_name=crew_name,
            agent_class="Crew",
            meta={"framework": "crewai"},
        ))

    def _handle_crew_completed(self, source: Any, event: Any) -> None:
        if not self._active:
            return
        cs = self._find_crew_session_from_source(source)
        if cs is None:
            return

        duration_ms = (time.time() - cs.start_time) * 1000
        total_tokens = getattr(event, "total_tokens", 0) or 0

        if total_tokens > 0:
            self._emit_safe(OpenAlertsEvent(
                type=EventType.LLM_TOKEN_USAGE,
                session_id=cs.session_id,
                agent_name=cs.crew_name,
                agent_class="Crew",
                token_count=total_tokens,
                meta={"scope": "crew_total"},
            ))

        self._emit_safe(OpenAlertsEvent(
            type=EventType.AGENT_END,
            session_id=cs.session_id,
            agent_name=cs.crew_name,
            agent_class="Crew",
            duration_ms=duration_ms,
            outcome="success",
            token_count=total_tokens if total_tokens > 0 else None,
        ))

        self._step_counters.pop(cs.session_id, None)
        self._crew_sessions.pop(self._crew_key(source), None)

    def _handle_crew_failed(self, source: Any, event: Any) -> None:
        if not self._active:
            return
        cs = self._find_crew_session_from_source(source)
        if cs is None:
            return

        duration_ms = (time.time() - cs.start_time) * 1000
        error = str(getattr(event, "error", "Unknown error"))

        self._emit_safe(OpenAlertsEvent(
            type=EventType.AGENT_ERROR,
            session_id=cs.session_id,
            agent_name=cs.crew_name,
            agent_class="Crew",
            duration_ms=duration_ms,
            error=error,
            severity=Severity.ERROR,
        ))

        self._step_counters.pop(cs.session_id, None)
        self._crew_sessions.pop(self._crew_key(source), None)

    # ------------------------------------------------------------------
    # Agent handlers (source = agent instance in real CrewAI)
    # ------------------------------------------------------------------
    def _handle_agent_started(self, source: Any, event: Any) -> None:
        if not self._active:
            return
        agent = getattr(event, "agent", source)
        agent_key = self._agent_key(agent)
        agent_name = getattr(agent, "role", None) or str(agent)

        # Find parent crew session
        parent_session_id = None
        crew = getattr(agent, "crew", None)
        if crew:
            cs = self._find_crew_session_from_source(crew)
            if cs:
                parent_session_id = cs.session_id

        sub_session_id = self._new_session()
        ags = _AgentSession(
            session_id=sub_session_id,
            parent_session_id=parent_session_id,
            agent_name=agent_name,
            start_time=time.time(),
        )
        _bounded_set(self._agent_sessions, agent_key, ags)

        self._emit_safe(OpenAlertsEvent(
            type=EventType.SUBAGENT_SPAWN,
            session_id=sub_session_id,
            parent_session_id=parent_session_id,
            agent_name=agent_name,
            agent_class=type(agent).__name__,
        ))

    def _handle_agent_completed(self, source: Any, event: Any) -> None:
        if not self._active:
            return
        agent = getattr(event, "agent", source)
        agent_key = self._agent_key(agent)
        ags = self._agent_sessions.get(agent_key)
        if ags is None:
            return

        duration_ms = (time.time() - ags.start_time) * 1000

        # Detect stuck: check if agent hit max_iter
        max_iter = getattr(agent, "max_iter", None)
        iterations = getattr(agent, "iterations", None)
        if max_iter and iterations and iterations >= max_iter:
            self._emit_safe(OpenAlertsEvent(
                type=EventType.AGENT_STUCK,
                session_id=ags.session_id,
                parent_session_id=ags.parent_session_id,
                agent_name=ags.agent_name,
                severity=Severity.WARN,
                step_number=iterations,
                max_steps=max_iter,
            ))

        self._emit_safe(OpenAlertsEvent(
            type=EventType.SUBAGENT_END,
            session_id=ags.session_id,
            parent_session_id=ags.parent_session_id,
            agent_name=ags.agent_name,
            duration_ms=duration_ms,
            outcome="success",
        ))

        self._agent_sessions.pop(agent_key, None)

    def _handle_agent_error(self, source: Any, event: Any) -> None:
        if not self._active:
            return
        agent = getattr(event, "agent", source)
        agent_key = self._agent_key(agent)
        ags = self._agent_sessions.get(agent_key)

        session_id = ags.session_id if ags else None
        parent_session_id = ags.parent_session_id if ags else None
        agent_name = ags.agent_name if ags else getattr(agent, "role", None)
        duration_ms = (time.time() - ags.start_time) * 1000 if ags else None
        error = str(getattr(event, "error", "Unknown error"))

        self._emit_safe(OpenAlertsEvent(
            type=EventType.SUBAGENT_ERROR,
            session_id=session_id,
            parent_session_id=parent_session_id,
            agent_name=agent_name,
            duration_ms=duration_ms,
            error=error,
            severity=Severity.ERROR,
        ))

        self._agent_sessions.pop(agent_key, None)

    # ------------------------------------------------------------------
    # Task handlers (source = Task instance in real CrewAI)
    # ------------------------------------------------------------------
    def _handle_task_started(self, source: Any, event: Any) -> None:
        if not self._active:
            return
        # In real CrewAI: source is the Task, source.agent.crew is the Crew
        crew = None
        agent = getattr(source, "agent", None)
        if agent:
            crew = getattr(agent, "crew", None)

        cs = self._find_crew_session_from_source(crew) if crew else None
        if cs is None:
            cs = self._find_any_crew_session()
        if cs is None:
            return

        session_id = cs.session_id
        step_num = self._step_counters.get(session_id, 0) + 1
        _bounded_set(self._step_counters, session_id, step_num)

        task_desc = getattr(source, "name", None) or getattr(source, "description", None) or ""

        self._emit_safe(OpenAlertsEvent(
            type=EventType.AGENT_STEP,
            session_id=session_id,
            agent_name=cs.crew_name,
            agent_class="Crew",
            step_number=step_num,
            max_steps=cs.total_tasks if cs.total_tasks > 0 else None,
            meta={"task_description": str(task_desc)[:200]} if task_desc else None,
        ))

    def _handle_task_failed(self, source: Any, event: Any) -> None:
        if not self._active:
            return
        crew = None
        agent = getattr(source, "agent", None)
        if agent:
            crew = getattr(agent, "crew", None)

        cs = self._find_crew_session_from_source(crew) if crew else None
        if cs is None:
            cs = self._find_any_crew_session()

        session_id = cs.session_id if cs else None
        agent_name = cs.crew_name if cs else None
        error = str(getattr(event, "error", "Task failed"))

        self._emit_safe(OpenAlertsEvent(
            type=EventType.AGENT_STEP,
            session_id=session_id,
            agent_name=agent_name,
            agent_class="Crew",
            error=error,
            severity=Severity.WARN,
        ))

    # ------------------------------------------------------------------
    # Tool handlers
    # ------------------------------------------------------------------
    def _handle_tool_started(self, source: Any, event: Any) -> None:
        if not self._active:
            return
        # Just record timestamp — ToolUsageFinishedEvent has started_at/finished_at
        # but we also track here for ToolUsageErrorEvent which doesn't have them

    def _handle_tool_finished(self, source: Any, event: Any) -> None:
        if not self._active:
            return
        tool_name = getattr(event, "tool_name", None) or "unknown"
        agent_id = getattr(event, "agent_id", None)

        # Compute duration from event timestamps
        started_at = getattr(event, "started_at", None)
        finished_at = getattr(event, "finished_at", None)
        duration_ms = None
        if started_at and finished_at:
            duration_ms = (finished_at - started_at).total_seconds() * 1000

        ags = self._agent_sessions.get(str(agent_id)) if agent_id else None
        session_id = ags.session_id if ags else None
        agent_name = ags.agent_name if ags else getattr(event, "agent_role", None)

        self._emit_safe(OpenAlertsEvent(
            type=EventType.TOOL_CALL,
            session_id=session_id,
            agent_name=agent_name,
            tool_name=tool_name,
            duration_ms=duration_ms,
            outcome="success",
        ))

    def _handle_tool_error(self, source: Any, event: Any) -> None:
        if not self._active:
            return
        tool_name = getattr(event, "tool_name", None) or "unknown"
        agent_id = getattr(event, "agent_id", None)
        error = str(getattr(event, "error", "Tool error"))

        ags = self._agent_sessions.get(str(agent_id)) if agent_id else None
        session_id = ags.session_id if ags else None
        agent_name = ags.agent_name if ags else getattr(event, "agent_role", None)

        self._emit_safe(OpenAlertsEvent(
            type=EventType.TOOL_ERROR,
            session_id=session_id,
            agent_name=agent_name,
            tool_name=tool_name,
            error=error,
            severity=Severity.WARN,
        ))

    # ------------------------------------------------------------------
    # LLM handlers
    # ------------------------------------------------------------------
    def _handle_llm_started(self, source: Any, event: Any) -> None:
        if not self._active:
            return
        # Track start time keyed by agent_id (LLM calls are sequential per agent)
        key = getattr(event, "agent_id", None) or "default"
        _bounded_set(self._llm_start_times, str(key), time.time())

    def _handle_llm_completed(self, source: Any, event: Any) -> None:
        if not self._active:
            return
        agent_id = getattr(event, "agent_id", None)
        key = str(agent_id or "default")
        start = self._llm_start_times.pop(key, None)
        duration_ms = (time.time() - start) * 1000 if start else None

        ags = self._agent_sessions.get(str(agent_id)) if agent_id else None
        session_id = ags.session_id if ags else None
        agent_name = ags.agent_name if ags else getattr(event, "agent_role", None)
        model = getattr(event, "model", None)

        # Extract token usage from response.usage (litellm ModelResponse)
        response = getattr(event, "response", None)
        usage = getattr(response, "usage", None) if response else None
        input_tokens = 0
        completion_tokens = 0
        total_tokens = 0

        if usage is not None:
            if isinstance(usage, dict):
                input_tokens = usage.get("prompt_tokens", 0) or 0
                completion_tokens = usage.get("completion_tokens", 0) or 0
                total_tokens = usage.get("total_tokens", 0) or (input_tokens + completion_tokens)
            else:
                input_tokens = getattr(usage, "prompt_tokens", 0) or 0
                completion_tokens = getattr(usage, "completion_tokens", 0) or 0
                total_tokens = getattr(usage, "total_tokens", 0) or (input_tokens + completion_tokens)

        self._emit_safe(OpenAlertsEvent(
            type=EventType.LLM_CALL,
            session_id=session_id,
            agent_name=agent_name,
            duration_ms=duration_ms,
            token_count=total_tokens if total_tokens > 0 else None,
            outcome="success",
            meta={"model": model} if model else None,
        ))

        if total_tokens > 0:
            self._emit_safe(OpenAlertsEvent(
                type=EventType.LLM_TOKEN_USAGE,
                session_id=session_id,
                agent_name=agent_name,
                token_count=total_tokens,
                meta={
                    "input_tokens": input_tokens,
                    "completion_tokens": completion_tokens,
                    "model": model,
                },
            ))

    def _handle_llm_failed(self, source: Any, event: Any) -> None:
        if not self._active:
            return
        agent_id = getattr(event, "agent_id", None)
        key = str(agent_id or "default")
        start = self._llm_start_times.pop(key, None)
        duration_ms = (time.time() - start) * 1000 if start else None

        ags = self._agent_sessions.get(str(agent_id)) if agent_id else None
        session_id = ags.session_id if ags else None
        agent_name = ags.agent_name if ags else getattr(event, "agent_role", None)
        error = str(getattr(event, "error", "LLM call failed"))

        self._emit_safe(OpenAlertsEvent(
            type=EventType.LLM_ERROR,
            session_id=session_id,
            agent_name=agent_name,
            duration_ms=duration_ms,
            error=error,
            severity=Severity.ERROR,
        ))
