from __future__ import annotations

import asyncio
import logging
import time
import uuid
from collections import deque
from pathlib import Path

from openalerts.collections.collection_manager import CollectionManager
from openalerts.collections.persistence import CollectionPersistence
from openalerts.collections.types import CollectionStats, MonitorAction, MonitorSession
from openalerts.core.config import OpenAlertsConfig
from openalerts.core.dispatcher import AlertDispatcher
from openalerts.core.evaluator import EvaluatorState, process_event, warm_from_history
from openalerts.core.event_bus import OpenAlertsEventBus
from openalerts.core.rules import ALL_RULES, AlertRule
from openalerts.core.store import append_event, load_history, prune_log
from openalerts.core.types import AlertEvent, EventType, OpenAlertsEvent, Severity

logger = logging.getLogger("openalerts.engine")

_PRUNE_INTERVAL_SECONDS = 6 * 3600
_MAX_LIVE_EVENTS = 500


class OpenAlertsEngine:
    """Main orchestrator. Receives events, evaluates rules, dispatches alerts."""

    def __init__(self, config: OpenAlertsConfig) -> None:
        self._config = config
        self._bus = OpenAlertsEventBus()
        self._dispatcher = AlertDispatcher()
        self._state = EvaluatorState()
        self._rules: list[AlertRule] = list(ALL_RULES)
        self._running = False
        self._state_dir = (
            Path(config.state_dir) if config.state_dir else Path.home() / ".openalerts"
        )
        self._prune_task: asyncio.Task | None = None
        self._started_at: float = 0.0

        # Live events ring buffer for dashboard history replay
        self._live_events: deque[OpenAlertsEvent] = deque(maxlen=_MAX_LIVE_EVENTS)

        # Recent alerts ring buffer for dashboard
        self._recent_alerts: deque[AlertEvent] = deque(maxlen=50)

        # Alert listeners (for SSE push)
        self._alert_listeners: list[object] = []

        # Session listeners (for SSE push)
        self._session_listeners: list[object] = []

        # Action listeners (for SSE push)
        self._action_listeners: list[object] = []

        # Running stats counters
        self._stats: dict[str, int] = {
            "events_processed": 0,
            "llm_calls": 0,
            "llm_errors": 0,
            "tool_calls": 0,
            "tool_errors": 0,
            "agent_starts": 0,
            "agent_errors": 0,
            "agent_steps": 0,
            "tokens_used": 0,
        }

        # Monitoring collections
        self._collections = CollectionManager()
        self._persistence = CollectionPersistence(self._state_dir)
        self._session_save_task: asyncio.Task | None = None

        # Wire up the event bus
        self._bus.on(self._on_event)

    async def start(self) -> None:
        self._state_dir.mkdir(parents=True, exist_ok=True)
        warm_from_history(self._state, self._state_dir, self._rules)

        # Hydrate monitoring collections from disk
        self._persistence.hydrate(self._collections)

        # Load historical events/alerts so the dashboard has context on connect
        hist_events, hist_alerts = load_history(self._state_dir)
        for ev in hist_events:
            self._live_events.append(ev)
        for al in hist_alerts:
            self._recent_alerts.append(al)
        if hist_events or hist_alerts:
            logger.info(
                "Loaded %d events and %d alerts from history",
                len(hist_events),
                len(hist_alerts),
            )

        self._running = True
        self._started_at = time.time()
        self._prune_task = asyncio.create_task(self._prune_loop())
        self._session_save_task = asyncio.create_task(self._session_save_loop())
        await self._persistence.start()
        logger.info("OpenAlerts engine started (state_dir=%s)", self._state_dir)

    async def stop(self) -> None:
        self._running = False

        # Cancel periodic session save
        if self._session_save_task and not self._session_save_task.done():
            self._session_save_task.cancel()
            try:
                await self._session_save_task
            except asyncio.CancelledError:
                pass
            self._session_save_task = None

        # Flush persistence
        await self._persistence.stop()
        if self._collections.dirty_sessions:
            self._persistence.save_sessions(self._collections.export_sessions())
            self._collections.mark_sessions_clean()

        if self._prune_task and not self._prune_task.done():
            self._prune_task.cancel()
            try:
                await self._prune_task
            except asyncio.CancelledError:
                pass
            self._prune_task = None
        self._bus.clear()
        logger.info("OpenAlerts engine stopped")

    async def ingest(self, event: OpenAlertsEvent) -> None:
        if not self._running:
            return
        await self._bus.emit(event)

    async def _on_event(self, event: OpenAlertsEvent) -> None:
        # Track in live buffer
        self._live_events.append(event)

        # Update stats
        self._stats["events_processed"] += 1
        _stat_map = {
            EventType.LLM_CALL: "llm_calls",
            EventType.LLM_ERROR: "llm_errors",
            EventType.TOOL_CALL: "tool_calls",
            EventType.TOOL_ERROR: "tool_errors",
            EventType.AGENT_START: "agent_starts",
            EventType.AGENT_ERROR: "agent_errors",
            EventType.AGENT_STEP: "agent_steps",
        }
        stat_key = _stat_map.get(event.type)
        if stat_key:
            self._stats[stat_key] += 1
        if event.token_count and event.type == EventType.LLM_TOKEN_USAGE:
            self._stats["tokens_used"] += event.token_count

        # --- Monitoring: update collections ---
        await self._update_collections(event)

        # Persist
        if self._config.persist:
            try:
                await append_event(self._state_dir, event.model_dump_json())
            except Exception:
                logger.exception("Failed to persist event")

        # Evaluate rules
        alerts = process_event(self._state, self._config, event, self._rules)

        # Dispatch alerts
        for alert in alerts:
            self._recent_alerts.append(alert)
            if not self._config.quiet:
                logger.info("Alert fired: [%s] %s", alert.rule_id, alert.title)
                await self._dispatcher.dispatch(alert)
            else:
                logger.info("Alert (quiet mode): [%s] %s", alert.rule_id, alert.title)
            if self._config.persist:
                try:
                    await append_event(self._state_dir, alert.model_dump_json())
                except Exception:
                    logger.exception("Failed to persist alert")
            await self._notify_alert_listeners(alert)

    async def _update_collections(self, event: OpenAlertsEvent) -> None:
        """Map incoming events to monitoring sessions and actions."""
        session_id = event.session_id
        seq = event.meta.get("seq", 0) if event.meta else 0

        # Session lifecycle
        if event.type == EventType.AGENT_START and session_id:
            self._collections.upsert_session(
                session_id,
                agent_name=event.agent_name,
                agent_class=event.agent_class,
                status="active",
                started_at=event.ts,
            )
            session = self._collections._sessions.get(session_id)
            if session:
                await self._notify_session_listeners(session)

        elif event.type == EventType.AGENT_END and session_id:
            self._collections.upsert_session(
                session_id,
                status="completed",
                ended_at=event.ts,
                duration_ms=event.duration_ms,
            )
            session = self._collections._sessions.get(session_id)
            if session:
                await self._notify_session_listeners(session)

        elif event.type == EventType.AGENT_ERROR and session_id:
            self._collections.upsert_session(
                session_id,
                status="error",
                ended_at=event.ts,
                duration_ms=event.duration_ms,
                error=event.error,
            )
            session = self._collections._sessions.get(session_id)
            if session:
                await self._notify_session_listeners(session)

        elif event.type == EventType.AGENT_STEP and session_id:
            session = self._collections._sessions.get(session_id)
            if session:
                session.step_count += 1
                self._collections.upsert_session(session_id)
                await self._notify_session_listeners(session)

        elif event.type in (EventType.TOOL_CALL, EventType.TOOL_ERROR) and session_id:
            session = self._collections._sessions.get(session_id)
            if session:
                session.tool_call_count += 1
                self._collections.upsert_session(session_id)
                await self._notify_session_listeners(session)

        elif event.type == EventType.LLM_CALL and session_id:
            session = self._collections._sessions.get(session_id)
            if session:
                session.llm_call_count += 1
                self._collections.upsert_session(session_id)
                await self._notify_session_listeners(session)

        elif event.type == EventType.LLM_TOKEN_USAGE and session_id:
            input_tokens = 0
            output_tokens = 0
            if event.meta:
                input_tokens = event.meta.get("input_tokens", 0)
                output_tokens = event.meta.get("completion_tokens", 0)
            self._collections.update_session_cost(
                session_id,
                input_tokens=input_tokens,
                output_tokens=output_tokens,
            )
            session = self._collections._sessions.get(session_id)
            if session:
                await self._notify_session_listeners(session)

        # Record action for all events with a session_id
        if session_id:
            action = MonitorAction(
                id=str(uuid.uuid4()),
                session_id=session_id,
                seq=seq,
                type=str(event.type),
                timestamp=event.ts,
                duration_ms=event.duration_ms,
                agent_name=event.agent_name,
                tool_name=event.tool_name,
                token_count=event.token_count,
                error=event.error,
                meta=event.meta,
            )
            self._collections.add_action(action)
            self._persistence.queue_action(action)
            await self._notify_action_listeners(action)

    def on_alert(self, listener: object) -> None:
        """Subscribe to alert events. Listener is an async callable(AlertEvent)."""
        self._alert_listeners.append(listener)

    def on_session_update(self, listener: object) -> None:
        """Subscribe to session update events. Listener is an async callable(MonitorSession)."""
        self._session_listeners.append(listener)

    def on_action(self, listener: object) -> None:
        """Subscribe to action events. Listener is an async callable(MonitorAction)."""
        self._action_listeners.append(listener)

    async def _notify_alert_listeners(self, alert: AlertEvent) -> None:
        for listener in self._alert_listeners:
            try:
                await listener(alert)  # type: ignore[operator]
            except Exception:
                logger.debug("Alert listener error", exc_info=True)

    async def _notify_session_listeners(self, session: MonitorSession) -> None:
        for listener in self._session_listeners:
            try:
                await listener(session)  # type: ignore[operator]
            except Exception:
                logger.debug("Session listener error", exc_info=True)

    async def _notify_action_listeners(self, action: MonitorAction) -> None:
        for listener in self._action_listeners:
            try:
                await listener(action)  # type: ignore[operator]
            except Exception:
                logger.debug("Action listener error", exc_info=True)

    async def send_test_alert(self) -> None:
        alert = AlertEvent(
            rule_id="test",
            severity=Severity.INFO,
            title="OpenAlerts Test Alert",
            detail="This is a test alert to verify your alert channels are working.",
            fingerprint="test-alert",
            ts=time.time(),
        )
        logger.info("Sending test alert to %d channel(s)", self._dispatcher.channel_count)
        self._recent_alerts.append(alert)
        await self._dispatcher.dispatch(alert)

    def get_recent_live_events(self, limit: int = 200) -> list[OpenAlertsEvent]:
        events = list(self._live_events)
        return events[-limit:]

    def get_sessions(self) -> list[MonitorSession]:
        """Return all monitoring sessions."""
        return self._collections.get_sessions()

    def get_actions(
        self,
        session_id: str | None = None,
        limit: int | None = None,
    ) -> list[MonitorAction]:
        """Return monitoring actions, optionally filtered by session."""
        return self._collections.get_actions(session_id=session_id, limit=limit)

    def get_collection_stats(self) -> CollectionStats:
        """Return collection summary stats."""
        return self._collections.get_stats()

    def get_state_snapshot(self) -> dict:
        """Return a JSON-serializable state snapshot for the dashboard."""
        now = time.time()

        # Build last_fired timestamps per rule_id from recent alerts
        rule_last_fired: dict[str, float] = {}
        for a in self._recent_alerts:
            if a.rule_id not in rule_last_fired or a.ts > rule_last_fired[a.rule_id]:
                rule_last_fired[a.rule_id] = a.ts

        rule_statuses = []
        for rule in self._rules:
            last = rule_last_fired.get(rule.id)
            fired = last is not None and (now - last) < 900
            rule_statuses.append({
                "id": rule.id,
                "status": "fired" if fired else "ok",
                "last_fired": last,
            })

        # Collection stats
        coll_stats = self._collections.get_stats()

        return {
            "uptime_ms": (now - self._started_at) * 1000 if self._started_at else 0,
            "started_at": self._started_at * 1000 if self._started_at else 0,
            "stats": dict(self._stats),
            "bus_listeners": self._bus.size,
            "recent_alerts": [
                {
                    "rule_id": a.rule_id,
                    "severity": a.severity,
                    "title": a.title,
                    "detail": a.detail,
                    "ts": a.ts,
                }
                for a in self._recent_alerts
            ],
            "rules": rule_statuses,
            "cooldowns": {k: v for k, v in self._state.cooldowns.items()},
            "collections": coll_stats.model_dump(),
        }

    async def _session_save_loop(self) -> None:
        """Periodically save dirty sessions to disk (every 5 seconds)."""
        while self._running:
            try:
                await asyncio.sleep(5)
                if self._collections.dirty_sessions:
                    self._persistence.save_sessions(self._collections.export_sessions())
                    self._collections.mark_sessions_clean()
            except asyncio.CancelledError:
                break
            except Exception:
                logger.debug("Session save failed", exc_info=True)

    async def _prune_loop(self) -> None:
        while self._running:
            try:
                await asyncio.sleep(_PRUNE_INTERVAL_SECONDS)
                await prune_log(
                    self._state_dir,
                    max_size_kb=self._config.max_log_size_kb,
                    max_age_days=self._config.max_log_age_days,
                )
            except asyncio.CancelledError:
                break
            except Exception:
                logger.exception("Prune failed")

    def add_channel(self, channel: object) -> None:
        self._dispatcher.add_channel(channel)  # type: ignore[arg-type]

    @property
    def bus(self) -> OpenAlertsEventBus:
        return self._bus

    @property
    def is_running(self) -> bool:
        return self._running

    @property
    def config(self) -> OpenAlertsConfig:
        return self._config

    @property
    def state(self) -> EvaluatorState:
        return self._state

    @property
    def stats(self) -> dict[str, int]:
        return dict(self._stats)
