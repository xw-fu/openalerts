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

logger = logging.getLogger("openalerts.adapters.nanobot")


class NanobotAdapter(BaseAdapter):
    """Monkey-patching adapter for the nanobot-ai agent framework.

    Patches the nanobot class hierarchy to emit monitoring events:
      AgentLoop._process_message()    -> agent.start / agent.end / agent.error
      AgentLoop._run_agent_loop()     -> agent.stuck (when max_iterations hit)
      LLMProvider.chat()              -> llm.call / llm.error / llm.token_usage / agent.step
      ToolRegistry.execute()          -> tool.call / tool.error
      SubagentManager.spawn()         -> subagent.spawn
      SubagentManager._run_subagent() -> subagent.end / subagent.error

    Session tracking: Each _process_message() invocation gets a unique session_id
    via contextvars, allowing all nested events to be correlated.

    Token tracking: LLMResponse.usage dict provides prompt_tokens/completion_tokens/
    total_tokens directly.

    SubagentManager is optional — not all nanobot versions include it.
    """

    @property
    def name(self) -> str:
        return "nanobot"

    def patch(self, engine: OpenAlertsEngine) -> None:
        self._engine = engine

        try:
            from nanobot.agent.loop import AgentLoop
        except ImportError as e:
            raise ImportError(
                "nanobot-ai not found. Install it: pip install nanobot-ai"
            ) from e

        try:
            from nanobot.providers.base import LLMProvider
        except ImportError:
            LLMProvider = None  # type: ignore[assignment, misc]

        try:
            from nanobot.agent.tools.registry import ToolRegistry
        except ImportError:
            ToolRegistry = None  # type: ignore[assignment, misc]

        try:
            from nanobot.agent.subagent import SubagentManager
        except ImportError:
            SubagentManager = None  # type: ignore[assignment, misc]

        self._patch_agent_loop(AgentLoop, engine)
        self._patch_run_agent_loop(AgentLoop, engine)

        if LLMProvider is not None:
            self._patch_llm_provider(LLMProvider, engine)
            # Also patch concrete subclasses that override chat() — the base
            # class patch alone won't intercept calls on overriding subclasses.
            for sub_module, sub_class in (
                ("nanobot.providers.litellm_provider", "LiteLLMProvider"),
                ("nanobot.providers.custom_provider", "CustomProvider"),
                ("nanobot.providers.openai_codex_provider", "OpenAICodexProvider"),
            ):
                try:
                    import importlib

                    mod = importlib.import_module(sub_module)
                    sub_cls = getattr(mod, sub_class)
                    if hasattr(sub_cls, "chat") and sub_cls.chat is not LLMProvider.chat:
                        self._patch_llm_provider(sub_cls, engine, key_prefix=sub_class)
                except (ImportError, AttributeError):
                    pass

        if ToolRegistry is not None:
            self._patch_tool_registry(ToolRegistry, engine)

        if SubagentManager is not None:
            self._patch_subagent_spawn(SubagentManager, engine)
            self._patch_run_subagent(SubagentManager, engine)

        logger.info("Nanobot adapter patched successfully")

    # ------------------------------------------------------------------
    # AgentLoop._process_message() -> agent.start / agent.end / agent.error
    # ------------------------------------------------------------------
    def _patch_agent_loop(self, cls: type, engine: OpenAlertsEngine) -> None:
        original = cls._process_message
        self._originals["AgentLoop._process_message"] = original

        # Step counter per session for AGENT_STEP events emitted from LLM patches
        self._step_counters: dict[str, int] = {}

        async def patched_process_message(self_agent: Any, message: Any, *args: Any, **kwargs: Any) -> Any:
            agent_name = getattr(self_agent, "name", None) or getattr(self_agent, "agent_name", None)
            agent_class = type(self_agent).__name__
            session_id = self._new_session()
            start = time.time()

            self._step_counters[session_id] = 0
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
                    result = await original(self_agent, message, *args, **kwargs)
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
                self._step_counters.pop(session_id, None)
                self._reset_session_context(tokens)

        cls._process_message = patched_process_message

    # ------------------------------------------------------------------
    # AgentLoop._run_agent_loop() -> agent.stuck (max_iterations hit)
    # ------------------------------------------------------------------
    def _patch_run_agent_loop(self, cls: type, engine: OpenAlertsEngine) -> None:
        if not hasattr(cls, "_run_agent_loop"):
            return

        original = cls._run_agent_loop
        self._originals["AgentLoop._run_agent_loop"] = original

        async def patched_run_agent_loop(self_agent: Any, *args: Any, **kwargs: Any) -> Any:
            result = await original(self_agent, *args, **kwargs)

            # Detect if max_iterations was reached
            max_iter = getattr(self_agent, "max_iterations", None)
            current_iter = getattr(self_agent, "current_iteration", None)
            if max_iter and current_iter and current_iter >= max_iter:
                session_id = self._get_session_id()
                agent_name = getattr(self_agent, "name", None) or getattr(self_agent, "agent_name", None)
                await engine.ingest(OpenAlertsEvent(
                    type=EventType.AGENT_STUCK,
                    session_id=session_id,
                    agent_name=agent_name,
                    agent_class=type(self_agent).__name__,
                    severity=Severity.WARN,
                    step_number=current_iter,
                    max_steps=max_iter,
                    meta={"seq": self._next_seq()} if session_id else None,
                ))

            return result

        cls._run_agent_loop = patched_run_agent_loop

    # ------------------------------------------------------------------
    # LLMProvider.chat() -> llm.call / llm.error / llm.token_usage / agent.step
    # ------------------------------------------------------------------
    def _patch_llm_provider(self, cls: type, engine: OpenAlertsEngine, key_prefix: str = "LLMProvider") -> None:
        original = cls.chat
        self._originals[f"{key_prefix}.chat"] = original

        async def patched_chat(self_provider: Any, *args: Any, **kwargs: Any) -> Any:
            session_id = _current_session_id.get(None)
            agent_name = _current_agent_name.get(None)
            agent_class = _current_agent_class.get(None)
            start = time.time()

            try:
                result = await original(self_provider, *args, **kwargs)
                duration_ms = (time.time() - start) * 1000

                # Extract token usage from LLMResponse
                usage = getattr(result, "usage", None) or {}
                if isinstance(usage, dict):
                    input_tokens = usage.get("prompt_tokens", 0)
                    completion_tokens = usage.get("completion_tokens", 0)
                    total_tokens = usage.get("total_tokens", 0) or (input_tokens + completion_tokens)
                else:
                    input_tokens = getattr(usage, "prompt_tokens", 0)
                    completion_tokens = getattr(usage, "completion_tokens", 0)
                    total_tokens = getattr(usage, "total_tokens", 0) or (input_tokens + completion_tokens)

                await engine.ingest(OpenAlertsEvent(
                    type=EventType.LLM_CALL,
                    session_id=session_id,
                    agent_name=agent_name,
                    agent_class=agent_class,
                    duration_ms=duration_ms,
                    token_count=total_tokens if total_tokens > 0 else None,
                    outcome="success",
                    meta={"seq": self._next_seq()} if session_id else None,
                ))

                if total_tokens > 0:
                    await engine.ingest(OpenAlertsEvent(
                        type=EventType.LLM_TOKEN_USAGE,
                        session_id=session_id,
                        agent_name=agent_name,
                        agent_class=agent_class,
                        token_count=total_tokens,
                        meta={
                            "input_tokens": input_tokens,
                            "completion_tokens": completion_tokens,
                            "model": getattr(self_provider, "model", None) or getattr(self_provider, "model_name", None),
                            **({"seq": self._next_seq()} if session_id else {}),
                        },
                    ))

                # Each LLM call = one agent step
                if session_id and hasattr(self, "_step_counters") and session_id in self._step_counters:
                    self._step_counters[session_id] += 1
                    step_num = self._step_counters[session_id]
                    max_steps = None
                    await engine.ingest(OpenAlertsEvent(
                        type=EventType.AGENT_STEP,
                        session_id=session_id,
                        agent_name=agent_name,
                        agent_class=agent_class,
                        step_number=step_num,
                        max_steps=max_steps,
                        duration_ms=duration_ms,
                        meta={"seq": self._next_seq()},
                    ))

                return result
            except Exception as e:
                duration_ms = (time.time() - start) * 1000
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

        cls.chat = patched_chat

    # ------------------------------------------------------------------
    # ToolRegistry.execute() -> tool.call / tool.error
    # ------------------------------------------------------------------
    def _patch_tool_registry(self, cls: type, engine: OpenAlertsEngine) -> None:
        original = cls.execute
        self._originals["ToolRegistry.execute"] = original

        async def patched_execute(self_registry: Any, *args: Any, **kwargs: Any) -> Any:
            # Try to extract tool name from arguments
            tool_name = None
            if args:
                tool_name = args[0] if isinstance(args[0], str) else None
            if tool_name is None:
                tool_name = kwargs.get("tool_name") or kwargs.get("name")

            session_id = _current_session_id.get(None)
            agent_name = _current_agent_name.get(None)
            start = time.time()

            try:
                result = await original(self_registry, *args, **kwargs)
                duration_ms = (time.time() - start) * 1000

                # Detect error patterns in return strings
                is_error = False
                if isinstance(result, str):
                    is_error = result.startswith("Error:") or "[Analyze the error" in result

                if is_error:
                    await engine.ingest(OpenAlertsEvent(
                        type=EventType.TOOL_ERROR,
                        session_id=session_id,
                        agent_name=agent_name,
                        tool_name=tool_name,
                        duration_ms=duration_ms,
                        error=result[:500] if isinstance(result, str) else str(result),
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
            except Exception as e:
                duration_ms = (time.time() - start) * 1000
                await engine.ingest(OpenAlertsEvent(
                    type=EventType.TOOL_ERROR,
                    session_id=session_id,
                    agent_name=agent_name,
                    tool_name=tool_name,
                    duration_ms=duration_ms,
                    error=str(e),
                    severity=Severity.WARN,
                    meta={"seq": self._next_seq()} if session_id else None,
                ))
                raise

        cls.execute = patched_execute

    # ------------------------------------------------------------------
    # SubagentManager.spawn() -> subagent.spawn
    # ------------------------------------------------------------------
    def _patch_subagent_spawn(self, cls: type, engine: OpenAlertsEngine) -> None:
        if not hasattr(cls, "spawn"):
            return

        original = cls.spawn
        self._originals["SubagentManager.spawn"] = original

        async def patched_spawn(self_manager: Any, *args: Any, **kwargs: Any) -> Any:
            parent_session_id = _current_session_id.get(None)
            sub_session_id = self._new_session()
            sub_agent_name = None
            if args:
                sub_agent_name = args[0] if isinstance(args[0], str) else None
            if sub_agent_name is None:
                sub_agent_name = kwargs.get("name") or kwargs.get("agent_name")

            await engine.ingest(OpenAlertsEvent(
                type=EventType.SUBAGENT_SPAWN,
                session_id=sub_session_id,
                parent_session_id=parent_session_id,
                agent_name=sub_agent_name,
                meta={
                    "parent_session_id": parent_session_id,
                    **({"seq": self._next_seq()} if parent_session_id else {}),
                },
            ))

            result = await original(self_manager, *args, **kwargs)
            return result

        cls.spawn = patched_spawn

    # ------------------------------------------------------------------
    # SubagentManager._run_subagent() -> subagent.end / subagent.error
    # ------------------------------------------------------------------
    def _patch_run_subagent(self, cls: type, engine: OpenAlertsEngine) -> None:
        if not hasattr(cls, "_run_subagent"):
            return

        original = cls._run_subagent
        self._originals["SubagentManager._run_subagent"] = original

        async def patched_run_subagent(self_manager: Any, *args: Any, **kwargs: Any) -> Any:
            parent_session_id = _current_session_id.get(None)
            sub_session_id = self._new_session()
            sub_agent_name = None
            if args:
                sub_agent_name = args[0] if isinstance(args[0], str) else None
            if sub_agent_name is None:
                sub_agent_name = kwargs.get("name") or kwargs.get("agent_name")

            start = time.time()
            try:
                result = await original(self_manager, *args, **kwargs)
                duration_ms = (time.time() - start) * 1000
                await engine.ingest(OpenAlertsEvent(
                    type=EventType.SUBAGENT_END,
                    session_id=sub_session_id,
                    parent_session_id=parent_session_id,
                    agent_name=sub_agent_name,
                    duration_ms=duration_ms,
                    outcome="success",
                    meta={
                        "parent_session_id": parent_session_id,
                        **({"seq": self._next_seq()} if parent_session_id else {}),
                    },
                ))
                return result
            except Exception as e:
                duration_ms = (time.time() - start) * 1000
                await engine.ingest(OpenAlertsEvent(
                    type=EventType.SUBAGENT_ERROR,
                    session_id=sub_session_id,
                    parent_session_id=parent_session_id,
                    agent_name=sub_agent_name,
                    duration_ms=duration_ms,
                    error=str(e),
                    severity=Severity.ERROR,
                    meta={
                        "parent_session_id": parent_session_id,
                        **({"seq": self._next_seq()} if parent_session_id else {}),
                    },
                ))
                raise

        cls._run_subagent = patched_run_subagent

    # ------------------------------------------------------------------
    # Unpatch: restore all original methods
    # ------------------------------------------------------------------
    def unpatch(self) -> None:
        _class_map = {
            "AgentLoop": "nanobot.agent.loop",
            "LLMProvider": "nanobot.providers.base",
            "LiteLLMProvider": "nanobot.providers.litellm_provider",
            "CustomProvider": "nanobot.providers.custom_provider",
            "OpenAICodexProvider": "nanobot.providers.openai_codex_provider",
            "ToolRegistry": "nanobot.agent.tools.registry",
            "SubagentManager": "nanobot.agent.subagent",
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
        if hasattr(self, "_step_counters"):
            self._step_counters.clear()
        logger.info("Nanobot adapter unpatched")
