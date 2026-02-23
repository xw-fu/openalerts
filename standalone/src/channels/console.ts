import type { AlertChannel, AlertEvent } from "../core/types.js";

export class ConsoleChannel implements AlertChannel {
  readonly name = "console";
  send(alert: AlertEvent, formatted: string): void {
    const prefix = alert.severity === "critical" ? "🚨" :
                   alert.severity === "error" ? "❌" :
                   alert.severity === "warn" ? "⚠️" : "ℹ️";
    console.log(`\n${prefix} ALERT [${alert.ruleId}]\n${formatted}\n`);
  }
}
