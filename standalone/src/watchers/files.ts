/**
 * File-system watcher for the OpenClaw data directory.
 * Uses node:fs watch (built-in). Debounces noisy filesystem events.
 * Calls reload callbacks when relevant files change.
 */
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { WatchConfig } from "../config.js";
import {
  loadAll,
  readCronJobs, readCronRuns, readSessions, readActions,
  readDeliveryQueue, readWorkspaceDocs, readOcConfig,
} from "../readers/openclaw.js";

type ChangeCallback = (changed: string) => void;

// Files/dirs that trigger a specific partial reload
const RELOAD_MAP: Array<[pattern: RegExp, reloader: (db: DatabaseSync, ocDir: string, wsNames: string[]) => void]> = [
  [/cron[/\\]jobs\.json$/, (db, d) => readCronJobs(db, d)],
  [/cron[/\\]runs[/\\]/, (db, d) => readCronRuns(db, d)],
  [/collections[/\\]sessions\.json$/, (db, d) => readSessions(db, d)],
  [/collections[/\\]actions\.jsonl$/, (db, d) => readActions(db, d)],
  [/delivery-queue[/\\]/, (db, d) => readDeliveryQueue(db, d)],
  [/openclaw\.json$/, (db, d) => readOcConfig(db, d)],
  [/(SOUL|HEARTBEAT|MEMORY|IDENTITY|USER|AGENTS|TOOLS)\.md$/i, (db, d, ws) => readWorkspaceDocs(db, d, ws)],
];

export class FileWatcher {
  private watchers: fs.FSWatcher[] = [];
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private db: DatabaseSync;
  private config: WatchConfig;
  private onChange: ChangeCallback;

  constructor(db: DatabaseSync, config: WatchConfig, onChange: ChangeCallback) {
    this.db = db;
    this.config = config;
    this.onChange = onChange;
  }

  start(): void {
    const { openclawDir } = this.config;
    if (!fs.existsSync(openclawDir)) {
      console.warn(`[watcher] OpenClaw dir not found: ${openclawDir}`);
      return;
    }

    // Watch top-level openclaw dir recursively
    this.watchDir(openclawDir, true);

    // Also watch each workspace dir directly (for MD files)
    for (const ws of this.config.workspaces) {
      const wsPath = path.isAbsolute(ws) ? ws : path.join(openclawDir, ws);
      if (fs.existsSync(wsPath)) {
        this.watchDir(wsPath, false);
      }
    }

    console.log(`[watcher] Watching ${openclawDir}`);
  }

  stop(): void {
    for (const w of this.watchers) { try { w.close(); } catch { /* ignore */ } }
    this.watchers = [];
    for (const t of this.debounceTimers.values()) clearTimeout(t);
    this.debounceTimers.clear();
  }

  private watchDir(dirPath: string, recursive: boolean): void {
    try {
      const w = fs.watch(dirPath, { recursive }, (event, filename) => {
        if (!filename) return;
        const fullPath = path.join(dirPath, filename);
        this.debounce(fullPath);
      });
      w.on("error", err => console.warn(`[watcher] Watch error: ${err.message}`));
      this.watchers.push(w);
    } catch (err) {
      console.warn(`[watcher] Cannot watch ${dirPath}: ${err}`);
    }
  }

  private debounce(filePath: string): void {
    const existing = this.debounceTimers.get(filePath);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(filePath, setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.handleChange(filePath);
    }, 200));
  }

  private handleChange(filePath: string): void {
    const normalized = filePath.replace(/\\/g, "/");

    // Find matching reloader
    for (const [pattern, reloader] of RELOAD_MAP) {
      if (pattern.test(normalized)) {
        try {
          reloader(this.db, this.config.openclawDir, this.config.workspaces);
        } catch (err) {
          console.warn(`[watcher] Reload failed for ${filePath}: ${err}`);
        }
        this.onChange(filePath);
        return;
      }
    }

    // For unmatched changes, just notify
    this.onChange(filePath);
  }
}

export function doFullLoad(db: DatabaseSync, config: WatchConfig): void {
  loadAll(db, config);
}
