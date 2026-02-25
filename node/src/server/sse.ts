/**
 * SSE (Server-Sent Events) connection manager.
 * Clients subscribe and receive real-time updates.
 */
import type { ServerResponse } from "node:http";

export interface SseClient {
  id: string;
  res: ServerResponse;
}

export class SseManager {
  private clients: Map<string, SseClient> = new Map();
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private clientCounter = 0;

  start(): void {
    this.heartbeatTimer = setInterval(() => {
      this.broadcast(":heartbeat\n\n");
    }, 15_000);
  }

  stop(): void {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    for (const client of this.clients.values()) {
      try { client.res.end(); } catch { /* ignore */ }
    }
    this.clients.clear();
  }

  add(res: ServerResponse): string {
    const id = `sse-${++this.clientCounter}`;
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    });
    res.write(":ok\n\n");
    this.clients.set(id, { id, res });
    res.on("close", () => this.clients.delete(id));
    return id;
  }

  emit(eventName: string, data: unknown): void {
    const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    this.broadcast(payload);
  }

  get size(): number { return this.clients.size; }

  private broadcast(payload: string): void {
    for (const [id, client] of [...this.clients]) {
      try {
        client.res.write(payload);
      } catch {
        this.clients.delete(id);
      }
    }
  }
}
