/**
 * Feishu alert channel — posts to a custom bot webhook directly.
 *
 * Feishu custom bots support a "keyword" security setting that requires
 * messages to contain at least one configured keyword. Pass `keyword`
 * in the constructor so the channel injects it automatically.
 */
import type { AlertChannel, AlertEvent } from "../core/types.js";

export class FeishuChannel implements AlertChannel {
  readonly name = "feishu";
  private url: string;
  private keyword: string;

  constructor(url: string, keyword?: string) {
    this.url = url;
    this.keyword = keyword ?? "";
  }

  async send(alert: AlertEvent, formatted: string): Promise<void> {
    // Recovery alerts use a distinct visual treatment
    const prefix = alert.recovery
      ? "✅"
      : alert.severity === "critical" ? "🚨" :
        alert.severity === "error" ? "❌" :
        alert.severity === "warn" ? "⚠️" : "ℹ️";

    const tag = this.keyword ? ` [${this.keyword}]` : "";
    const text = `${prefix}${tag} ${formatted}`;

    const res = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msg_type: "text", content: { text } }),
    });
    if (!res.ok) throw new Error(`Feishu webhook ${res.status}`);
  }
}
