import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { SCHEMA_SQL } from "../schema.js";
import { getActivityLog, upsertAction, insertDiagnostic } from "../queries.js";

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA_SQL);
  return db;
}

function seedData(db: DatabaseSync): void {
  // Insert actions for two different sessions
  upsertAction(db, {
    id: "act-1", session_key: "session-alpha", type: "start",
    event_type: "agent.start", ts: 1000,
  });
  upsertAction(db, {
    id: "act-2", session_key: "session-alpha", type: "complete",
    event_type: "agent.end", ts: 2000,
  });
  upsertAction(db, {
    id: "act-3", session_key: "session-beta", type: "tool_call",
    event_type: "tool.call", ts: 3000, tool_name: "web_search",
  });

  // Insert diagnostics for both sessions
  insertDiagnostic(db, {
    event_type: "llm.call", ts: 1500, summary: "llm ok",
    session_key: "session-alpha",
  });
  insertDiagnostic(db, {
    event_type: "tool.error", ts: 3500, summary: "tool failed",
    session_key: "session-beta",
  });
}

describe("getActivityLog", () => {
  let db: DatabaseSync;

  before(() => {
    db = createTestDb();
    seedData(db);
  });

  after(() => {
    db.close();
  });

  it("should return all entries when no sessionKey is provided", () => {
    const entries = getActivityLog(db, 100);
    // 3 actions + 2 diagnostics = 5 total
    assert.equal(entries.length, 5);
  });

  it("should filter by sessionKey when provided", () => {
    const entries = getActivityLog(db, 100, "session-alpha");
    // 2 actions + 1 diagnostic for session-alpha
    assert.equal(entries.length, 3);
    for (const e of entries) {
      assert.equal(e.session_key, "session-alpha");
    }
  });

  it("should return empty array for non-existent sessionKey", () => {
    const entries = getActivityLog(db, 100, "does-not-exist");
    assert.equal(entries.length, 0);
  });

  it("should respect the limit parameter", () => {
    const entries = getActivityLog(db, 2);
    assert.equal(entries.length, 2);
  });

  it("should return entries ordered by ts descending", () => {
    const entries = getActivityLog(db, 100);
    for (let i = 1; i < entries.length; i++) {
      assert.ok(entries[i - 1].ts >= entries[i].ts,
        `Expected entries[${i-1}].ts (${entries[i-1].ts}) >= entries[${i}].ts (${entries[i].ts})`);
    }
  });

  it("should not be vulnerable to SQL injection via sessionKey", () => {
    // Classic SQL injection payloads — should return 0 results, not crash or leak data
    const payloads = [
      "' OR '1'='1",
      "'; DROP TABLE actions; --",
      "' UNION SELECT 1,2,3,4,5,6,7,8,9,10,11 --",
      "session-alpha' OR session_key='session-beta",
    ];

    for (const payload of payloads) {
      const entries = getActivityLog(db, 100, payload);
      assert.equal(entries.length, 0,
        `SQL injection payload should return 0 results: ${payload}`);
    }

    // Verify the database is still intact after injection attempts
    const all = getActivityLog(db, 100);
    assert.equal(all.length, 5, "Database should still have all 5 entries after injection attempts");
  });
});
