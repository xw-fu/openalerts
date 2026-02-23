#!/usr/bin/env node
// Pass --experimental-sqlite flag needed for node:sqlite
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.join(__dirname, "../dist/cli.js");

const result = spawnSync(
  process.execPath,
  ["--experimental-sqlite", entry, ...process.argv.slice(2)],
  { stdio: "inherit" }
);

process.exit(result.status ?? 1);
