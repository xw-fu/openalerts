import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { FeishuChannel } from "../feishu.js";
import type { AlertEvent } from "../../core/types.js";

function makeAlert(severity: "info" | "warn" | "error" | "critical"): AlertEvent {
  return {
    type: "alert",
    id: `test:fp:${Date.now()}`,
    ruleId: "test-rule",
    severity,
    title: "Test alert",
    detail: "Something went wrong",
    ts: Date.now(),
    fingerprint: "test:fp",
  };
}

describe("FeishuChannel", () => {
  let originalFetch: typeof globalThis.fetch;
  let lastFetchUrl: string | undefined;
  let lastFetchInit: RequestInit | undefined;
  let mockResponse: { ok: boolean; status: number };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    mockResponse = { ok: true, status: 200 };
    lastFetchUrl = undefined;
    lastFetchInit = undefined;

    globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      lastFetchUrl = String(input);
      lastFetchInit = init;
      return mockResponse as unknown as Response;
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("should have name 'feishu'", () => {
    const ch = new FeishuChannel("https://open.feishu.cn/open-apis/bot/v2/hook/test");
    assert.equal(ch.name, "feishu");
  });

  it("should POST to webhook URL with correct Feishu JSON format", async () => {
    const url = "https://open.feishu.cn/open-apis/bot/v2/hook/abc123";
    const ch = new FeishuChannel(url);
    const alert = makeAlert("error");

    await ch.send(alert, "1 agent error(s) in the last minute");

    assert.equal(lastFetchUrl, url);
    assert.equal(lastFetchInit?.method, "POST");

    const headers = lastFetchInit?.headers as Record<string, string>;
    assert.equal(headers["Content-Type"], "application/json");

    const body = JSON.parse(lastFetchInit?.body as string);
    assert.equal(body.msg_type, "text");
    assert.equal(typeof body.content.text, "string");
  });

  it("should include severity emoji prefix in text", async () => {
    const ch = new FeishuChannel("https://open.feishu.cn/open-apis/bot/v2/hook/test");

    for (const [severity, emoji] of [
      ["critical", "🚨"],
      ["error", "❌"],
      ["warn", "⚠️"],
      ["info", "ℹ️"],
    ] as const) {
      const alert = makeAlert(severity);
      await ch.send(alert, "test message");
      const body = JSON.parse(lastFetchInit?.body as string);
      assert.ok(
        body.content.text.startsWith(emoji),
        `Expected text to start with ${emoji} for severity ${severity}, got: ${body.content.text}`
      );
    }
  });

  it("should include configured keyword in text when provided", async () => {
    const ch = new FeishuChannel("https://open.feishu.cn/open-apis/bot/v2/hook/test", "alert");
    const alert = makeAlert("error");

    await ch.send(alert, "Some alert message");

    const body = JSON.parse(lastFetchInit?.body as string);
    assert.ok(
      body.content.text.includes("[alert]"),
      `Expected text to include '[alert]', got: ${body.content.text}`
    );
  });

  it("should omit keyword tag when no keyword is configured", async () => {
    const ch = new FeishuChannel("https://open.feishu.cn/open-apis/bot/v2/hook/test");
    const alert = makeAlert("error");

    await ch.send(alert, "Some alert message");

    const body = JSON.parse(lastFetchInit?.body as string);
    assert.ok(
      !body.content.text.includes("["),
      `Expected no bracket tag in text, got: ${body.content.text}`
    );
  });

  it("should throw on non-ok response", async () => {
    mockResponse = { ok: false, status: 400 };
    const ch = new FeishuChannel("https://open.feishu.cn/open-apis/bot/v2/hook/test");
    const alert = makeAlert("error");

    await assert.rejects(
      () => ch.send(alert, "test"),
      (err: Error) => {
        assert.ok(err.message.includes("400"), `Expected error to include status 400, got: ${err.message}`);
        return true;
      }
    );
  });
});
