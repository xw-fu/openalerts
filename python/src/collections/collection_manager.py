from __future__ import annotations

import logging
import time
from typing import Any

from openalerts.core.evaluator import BoundedDict
from openalerts.collections.types import CollectionStats, MonitorAction, MonitorSession

logger = logging.getLogger("openalerts.collections")

MAX_SESSIONS = 200
MAX_ACTIONS = 2000


class CollectionManager:
    """Manages bounded collections of monitoring sessions and actions.

    Adapted from the Node package's CollectionManager for OpenManus integration.
    Sessions map to agent.run() invocations; actions are individual events within sessions.
    """

    def __init__(self) -> None:
        self._sessions: BoundedDict = BoundedDict(MAX_SESSIONS)
        self._actions: BoundedDict = BoundedDict(MAX_ACTIONS)
        self._dirty_sessions: bool = False

    def upsert_session(self, session_id: str, **fields: Any) -> MonitorSession:
        """Create or update a monitoring session."""
        existing = self._sessions.get(session_id)
        if existing is not None:
            for k, v in fields.items():
                if v is not None and hasattr(existing, k):
                    setattr(existing, k, v)
            # Only auto-update last_activity_at if not explicitly provided
            if "last_activity_at" not in fields:
                existing.last_activity_at = time.time()
        else:
            existing = MonitorSession(session_id=session_id, **fields)
        self._sessions[session_id] = existing
        self._dirty_sessions = True
        return existing

    def add_action(self, action: MonitorAction) -> None:
        """Add an action to the collection."""
        self._actions[action.id] = action

    def update_session_cost(
        self,
        session_id: str,
        cost: float = 0.0,
        input_tokens: int = 0,
        output_tokens: int = 0,
    ) -> None:
        """Accumulate token/cost data on a session."""
        session = self._sessions.get(session_id)
        if session is None:
            return
        session.total_cost_usd += cost
        session.total_input_tokens += input_tokens
        session.total_output_tokens += output_tokens
        session.last_activity_at = time.time()
        self._dirty_sessions = True

    def get_sessions(self) -> list[MonitorSession]:
        """Return all sessions, most recent first."""
        return list(reversed(self._sessions.values()))

    def get_active_sessions(self) -> list[MonitorSession]:
        """Return only active sessions."""
        return [s for s in self._sessions.values() if s.status == "active"]

    def get_actions(
        self,
        session_id: str | None = None,
        limit: int | None = None,
    ) -> list[MonitorAction]:
        """Query actions, optionally filtered by session_id."""
        actions: list[MonitorAction] = list(self._actions.values())
        if session_id is not None:
            actions = [a for a in actions if a.session_id == session_id]
        # Most recent first
        actions.reverse()
        if limit is not None:
            actions = actions[:limit]
        return actions

    def get_stats(self) -> CollectionStats:
        """Return summary stats."""
        total_cost = sum(s.total_cost_usd for s in self._sessions.values())
        return CollectionStats(
            sessions=len(self._sessions),
            actions=len(self._actions),
            total_cost_usd=total_cost,
        )

    def clear(self) -> None:
        """Clear all collections."""
        self._sessions.clear()
        self._actions.clear()
        self._dirty_sessions = False

    def export_sessions(self) -> list[dict]:
        """Export sessions as JSON-serializable dicts."""
        return [s.model_dump(mode="json") for s in self._sessions.values()]

    def export_actions(self) -> list[dict]:
        """Export actions as JSON-serializable dicts."""
        return [a.model_dump(mode="json") for a in self._actions.values()]

    @property
    def dirty_sessions(self) -> bool:
        return self._dirty_sessions

    def mark_sessions_clean(self) -> None:
        self._dirty_sessions = False
