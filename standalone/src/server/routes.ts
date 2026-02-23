import type { IncomingMessage, ServerResponse } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { OpenAlertsEngine } from "../core/engine.js";
import type { SseManager } from "./sse.js";
import {
  getDashboardState, getRecentAlerts, getRecentDiagnostics,
  getRecentHeartbeats, getRecentActions, getActivityLog,
} from "../db/queries.js";
import { getDashboardHtml } from "./dashboard.js";

function json(res: ServerResponse, data: unknown, status = 200): void {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Content-Length": Buffer.byteLength(body),
  });
  res.end(body);
}

function notFound(res: ServerResponse): void {
  json(res, { error: "Not found" }, 404);
}

export function createRouter(
  db: DatabaseSync,
  engine: OpenAlertsEngine,
  sse: SseManager,
  getGatewayStatus?: () => boolean,
) {
  return function handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = new URL(req.url ?? "/", "http://localhost");
    const pathname = url.pathname;

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      });
      res.end();
      return;
    }

    // ── Dashboard UI ──────────────────────────────────────────────────────
    if (pathname === "/" || pathname === "/dashboard") {
      const html = getDashboardHtml();
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }

    // ── SSE stream ────────────────────────────────────────────────────────
    if (pathname === "/events") {
      sse.add(res);
      // Send initial state snapshot
      try {
        const state = getDashboardState(db);
        sse.emit("state", state);
      } catch { /* ignore */ }
      return;
    }

    // ── Full state snapshot ───────────────────────────────────────────────
    if (pathname === "/api/state") {
      try {
        json(res, getDashboardState(db));
      } catch (err) {
        json(res, { error: String(err) }, 500);
      }
      return;
    }

    // ── Recent alerts ─────────────────────────────────────────────────────
    if (pathname === "/api/alerts") {
      const limit = parseInt(url.searchParams.get("limit") ?? "50");
      json(res, getRecentAlerts(db, Math.min(limit, 200)));
      return;
    }

    // ── Recent diagnostics ────────────────────────────────────────────────
    if (pathname === "/api/diagnostics") {
      const limit = parseInt(url.searchParams.get("limit") ?? "100");
      json(res, getRecentDiagnostics(db, Math.min(limit, 500)));
      return;
    }

    // ── Heartbeat history ─────────────────────────────────────────────────
    if (pathname === "/api/heartbeats") {
      const limit = parseInt(url.searchParams.get("limit") ?? "50");
      json(res, getRecentHeartbeats(db, Math.min(limit, 500)));
      return;
    }

    // ── Action history ────────────────────────────────────────────────────
    if (pathname === "/api/actions") {
      const limit = parseInt(url.searchParams.get("limit") ?? "100");
      const session = url.searchParams.get("session") ?? undefined;
      json(res, getRecentActions(db, Math.min(limit, 500), session));
      return;
    }

    // ── Unified activity log (actions + diagnostics merged) ───────────────
    if (pathname === "/api/activity") {
      const limit = parseInt(url.searchParams.get("limit") ?? "100");
      const session = url.searchParams.get("session") ?? undefined;
      json(res, getActivityLog(db, Math.min(limit, 500), session));
      return;
    }

    // ── Structured logs (OpenClaw /logs style) ────────────────────────────
    if (pathname === "/api/logs") {
      const limit = parseInt(url.searchParams.get("limit") ?? "100");
      const session = url.searchParams.get("session") ?? undefined;
      const subsystem = url.searchParams.get("subsystem") ?? undefined;
      let entries = getActivityLog(db, Math.min(limit * 2, 1000), session);
      if (subsystem) entries = entries.filter(e => e.subsystem === subsystem);
      const logs = entries.slice(0, limit).map(e => ({
        ts: new Date(e.ts).toISOString(),
        tsMs: e.ts,
        level: e.event_type.includes("error") || e.event_type.includes("fail") ? "ERROR"
             : e.subsystem === "infra" ? "DEBUG" : "INFO",
        subsystem: e.subsystem,
        message: e.message,
        ...(e.session_key ? { sessionKey: e.session_key } : {}),
        ...(e.run_id ? { runId: e.run_id } : {}),
        ...(e.tool_name ? { toolName: e.tool_name } : {}),
        ...(e.duration_ms != null ? { durationMs: e.duration_ms } : {}),
        ...(e.input_tokens != null ? { inputTokens: e.input_tokens } : {}),
        ...(e.output_tokens != null ? { outputTokens: e.output_tokens } : {}),
      }));
      json(res, { entries: logs, total: logs.length });
      return;
    }

    // ── Engine state (rules, stats, uptime) ───────────────────────────────
    if (pathname === "/api/engine") {
      json(res, {
        running: engine.isRunning,
        gatewayConnected: getGatewayStatus ? getGatewayStatus() : null,
        startedAt: engine.state.startedAt,
        stats: engine.state.stats,
        hourlyAlerts: engine.state.hourlyAlerts,
        lastHeartbeatTs: engine.state.lastHeartbeatTs,
      });
      return;
    }

    // ── Test alert ────────────────────────────────────────────────────────
    if (pathname === "/api/test" && req.method === "POST") {
      engine.sendTestAlert();
      json(res, { ok: true, message: "Test alert fired" });
      return;
    }

    // ── Health check ──────────────────────────────────────────────────────
    if (pathname === "/health") {
      json(res, {
        ok: true,
        ts: Date.now(),
        sseClients: sse.size,
        gatewayConnected: getGatewayStatus ? getGatewayStatus() : null,
      });
      return;
    }

    notFound(res);
  };
}
