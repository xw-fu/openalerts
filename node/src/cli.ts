#!/usr/bin/env node
/**
 * openalerts CLI
 *
 * Usage:
 *   openalerts start                 Start monitoring daemon
 *   openalerts start --port 4242     Custom port
 *   openalerts start --config ./openalerts.config.json
 *   openalerts status                Print engine state (if running)
 *   openalerts init                  Create default config file
 *   openalerts test                  Send test alert (daemon must be running)
 */
import path from "node:path";
import os from "node:os";
import { openDb, pruneDb } from "./db/index.js";
import { loadConfig, detectGatewayToken, writeDefaultConfig } from "./config.js";
import { loadAll } from "./readers/openclaw.js";
import { FileWatcher } from "./watchers/files.js";
import { GatewayClient } from "./watchers/gateway.js";
import { translateGatewayEvent } from "./watchers/gateway-adapter.js";
import { OpenAlertsEngine } from "./core/engine.js";
import { TelegramChannel } from "./channels/telegram.js";
import { WebhookChannel } from "./channels/webhook.js";
import { ConsoleChannel } from "./channels/console.js";
import { startHttpServer } from "./server/index.js";
import type { AlertChannel } from "./core/types.js";
import type { DatabaseSync } from "node:sqlite";

// ── CLI arg parsing ───────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const command = args[0] ?? "start";

function getFlag(name: string, defaultVal?: string): string | undefined {
  const idx = args.indexOf(name);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return defaultVal;
}

// ── Commands ──────────────────────────────────────────────────────────────────

if (command === "init") {
  const configPath = getFlag("--config") ?? path.join(os.homedir(), ".openalerts", "config.json");
  writeDefaultConfig(configPath);
  console.log(`[init] Created config at ${configPath}`);
  console.log(`[init] Edit it and run: openalerts start`);
  process.exit(0);
}

if (command === "test") {
  const port = parseInt(getFlag("--port") ?? "4242");
  fetch(`http://127.0.0.1:${port}/api/test`, { method: "POST" })
    .then(r => r.json())
    .then(d => { console.log("[test]", d); process.exit(0); })
    .catch(err => { console.error("[test] Failed (is daemon running?):", err.message); process.exit(1); });
  // guard: exit after 5s if fetch hangs
  setTimeout(() => process.exit(1), 5000);
  process.exitCode = 0; // allow async
}

else if (command === "status") {
  const port = parseInt(getFlag("--port") ?? "4242");
  fetch(`http://127.0.0.1:${port}/api/engine`)
    .then(r => r.json())
    .then(d => { console.log(JSON.stringify(d, null, 2)); process.exit(0); })
    .catch(err => { console.error("[status] Failed (is daemon running?):", err.message); process.exit(1); });
  setTimeout(() => process.exit(1), 5000);
}

else if (command === "start") {
  const configPath = getFlag("--config");
  const portArg = getFlag("--port");

  const config = loadConfig(configPath);
  if (portArg) config.server.port = parseInt(portArg);

  // Auto-detect gateway token if not configured
  if (!config.gatewayToken) {
    config.gatewayToken = detectGatewayToken(config.watch.openclawDir);
    if (config.gatewayToken) {
      console.log("[config] Auto-detected gateway operator token");
    }
  }

  startDaemon(config);
}

else if (command === "mcp") {
  const port = parseInt(getFlag("--port") ?? "4242");
  import("./mcp/index.js")
    .then(({ startMcpServer }) => startMcpServer({ port }))
    .catch(err => { console.error("[mcp] Failed to start MCP server:", err); process.exit(1); });
}

else {
  console.error(`Unknown command: ${command}`);
  console.error("Usage: openalerts [start|init|status|test|mcp] [--port N] [--config path]");
  process.exit(1);
}

// ── Daemon startup ────────────────────────────────────────────────────────────

