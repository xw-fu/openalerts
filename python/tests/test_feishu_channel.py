"""Tests for the Feishu alert channel."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock, patch

import pytest

from openalerts.channels.feishu import FeishuChannel
from openalerts.core.types import AlertEvent, Severity


def _make_alert(severity: str = "error") -> AlertEvent:
    return AlertEvent(
        rule_id="test-rule",
        severity=severity,
        title="Test alert",
        detail="Something went wrong",
        fingerprint="test:fp",
    )


class TestFeishuChannel:
    def test_name_defaults_to_feishu(self) -> None:
        ch = FeishuChannel("https://open.feishu.cn/open-apis/bot/v2/hook/test")
        assert ch.name == "feishu"

    def test_name_uses_display_name(self) -> None:
        ch = FeishuChannel("https://example.com/hook", display_name="my-feishu")
        assert ch.name == "my-feishu"

    @pytest.mark.asyncio
    async def test_posts_correct_feishu_json_format(self) -> None:
        ch = FeishuChannel("https://open.feishu.cn/open-apis/bot/v2/hook/abc")
        alert = _make_alert()

        mock_resp = AsyncMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status = AsyncMock()

        with patch.object(ch._client, "post", return_value=mock_resp) as mock_post:
            await ch.send(alert)

            mock_post.assert_called_once()
            _, kwargs = mock_post.call_args
            payload = kwargs["json"]
            assert payload["msg_type"] == "text"
            assert "text" in payload["content"]
            assert isinstance(payload["content"]["text"], str)

    @pytest.mark.asyncio
    async def test_includes_severity_emoji(self) -> None:
        ch = FeishuChannel("https://example.com/hook")

        for severity, emoji in [
            ("critical", "🚨"),
            ("error", "❌"),
            ("warn", "⚠️"),
            ("info", "ℹ️"),
        ]:
            alert = _make_alert(severity)
            mock_resp = AsyncMock()
            mock_resp.raise_for_status = AsyncMock()

            with patch.object(ch._client, "post", return_value=mock_resp) as mock_post:
                await ch.send(alert)
                payload = mock_post.call_args[1]["json"]
                assert payload["content"]["text"].startswith(emoji), (
                    f"Expected text to start with {emoji} for {severity}"
                )

    @pytest.mark.asyncio
    async def test_includes_keyword_when_configured(self) -> None:
        ch = FeishuChannel("https://example.com/hook", keyword="alert")
        alert = _make_alert()

        mock_resp = AsyncMock()
        mock_resp.raise_for_status = AsyncMock()

        with patch.object(ch._client, "post", return_value=mock_resp) as mock_post:
            await ch.send(alert)
            text = mock_post.call_args[1]["json"]["content"]["text"]
            assert "[alert]" in text

    @pytest.mark.asyncio
    async def test_omits_keyword_tag_when_not_configured(self) -> None:
        ch = FeishuChannel("https://example.com/hook")
        alert = _make_alert()

        mock_resp = AsyncMock()
        mock_resp.raise_for_status = AsyncMock()

        with patch.object(ch._client, "post", return_value=mock_resp) as mock_post:
            await ch.send(alert)
            text = mock_post.call_args[1]["json"]["content"]["text"]
            assert "[" not in text.split(" ", 1)[0]  # no bracket tag after emoji

    @pytest.mark.asyncio
    async def test_posts_to_correct_url(self) -> None:
        url = "https://open.feishu.cn/open-apis/bot/v2/hook/specific-id"
        ch = FeishuChannel(url)
        alert = _make_alert()

        mock_resp = AsyncMock()
        mock_resp.raise_for_status = AsyncMock()

        with patch.object(ch._client, "post", return_value=mock_resp) as mock_post:
            await ch.send(alert)
            assert mock_post.call_args[0][0] == url
