import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DeduplicationStorage } from "./index.js";

test("deduplicates messages in a temporary SQLite database", () => {
  const directory = mkdtempSync(join(tmpdir(), "jobot-db-"));
  const storage = new DeduplicationStorage(join(directory, "app.db"));

  try {
    assert.equal(storage.isProcessed("-1001", 42), false);
    storage.markProcessed("-1001", 42);
    assert.equal(storage.isProcessed("-1001", 42), true);
  } finally {
    storage.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
