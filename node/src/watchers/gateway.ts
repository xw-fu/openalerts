/**
 * Gateway WebSocket client — connects to OpenClaw gateway as an operator.
 * Adapted from node/src/plugin/gateway-client.ts (same protocol).
 * Emits: ready, disconnected, error, agent, chat, health, cron, tick
 */
import { randomUUID } from "node:crypto";
import { WebSocket } from "ws";
import { EventEmitter } from "node:events";

export interface GatewayClientConfig {
  url?: string;
  token?: string;
  reconnectInterval?: number;
}

interface GatewayFrame {
  type: "req" | "res" | "event";
  id?: string;
  method?: string;
  params?: unknown;
  ok?: boolean;
  result?: unknown;
  error?: unknown;
  payload?: unknown;
  event?: string;
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export class GatewayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private backoffMs = 1000;
  private closed = false;
  private connectTimer: NodeJS.Timeout | null = null;
  private _ready = false;

  private readonly url: string;
  private readonly token: string;
  private readonly reconnectInterval: number;

  constructor(config: GatewayClientConfig = {}) {
    super();
    this.url = config.url ?? "ws://127.0.0.1:18789";
    this.token = config.token ?? "";
    this.reconnectInterval = config.reconnectInterval ?? 1000;
  }

  get isReady(): boolean { return this._ready; }

  start(): void {
    if (!this.closed) this.connect();
  }

  stop(): void {
    this.closed = true;
    if (this.connectTimer) { clearTimeout(this.connectTimer); this.connectTimer = null; }
    if (this.ws) { this.ws.close(); this.ws = null; }
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this._ready || !this.ws) return Promise.reject(new Error("Gateway not ready"));
    const id = randomUUID();
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout: ${method}`));
      }, 10_000);
      this.pending.set(id, {
        resolve: v => { clearTimeout(timeout); resolve(v as T); },
        reject: e => { clearTimeout(timeout); reject(e); },
      });
      this.ws!.send(JSON.stringify({ type: "req", id, method, params } satisfies GatewayFrame));
    });
  }

  private connect(): void {
    if (this.closed || this.ws) return;
    this.ws = new WebSocket(this.url, { maxPayload: 25 * 1024 * 1024 });

    this.ws.on("open", () => { this.backoffMs = this.reconnectInterval; });
    this.ws.on("message", (data: Buffer) => this.handleFrame(data.toString()));
    this.ws.on("error", err => this.emit("error", err));
    this.ws.on("close", () => {
      this.ws = null;
      this._ready = false;
      this.emit("disconnected");
      if (!this.closed) this.scheduleReconnect();
    });
  }

  private handleFrame(raw: string): void {
    try {
      const frame: GatewayFrame = JSON.parse(raw);
      if (frame.type === "event" && frame.event === "connect.challenge") {
        this.sendHandshake();
        return;
      }
      if (frame.type === "res") {
        const p = this.pending.get(frame.id!);
        if (p) {
          this.pending.delete(frame.id!);
          if (frame.error || frame.ok === false) {
            const msg = typeof frame.error === "string" ? frame.error : JSON.stringify(frame.error ?? frame.payload);
            p.reject(new Error(msg));
          } else {
            p.resolve(frame.payload ?? frame.result);
          }
        }
        return;
      }
      if (frame.type === "event" && frame.event) {
        this.emit(frame.event, frame.payload);
      }
    } catch { /* ignore parse errors */ }
  }

  private sendHandshake(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const id = randomUUID();
    this.pending.set(id, {
      resolve: result => { this._ready = true; this.emit("ready", result); },
      reject: err => this.emit("error", new Error(`Handshake failed: ${err.message}`)),
    });
    const frame: GatewayFrame = {
      type: "req", id, method: "connect",
      params: {
        minProtocol: 3, maxProtocol: 3,
        client: { id: "cli", displayName: "OpenAlerts", version: "0.1.0", platform: process.platform, mode: "cli" },
        role: "operator",
        scopes: ["operator.read"],
        caps: [], commands: [], permissions: {},
        locale: "en-US",
        userAgent: "openalerts/0.1.0",
        auth: this.token ? { token: this.token } : undefined,
      },
    };
    this.ws.send(JSON.stringify(frame));
  }

  private scheduleReconnect(): void {
    if (this.connectTimer) clearTimeout(this.connectTimer);
    this.connectTimer = setTimeout(() => {
      this.backoffMs = Math.min(this.backoffMs * 2, 60_000);
      this.connect();
    }, this.backoffMs);
  }
}
