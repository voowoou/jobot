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

test("persists bot update cursor and dialog state", () => {
	const directory = mkdtempSync(join(tmpdir(), "jobot-db-"));
	const path = join(directory, "app.db");
	const storage = new DeduplicationStorage(path);

	try {
		assert.equal(storage.getNextBotUpdateId(), undefined);
		storage.setNextBotUpdateId(12);
		storage.saveBotDialog("-1007", "profiles", "title", { id: "frontend" });
		storage.close();

		const restarted = new DeduplicationStorage(path);
		assert.equal(restarted.getNextBotUpdateId(), 12);
		assert.deepEqual(restarted.getBotDialog("-1007"), {
			chatId: "-1007",
			command: "profiles",
			step: "title",
			draft: { id: "frontend" },
			updatedAt: restarted.getBotDialog("-1007")?.updatedAt,
		});
		assert.equal(restarted.clearBotDialog("-1007"), true);
		assert.equal(restarted.getBotDialog("-1007"), undefined);
		restarted.close();
	} finally {
		storage.close();
		rmSync(directory, { recursive: true, force: true });
	}
});

test("persists source settings and notification pause", () => {
	const directory = mkdtempSync(join(tmpdir(), "jobot-db-"));
	const storage = new DeduplicationStorage(join(directory, "app.db"));
	try {
		assert.deepEqual(storage.getSourceSettings(), {
			mode: "all",
			chatIds: [],
			paused: false,
		});
		storage.setSourceMode("allowlist");
		storage.addSourceChat("-10042", "Jobs");
		storage.setNotificationsPaused(true);
		assert.deepEqual(storage.getSourceSettings(), {
			mode: "allowlist",
			chatIds: ["-10042"],
			paused: true,
		});
		assert.equal(storage.removeSourceChat("-10042"), true);
	} finally {
		storage.close();
		rmSync(directory, { recursive: true, force: true });
	}
});

test("keeps recent group and channel sources with a bounded, expiring list", () => {
	const directory = mkdtempSync(join(tmpdir(), "jobot-db-"));
	const storage = new DeduplicationStorage(join(directory, "app.db"));
	try {
		const now = Date.now();
		storage.recordRecentSource({
			chatId: "-1001",
			title: "Jobs",
			type: "channel",
			lastSeenAt: now - 1,
		});
		storage.recordRecentSource({
			chatId: "-1002",
			title: "Developers",
			type: "supergroup",
			lastSeenAt: now,
		});
		assert.deepEqual(storage.listRecentSourceChats(1), [
			{
				chatId: "-1002",
				title: "Developers",
				type: "supergroup",
				lastSeenAt: now,
			},
		]);
		assert.equal(storage.getRecentSourceCount(), 2);
		storage.recordRecentSource({
			chatId: "-1001",
			title: "New Jobs",
			type: "channel",
			lastSeenAt: Date.now(),
		});
		assert.equal(storage.listRecentSourceChats(2)[0].title, "New Jobs");
	} finally {
		storage.close();
		rmSync(directory, { recursive: true, force: true });
	}
});

test("expires old fingerprints and preserves recent fingerprints across a checkpoint", () => {
	const directory = mkdtempSync(join(tmpdir(), "jobot-db-"));
	const path = join(directory, "app.db");
	const storage = new DeduplicationStorage(path);
	try {
		const now = Date.now();
		storage.saveFingerprint("old", now - 31 * 24 * 60 * 60 * 1_000);
		storage.saveFingerprint("fresh", now);
		assert.equal(storage.hasFingerprint("old"), false);
		assert.equal(storage.hasFingerprint("fresh"), true);
		storage.checkpointWal();
		storage.close();

		const restarted = new DeduplicationStorage(path);
		assert.equal(restarted.hasFingerprint("fresh"), true);
		restarted.close();
	} finally {
		storage.close();
		rmSync(directory, { recursive: true, force: true });
	}
});
