import { createServer } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { OpenAlertsEngine } from "../core/engine.js";
import type { ServerConfig } from "../config.js";
import { SseManager } from "./sse.js";
import { createRouter } from "./routes.js";

export interface HttpServer {
  sse: SseManager;
  close(): void;
}

export function startHttpServer(
  config: ServerConfig,
  db: DatabaseSync,
  engine: OpenAlertsEngine,
  getGatewayStatus?: () => boolean,
): HttpServer {
  const sse = new SseManager();
  sse.start();

  const router = createRouter(db, engine, sse, getGatewayStatus);
  const server = createServer(router);

  server.listen(config.port, config.host, () => {
    console.log(`[server] Dashboard: http://${config.host}:${config.port}`);
    console.log(`[server] API:       http://${config.host}:${config.port}/api/state`);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`[server] Port ${config.port} already in use. Use --port to change.`);
      process.exit(1);
    }
    console.error(`[server] Error: ${err.message}`);
  });

  return {
    sse,
    close() {
      sse.stop();
      server.close();
    },
  };
}
