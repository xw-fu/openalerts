import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_SQL, PRUNE_DIAGNOSTICS_SQL, PRUNE_HEARTBEATS_SQL } from "./schema.js";

export type DB = DatabaseSync;

let _db: DatabaseSync | null = null;

export function openDb(stateDir: string): DatabaseSync {
  fs.mkdirSync(stateDir, { recursive: true });
  const dbPath = path.join(stateDir, "openalerts.db");
  const db = new DatabaseSync(dbPath);
  db.exec(SCHEMA_SQL);
  _db = db;
  return db;
}

export function getDb(): DatabaseSync {
  if (!_db) throw new Error("DB not initialized — call openDb() first");
  return _db;
}

export function pruneDb(db: DatabaseSync): void {
  db.exec(PRUNE_DIAGNOSTICS_SQL);
  db.exec(PRUNE_HEARTBEATS_SQL);
  // Prune cron runs older than 30 days
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  db.prepare("DELETE FROM cron_runs WHERE ts < ?").run(cutoff);
  // Prune actions older than 7 days
  const actionCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  db.prepare("DELETE FROM actions WHERE ts < ?").run(actionCutoff);
  // Prune daily_metrics older than 90 days
  db.prepare("DELETE FROM daily_metrics WHERE hour_ts < ?").run(cutoff);
}
