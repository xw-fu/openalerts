/**
 * OpenAlerts MCP Server
 *
 * Exposes OpenAlerts monitoring data to any MCP-compatible AI assistant.
 * Communicates via stdio. Start with: openalerts mcp
 *
 * Tools:    get_status, get_alerts, get_sessions, get_session_detail,
 *           get_activity, get_rule_states, get_agents, get_cron_jobs,
 *           summarize, fire_test_alert
 *
 * Resources: openalerts://status, openalerts://alerts/recent,
 *            openalerts://sessions/active, openalerts://rules
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { OpenAlertsClient } from "./client.js";
import { RESOURCES, readResource } from "./resources.js";
import {
  handleGetStatus,
  handleGetAlerts,
  handleGetSessions,
  handleGetSessionDetail,
  handleGetActivity,
  handleGetRuleStates,
  handleGetAgents,
  handleGetCronJobs,
  handleSummarize,
  handleFireTestAlert,
} from "./tools.js";

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "get_status",
    description: "Get OpenAlerts daemon health, gateway connection status, and 24h statistics (messages, errors, tokens, cost).",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_alerts",
    description: "Get recent fired alerts. Optionally filter by severity or rule ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit:    { type: "number", description: "Max alerts to return (default 50)" },
        severity: { type: "string", enum: ["info", "warn", "error", "critical"], description: "Filter by severity" },
        rule_id:  { type: "string", description: "Filter by rule ID (e.g. llm-errors, gateway-down)" },
      },
    },
  },
  {
    name: "get_sessions",
    description: "List agent monitoring sessions with status, message count, cost, and last activity.",
    inputSchema: {
      type: "object" as const,
      properties: {
        status: { type: "string", description: "Filter by status (e.g. active, completed, error)" },
        limit:  { type: "number", description: "Max sessions to return" },
      },
    },
  },
  {
    name: "get_session_detail",
    description: "Get full detail for a specific session including all its actions/events.",
    inputSchema: {
      type: "object" as const,
      properties: {
        session_key:  { type: "string", description: "Session key to look up" },
        action_limit: { type: "number", description: "Max actions to return (default 50)" },
      },
      required: ["session_key"],
    },
  },
  {
    name: "get_activity",
    description: "Get the unified activity feed — agent steps, tool calls, LLM calls, infra events.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit:       { type: "number", description: "Max entries to return (default 50)" },
        session_key: { type: "string", description: "Filter by session key" },
        subsystem:   { type: "string", enum: ["llm", "tool", "agent", "infra", "exec", "sys"], description: "Filter by subsystem" },
      },
    },
  },
  {
    name: "get_rule_states",
    description: "List all 10 alert rules with their thresholds, cooldowns, and last-fired timestamps.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_agents",
    description: "List all known agents with their IDs, names, and last-updated timestamps.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "get_cron_jobs",
    description: "List all scheduled cron jobs with their last run status, schedule, and consecutive errors.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "summarize",
    description: "Get a concise narrative summary of what's happening right now — active sessions, recent alerts, activity, cost, and gateway status.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
  {
    name: "fire_test_alert",
    description: "Send a test alert through all configured channels to verify delivery is working. Requires daemon to be running.",
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },
];

// ── Server bootstrap ──────────────────────────────────────────────────────────

export async function startMcpServer(opts?: { port?: number; dbPath?: string }): Promise<void> {
  const client = new OpenAlertsClient(opts);

  const server = new Server(
    { name: "openalerts", version: "1.0.0" },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        "OpenAlerts MCP server. Use 'summarize' for a quick overview, " +
        "'get_status' for daemon health, 'get_alerts' for recent alerts, " +
        "and 'get_activity' for live agent events. " +
        "Data comes from the running daemon (localhost:4242) or SQLite fallback.",
    },
  );

  // ── List tools ─────────────────────────────────────────────────────────────
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  // ── Call tool ──────────────────────────────────────────────────────────────
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const a = (args ?? {}) as Record<string, unknown>;

    switch (name) {
      case "get_status":         return handleGetStatus(client);
      case "get_alerts":         return handleGetAlerts(client, a as Parameters<typeof handleGetAlerts>[1]);
      case "get_sessions":       return handleGetSessions(client, a as Parameters<typeof handleGetSessions>[1]);
      case "get_session_detail": return handleGetSessionDetail(client, a as Parameters<typeof handleGetSessionDetail>[1]);
      case "get_activity":       return handleGetActivity(client, a as Parameters<typeof handleGetActivity>[1]);
      case "get_rule_states":    return handleGetRuleStates(client);
      case "get_agents":         return handleGetAgents(client);
      case "get_cron_jobs":      return handleGetCronJobs(client);
      case "summarize":          return handleSummarize(client);
      case "fire_test_alert":    return handleFireTestAlert(client);
      default:
        return { content: [{ type: "text" as const, text: `Unknown tool: ${name}` }], isError: true };
    }
  });

  // ── List resources ─────────────────────────────────────────────────────────
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCES }));

  // ── Read resource ──────────────────────────────────────────────────────────
  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const { uri } = request.params;
    const text = await readResource(uri, client);
    return {
      contents: [{ uri, mimeType: "text/plain", text }],
    };
  });

  // ── Connect stdio transport ────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);

  process.on("exit", () => client.close());
}
