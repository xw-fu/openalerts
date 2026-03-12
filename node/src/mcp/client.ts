/**
 * OpenAlerts MCP Client
 * Fetches data from the REST API (localhost:4242) with direct SQLite fallback.
 */
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  getRecentAlerts,
  getRecentActions,
  getAllSessions,
  getAllAgents,
  getAllCronJobs,
  getActivityLog,
  getRecentDiagnostics,
  getRecentHeartbeats,
  getDashboardState,
} from "../db/queries.js";

export const DEFAULT_PORT = 4242;
export const DEFAULT_DB_PATH = path.join(os.homedir(), ".openalerts", "openalerts.db");

// ── API response shapes ──────────────────────────────────────────────────────

export interface EngineState {
  running: boolean;
  gatewayConnected: boolean | null;
  startedAt: number;
  stats: Record<string, number>;
  hourlyAlerts: { count: number; resetAt: number };
  lastHeartbeatTs: number;
}

export interface HealthState {
  ok: boolean;
  ts: number;
  sseClients: number;
  gatewayConnected: boolean | null;
}

// ── Client ───────────────────────────────────────────────────────────────────

export class OpenAlertsClient {
  private port: number;
  private dbPath: string;
  private _db: DatabaseSync | null = null;

  constructor(opts?: { port?: number; dbPath?: string }) {
    this.port = opts?.port ?? DEFAULT_PORT;
    this.dbPath = opts?.dbPath ?? DEFAULT_DB_PATH;
  }

  private get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /** Try REST API; returns null on any error. */
  private async api<T>(endpoint: string, init?: RequestInit): Promise<T | null> {
    try {
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        ...init,
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return null;
      return res.json() as Promise<T>;
    } catch {
      return null;
    }
  }

  /** Get or lazily open a read-only SQLite connection. */
  private db(): DatabaseSync | null {
    if (this._db) return this._db;
    try {
      this._db = new DatabaseSync(this.dbPath, { open: true });
      return this._db;
    } catch {
      return null;
    }
  }

  close(): void {
    try { this._db?.close(); } catch { /* ignore */ }
    this._db = null;
  }

  // ── Health / Engine ────────────────────────────────────────────────────────

  async getHealth(): Promise<HealthState | null> {
    return this.api<HealthState>("/health");
  }

  async getEngine(): Promise<EngineState | null> {
    return this.api<EngineState>("/api/engine");
  }

  // ── Alerts ─────────────────────────────────────────────────────────────────

  async getAlerts(limit = 50): Promise<unknown[]> {
    const fromApi = await this.api<unknown[]>(`/api/alerts?limit=${limit}`);
    if (fromApi) return fromApi;
    const db = this.db();
    if (!db) return [];
    return getRecentAlerts(db, limit);
  }

  // ── Sessions ───────────────────────────────────────────────────────────────

  async getSessions(): Promise<unknown[]> {
    const state = await this.api<{ sessions: unknown[] }>("/api/state");
    if (state?.sessions) return state.sessions;
    const db = this.db();
    if (!db) return [];
    return getAllSessions(db);
  }

  // ── Activity ───────────────────────────────────────────────────────────────

  async getActivity(limit = 100, sessionKey?: string): Promise<unknown[]> {
    const q = sessionKey
      ? `/api/activity?limit=${limit}&session=${encodeURIComponent(sessionKey)}`
      : `/api/activity?limit=${limit}`;
    const fromApi = await this.api<unknown[]>(q);
    if (fromApi) return fromApi;
    const db = this.db();
    if (!db) return [];
    return getActivityLog(db, limit, sessionKey);
  }

  // ── Actions ────────────────────────────────────────────────────────────────

  async getActions(limit = 100, sessionKey?: string): Promise<unknown[]> {
    const q = sessionKey
      ? `/api/actions?limit=${limit}&session=${encodeURIComponent(sessionKey)}`
      : `/api/actions?limit=${limit}`;
    const fromApi = await this.api<unknown[]>(q);
    if (fromApi) return fromApi;
    const db = this.db();
    if (!db) return [];
    return getRecentActions(db, limit, sessionKey);
  }

  // ── Agents ─────────────────────────────────────────────────────────────────

  async getAgents(): Promise<unknown[]> {
    const state = await this.api<{ agents: unknown[] }>("/api/state");
    if (state?.agents) return state.agents;
    const db = this.db();
    if (!db) return [];
    return getAllAgents(db);
  }

  // ── Cron jobs ──────────────────────────────────────────────────────────────

  async getCronJobs(): Promise<unknown[]> {
    const state = await this.api<{ cronJobs: unknown[] }>("/api/state");
    if (state?.cronJobs) return state.cronJobs;
    const db = this.db();
    if (!db) return [];
    return getAllCronJobs(db);
  }

  // ── Full state snapshot ────────────────────────────────────────────────────

  async getFullState(): Promise<unknown> {
    const fromApi = await this.api<unknown>("/api/state");
    if (fromApi) return fromApi;
    const db = this.db();
    if (!db) return null;
    return getDashboardState(db);
  }

  // ── Diagnostics & heartbeats ───────────────────────────────────────────────

  async getDiagnostics(limit = 50): Promise<unknown[]> {
    const fromApi = await this.api<unknown[]>(`/api/diagnostics?limit=${limit}`);
    if (fromApi) return fromApi;
    const db = this.db();
    if (!db) return [];
    return getRecentDiagnostics(db, limit);
  }

  async getHeartbeats(limit = 10): Promise<unknown[]> {
    const fromApi = await this.api<unknown[]>(`/api/heartbeats?limit=${limit}`);
    if (fromApi) return fromApi;
    const db = this.db();
    if (!db) return [];
    return getRecentHeartbeats(db, limit);
  }

  // ── Test alert ─────────────────────────────────────────────────────────────

  async fireTestAlert(): Promise<{ ok: boolean; message?: string; error?: string }> {
    const result = await this.api<{ ok: boolean; message: string }>(
      "/api/test",
      { method: "POST" },
    );
    if (result) return result;
    return { ok: false, error: "Daemon not running. Start with: openalerts start" };
  }

  // ── Daemon status ──────────────────────────────────────────────────────────

  async isDaemonRunning(): Promise<boolean> {
    const h = await this.getHealth();
    return h?.ok === true;
  }
}
