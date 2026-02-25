import type { AlertChannel, AlertEvent } from "../core/types.js";

export class WebhookChannel implements AlertChannel {
  readonly name = "webhook";
  private url: string;

  constructor(url: string) { this.url = url; }

  async send(alert: AlertEvent, formatted: string): Promise<void> {
    const res = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alert, formatted }),
    });
    if (!res.ok) throw new Error(`Webhook ${res.status}`);
  }
}