async function startDaemon(config: ReturnType<typeof loadConfig>): Promise<void> {
  console.log("[openalerts] Starting…");
  console.log(`[openalerts] State dir: ${config.stateDir}`);
  console.log(`[openalerts] Watching: ${config.watch.openclawDir}`);

  // ── 1. Open database ───────────────────────────────────────────────────────
  const db = openDb(config.stateDir) as DatabaseSync;
  console.log("[db] SQLite opened");

  // ── 2. Build alert channels ────────────────────────────────────────────────
  const channels: AlertChannel[] = [];

  for (const ch of config.channels) {
    if (ch.type === "telegram" && ch.token && ch.chatId) {
      channels.push(new TelegramChannel(ch.token, ch.chatId));
      console.log("[channels] Telegram channel added");
    } else if (ch.type === "webhook" && ch.webhookUrl) {
      channels.push(new WebhookChannel(ch.webhookUrl));
      console.log("[channels] Webhook channel added");
    } else if (ch.type === "console") {
      channels.push(new ConsoleChannel());
      console.log("[channels] Console channel added");
    }
  }

  if (channels.length === 0) {
    channels.push(new ConsoleChannel());
    console.log("[channels] No channels configured — using console fallback");
  }

  // ── 3. Start alert engine ──────────────────────────────────────────────────
  const engine = new OpenAlertsEngine({
    stateDir: path.join(config.stateDir, "events"),
    config: {
      quiet: config.quiet,
      rules: config.rules,
    },
    channels,
    diagnosisHint: 'Run "openclaw doctor" in your terminal',
    db,
  });
  engine.start();

  // ── 4. Initial file load ───────────────────────────────────────────────────
  console.log("[loader] Loading OpenClaw files…");
  try {
    loadAll(db, config.watch);
    console.log("[loader] Initial load complete");
  } catch (err) {
    console.warn(`[loader] Initial load warning: ${err}`);
  }

  // ── 5. Gateway connection state (declared early so closure captures it) ──────
  let gatewayConnected = false;
  let startupGwAlertFired = false;

  // ── 6. Start HTTP server + SSE ─────────────────────────────────────────────
  const httpServer = startHttpServer(config.server, db, engine, () => gatewayConnected);

  // Wire engine events to SSE (push live alerts/diagnostics to dashboard)
  engine.bus.on(event => {
    httpServer.sse.emit("diagnostic", {
      event_type: event.type, ts: event.ts,
      summary: `${event.type}${event.outcome ? `:${event.outcome}` : ""}`,
      channel: event.channel, session_key: event.sessionKey, agent_id: event.agentId,
    });
  });

  // ── 7. File watcher ────────────────────────────────────────────────────────
  const fileWatcher = new FileWatcher(db, config.watch, (changed) => {
    console.log(`[watcher] Changed: ${path.basename(changed)}`);
    // Push updated state to SSE clients
    try {
      import("./db/queries.js").then(({ getDashboardState }) => {
        httpServer.sse.emit("state", getDashboardState(db));
      }).catch(() => { /* ignore */ });
    } catch { /* ignore */ }
  });
  fileWatcher.start();

  // ── 8. Gateway WebSocket ───────────────────────────────────────────────────

  const gwClient = new GatewayClient({
    url: config.gatewayUrl,
    token: config.gatewayToken,
  });

  gwClient.on("ready", () => {
    gatewayConnected = true;
    console.log("[gateway] Connected to OpenClaw gateway ✓");
    // Push updated state (heartbeats, sessions) to dashboard
    import("./db/queries.js").then(({ getDashboardState }) => {
      httpServer.sse.emit("state", getDashboardState(db));
    }).catch(() => { /* ignore */ });
  });

  gwClient.on("disconnected", () => {
    const wasConnected = gatewayConnected;
    gatewayConnected = false;
    if (wasConnected) {
      console.log("[gateway] Lost connection — reconnecting…");
      engine.ingest({ type: "infra.heartbeat", ts: Date.now(), outcome: "error" });
    }
  });

  gwClient.on("error", (err: Error) => {
    // ECONNREFUSED = openclaw not running, suppress noisy repeat logs
    if (!err.message.includes("ECONNREFUSED") && !err.message.includes("connect ECONNREFUSED")) {
      console.warn(`[gateway] ${err.message}`);
    }
  });

  // All real gateway event names from OpenClaw's WS protocol
  const GW_EVENTS = ["health", "tick", "agent", "chat", "cron.run", "exec.started", "exec.output", "exec.completed"];
  for (const evt of GW_EVENTS) {
    gwClient.on(evt, (payload: unknown) => {
      const result = translateGatewayEvent(evt, payload, db);
      if (result.event) engine.ingest(result.event);
      if (result.sseType && result.ssePayload) {
        httpServer.sse.emit(result.sseType, result.ssePayload);
      }
    });
  }

  gwClient.start();

  // Fire gateway-down alert if not connected within 30s of startup
  setTimeout(() => {
    if (!gatewayConnected && !startupGwAlertFired) {
      startupGwAlertFired = true;
      console.warn("[gateway] Not connected after 30s — OpenClaw may be down");
      engine.ingest({ type: "infra.heartbeat", ts: Date.now(), outcome: "error" });
      // Manually fire a gateway-down style alert via 3 consecutive heartbeat failures
      for (let i = 0; i < 3; i++) {
        engine.ingest({ type: "infra.heartbeat", ts: Date.now() + i, outcome: "error" });
      }
    }
  }, 30_000);

  // ── 9. Periodic tasks ─────────────────────────────────────────────────────
  // Re-sync files + DB prune every 5 minutes
  const syncInterval = setInterval(() => {
    try { loadAll(db, config.watch); } catch { /* ignore */ }
    try { pruneDb(db); } catch { /* ignore */ }
  }, 5 * 60 * 1000);

  // ── 10. Graceful shutdown ──────────────────────────────────────────────────
  function shutdown(sig: string) {
    console.log(`\n[openalerts] ${sig} — shutting down…`);
    clearInterval(syncInterval);
    gwClient.stop();
    fileWatcher.stop();
    engine.stop();
    httpServer.close();
    db.close();
    process.exit(0);
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  console.log("[openalerts] Running. Press Ctrl+C to stop.");
}
