from __future__ import annotations

import json
import logging
import time
from collections import OrderedDict, deque
from dataclasses import dataclass, field
from pathlib import Path

from openalerts.core.config import OpenAlertsConfig
from openalerts.core.rules import AlertRule
from openalerts.core.types import AlertEvent, OpenAlertsEvent

logger = logging.getLogger("openalerts.evaluator")

# Max entries in the cooldown map before evicting oldest (from TS BoundedMap)
MAX_COOLDOWN_ENTRIES = 50
MAX_WINDOW_ENTRIES = 100


class BoundedDict(OrderedDict):
    """OrderedDict that evicts the oldest entries when max_size is exceeded.

    Ported from the TS package's BoundedMap to prevent unbounded memory growth
    in long-running agents.
    """

    def __init__(self, max_size: int, *args, **kwargs):
        self._max_size = max_size
        super().__init__(*args, **kwargs)

    def __setitem__(self, key, value):
        super().__setitem__(key, value)
        self.move_to_end(key)
        while len(self) > self._max_size:
            self.popitem(last=False)


@dataclass
class RuleContext:
    """Context passed to rules during evaluation."""

    _windows: dict[str, deque[OpenAlertsEvent]]
    _config: OpenAlertsConfig

    def get_window(self, rule_id: str, window_seconds: int = 60) -> list[OpenAlertsEvent]:
        """Return events within the time window for a given rule."""
        window = self._windows.get(rule_id, deque())
        cutoff = time.time() - window_seconds
        return [e for e in window if e.ts >= cutoff]

    def get_threshold(self, rule_id: str, default: int | float) -> int | float:
        override = self._config.rules.get(rule_id)
        if override and override.threshold is not None:
            return override.threshold
        return default


@dataclass
class EvaluatorState:
    windows: dict[str, deque[OpenAlertsEvent]] = field(default_factory=dict)
    cooldowns: BoundedDict = field(
        default_factory=lambda: BoundedDict(MAX_COOLDOWN_ENTRIES)
    )
    alerts_this_hour: int = 0
    hour_start: float = field(default_factory=time.time)
    startup_time: float = field(default_factory=time.time)
    stats: dict[str, int] = field(default_factory=dict)


def _is_rule_enabled(config: OpenAlertsConfig, rule_id: str) -> bool:
    override = config.rules.get(rule_id)
    if override and override.enabled is not None:
        return override.enabled
    return True


def _get_cooldown(config: OpenAlertsConfig, rule: AlertRule) -> int:
    # Priority: per-rule override > global config > rule default
    override = config.rules.get(rule.id)
    if override and override.cooldown_seconds is not None:
        return override.cooldown_seconds
    if config.cooldown_seconds != 900:  # non-default global override
        return config.cooldown_seconds
    return rule.default_cooldown_seconds


def _is_cooled_down(state: EvaluatorState, fingerprint: str, cooldown_seconds: int) -> bool:
    entry = state.cooldowns.get(fingerprint)
    if entry is None:
        return True
    # Support both old format (float) and new format (dict with "ts")
    ts = entry["ts"] if isinstance(entry, dict) else entry
    return (time.time() - ts) >= cooldown_seconds


def _reset_hour_if_needed(state: EvaluatorState) -> None:
    now = time.time()
    if now - state.hour_start >= 3600:
        state.alerts_this_hour = 0
        state.hour_start = now


def process_event(
    state: EvaluatorState,
    config: OpenAlertsConfig,
    event: OpenAlertsEvent,
    rules: list[AlertRule],
) -> list[AlertEvent]:
    """Run all rules against an event. Returns fired alerts (post-cooldown)."""
    _reset_hour_if_needed(state)
    fired: list[AlertEvent] = []

    # Add event only to relevant rule windows (bounded)
    for rule in rules:
        rule_types = getattr(rule, "event_types", None)
        if rule_types and event.type not in rule_types:
            continue
        if rule.id not in state.windows:
            state.windows[rule.id] = deque(maxlen=MAX_WINDOW_ENTRIES)
        state.windows[rule.id].append(event)

    for rule in rules:
        if not _is_rule_enabled(config, rule.id):
            continue

        ctx = RuleContext(_windows=state.windows, _config=config)
        alert = rule.evaluate(event, ctx)
        if alert is None:
            continue

        cooldown = _get_cooldown(config, rule)
        if not _is_cooled_down(state, alert.fingerprint, cooldown):
            continue

        if state.alerts_this_hour >= config.max_alerts_per_hour:
            continue

        state.cooldowns[alert.fingerprint] = {
            "ts": time.time(),
            "rule_id": rule.id,
        }
        state.alerts_this_hour += 1
        state.stats[rule.id] = state.stats.get(rule.id, 0) + 1
        fired.append(alert)

    return fired


def warm_from_history(
    state: EvaluatorState,
    state_dir: Path,
    rules: list[AlertRule],
) -> None:
    """Replay persisted alert events to restore cooldown state on restart.

    Ported from the TS package's warmFromHistory(). Only restores cooldown
    timestamps — does NOT re-fire alerts. This prevents duplicate alerts
    after an SDK restart.
    """
    log_path = state_dir / "events.jsonl"
    if not log_path.exists():
        return

    count = 0
    try:
        with open(log_path) as f:
            for line in f:
                stripped = line.strip()
                if not stripped:
                    continue
                try:
                    data = json.loads(stripped)
                    # Look for alert-like events (they have rule_id and fingerprint)
                    if "rule_id" in data and "fingerprint" in data:
                        state.cooldowns[data["fingerprint"]] = {
                            "ts": data.get("ts", 0),
                            "rule_id": data["rule_id"],
                        }
                        count += 1
                except (json.JSONDecodeError, KeyError):
                    continue
    except OSError:
        logger.warning("Could not read history for warmup: %s", log_path)

    if count:
        logger.info("Warmed %d cooldown entries from history", count)
