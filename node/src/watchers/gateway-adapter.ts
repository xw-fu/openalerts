/**
 * Translates real OpenClaw gateway WS events into:
 *   1. OpenAlertsEvents  → engine for rule evaluation
 *   2. DB writes         → SQLite for dashboard state
 *   3. SSE payloads      → dashboard live feed
 *
 * Event shapes are derived from node/src/collections/event-parser.ts
 */
import type { OpenAlertsEvent } from "../core/types.js";
import type { DatabaseSync } from "node:sqlite";
import { upsertSession, upsertAction, insertHeartbeat } from "../db/queries.js";

// ─── Raw gateway event shapes ────────────────────────────────────────────────

interface ChatEvent {
  runId: string;
  sessionKey: string;
  seq: number;
  state: "delta" | "final" | "aborted" | "error";
  /** Full message object — may include role: "user" | "assistant" */
  message?: unknown;
  usage?: { inputTokens?: number; outputTokens?: number };
  stopReason?: string;
  errorMessage?: string;
}

interface AgentLifecycleData {
  phase?: "start" | "end";
  startedAt?: number;
  endedAt?: number;
}

interface AgentToolData {
  type?: "tool_use" | "tool_result" | "text";
  name?: string;
  input?: unknown;
  content?: unknown;
  text?: string;
}

interface AgentEvent {
  runId: string;
  sessionKey?: string;
  seq: number;
  ts: number;
  stream: "lifecycle" | "assistant" | string;
  data: AgentLifecycleData & AgentToolData & Record<string, unknown>;
}

interface HealthPayload {
  queue?: number | { total?: number };
  sessions?: Array<{ key?: string; agentId?: string; status?: string; lastActivityAt?: number }>;
}

interface ExecStartedEvent {
  runId: string;
  pid: number;
  sessionId?: string;
  command?: string;
  startedAt?: number;
}

interface ExecOutputEvent {
  runId: string;
  pid: number;
  sessionId?: string;
  stream?: "stdout" | "stderr";
  output?: string;
}

