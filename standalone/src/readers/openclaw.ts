/**
 * Reads all relevant OpenClaw files and translates them into DB records.
 * Called once on startup and then on file-change events.
 */
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { WatchConfig } from "../config.js";
import {
  upsertAgentInfo,
  upsertCronJob,
  insertCronRun,
  upsertSession,
  upsertAction,
  upsertDeliveryItem,
  upsertOcConfig,
  type AgentInfoRow,
  type CronJobRow,
  type CronRunRow,
  type SessionRow,
  type ActionRow,
  type DeliveryQueueRow,
} from "../db/queries.js";

function readFileSafe(filePath: string): string | null {
  try {
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath, "utf8");
  } catch { /* ignore */ }
  return null;
}

function parseJsonSafe<T>(text: string | null): T | null {
  if (!text) return null;
  try { return JSON.parse(text) as T; } catch { return null; }
}

function readJsonFile<T>(filePath: string): T | null {
  return parseJsonSafe<T>(readFileSafe(filePath));
}

// ── Workspace docs (SOUL, HEARTBEAT, etc.) ───────────────────────────────────

export function readWorkspaceDocs(db: DatabaseSync, ocDir: string, workspaces: string[]): void {
  // Read main workspace (first in list)
  const workspaceNames = workspaces.length > 0 ? workspaces : ["workspace"];

  for (const wsName of workspaceNames) {
    const wsPath = path.isAbsolute(wsName) ? wsName : path.join(ocDir, wsName);
    if (!fs.existsSync(wsPath)) continue;

    // Derive agent_id from workspace name (workspace → main, workspace-study → study)
    let agentId = wsName.replace(/^workspace-?/, "") || "main";
    if (agentId === "") agentId = "main";

    // Try to get name/emoji from IDENTITY.md
    const identityRaw = readFileSafe(path.join(wsPath, "IDENTITY.md"));
    let name: string | undefined;
    let emoji: string | undefined;
    if (identityRaw) {
      // Matches both "**Name:** Value" and "**Name**: Value" and "**Name** Value"
      const nameMatch = identityRaw.match(/\*\*Name[:\*]+\s*(.+)/i) || identityRaw.match(/^[#\s\-]*Name[:\s]+(.+)/im);
      if (nameMatch) name = nameMatch[1].trim().replace(/["`*]/g, "");
      const emojiMatch = identityRaw.match(/\*\*Emoji[:\*]+\s*(.+)/i);
      if (emojiMatch) emoji = emojiMatch[1].trim();
    }

    const row: AgentInfoRow = {
      agent_id: agentId,
      name,
      emoji,
      soul_md: readFileSafe(path.join(wsPath, "SOUL.md")) ?? undefined,
      heartbeat_md: readFileSafe(path.join(wsPath, "HEARTBEAT.md")) ?? undefined,
      memory_md: readFileSafe(path.join(wsPath, "MEMORY.md")) ?? undefined,
      identity_md: identityRaw ?? undefined,
      user_md: readFileSafe(path.join(wsPath, "USER.md")) ?? undefined,
      agents_md: readFileSafe(path.join(wsPath, "AGENTS.md")) ?? undefined,
      tools_md: readFileSafe(path.join(wsPath, "TOOLS.md")) ?? undefined,
      updated_at: Date.now(),
    };

    upsertAgentInfo(db, row);
  }
}

// ── Cron jobs ────────────────────────────────────────────────────────────────

interface OcCronJob {
  id: string;
  agentId?: string;
  name?: string;
  description?: string;
  schedule?: { kind?: string; expr?: string; tz?: string };
  state?: {
    lastRunAtMs?: number;
    lastStatus?: string;
    lastError?: string;
    nextRunAtMs?: number;
    consecutiveErrors?: number;
  };
}

export function readCronJobs(db: DatabaseSync, ocDir: string): void {
  const jobsPath = path.join(ocDir, "cron", "jobs.json");
  const data = readJsonFile<{ jobs?: OcCronJob[] }>(jobsPath);
  if (!data?.jobs) return;

  const now = Date.now();
  for (const job of data.jobs) {
    const row: CronJobRow = {
      id: job.id,
      agent_id: job.agentId,
      name: job.name,
      description: job.description,
      schedule_expr: job.schedule?.expr,
      schedule_tz: job.schedule?.tz,
      last_run_at: job.state?.lastRunAtMs,
      last_status: job.state?.lastStatus,
      last_error: job.state?.lastError,
      next_run_at: job.state?.nextRunAtMs,
      consecutive_errors: job.state?.consecutiveErrors ?? 0,
      updated_at: now,
    };
    upsertCronJob(db, row);
  }
}

// ── Cron runs ────────────────────────────────────────────────────────────────

interface OcCronRunLine {
  ts?: number;
  jobId?: string;
  action?: string;
  status?: string;
  error?: string;
  durationMs?: number;
  sessionId?: string;
  sessionKey?: string;
  nextRunAtMs?: number;
}

// Track which run files we've already read (by file + size) to avoid re-reading
const _cronRunCache = new Map<string, number>();

export function readCronRuns(db: DatabaseSync, ocDir: string): void {
  const runsDir = path.join(ocDir, "cron", "runs");
  if (!fs.existsSync(runsDir)) return;

  const files = fs.readdirSync(runsDir).filter(f => f.endsWith(".jsonl"));
  for (const file of files) {
    const filePath = path.join(runsDir, file);
    const size = fs.statSync(filePath).size;
    if (_cronRunCache.get(filePath) === size) continue; // not changed
    _cronRunCache.set(filePath, size);

    const lines = (readFileSafe(filePath) ?? "").split("\n").filter(Boolean);
    for (const line of lines) {
      const e = parseJsonSafe<OcCronRunLine>(line);
      if (!e || !e.ts || !e.jobId) continue;
      const row: CronRunRow = {
        job_id: e.jobId,
        ts: e.ts,
        action: e.action,
        status: e.status,
        error: e.error,
        duration_ms: e.durationMs,
        session_id: e.sessionId,
        session_key: e.sessionKey,
        next_run_at: e.nextRunAtMs,
      };
      insertCronRun(db, row);
    }
  }
}

// ── Sessions ─────────────────────────────────────────────────────────────────

interface OcSession {
  key?: string;
  agentId?: string;
  platform?: string;
  recipient?: string;
  isGroup?: boolean;
  lastActivityAt?: number;
  status?: string;
  messageCount?: number;
  totalCostUsd?: number;
  totalInputTokens?: number;
  totalOutputTokens?: number;
}

export function readSessions(db: DatabaseSync, ocDir: string): void {
  const sessionsPath = path.join(ocDir, "collections", "sessions.json");
  const data = readJsonFile<OcSession[]>(sessionsPath);
  if (!Array.isArray(data)) return;

  const now = Date.now();
  for (const s of data) {
    if (!s.key) continue;
    const row: SessionRow = {
      session_key: s.key,
      agent_id: s.agentId,
      platform: s.platform,
      recipient: s.recipient,
      is_group: s.isGroup ? 1 : 0,
      last_activity_at: s.lastActivityAt,
      status: s.status,
      message_count: s.messageCount,
      total_cost_usd: s.totalCostUsd,
      total_input_tokens: s.totalInputTokens,
      total_output_tokens: s.totalOutputTokens,
      updated_at: now,
    };
    upsertSession(db, row);
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

interface OcAction {
  id?: string;
  runId?: string;
  sessionKey?: string;
  seq?: number;
  type?: string;
  eventType?: string;
  timestamp?: number;
  duration?: number;
  toolName?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  model?: string;
  provider?: string;
}

let _actionsOffset = 0;

export function readActions(db: DatabaseSync, ocDir: string): void {
  const actionsPath = path.join(ocDir, "collections", "actions.jsonl");
  if (!fs.existsSync(actionsPath)) return;

  const raw = readFileSafe(actionsPath) ?? "";
  const lines = raw.split("\n").filter(Boolean);

  // Only process new lines since last read
  const newLines = lines.slice(_actionsOffset);
  _actionsOffset = lines.length;

  for (const line of newLines) {
    const e = parseJsonSafe<OcAction>(line);
    if (!e?.id || !e.timestamp) continue;
    const row: ActionRow = {
      id: e.id,
      run_id: e.runId,
      session_key: e.sessionKey,
      seq: e.seq,
      type: e.type,
      event_type: e.eventType,
      ts: e.timestamp,
      duration_ms: e.duration,
      tool_name: e.toolName,
      input_tokens: e.inputTokens,
      output_tokens: e.outputTokens,
      cost_usd: e.costUsd,
      model: e.model,
      provider: e.provider,
    };
    upsertAction(db, row);
  }
}

// ── Delivery queue ────────────────────────────────────────────────────────────

interface OcDeliveryItem {
  id?: string;
  channel?: string;
  to?: string;
  payloads?: Array<{ text?: string }>;
  enqueuedAt?: number;
  retryCount?: number;
  lastError?: string;
}

export function readDeliveryQueue(db: DatabaseSync, ocDir: string): void {
  const queueDir = path.join(ocDir, "delivery-queue");
  if (!fs.existsSync(queueDir)) return;

  const files = fs.readdirSync(queueDir).filter(f => f.endsWith(".json") && !f.startsWith("."));
  const now = Date.now();

  for (const file of files) {
    const data = readJsonFile<OcDeliveryItem>(path.join(queueDir, file));
    if (!data?.id) continue;

    const text = data.payloads?.[0]?.text ?? "";
    const row: DeliveryQueueRow = {
      id: data.id,
      channel: data.channel,
      to_address: data.to,
      text: text.substring(0, 1000), // cap size
      enqueued_at: data.enqueuedAt,
      retry_count: data.retryCount,
      last_error: data.lastError,
      status: "pending",
      updated_at: now,
    };
    upsertDeliveryItem(db, row);
  }

  // Mark items no longer on disk as 'sent'
  const failedDir = path.join(queueDir, "failed");
  if (fs.existsSync(failedDir)) {
    const failedFiles = fs.readdirSync(failedDir).filter(f => f.endsWith(".json"));
    for (const file of failedFiles) {
      const data = readJsonFile<OcDeliveryItem>(path.join(failedDir, file));
      if (!data?.id) continue;
      const text = data.payloads?.[0]?.text ?? "";
      const row: DeliveryQueueRow = {
        id: data.id,
        channel: data.channel,
        to_address: data.to,
        text: text.substring(0, 1000),
        enqueued_at: data.enqueuedAt,
        retry_count: data.retryCount,
        last_error: data.lastError,
        status: "failed",
        updated_at: now,
      };
      upsertDeliveryItem(db, row);
    }
  }
}

// ── openclaw.json config ─────────────────────────────────────────────────────

export function readOcConfig(db: DatabaseSync, ocDir: string): void {
  const configPath = path.join(ocDir, "openclaw.json");
  const data = readJsonFile<Record<string, unknown>>(configPath);
  if (!data) return;

  // Store safe subset (no API keys)
  const safe = {
    meta: data.meta,
    wizard: data.wizard,
    diagnostics: data.diagnostics,
    gateway: (data as Record<string, unknown>).gateway,
  };
  upsertOcConfig(db, "openclaw", safe);
  // Store model provider names (not keys)
  const models = data.models as Record<string, unknown> | undefined;
  const providers = models?.providers as Record<string, unknown> | undefined;
  if (providers) {
    const providerNames = Object.keys(providers);
    upsertOcConfig(db, "providers", providerNames);
  }
}

// ── Full initial load ─────────────────────────────────────────────────────────

export function loadAll(db: DatabaseSync, config: WatchConfig): void {
  const { openclawDir, workspaces } = config;
  readWorkspaceDocs(db, openclawDir, workspaces);
  readCronJobs(db, openclawDir);
  readCronRuns(db, openclawDir);
  readSessions(db, openclawDir);
  readActions(db, openclawDir);
  readDeliveryQueue(db, openclawDir);
  readOcConfig(db, openclawDir);
}
