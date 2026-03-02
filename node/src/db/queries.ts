import type { DatabaseSync } from "node:sqlite";

// ── Agent Info ──────────────────────────────────────────────────────────────

export interface AgentInfoRow {
  agent_id: string;
  name?: string;
  emoji?: string;
  soul_md?: string;
  heartbeat_md?: string;
  memory_md?: string;
  identity_md?: string;
  user_md?: string;
  agents_md?: string;
  tools_md?: string;
  updated_at: number;
}

export function upsertAgentInfo(db: DatabaseSync, row: AgentInfoRow): void {
  db.prepare(`
    INSERT INTO agent_info (agent_id, name, emoji, soul_md, heartbeat_md, memory_md, identity_md, user_md, agents_md, tools_md, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(agent_id) DO UPDATE SET
      name=excluded.name, emoji=excluded.emoji,
      soul_md=excluded.soul_md, heartbeat_md=excluded.heartbeat_md,
      memory_md=excluded.memory_md, identity_md=excluded.identity_md,
      user_md=excluded.user_md, agents_md=excluded.agents_md,
      tools_md=excluded.tools_md, updated_at=excluded.updated_at
  `).run(
    row.agent_id, row.name ?? null, row.emoji ?? null,
    row.soul_md ?? null, row.heartbeat_md ?? null, row.memory_md ?? null,
    row.identity_md ?? null, row.user_md ?? null, row.agents_md ?? null,
    row.tools_md ?? null, row.updated_at
  );
}

export function getAllAgents(db: DatabaseSync): AgentInfoRow[] {
  return db.prepare("SELECT * FROM agent_info ORDER BY agent_id").all() as unknown as AgentInfoRow[];
}

// ── Cron Jobs ───────────────────────────────────────────────────────────────

export interface CronJobRow {
  id: string;
  agent_id?: string;
  name?: string;
  description?: string;
  schedule_expr?: string;
  schedule_tz?: string;
  last_run_at?: number;
  last_status?: string;
  last_error?: string;
  next_run_at?: number;
  consecutive_errors?: number;
  updated_at: number;
}

export function upsertCronJob(db: DatabaseSync, row: CronJobRow): void {
  db.prepare(`
    INSERT INTO cron_jobs (id, agent_id, name, description, schedule_expr, schedule_tz, last_run_at, last_status, last_error, next_run_at, consecutive_errors, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      agent_id=excluded.agent_id, name=excluded.name, description=excluded.description,
      schedule_expr=excluded.schedule_expr, schedule_tz=excluded.schedule_tz,
      last_run_at=excluded.last_run_at, last_status=excluded.last_status,
      last_error=excluded.last_error, next_run_at=excluded.next_run_at,
      consecutive_errors=excluded.consecutive_errors, updated_at=excluded.updated_at
  `).run(
    row.id, row.agent_id ?? null, row.name ?? null, row.description ?? null,
    row.schedule_expr ?? null, row.schedule_tz ?? null,
    row.last_run_at ?? null, row.last_status ?? null, row.last_error ?? null,
    row.next_run_at ?? null, row.consecutive_errors ?? 0, row.updated_at
  );
}

export function getAllCronJobs(db: DatabaseSync): CronJobRow[] {
  return db.prepare("SELECT * FROM cron_jobs ORDER BY name").all() as unknown as CronJobRow[];
}

export interface CronRunRow {
  job_id: string;
  ts: number;
  action?: string;
  status?: string;
  error?: string;
  duration_ms?: number;
  session_id?: string;
  session_key?: string;
  next_run_at?: number;
}