interface ExecCompletedEvent {
  runId: string;
  pid: number;
  sessionId?: string;
  durationMs?: number;
  exitCode?: number;
  status?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Extract text content from a message block (handles string, array, or text field) */
function extractContent(message: unknown): string {
  if (!message) return "";
  const msg = message as Record<string, unknown>;
  if (typeof msg.content === "string") return msg.content;
  if (typeof msg.text === "string") return msg.text;
  if (Array.isArray(msg.content)) {
    return (msg.content as Array<Record<string, unknown>>)
      .filter(b => b.type === "text")
      .map(b => String(b.text || ""))
      .join("");
  }
  return "";
}

/** Infer platform label from session key (e.g. "agent:workspace:main" → "webchat") */
function inferPlatform(sessionKey?: string): string | undefined {
  if (!sessionKey) return undefined;
  const lower = sessionKey.toLowerCase();
  if (lower.includes("telegram")) return "telegram";
  if (lower.includes("discord")) return "discord";
  if (lower.includes("slack")) return "slack";
  if (lower.includes("webchat") || lower.includes("web")) return "webchat";
  return undefined;
}

// ─── Translator ───────────────────────────────────────────────────────────────

export interface GatewayTranslation {
  event?: OpenAlertsEvent;
  /** For pushing to SSE clients */
  sseType?: string;
  ssePayload?: unknown;
}

export function translateGatewayEvent(
  eventName: string,
  payload: unknown,
  db?: DatabaseSync | null,
): GatewayTranslation {
  const now = Date.now();

  // ── health / tick ─────────────────────────────────────────────────────────
  if (eventName === "health" || eventName === "tick") {
    const h = payload as HealthPayload | null;
    const queueDepth =
      typeof h?.queue === "number"
        ? h.queue
        : (typeof h?.queue === "object" && h?.queue ? (h.queue as Record<string, number>).total ?? 0 : 0);
    const sessions = Array.isArray(h?.sessions) ? h!.sessions : [];
    const activeSessions = sessions.length;

    // Upsert all sessions from health payload
    if (db) {
      for (const s of sessions) {
        if (!s.key) continue;
        try {
          upsertSession(db, {
            session_key: s.key,
            agent_id: s.agentId,
            last_activity_at: s.lastActivityAt ?? now,
            status: s.status ?? "active",
            updated_at: now,
          });
        } catch { /* ignore */ }
      }
      try {
        insertHeartbeat(db, {
          ts: now, status: "ok",
          gateway_connected: 1,
          queue_depth: queueDepth,
          active_sessions: activeSessions,
        });
      } catch { /* ignore */ }
    }

    return {
      event: {
        type: "infra.heartbeat", ts: now,
        outcome: "success", queueDepth,
      },
      sseType: "health",
      ssePayload: { queueDepth, activeSessions, sessions, ts: now },
    };
  }

  // ── chat ──────────────────────────────────────────────────────────────────
  if (eventName === "chat") {
    const c = payload as ChatEvent;
    if (!c?.runId) return {};

    const actionId = `${c.runId}-${c.seq}`;
    const platform = inferPlatform(c.sessionKey);
    const msg = c.message as Record<string, unknown> | undefined;
    const role = typeof msg?.role === "string" ? msg.role : undefined;

    // ── User message (Telegram / webchat / connected app input) ──
    if (role === "user") {
      const content = extractContent(c.message);
      if (db) {
        try {
          upsertSession(db, { session_key: c.sessionKey, last_activity_at: now, status: "active", updated_at: now });
          upsertAction(db, { id: actionId, run_id: c.runId, session_key: c.sessionKey, seq: c.seq, type: "user_message", event_type: "chat", ts: now });
        } catch { /* ignore */ }
      }
      return {
        sseType: "action",
        ssePayload: {
          id: actionId, runId: c.runId, sessionKey: c.sessionKey, seq: c.seq,
          type: "user_message", eventType: "chat",
          content: content.substring(0, 300),
          platform,
          ts: now,
        },
      };
    }

    // ── Assistant response (LLM output) ──
    let type: string;
    if (c.state === "final") type = "complete";
    else if (c.state === "aborted") type = "aborted";
    else if (c.state === "error") type = "error";
    else type = "streaming";

    let content: string | undefined;
    if (c.message) content = extractContent(c.message) || undefined;
    if (c.errorMessage) content = c.errorMessage;

    if (db) {
      try {
        upsertSession(db, {
          session_key: c.sessionKey,
          last_activity_at: now,
          status: c.state === "delta" ? "thinking" : "active",
          total_input_tokens: c.usage?.inputTokens ?? undefined,
          total_output_tokens: c.usage?.outputTokens ?? undefined,
          updated_at: now,
        });
        upsertAction(db, {
          id: actionId, run_id: c.runId, session_key: c.sessionKey,
          seq: c.seq, type, event_type: "chat", ts: now,
          input_tokens: c.usage?.inputTokens ?? undefined,
          output_tokens: c.usage?.outputTokens ?? undefined,
        });
      } catch { /* ignore */ }
    }

    const alertEvent: OpenAlertsEvent | undefined =
      c.state === "error"
        ? { type: "llm.error", ts: now, sessionKey: c.sessionKey, error: c.errorMessage ?? "chat error", outcome: "error" }
        : c.state === "final" && c.usage
        ? { type: "llm.token_usage", ts: now, sessionKey: c.sessionKey, tokenCount: (c.usage.inputTokens ?? 0) + (c.usage.outputTokens ?? 0) }
        : undefined;

    return {
      event: alertEvent,
      sseType: "action",
      ssePayload: {
        id: actionId, runId: c.runId, sessionKey: c.sessionKey, seq: c.seq,
        type, eventType: "chat",
        content: content?.substring(0, 200),
        platform,
        ts: now,
      },
    };
  }

  // ── agent ─────────────────────────────────────────────────────────────────
  if (eventName === "agent") {
    const a = payload as AgentEvent;
    if (!a?.runId) return {};

    const actionId = `${a.runId}-${a.seq}`;

    if (a.stream === "lifecycle") {
      const phase = a.data?.phase;
      if (phase === "start") {
        if (db) {
          try {
            if (a.sessionKey) upsertSession(db, { session_key: a.sessionKey, last_activity_at: now, status: "thinking", updated_at: now });
            upsertAction(db, { id: actionId, run_id: a.runId, session_key: a.sessionKey, seq: a.seq, type: "start", event_type: "agent", ts: a.data.startedAt ?? now });
          } catch { /* ignore */ }
        }
        return {
          event: { type: "agent.start", ts: a.data.startedAt ?? now, sessionKey: a.sessionKey, agentId: a.sessionKey?.split(":")[1], meta: { runId: a.runId } },
          sseType: "action",
          ssePayload: { id: actionId, runId: a.runId, sessionKey: a.sessionKey, type: "start", eventType: "agent", ts: now },
        };
      }
      if (phase === "end") {
        const startedAt = typeof a.data.startedAt === "number" ? a.data.startedAt : now;
        const endedAt = typeof a.data.endedAt === "number" ? a.data.endedAt : now;
        if (db) {
          try {
            if (a.sessionKey) upsertSession(db, { session_key: a.sessionKey, last_activity_at: now, status: "active", updated_at: now });
            upsertAction(db, { id: actionId, run_id: a.runId, session_key: a.sessionKey, seq: a.seq, type: "complete", event_type: "agent", ts: endedAt, duration_ms: endedAt - startedAt });
          } catch { /* ignore */ }
        }
        return {
          event: { type: "agent.end", ts: endedAt, sessionKey: a.sessionKey, durationMs: endedAt - startedAt, outcome: "success", meta: { runId: a.runId } },
          sseType: "action",
          ssePayload: { id: actionId, runId: a.runId, sessionKey: a.sessionKey, type: "complete", eventType: "agent", durationMs: endedAt - startedAt, ts: now },
        };
      }
    }

    // Tool use / tool result
    if (a.data?.type === "tool_use") {
      const toolName = String(a.data.name || "unknown");
      if (db) {
        try {
          upsertAction(db, { id: actionId, run_id: a.runId, session_key: a.sessionKey, seq: a.seq, type: "tool_call", event_type: "agent", ts: now, tool_name: toolName });
        } catch { /* ignore */ }
      }
      return {
        event: { type: "tool.call", ts: now, sessionKey: a.sessionKey, meta: { toolName, runId: a.runId } },
        sseType: "action",
        ssePayload: { id: actionId, runId: a.runId, sessionKey: a.sessionKey, type: "tool_call", eventType: "agent", toolName, ts: now },
      };
    }

    if (a.data?.type === "tool_result") {
      if (db) {
        try {
          upsertAction(db, { id: actionId, run_id: a.runId, session_key: a.sessionKey, seq: a.seq, type: "tool_result", event_type: "agent", ts: now });
        } catch { /* ignore */ }
      }
      return {
        sseType: "action",
        ssePayload: { id: actionId, runId: a.runId, sessionKey: a.sessionKey, type: "tool_result", eventType: "agent", ts: now },
      };
    }

    // Streaming text
    if (a.stream === "assistant" && typeof a.data?.text === "string") {
      if (db) {
        try {
          if (a.sessionKey) upsertSession(db, { session_key: a.sessionKey, last_activity_at: now, status: "thinking", updated_at: now });
        } catch { /* ignore */ }
      }
      return {
        sseType: "action",
        ssePayload: { id: actionId, runId: a.runId, sessionKey: a.sessionKey, type: "streaming", eventType: "agent", content: a.data.text.substring(0, 200), ts: now },
      };
    }

    return {};
  }

  // ── exec.* ────────────────────────────────────────────────────────────────
  if (eventName === "exec.started") {
    const e = payload as ExecStartedEvent;
    return {
      sseType: "exec",
      ssePayload: { type: "started", runId: e.runId, pid: e.pid, command: e.command, sessionId: e.sessionId, ts: now },
    };
  }

  if (eventName === "exec.output") {
    const e = payload as ExecOutputEvent;
    return {
      sseType: "exec",
      ssePayload: { type: "output", runId: e.runId, pid: e.pid, stream: e.stream, output: e.output?.substring(0, 500), ts: now },
    };
  }

  if (eventName === "exec.completed") {
    const e = payload as ExecCompletedEvent;
    const isError = typeof e.exitCode === "number" && e.exitCode !== 0;
    return {
      event: isError
        ? { type: "tool.error", ts: now, sessionKey: e.sessionId, error: `exec exit ${e.exitCode}`, meta: { runId: e.runId, pid: e.pid, exitCode: e.exitCode } }
        : undefined,
      sseType: "exec",
      ssePayload: { type: "completed", runId: e.runId, pid: e.pid, exitCode: e.exitCode, durationMs: e.durationMs, ts: now },
    };
  }

  return {};
}
