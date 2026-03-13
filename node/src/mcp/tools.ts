/**
 * OpenAlerts MCP Tools
 * Each function handles one tool call and returns MCP-compatible content.
 */
import type { OpenAlertsClient } from "./client.js";

// ── Static rule catalogue (for get_rule_states when daemon is offline) ───────

const RULE_CATALOGUE = [
  { id: "infra-errors",       severity: "error",    defaultThreshold: 1,    defaultCooldownMin: 15,  description: "Infrastructure errors spike (>= N in 1 min)" },
  { id: "llm-errors",         severity: "error",    defaultThreshold: 1,    defaultCooldownMin: 15,  description: "LLM / agent call errors (>= N in 1 min)" },
  { id: "session-stuck",      severity: "warn",     defaultThreshold: 120,  defaultCooldownMin: 30,  description: "Session inactive for >= N seconds" },
  { id: "heartbeat-fail",     severity: "error",    defaultThreshold: 3,    defaultCooldownMin: 30,  description: ">= N consecutive heartbeat failures" },
  { id: "queue-depth",        severity: "warn",     defaultThreshold: 10,   defaultCooldownMin: 15,  description: "Delivery queue >= N items" },
  { id: "high-error-rate",    severity: "error",    defaultThreshold: 50,   defaultCooldownMin: 30,  description: ">= N% of last 20 LLM calls failed" },
  { id: "cost-hourly-spike",  severity: "warn",     defaultThreshold: 5,    defaultCooldownMin: 30,  description: "LLM spend >= $N in last 60 minutes" },
  { id: "cost-daily-budget",  severity: "error",    defaultThreshold: 20,   defaultCooldownMin: 360, description: "LLM spend >= $N in last 24 hours" },
  { id: "tool-errors",        severity: "warn",     defaultThreshold: 1,    defaultCooldownMin: 15,  description: "Tool execution errors (>= N in 1 min)" },
  { id: "gateway-down",       severity: "critical", defaultThreshold: 30,   defaultCooldownMin: 60,  description: "No gateway heartbeat for >= N seconds" },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function text(content: string) {
  return { content: [{ type: "text" as const, text: content }] };
}

function ts(ms: number): string {
  return new Date(ms).toISOString();
}

function ago(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.round(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m ago`;
  return `${Math.round(diff / 3_600_000)}h ago`;
}

// ── Tool handlers ─────────────────────────────────────────────────────────────

export async function handleGetStatus(client: OpenAlertsClient) {
  const [health, engine] = await Promise.all([
    client.getHealth(),
    client.getEngine(),
  ]);

  if (!health && !engine) {
    return text(
      "Daemon is not running.\n" +
      "Start it with: openalerts start\n" +
      "SQLite data may still be available via other tools.",
    );
  }

  const lines: string[] = ["## OpenAlerts Status\n"];

  if (health) {
    lines.push(`**Daemon**: running`);
    lines.push(`**Gateway**: ${health.gatewayConnected ? "connected" : "disconnected"}`);
    lines.push(`**SSE clients**: ${health.sseClients}`);
    lines.push(`**Checked at**: ${ts(health.ts)}\n`);
  }

  if (engine) {
    const s = engine.stats;
    lines.push(`**Uptime since**: ${ts(engine.startedAt)} (${ago(engine.startedAt)})`);
    lines.push(`**Messages processed**: ${s.messagesProcessed ?? 0}`);
    lines.push(`**Agent starts**: ${s.agentStarts ?? 0}`);
    lines.push(`**Tool calls**: ${s.toolCalls ?? 0}`);
    lines.push(`**Tool errors**: ${s.toolErrors ?? 0}`);
    lines.push(`**LLM errors**: ${s.messageErrors ?? 0}`);
    lines.push(`**Total tokens**: ${(s.totalTokens ?? 0).toLocaleString()}`);
    lines.push(`**Total cost**: $${(s.totalCostUsd ?? 0).toFixed(4)}`);
    lines.push(`**Alerts this hour**: ${engine.hourlyAlerts.count}`);
    lines.push(`**Last heartbeat**: ${engine.lastHeartbeatTs ? ago(engine.lastHeartbeatTs) : "none"}`);
  }

  return text(lines.join("\n"));
}

export async function handleGetAlerts(
  client: OpenAlertsClient,
  args: { limit?: number; severity?: string; rule_id?: string },
) {
  let alerts = await client.getAlerts(args.limit ?? 50) as Array<{
    id: string; rule_id: string; severity: string; title: string;
    detail: string; ts: number; fingerprint: string;
  }>;

  if (args.severity) {
    alerts = alerts.filter(a => a.severity === args.severity);
  }
  if (args.rule_id) {
    alerts = alerts.filter(a => a.rule_id === args.rule_id);
  }

  if (alerts.length === 0) {
    return text("No alerts found matching the criteria.");
  }

  const lines = [`## Alerts (${alerts.length})\n`];
  for (const a of alerts) {
    const icon = { info: "ℹ️", warn: "⚠️", error: "🚨", critical: "🔥" }[a.severity] ?? "•";
    lines.push(`${icon} **${a.title}** [${a.rule_id}] — ${ago(a.ts)}`);
    lines.push(`   ${a.detail}`);
    lines.push(`   _${ts(a.ts)}_\n`);
  }

  return text(lines.join("\n"));
}

export async function handleGetSessions(
  client: OpenAlertsClient,
  args: { status?: string; limit?: number },
) {
  let sessions = await client.getSessions() as Array<{
    session_key: string; agent_id?: string; platform?: string;
    status?: string; message_count?: number; total_cost_usd?: number;
    total_input_tokens?: number; total_output_tokens?: number;
    last_activity_at?: number;
  }>;

  if (args.status) {
    sessions = sessions.filter(s => s.status === args.status);
  }
  if (args.limit) {
    sessions = sessions.slice(0, args.limit);
  }

  if (sessions.length === 0) {
    return text("No sessions found.");
  }

  const lines = [`## Sessions (${sessions.length})\n`];
  for (const s of sessions) {
    lines.push(`**${s.session_key}**`);
    if (s.agent_id) lines.push(`  Agent: ${s.agent_id}`);
    if (s.platform) lines.push(`  Platform: ${s.platform}`);
    if (s.status) lines.push(`  Status: ${s.status}`);
    if (s.message_count) lines.push(`  Messages: ${s.message_count}`);
    if (s.total_cost_usd) lines.push(`  Cost: $${s.total_cost_usd.toFixed(4)}`);
    const tokens = (s.total_input_tokens ?? 0) + (s.total_output_tokens ?? 0);
    if (tokens > 0) lines.push(`  Tokens: ${tokens.toLocaleString()}`);
    if (s.last_activity_at) lines.push(`  Last activity: ${ago(s.last_activity_at)}`);
    lines.push("");
  }

  return text(lines.join("\n"));
}

export async function handleGetSessionDetail(
  client: OpenAlertsClient,
  args: { session_key: string; action_limit?: number },
) {
  const [sessions, actions] = await Promise.all([
    client.getSessions(),
    client.getActions(args.action_limit ?? 50, args.session_key),
  ]);

  const session = (sessions as Array<{ session_key: string } & Record<string, unknown>>)
    .find(s => s.session_key === args.session_key);

  if (!session) {
    return text(`Session '${args.session_key}' not found.`);
  }

  const lines = [`## Session: ${args.session_key}\n`];
  for (const [k, v] of Object.entries(session)) {
    if (v != null) lines.push(`**${k}**: ${v}`);
  }

  lines.push(`\n### Actions (${(actions as unknown[]).length})\n`);
  for (const a of actions as Array<Record<string, unknown>>) {
    const icon = a.outcome === "error" ? "❌" : "✓";
    lines.push(
      `${icon} [${ts(a.ts as number)}] ${a.type ?? a.event_type ?? "?"}` +
      (a.tool_name ? ` — ${a.tool_name}` : "") +
      (a.duration_ms ? ` (${a.duration_ms}ms)` : "") +
      (a.error ? `\n   Error: ${a.error}` : ""),
    );
  }

  return text(lines.join("\n"));
}

export async function handleGetActivity(
  client: OpenAlertsClient,
  args: { limit?: number; session_key?: string; subsystem?: string },
) {
  let activity = await client.getActivity(args.limit ?? 50, args.session_key) as Array<{
    ts: number; subsystem: string; message: string; event_type: string;
    session_key?: string; tool_name?: string; duration_ms?: number;
    input_tokens?: number; output_tokens?: number;
  }>;

  if (args.subsystem) {
    activity = activity.filter(e => e.subsystem === args.subsystem);
  }

  if (activity.length === 0) {
    return text("No activity found.");
  }

  const lines = [`## Activity (${activity.length})\n`];
  for (const e of activity) {
    const subsysIcon: Record<string, string> = {
      llm: "🤖", tool: "🔧", agent: "👤", infra: "⚙️", exec: "💻", sys: "📋",
    };
    const icon = subsysIcon[e.subsystem] ?? "•";
    let line = `${icon} [${ts(e.ts)}] **${e.subsystem}** — ${e.message}`;
    if (e.tool_name) line += ` (${e.tool_name})`;
    if (e.duration_ms) line += ` ${e.duration_ms}ms`;
    if (e.input_tokens || e.output_tokens) {
      line += ` [in:${e.input_tokens ?? 0} out:${e.output_tokens ?? 0}]`;
    }
    lines.push(line);
  }

  return text(lines.join("\n"));
}

export async function handleGetRuleStates(client: OpenAlertsClient) {
  const recentAlerts = await client.getAlerts(200) as Array<{
    rule_id: string; ts: number; severity: string;
  }>;

  const lastFiredMap = new Map<string, number>();
  for (const a of recentAlerts) {
    const existing = lastFiredMap.get(a.rule_id);
    if (!existing || a.ts > existing) lastFiredMap.set(a.rule_id, a.ts);
  }

  const lines = ["## Alert Rules\n"];
  for (const rule of RULE_CATALOGUE) {
    const lastFired = lastFiredMap.get(rule.id);
    const cooldownMs = rule.defaultCooldownMin * 60 * 1000;
    const onCooldown = lastFired ? (Date.now() - lastFired) < cooldownMs : false;
    const icon = { warn: "⚠️", error: "🚨", critical: "🔥" }[rule.severity] ?? "ℹ️";

    lines.push(`${icon} **${rule.id}**`);
    lines.push(`  ${rule.description}`);
    lines.push(`  Threshold: ${rule.defaultThreshold} | Cooldown: ${rule.defaultCooldownMin}min`);
    if (lastFired) {
      lines.push(`  Last fired: ${ago(lastFired)} (${ts(lastFired)})`);
      lines.push(`  On cooldown: ${onCooldown ? "yes" : "no"}`);
    } else {
      lines.push(`  Last fired: never`);
    }
    lines.push("");
  }

  return text(lines.join("\n"));
}

export async function handleGetAgents(client: OpenAlertsClient) {
  const agents = await client.getAgents() as Array<{
    agent_id: string; name?: string; emoji?: string; updated_at: number;
  }>;

  if (agents.length === 0) {
    return text("No agents found in the database.");
  }

  const lines = [`## Agents (${agents.length})\n`];
  for (const a of agents) {
    lines.push(`${a.emoji ?? "🤖"} **${a.name ?? a.agent_id}** (${a.agent_id})`);
    lines.push(`  Updated: ${ago(a.updated_at)}`);
    lines.push("");
  }
  return text(lines.join("\n"));
}

export async function handleSummarize(client: OpenAlertsClient) {
  const [engine, alerts, sessions, activity] = await Promise.all([
    client.getEngine(),
    client.getAlerts(100),
    client.getSessions(),
    client.getActivity(200),
  ]);

  const now = Date.now();
  const window1h = now - 3_600_000;
  const window15m = now - 15 * 60_000;

  const recentAlerts = (alerts as Array<{ ts: number; title: string; severity: string; rule_id: string }>)
    .filter(a => a.ts > window1h);

  const typedSessions = sessions as Array<{
    session_key: string; status?: string; last_activity_at?: number;
    total_cost_usd?: number; message_count?: number;
  }>;
  const activeSessions = typedSessions.filter(s =>
    s.last_activity_at && s.last_activity_at > window15m,
  );

  const typedActivity = activity as Array<{ ts: number; subsystem: string; event_type: string }>;
  const recentActivity = typedActivity.filter(e => e.ts > window1h);
  const llmCalls = recentActivity.filter(e => e.subsystem === "llm").length;
  const toolCalls = recentActivity.filter(e => e.subsystem === "tool").length;
  const errors = recentActivity.filter(e =>
    e.event_type.includes("error") || e.event_type.includes("fail"),
  ).length;

  const lines: string[] = ["## OpenAlerts Summary\n"];

  if (engine) {
    const gw = engine.gatewayConnected;
    lines.push(
      `**Daemon**: running since ${ago(engine.startedAt)}` +
      ` | Gateway: ${gw === true ? "connected" : gw === false ? "disconnected" : "unknown"}`,
    );
  } else {
    lines.push("**Daemon**: not running (showing historical data from SQLite)");
  }
  lines.push("");

  if (activeSessions.length > 0) {
    lines.push(`**Active sessions** (last 15m): ${activeSessions.length}`);
    for (const s of activeSessions.slice(0, 5)) {
      lines.push(`  • ${s.session_key}` + (s.total_cost_usd ? ` — $${s.total_cost_usd.toFixed(4)}` : ""));
    }
  } else {
    lines.push(`**Active sessions**: none in last 15 minutes`);
  }
  lines.push(`**Total sessions**: ${typedSessions.length}`);
  lines.push("");

  lines.push(`**Activity (last 1h)**: ${recentActivity.length} events`);
  if (llmCalls > 0) lines.push(`  • LLM calls: ${llmCalls}`);
  if (toolCalls > 0) lines.push(`  • Tool calls: ${toolCalls}`);
  if (errors > 0) lines.push(`  • ⚠️ Errors: ${errors}`);
  lines.push("");

  if (engine?.stats) {
    const s = engine.stats;
    if (s.totalCostUsd > 0) {
      lines.push(`**Cost (24h)**: $${s.totalCostUsd.toFixed(4)} | Tokens: ${(s.totalTokens ?? 0).toLocaleString()}`);
      lines.push("");
    }
  }

  if (recentAlerts.length > 0) {
    lines.push(`**Alerts fired (last 1h)**: ${recentAlerts.length}`);
    for (const a of recentAlerts.slice(0, 5)) {
      const icon = { warn: "⚠️", error: "🚨", critical: "🔥" }[a.severity] ?? "ℹ️";
      lines.push(`  ${icon} ${a.title} [${a.rule_id}] — ${ago(a.ts)}`);
    }
  } else {
    lines.push(`**Alerts (last 1h)**: none ✓`);
  }

  return text(lines.join("\n"));
}

export async function handleFireTestAlert(client: OpenAlertsClient) {
  const result = await client.fireTestAlert();
  if (result.ok) {
    return text(`Test alert fired successfully. ${result.message ?? ""}`);
  }
  return text(`Failed to fire test alert: ${result.error ?? "unknown error"}`);
}

export async function handleGetCronJobs(client: OpenAlertsClient) {
  const jobs = await client.getCronJobs() as Array<{
    id: string; name?: string; agent_id?: string; schedule_expr?: string;
    last_status?: string; last_run_at?: number; next_run_at?: number;
    consecutive_errors?: number;
  }>;

  if (jobs.length === 0) {
    return text("No cron jobs found.");
  }

  const lines = [`## Cron Jobs (${jobs.length})\n`];
  for (const j of jobs) {
    const statusIcon = j.last_status === "error" ? "❌" : j.last_status === "ok" ? "✓" : "•";
    lines.push(`${statusIcon} **${j.name ?? j.id}**`);
    if (j.schedule_expr) lines.push(`  Schedule: ${j.schedule_expr}`);
    if (j.agent_id) lines.push(`  Agent: ${j.agent_id}`);
    if (j.last_run_at) lines.push(`  Last run: ${ago(j.last_run_at)}`);
    if (j.next_run_at) lines.push(`  Next run: ${new Date(j.next_run_at).toISOString()}`);
    if (j.consecutive_errors) lines.push(`  Consecutive errors: ${j.consecutive_errors}`);
    lines.push("");
  }
  return text(lines.join("\n"));
}
