from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path

from openalerts.collections.collection_manager import CollectionManager
from openalerts.collections.types import MonitorAction, MonitorSession

logger = logging.getLogger("openalerts.collections.persistence")

MAX_ACTION_LINES = 10_000
FLUSH_INTERVAL = 5  # seconds


class CollectionPersistence:
    """Persists monitoring sessions and actions to disk.

    - Sessions: atomic JSON rewrite to sessions.json (only when dirty)
    - Actions: JSONL append to actions.jsonl with line cap
    """

    def __init__(self, state_dir: Path) -> None:
        self._dir = state_dir / "collections"
        self._sessions_path = self._dir / "sessions.json"
        self._actions_path = self._dir / "actions.jsonl"
        self._action_queue: list[MonitorAction] = []
        self._flush_task: asyncio.Task | None = None
        self._running = False

    async def start(self) -> None:
        self._dir.mkdir(parents=True, exist_ok=True)
        self._running = True
        self._flush_task = asyncio.create_task(self._flush_loop())

    async def stop(self) -> None:
        self._running = False
        if self._flush_task and not self._flush_task.done():
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
            self._flush_task = None
        # Final flush
        await self._do_flush()

    def hydrate(self, manager: CollectionManager) -> None:
        """Load persisted sessions and actions into the manager on startup."""
        self._dir.mkdir(parents=True, exist_ok=True)
        loaded_sessions = 0
        loaded_actions = 0

        # Load sessions
        if self._sessions_path.exists():
            try:
                data = json.loads(self._sessions_path.read_text())
                for item in data:
                    session = MonitorSession.model_validate(item)
                    manager.upsert_session(
                        session.session_id,
                        agent_name=session.agent_name,
                        agent_class=session.agent_class,
                        status=session.status,
                        started_at=session.started_at,
                        ended_at=session.ended_at,
                        duration_ms=session.duration_ms,
                        last_activity_at=session.last_activity_at,
                        step_count=session.step_count,
                        tool_call_count=session.tool_call_count,
                        llm_call_count=session.llm_call_count,
                        total_cost_usd=session.total_cost_usd,
                        total_input_tokens=session.total_input_tokens,
                        total_output_tokens=session.total_output_tokens,
                        error=session.error,
                    )
                    loaded_sessions += 1
                manager.mark_sessions_clean()
            except Exception:
                logger.warning("Failed to load sessions from %s", self._sessions_path, exc_info=True)

        # Load actions
        if self._actions_path.exists():
            try:
                with open(self._actions_path) as f:
                    for line in f:
                        stripped = line.strip()
                        if not stripped:
                            continue
                        try:
                            action = MonitorAction.model_validate_json(stripped)
                            manager.add_action(action)
                            loaded_actions += 1
                        except Exception:
                            continue
            except Exception:
                logger.warning("Failed to load actions from %s", self._actions_path, exc_info=True)

        if loaded_sessions or loaded_actions:
            logger.info(
                "Hydrated %d sessions and %d actions from disk",
                loaded_sessions,
                loaded_actions,
            )

    def save_sessions(self, sessions: list[dict]) -> None:
        """Atomically write sessions to disk."""
        try:
            self._dir.mkdir(parents=True, exist_ok=True)
            tmp = self._sessions_path.with_suffix(".tmp")
            tmp.write_text(json.dumps(sessions, separators=(",", ":")))
            tmp.replace(self._sessions_path)
        except Exception:
            logger.debug("Failed to save sessions", exc_info=True)

    def queue_action(self, action: MonitorAction) -> None:
        """Queue an action for batched JSONL append."""
        self._action_queue.append(action)

    async def flush(self) -> None:
        """Flush queued actions to disk."""
        await self._do_flush()

    async def _do_flush(self) -> None:
        if not self._action_queue:
            return

        batch = self._action_queue[:]
        self._action_queue.clear()

        try:
            self._dir.mkdir(parents=True, exist_ok=True)
            lines = [a.model_dump_json() + "\n" for a in batch]
            with open(self._actions_path, "a") as f:
                f.writelines(lines)
            await self._trim_actions()
        except Exception:
            logger.debug("Failed to flush actions", exc_info=True)

    async def _trim_actions(self) -> None:
        """Cap the actions JSONL file to MAX_ACTION_LINES."""
        try:
            if not self._actions_path.exists():
                return
            with open(self._actions_path) as f:
                all_lines = f.readlines()
            if len(all_lines) <= MAX_ACTION_LINES:
                return
            keep = all_lines[-MAX_ACTION_LINES:]
            with open(self._actions_path, "w") as f:
                f.writelines(keep)
        except Exception:
            logger.debug("Failed to trim actions file", exc_info=True)

    async def _flush_loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(FLUSH_INTERVAL)
                await self._do_flush()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.debug("Flush loop error", exc_info=True)
