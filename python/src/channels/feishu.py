"""Feishu alert channel — posts to a custom bot webhook directly.

Feishu custom bots support a "keyword" security setting that requires
messages to contain at least one configured keyword. Pass ``keyword``
so the channel injects it automatically.
"""
from __future__ import annotations

import logging

import httpx

from openalerts.core.formatter import format_alert
from openalerts.core.types import AlertEvent

logger = logging.getLogger("openalerts.channels.feishu")

_SEVERITY_EMOJI = {
    "info": "ℹ️",
    "warn": "⚠️",
    "error": "❌",
    "critical": "🚨",
}


class FeishuChannel:
    def __init__(
        self,
        webhook_url: str,
        keyword: str = "",
        display_name: str | None = None,
    ) -> None:
        self._webhook_url = webhook_url
        self._keyword = keyword
        self._display_name = display_name or "feishu"
        self._client = httpx.AsyncClient(timeout=5.0)

    @property
    def name(self) -> str:
        return self._display_name

    async def send(self, alert: AlertEvent) -> None:
        emoji = _SEVERITY_EMOJI.get(alert.severity, "")
        tag = f" [{self._keyword}]" if self._keyword else ""
        text = f"{emoji}{tag} {format_alert(alert)}"

        payload = {"msg_type": "text", "content": {"text": text}}

        try:
            resp = await self._client.post(self._webhook_url, json=payload)
            resp.raise_for_status()
        except httpx.HTTPError as e:
            logger.error("Feishu delivery failed: %s", e)
