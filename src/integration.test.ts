import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { TelegramBotClient } from "./bot/client.js";
import { loadSearchProfiles } from "./config/profile-config.js";
import { DeduplicationStorage } from "./db/index.js";
import { formatNotification } from "./services/formatter.js";
import { matchVacancy } from "./services/matcher.js";

test("processes a matching vacancy with mocked Bot API and temporary SQLite", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jobot-smoke-"));
  const storage = new DeduplicationStorage(join(directory, "app.db"));
  const originalFetch = globalThis.fetch;
  let sentMessage = "";
  globalThis.fetch = async (_input, init) => {
    sentMessage = new URLSearchParams(String(init?.body)).get("text") ?? "";
    return new Response(JSON.stringify({ ok: true, result: {} }), {
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const profiles = loadSearchProfiles(join(process.cwd(), "data", "profiles.example.yaml"));
    const vacancy = matchVacancy("Ищем Java middle разработчика, remote, Spring Boot", profiles, {
      sourceTitle: "Test channel",
      directLink: "https://t.me/test/1",
    });

    assert.ok(vacancy);
    assert.equal(storage.isProcessed("-1001", 1), false);

    await new TelegramBotClient("test-token", "123").sendNotification(formatNotification(vacancy));
    storage.markProcessed("-1001", 1);

    assert.match(sentMessage, /Java Backend/);
    assert.equal(storage.isProcessed("-1001", 1), true);
  } finally {
    globalThis.fetch = originalFetch;
    storage.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
