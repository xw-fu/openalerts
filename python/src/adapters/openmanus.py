from __future__ import annotations

import logging
import time
from typing import Any

from openalerts.adapters.base import (
    BaseAdapter,
    _current_agent_class,
    _current_agent_name,
    _current_session_id,
)
from openalerts.core.engine import OpenAlertsEngine
from openalerts.core.types import EventType, OpenAlertsEvent, Severity

logger = logging.getLogger("openalerts.adapters.openmanus")


class OpenManusAdapter(BaseAdapter):
    """Monkey-patching adapter for OpenManus agent framework.

    Patches the OpenManus class hierarchy to emit monitoring events:
      BaseAgent.run()              -> agent.start / agent.end / agent.error
      ReActAgent.step()            -> agent.step (with step_number / max_steps)
      BaseAgent.is_stuck()         -> agent.stuck
      ToolCallAgent.execute_tool() -> tool.call / tool.error (detected from return value)
      LLM.ask_tool()               -> llm.call / llm.error / llm.token_usage / token.limit_exceeded
      LLM.ask()                    -> llm.call / llm.error / llm.token_usage / token.limit_exceeded

    OpenManus's execute_tool() catches all exceptions internally and returns
    error strings prefixed with "Error:". This adapter detects that pattern
    to emit tool.error events rather than relying on exception propagation.

    Session tracking: Each agent.run() invocation gets a unique session_id via
    contextvars, allowing all nested events (steps, tool calls, LLM calls) to
    be correlated to the same session.
    """

    @property
    def name(self) -> str:
        return "openmanus"

    def patch(self, engine: OpenAlertsEngine) -> None:
        self._engine = engine

        try:
            from app.agent.base import BaseAgent
            from app.agent.react import ReActAgent
            from app.agent.toolcall import ToolCallAgent
            from app.llm import LLM
        except ImportError as e:
            raise ImportError(
                "OpenManus not found. Install it or ensure app/ is on your Python path."
            ) from e

        self._patch_base_agent_run(BaseAgent, engine)
        self._patch_react_agent_step(ReActAgent, engine)
        self._patch_is_stuck(BaseAgent, engine)
        self._patch_execute_tool(ToolCallAgent, engine)
        self._patch_llm(LLM, engine)

        logger.info("OpenManus adapter patched successfully")

    # ------------------------------------------------------------------
    # BaseAgent.run() -> agent.start / agent.end / agent.error
    # ------------------------------------------------------------------
    def _patch_base_agent_run(self, cls: type, engine: OpenAlertsEngine) -> None:
        original_run = cls.run
        self._originals["BaseAgent.run"] = original_run

        async def patched_run(self_agent: Any, request: str | None = None) -> str:
            agent_name = getattr(self_agent, "name", None)
            agent_class = type(self_agent).__name__
            session_id = self._new_session()
            start = time.time()

            tokens = self._set_session_context(session_id, agent_name, agent_class)

            try:
                await engine.ingest(OpenAlertsEvent(
                    type=EventType.AGENT_START,
                    session_id=session_id,
                    agent_name=agent_name,
                    agent_class=agent_class,
                    meta={"seq": self._next_seq()},
                ))
                try:
                    result = await original_run(self_agent, request)
                    duration_ms = (time.time() - start) * 1000
                    await engine.ingest(OpenAlertsEvent(
                        type=EventType.AGENT_END,
                        session_id=session_id,
                        agent_name=agent_name,
                        agent_class=agent_class,
                        duration_ms=duration_ms,
                        outcome="success",
                        meta={"seq": self._next_seq()},
                    ))
                    return result
                except Exception as e:
                    duration_ms = (time.time() - start) * 1000
                    await engine.ingest(OpenAlertsEvent(
                        type=EventType.AGENT_ERROR,
                        session_id=session_id,
                        agent_name=agent_name,
                        agent_class=agent_class,
                        duration_ms=duration_ms,
                        error=str(e),
                        severity=Severity.ERROR,
                        meta={"seq": self._next_seq()},
                    ))
                    raise
            finally:
                self._reset_session_context(tokens)

        cls.run = patched_run

    # ------------------------------------------------------------------
    # ReActAgent.step() -> agent.step
    # ------------------------------------------------------------------
    def _patch_react_agent_step(self, cls: type, engine: OpenAlertsEngine) -> None:
        original_step = cls.step
        self._originals["ReActAgent.step"] = original_step

        async def patched_step(self_agent: Any) -> str:
            step_num = getattr(self_agent, "current_step", None)
            max_steps = getattr(self_agent, "max_steps", None)
            session_id = self._get_session_id()
            start = time.time()

            result = await original_step(self_agent)
            duration_ms = (time.time() - start) * 1000

            await engine.ingest(OpenAlertsEvent(
                type=EventType.AGENT_STEP,
                session_id=session_id,
                agent_name=getattr(self_agent, "name", None),
                agent_class=type(self_agent).__name__,
                step_number=step_num,
                max_steps=max_steps,
                duration_ms=duration_ms,
                meta={"seq": self._next_seq()} if session_id else None,
            ))
            return result

        cls.step = patched_step

    # ------------------------------------------------------------------
    # BaseAgent.is_stuck() -> agent.stuck (sync method, fire-and-forget)
    # ------------------------------------------------------------------
    def _patch_is_stuck(self, cls: type, engine: OpenAlertsEngine) -> None:
        if not hasattr(cls, "is_stuck"):
            return

        original_is_stuck = cls.is_stuck
        self._originals["BaseAgent.is_stuck"] = original_is_stuck

        def patched_is_stuck(self_agent: Any) -> bool:
            result = original_is_stuck(self_agent)
            if result:
                session_id = self._get_session_id()
                self._emit_fire_and_forget(OpenAlertsEvent(
                    type=EventType.AGENT_STUCK,
                    session_id=session_id,
                    agent_name=getattr(self_agent, "name", None),
                    agent_class=type(self_agent).__name__,
                    severity=Severity.WARN,
                    meta={"seq": self._next_seq()} if session_id else None,
                ))
            return result

        cls.is_stuck = patched_is_stuck

    # ------------------------------------------------------------------
    # ToolCallAgent.execute_tool() -> tool.call / tool.error
    # ------------------------------------------------------------------
    def _patch_execute_tool(self, cls: type, engine: OpenAlertsEngine) -> None:
        if not hasattr(cls, "execute_tool"):
            return

        original_execute = cls.execute_tool
        self._originals["ToolCallAgent.execute_tool"] = original_execute

        async def patched_execute_tool(self_agent: Any, command: Any) -> str:
            tool_name = None
            if command and hasattr(command, "function"):
                tool_name = getattr(command.function, "name", None)

            agent_name = getattr(self_agent, "name", None)
            session_id = self._get_session_id()
            start = time.time()

            result = await original_execute(self_agent, command)
            duration_ms = (time.time() - start) * 1000

            is_error = isinstance(result, str) and result.startswith("Error:")

            if is_error:
                await engine.ingest(OpenAlertsEvent(
                    type=EventType.TOOL_ERROR,
                    session_id=session_id,
                    agent_name=agent_name,
                    tool_name=tool_name,
                    duration_ms=duration_ms,
                    error=result,
                    severity=Severity.WARN,
                    meta={"seq": self._next_seq()} if session_id else None,
                ))
            else:
                await engine.ingest(OpenAlertsEvent(
                    type=EventType.TOOL_CALL,
                    session_id=session_id,
                    agent_name=agent_name,
                    tool_name=tool_name,
                    duration_ms=duration_ms,
                    outcome="success",
                    meta={"seq": self._next_seq()} if session_id else None,
                ))

            return result

        cls.execute_tool = patched_execute_tool

    # ------------------------------------------------------------------
    # LLM.ask_tool() / LLM.ask() -> llm.call / llm.error / llm.token_usage
    # ------------------------------------------------------------------
    def _patch_llm(self, cls: type, engine: OpenAlertsEngine) -> None:
        for method_name in ("ask_tool", "ask"):
            if not hasattr(cls, method_name):
                continue

            original = getattr(cls, method_name)
            self._originals[f"LLM.{method_name}"] = original

            async def patched_llm_method(
                self_llm: Any,
                *args: Any,
                _original: Any = original,
                **kwargs: Any,
            ) -> Any:
                input_before = getattr(self_llm, "total_input_tokens", 0)
                completion_before = getattr(self_llm, "total_completion_tokens", 0)
                session_id = _current_session_id.get(None)
                agent_name = _current_agent_name.get(None)
                agent_class = _current_agent_class.get(None)
                start = time.time()

                try:
                    result = await _original(self_llm, *args, **kwargs)
                    duration_ms = (time.time() - start) * 1000

                    input_delta = getattr(self_llm, "total_input_tokens", 0) - input_before
                    completion_delta = getattr(self_llm, "total_completion_tokens", 0) - completion_before
                    token_count = input_delta + completion_delta

                    await engine.ingest(OpenAlertsEvent(
                        type=EventType.LLM_CALL,
                        session_id=session_id,
                        agent_name=agent_name,
                        agent_class=agent_class,
                        duration_ms=duration_ms,
                        token_count=token_count if token_count > 0 else None,
                        outcome="success",
                        meta={"seq": self._next_seq()} if session_id else None,
                    ))

                    if token_count > 0:
                        await engine.ingest(OpenAlertsEvent(
                            type=EventType.LLM_TOKEN_USAGE,
                            session_id=session_id,
                            agent_name=agent_name,
                            agent_class=agent_class,
                            token_count=token_count,
                            meta={
                                "input_tokens": input_delta,
                                "completion_tokens": completion_delta,
                                "model": getattr(self_llm, "model", None),
                                **({"seq": self._next_seq()} if session_id else {}),
                            },
                        ))

                    return result
                except Exception as e:
                    duration_ms = (time.time() - start) * 1000

                    cause = getattr(e, "__cause__", e)
                    is_token_limit = type(cause).__name__ == "TokenLimitExceeded"

                    if is_token_limit:
                        await engine.ingest(OpenAlertsEvent(
                            type=EventType.TOKEN_LIMIT,
                            session_id=session_id,
                            agent_name=agent_name,
                            agent_class=agent_class,
                            duration_ms=duration_ms,
                            error=str(cause),
                            severity=Severity.ERROR,
                            meta={"seq": self._next_seq()} if session_id else None,
                        ))

                    await engine.ingest(OpenAlertsEvent(
                        type=EventType.LLM_ERROR,
                        session_id=session_id,
                        agent_name=agent_name,
                        agent_class=agent_class,
                        duration_ms=duration_ms,
                        error=str(e),
                        severity=Severity.ERROR,
                        meta={"seq": self._next_seq()} if session_id else None,
                    ))
                    raise

            setattr(cls, method_name, patched_llm_method)

    # ------------------------------------------------------------------
    # Unpatch: restore all original methods
    # ------------------------------------------------------------------
    def unpatch(self) -> None:
        _class_map = {
            "BaseAgent": "app.agent.base",
            "ReActAgent": "app.agent.react",
            "ToolCallAgent": "app.agent.toolcall",
            "LLM": "app.llm",
        }

        for key, original in self._originals.items():
            cls_name, method_name = key.split(".")
            module_path = _class_map.get(cls_name)
            if not module_path:
                continue
            try:
                import importlib

                mod = importlib.import_module(module_path)
                cls = getattr(mod, cls_name)
                setattr(cls, method_name, original)
            except (ImportError, AttributeError):
                pass

        self._originals.clear()
        self._engine = None
        logger.info("OpenManus adapter unpatched")
