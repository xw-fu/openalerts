/** SQLite schema for openalerts */

export const SCHEMA_SQL = `
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

-- ── Agent identity + workspace docs ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_info (
  agent_id    TEXT PRIMARY KEY,
  name        TEXT,
  emoji       TEXT,
  soul_md     TEXT,
  heartbeat_md TEXT,
  memory_md   TEXT,
  identity_md TEXT,
  user_md     TEXT,
  agents_md   TEXT,
  tools_md    TEXT,
  updated_at  INTEGER NOT NULL
);

-- ── Cron job definitions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cron_jobs (
  id                TEXT PRIMARY KEY,
  agent_id          TEXT,
  name              TEXT,
  description       TEXT,
  schedule_expr     TEXT,
  schedule_tz       TEXT,
  last_run_at       INTEGER,
  last_status       TEXT,
  last_error        TEXT,
  next_run_at       INTEGER,
  consecutive_errors INTEGER DEFAULT 0,
  updated_at        INTEGER NOT NULL
);

-- ── Cron job run history ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cron_runs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id      TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  action      TEXT,
  status      TEXT,
  error       TEXT,
  duration_ms INTEGER,
  session_id  TEXT,
  session_key TEXT,
  next_run_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cron_runs_job ON cron_runs(job_id, ts DESC);

-- ── Sessions ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sessions (
  session_key          TEXT PRIMARY KEY,
  agent_id             TEXT,
  platform             TEXT,
  recipient            TEXT,
  is_group             INTEGER DEFAULT 0,
  last_activity_at     INTEGER,
  status               TEXT,
  message_count        INTEGER DEFAULT 0,
  total_cost_usd       REAL DEFAULT 0,
  total_input_tokens   INTEGER DEFAULT 0,
  total_output_tokens  INTEGER DEFAULT 0,
  updated_at           INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_agent ON sessions(agent_id, last_activity_at DESC);

-- ── Agent actions (tool calls, LLM runs, etc.) ───────────────────────────────
CREATE TABLE IF NOT EXISTS actions (
  id           TEXT PRIMARY KEY,
  run_id       TEXT,
  session_key  TEXT,
  seq          INTEGER,
  type         TEXT,
  event_type   TEXT,
  ts           INTEGER NOT NULL,
  duration_ms  INTEGER,
  tool_name    TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_usd     REAL,
  model        TEXT,
  provider     TEXT,
  outcome      TEXT,
  error        TEXT
);
CREATE INDEX IF NOT EXISTS idx_actions_session ON actions(session_key, ts DESC);
CREATE INDEX IF NOT EXISTS idx_actions_run ON actions(run_id, seq);

-- ── Alert events ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS alerts (
  id          TEXT PRIMARY KEY,
  rule_id     TEXT NOT NULL,
  severity    TEXT NOT NULL,
  title       TEXT NOT NULL,
  detail      TEXT,
  ts          INTEGER NOT NULL,
  fingerprint TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_alerts_ts ON alerts(ts DESC);
CREATE INDEX IF NOT EXISTS idx_alerts_rule ON alerts(rule_id);

-- ── Diagnostic events (ring buffer, keep last 2000) ──────────────────────────
CREATE TABLE IF NOT EXISTS diagnostics (
  rowid       INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type  TEXT NOT NULL,
  ts          INTEGER NOT NULL,
  summary     TEXT,
  channel     TEXT,
  session_key TEXT,
  agent_id    TEXT
);
CREATE INDEX IF NOT EXISTS idx_diag_ts ON diagnostics(ts DESC);

-- ── Heartbeat log ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS heartbeats (
  rowid            INTEGER PRIMARY KEY AUTOINCREMENT,
  ts               INTEGER NOT NULL,
  status           TEXT,
  gateway_connected INTEGER DEFAULT 0,
  queue_depth      INTEGER DEFAULT 0,
  active_sessions  INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_hb_ts ON heartbeats(ts DESC);

-- ── Delivery queue snapshot ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS delivery_queue (
  id          TEXT PRIMARY KEY,
  channel     TEXT,
  to_address  TEXT,
  text        TEXT,
  enqueued_at INTEGER,
  retry_count INTEGER DEFAULT 0,
  last_error  TEXT,
  status      TEXT DEFAULT 'pending',
  updated_at  INTEGER NOT NULL
);

-- ── Daily metrics ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS daily_metrics (
  date_key      TEXT NOT NULL,
  hour_ts       INTEGER NOT NULL,
  agent_runs    INTEGER DEFAULT 0,
  tool_calls    INTEGER DEFAULT 0,
  total_tokens  INTEGER DEFAULT 0,
  total_cost    REAL DEFAULT 0,
  errors        INTEGER DEFAULT 0,
  PRIMARY KEY (date_key, hour_ts)
);

-- ── OpenClaw config snapshot (for dashboard display) ─────────────────────────
CREATE TABLE IF NOT EXISTS oc_config (
  key         TEXT PRIMARY KEY,
  value_json  TEXT,
  updated_at  INTEGER NOT NULL
);

-- ── Schema version ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);
INSERT OR IGNORE INTO schema_version VALUES (1);
`;

export const PRUNE_DIAGNOSTICS_SQL = `
  DELETE FROM diagnostics
  WHERE rowid NOT IN (
    SELECT rowid FROM diagnostics ORDER BY rowid DESC LIMIT 2000
  )
`;

export const PRUNE_HEARTBEATS_SQL = `
  DELETE FROM heartbeats
  WHERE rowid NOT IN (
    SELECT rowid FROM heartbeats ORDER BY rowid DESC LIMIT 500
  )
`;
