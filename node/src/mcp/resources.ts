/**
 * OpenAlerts MCP Resources
 * Static context that clients can subscribe to or read on-demand.
 */
import type { OpenAlertsClient } from "./client.js";

export const RESOURCES = [
  {
    uri: "openalerts://status",
    name: "Engine Status",
    description: "Current daemon health, gateway connection, and 24h stats",
    mimeType: "text/plain",
  },
  {
    uri: "openalerts://alerts/recent",
    name: "Recent Alerts",
    description: "Last 50 fired alerts across all rules",
    mimeType: "text/plain",
  },
  {
    uri: "openalerts://sessions/active",
    name: "Active Sessions",
    description: "Sessions with activity in the last 15 minutes",
    mimeType: "text/plain",
  },
  {
    uri: "openalerts://rules",
    name: "Alert Rules",
    description: "All 10 alert rules with thresholds, cooldowns, and last-fired info",
    mimeType: "text/plain",
  },
];

function ago(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

export async function readResource(uri: string, client: OpenAlertsClient): Promise<string> {
  switch (uri) {
    case "openalerts://status": {
      const [health, engine] = await Promise.all([client.getHealth(), client.getEngine()]);
      if (!health && !engine) return "Daemon not running.";
      const lines: string[] = [];
      if (health) {
        lines.push(`Daemon: running | Gateway: ${health.gatewayConnected ? "connected" : "disconnected"} | SSE clients: ${health.sseClients}`);
      }
      if (engine) {
        const s = engine.stats;
        lines.push(`Uptime since: ${new Date(engine.startedAt).toISOString()} (${ago(engine.startedAt)})`);
        lines.push(`Messages: ${s.messagesProcessed ?? 0} | Agent starts: ${s.agentStarts ?? 0} | Tool calls: ${s.toolCalls ?? 0}`);
        lines.push(`Errors: ${s.messageErrors ?? 0} | Cost: $${(s.totalCostUsd ?? 0).toFixed(4)} | Tokens: ${(s.totalTokens ?? 0).toLocaleString()}`);
        lines.push(`Alerts this hour: ${engine.hourlyAlerts.count}`);
      }
      return lines.join("\n");
    }

    case "openalerts://alerts/recent": {
      const alerts = await client.getAlerts(50) as Array<{
        rule_id: string; severity: string; title: string; detail: string; ts: number;
      }>;
      if (!alerts.length) return "No recent alerts.";
      return alerts.map(a => {
        const icon = { warn: "⚠️", error: "🚨", critical: "🔥" }[a.severity] ?? "ℹ️";
        return `${icon} [${new Date(a.ts).toISOString()}] ${a.title} [${a.rule_id}]\n   ${a.detail}`;
      }).join("\n\n");
    }

    case "openalerts://sessions/active": {
      const sessions = await client.getSessions() as Array<{
        session_key: string; status?: string; last_activity_at?: number;
        total_cost_usd?: number; message_count?: number;
      }>;
      const active = sessions.filter(s =>
        s.last_activity_at && (Date.now() - s.last_activity_at) < 15 * 60_000,
      );
      if (!active.length) return "No sessions active in the last 15 minutes.";
      return active.map(s =>
        `${s.session_key} | status: ${s.status ?? "?"} | messages: ${s.message_count ?? 0} | cost: $${(s.total_cost_usd ?? 0).toFixed(4)} | last: ${ago(s.last_activity_at!)}`,
      ).join("\n");
    }

    case "openalerts://rules": {
      const RULES = [
        { id: "infra-errors",      severity: "error",    threshold: 1,   cooldownMin: 15,  desc: "Infrastructure errors spike" },
        { id: "llm-errors",        severity: "error",    threshold: 1,   cooldownMin: 15,  desc: "LLM / agent call errors" },
        { id: "session-stuck",     severity: "warn",     threshold: 120, cooldownMin: 30,  desc: "Session inactive for N seconds" },
        { id: "heartbeat-fail",    severity: "error",    threshold: 3,   cooldownMin: 30,  desc: "N consecutive heartbeat failures" },
        { id: "queue-depth",       severity: "warn",     threshold: 10,  cooldownMin: 15,  desc: "Delivery queue >= N items" },
        { id: "high-error-rate",   severity: "error",    threshold: 50,  cooldownMin: 30,  desc: ">= N% of last 20 LLM calls failed" },
        { id: "cost-hourly-spike", severity: "warn",     threshold: 5,   cooldownMin: 30,  desc: "LLM spend >= $N/hour" },
        { id: "cost-daily-budget", severity: "error",    threshold: 20,  cooldownMin: 360, desc: "LLM spend >= $N/day" },
        { id: "tool-errors",       severity: "warn",     threshold: 1,   cooldownMin: 15,  desc: "Tool errors spike" },
        { id: "gateway-down",      severity: "critical", threshold: 30,  cooldownMin: 60,  desc: "No gateway heartbeat for N seconds" },
      ];
      const alerts = await client.getAlerts(200) as Array<{ rule_id: string; ts: number }>;
      const lastFired = new Map<string, number>();
      for (const a of alerts) {
        if (!lastFired.has(a.rule_id) || a.ts > lastFired.get(a.rule_id)!) {
          lastFired.set(a.rule_id, a.ts);
        }
      }
      return RULES.map(r => {
        const lf = lastFired.get(r.id);
        return `[${r.severity.toUpperCase()}] ${r.id} — ${r.desc}\n  threshold: ${r.threshold} | cooldown: ${r.cooldownMin}min | last fired: ${lf ? ago(lf) : "never"}`;
      }).join("\n\n");
    }

    default:
      return `Unknown resource: ${uri}`;
  }
}