export function insertCronRun(db: DatabaseSync, row: CronRunRow): void {
  db.prepare(`
    INSERT OR IGNORE INTO cron_runs (job_id, ts, action, status, error, duration_ms, session_id, session_key, next_run_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.job_id, row.ts, row.action ?? null, row.status ?? null, row.error ?? null,
    row.duration_ms ?? null, row.session_id ?? null, row.session_key ?? null, row.next_run_at ?? null
  );
}

export function getRecentCronRuns(db: DatabaseSync, jobId: string, limit = 20): CronRunRow[] {
  return db.prepare("SELECT * FROM cron_runs WHERE job_id=? ORDER BY ts DESC LIMIT ?").all(jobId, limit) as unknown as CronRunRow[];
}

// ── Sessions ────────────────────────────────────────────────────────────────

export interface SessionRow {
  session_key: string;
  agent_id?: string;
  platform?: string;
  recipient?: string;
  is_group?: number;
  last_activity_at?: number;
  status?: string;
  message_count?: number;
  total_cost_usd?: number;
  total_input_tokens?: number;
  total_output_tokens?: number;
  updated_at: number;
}

export function upsertSession(db: DatabaseSync, row: SessionRow): void {
  db.prepare(`
    INSERT INTO sessions (session_key, agent_id, platform, recipient, is_group, last_activity_at, status, message_count, total_cost_usd, total_input_tokens, total_output_tokens, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_key) DO UPDATE SET
      agent_id=COALESCE(excluded.agent_id, sessions.agent_id),
      platform=COALESCE(excluded.platform, sessions.platform),
      recipient=COALESCE(excluded.recipient, sessions.recipient),
      is_group=excluded.is_group,
      last_activity_at=excluded.last_activity_at,
      status=excluded.status,
      message_count=sessions.message_count + excluded.message_count,
      total_cost_usd=sessions.total_cost_usd + excluded.total_cost_usd,
      total_input_tokens=sessions.total_input_tokens + excluded.total_input_tokens,
      total_output_tokens=sessions.total_output_tokens + excluded.total_output_tokens,
      updated_at=excluded.updated_at
  `).run(
    row.session_key, row.agent_id ?? null, row.platform ?? null, row.recipient ?? null,
    row.is_group ?? 0, row.last_activity_at ?? null, row.status ?? null,
    row.message_count ?? 0, row.total_cost_usd ?? 0,
    row.total_input_tokens ?? 0, row.total_output_tokens ?? 0, row.updated_at
  );
}

export function getAllSessions(db: DatabaseSync): SessionRow[] {
  return db.prepare("SELECT * FROM sessions ORDER BY last_activity_at DESC").all() as unknown as SessionRow[];
}

// ── Actions ─────────────────────────────────────────────────────────────────

export interface ActionRow {
  id: string;
  run_id?: string;
  session_key?: string;
  seq?: number;
  type?: string;
  event_type?: string;
  ts: number;
  duration_ms?: number;
  tool_name?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  model?: string;
  provider?: string;
  outcome?: string;
  error?: string;
}

export function upsertAction(db: DatabaseSync, row: ActionRow): void {
  db.prepare(`
    INSERT OR REPLACE INTO actions (id, run_id, session_key, seq, type, event_type, ts, duration_ms, tool_name, input_tokens, output_tokens, cost_usd, model, provider, outcome, error)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id, row.run_id ?? null, row.session_key ?? null, row.seq ?? null,
    row.type ?? null, row.event_type ?? null, row.ts,
    row.duration_ms ?? null, row.tool_name ?? null,
    row.input_tokens ?? null, row.output_tokens ?? null, row.cost_usd ?? null,
    row.model ?? null, row.provider ?? null, row.outcome ?? null, row.error ?? null
  );
}

export function getRecentActions(db: DatabaseSync, limit = 100, sessionKey?: string): ActionRow[] {
  if (sessionKey) {
    return db.prepare("SELECT * FROM actions WHERE session_key=? ORDER BY ts DESC LIMIT ?").all(sessionKey, limit) as unknown as ActionRow[];
  }
  return db.prepare("SELECT * FROM actions ORDER BY ts DESC LIMIT ?").all(limit) as unknown as ActionRow[];
}

// ── Alerts ──────────────────────────────────────────────────────────────────

export interface AlertRow {
  id: string;
  rule_id: string;
  severity: string;
  title: string;
  detail?: string;
  ts: number;
  fingerprint: string;
}

