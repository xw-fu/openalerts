/**
 * Telegram alert channel — uses Bot API directly (no OpenClaw dependency).
 */
import type { AlertChannel, AlertEvent } from "../core/types.js";

export class TelegramChannel implements AlertChannel {
  readonly name = "telegram";
  private token: string;
  private chatId: string;

  constructor(token: string, chatId: string) {
    this.token = token;
    this.chatId = chatId;
  }

  async send(_alert: AlertEvent, formatted: string): Promise<void> {
    const url = `https://api.telegram.org/bot${this.token}/sendMessage`;
    const body = JSON.stringify({
      chat_id: this.chatId,
      text: formatted,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Telegram API ${res.status}: ${text.substring(0, 200)}`);
    }
  }
}
