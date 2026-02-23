/**
 * JSONL persistence for openalerts.
 * Keeps a flat events.jsonl alongside SQLite as a backup/audit log.
 */
import fs from "node:fs";
import path from "node:path";
import type { StoredEvent } from "./types.js";
import { LOG_FILENAME } from "./types.js";

export function appendEvent(stateDir: string, event: StoredEvent): void {
  const logPath = path.join(stateDir, LOG_FILENAME);
  fs.mkdirSync(stateDir, { recursive: true });
  fs.appendFileSync(logPath, JSON.stringify(event) + "\n");
}

export function readAllEvents(stateDir: string): StoredEvent[] {
  const logPath = path.join(stateDir, LOG_FILENAME);
  if (!fs.existsSync(logPath)) return [];
  const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
  return lines.slice(-1000).map(l => {
    try { return JSON.parse(l) as StoredEvent; } catch { return null; }
  }).filter(Boolean) as StoredEvent[];
}

export function readRecentEvents(stateDir: string, limit = 50): StoredEvent[] {
  const all = readAllEvents(stateDir);
  return all.slice(-limit);
}

export function pruneLog(stateDir: string, opts: { maxAgeMs: number; maxSizeKb: number }): void {
  const logPath = path.join(stateDir, LOG_FILENAME);
  if (!fs.existsSync(logPath)) return;
  const stat = fs.statSync(logPath);
  const cutoff = Date.now() - opts.maxAgeMs;
  const oversized = stat.size > opts.maxSizeKb * 1024;

  if (!oversized) {
    const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    const fresh = lines.filter(l => {
      try { return (JSON.parse(l) as StoredEvent).ts >= cutoff; } catch { return false; }
    });
    if (fresh.length === lines.length) return;
    const tmp = logPath + ".tmp";
    fs.writeFileSync(tmp, fresh.join("\n") + "\n");
    fs.renameSync(tmp, logPath);
    return;
  }

  // Oversized: keep last 500 lines
  const lines = fs.readFileSync(logPath, "utf8").split("\n").filter(Boolean);
  const keep = lines.slice(-500);
  const tmp = logPath + ".tmp";
  fs.writeFileSync(tmp, keep.join("\n") + "\n");
  try { fs.renameSync(tmp, logPath); } catch {
    // Windows rename fallback
    fs.writeFileSync(logPath, keep.join("\n") + "\n");
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
  }
}