export function upsertAlert(db: DatabaseSync, row: AlertRow): void {
  db.prepare(`
    INSERT OR REPLACE INTO alerts (id, rule_id, severity, title, detail, ts, fingerprint)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(row.id, row.rule_id, row.severity, row.title, row.detail ?? null, row.ts, row.fingerprint);
}

export function getRecentAlerts(db: DatabaseSync, limit = 50): AlertRow[] {
  return db.prepare("SELECT * FROM alerts ORDER BY ts DESC LIMIT ?").all(limit) as unknown as AlertRow[];
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

export interface DiagnosticRow {
  event_type: string;
  ts: number;
  summary?: string;
  channel?: string;
  session_key?: string;
  agent_id?: string;
}

export function insertDiagnostic(db: DatabaseSync, row: DiagnosticRow): void {
  db.prepare(`
    INSERT INTO diagnostics (event_type, ts, summary, channel, session_key, agent_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(row.event_type, row.ts, row.summary ?? null, row.channel ?? null, row.session_key ?? null, row.agent_id ?? null);
}

export function getRecentDiagnostics(db: DatabaseSync, limit = 100): DiagnosticRow[] {
  return db.prepare("SELECT * FROM diagnostics ORDER BY rowid DESC LIMIT ?").all(limit) as unknown as DiagnosticRow[];
}

// ── Heartbeats ───────────────────────────────────────────────────────────────

export interface HeartbeatRow {
  ts: number;
  status?: string;
  gateway_connected?: number;
  queue_depth?: number;
  active_sessions?: number;
}

export function insertHeartbeat(db: DatabaseSync, row: HeartbeatRow): void {
  db.prepare(`
    INSERT INTO heartbeats (ts, status, gateway_connected, queue_depth, active_sessions)
    VALUES (?, ?, ?, ?, ?)
  `).run(row.ts, row.status ?? null, row.gateway_connected ?? 0, row.queue_depth ?? 0, row.active_sessions ?? 0);
}

export function getRecentHeartbeats(db: DatabaseSync, limit = 20): HeartbeatRow[] {
  return db.prepare("SELECT * FROM heartbeats ORDER BY rowid DESC LIMIT ?").all(limit) as unknown as HeartbeatRow[];
}

// ── Activity log (unified actions + diagnostics) ───────────────────────────

export interface ActivityEntry {
  ts: number;
  source: "action" | "diagnostic";
  /** action type (start/complete/tool_call…) or diagnostic event_type */
  event_type: string;
  /** e.g. "agent", "tool", "llm", "infra" */
  subsystem: string;
  /** human-readable message */
  message: string;
  session_key?: string;
  run_id?: string;
  tool_name?: string;
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  summary?: string;
  channel?: string;
}

function subsystemFor(eventType: string, source: string): string {
  const t = eventType ?? "";
  if (source === "action") {
    if (t === "tool_call" || t === "tool_result") return "tool";
    if (t === "exec") return "exec";
    if (t === "streaming") return "llm";
    return "agent";
  }
  const prefix = t.split(".")[0];
  if (prefix === "llm") return "llm";
  if (prefix === "tool") return "tool";
  if (prefix === "agent") return "agent";
  if (prefix === "infra") return "infra";
  if (prefix === "session") return "session";
  return "sys";
}

function messageFor(eventType: string, source: string, toolName?: string | null, summary?: string | null): string {
  if (source === "diagnostic") {
    const s = summary ?? eventType;
    if (s === "infra.heartbeat:success" || s === "infra.heartbeat") return "heartbeat ok";
    if (s === "infra.heartbeat:error") return "heartbeat FAIL";
    const ci = s.indexOf(":");
    if (ci > 0) { const after = s.substring(ci + 1); if (after) return after; }
    return s;
  }
  switch (eventType) {
    case "start": return "agent started";
    case "streaming": return "thinking…";
    case "tool_call": return toolName ? `tool: ${toolName}` : "tool call";
    case "tool_result": return "tool result received";
    case "complete": return "response complete";
    case "error": return "error";
    case "aborted": return "aborted";
    case "exec": return toolName ? `exec: ${toolName}` : "exec";
    default: return eventType;
  }
}

export function getActivityLog(db: DatabaseSync, limit = 100, sessionKey?: string): ActivityEntry[] {
  const sessFilter = sessionKey ? `AND session_key = '${sessionKey.replace(/'/g, "''")}'` : "";
  const rows = db.prepare(`
    SELECT
      ts, 'action' AS source, type AS event_type, tool_name, session_key,
      run_id, input_tokens, output_tokens, duration_ms,
      NULL AS summary, NULL AS channel
    FROM actions
    WHERE type IS NOT NULL AND type != 'streaming' ${sessFilter}
    UNION ALL
    SELECT
      ts, 'diagnostic' AS source, event_type, NULL AS tool_name, session_key,
      NULL AS run_id, NULL AS input_tokens, NULL AS output_tokens, NULL AS duration_ms,
      summary, channel
    FROM diagnostics ${sessionKey ? `WHERE session_key = '${sessionKey.replace(/'/g, "''")}'` : ""}
    ORDER BY ts DESC
    LIMIT ?
  `).all(limit) as unknown as Array<{
    ts: number; source: string; event_type: string; tool_name: string | null;
    session_key: string | null; run_id: string | null;
    input_tokens: number | null; output_tokens: number | null;
    duration_ms: number | null; summary: string | null; channel: string | null;
  }>;

  return rows.map(r => ({
    ts: r.ts,
    source: r.source as "action" | "diagnostic",
    event_type: r.event_type ?? "",
    subsystem: subsystemFor(r.event_type ?? "", r.source),
    message: messageFor(r.event_type ?? "", r.source, r.tool_name, r.summary),
    session_key: r.session_key ?? undefined,
    run_id: r.run_id ?? undefined,
    tool_name: r.tool_name ?? undefined,
    duration_ms: r.duration_ms ?? undefined,
    input_tokens: r.input_tokens ?? undefined,
    output_tokens: r.output_tokens ?? undefined,
    summary: r.summary ?? undefined,
    channel: r.channel ?? undefined,
  }));
}

// ── Delivery Queue ───────────────────────────────────────────────────────────

export interface DeliveryQueueRow {
  id: string;
  channel?: string;
  to_address?: string;
  text?: string;
  enqueued_at?: number;
  retry_count?: number;
  last_error?: string;
  status?: string;
  updated_at: number;
}

export function upsertDeliveryItem(db: DatabaseSync, row: DeliveryQueueRow): void {
  db.prepare(`
    INSERT INTO delivery_queue (id, channel, to_address, text, enqueued_at, retry_count, last_error, status, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      retry_count=excluded.retry_count, last_error=excluded.last_error,
      status=excluded.status, updated_at=excluded.updated_at
  `).run(
    row.id, row.channel ?? null, row.to_address ?? null, row.text ?? null,
    row.enqueued_at ?? null, row.retry_count ?? 0, row.last_error ?? null,
    row.status ?? 'pending', row.updated_at
  );
}

export function getPendingDeliveries(db: DatabaseSync): DeliveryQueueRow[] {
  return db.prepare("SELECT * FROM delivery_queue WHERE status='pending' ORDER BY enqueued_at").all() as unknown as DeliveryQueueRow[];
}

// ── OC Config ────────────────────────────────────────────────────────────────

export function upsertOcConfig(db: DatabaseSync, key: string, value: unknown): void {
  db.prepare(`
    INSERT INTO oc_config (key, value_json, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at
  `).run(key, JSON.stringify(value), Date.now());
}

export function getOcConfig(db: DatabaseSync, key: string): unknown {
  const row = db.prepare("SELECT value_json FROM oc_config WHERE key=?").get(key) as unknown as { value_json: string } | undefined;
  if (!row) return null;
  try { return JSON.parse(row.value_json); } catch { return null; }
}

// ── Dashboard state snapshot ──────────────────────────────────────────────────

export interface DashboardState {
  agents: AgentInfoRow[];
  cronJobs: CronJobRow[];
  sessions: SessionRow[];
  recentAlerts: AlertRow[];
  recentDiagnostics: DiagnosticRow[];
  recentHeartbeats: HeartbeatRow[];
  pendingDeliveries: DeliveryQueueRow[];
  recentActions: ActionRow[];
}

export function getDashboardState(db: DatabaseSync): DashboardState {
  return {
    agents: getAllAgents(db),
    cronJobs: getAllCronJobs(db),
    sessions: getAllSessions(db),
    recentAlerts: getRecentAlerts(db, 50),
    recentDiagnostics: getRecentDiagnostics(db, 50),
    recentHeartbeats: getRecentHeartbeats(db, 10),
    pendingDeliveries: getPendingDeliveries(db),
    recentActions: getRecentActions(db, 50),
  };
}
