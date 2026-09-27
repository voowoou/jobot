import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DeduplicationStorage } from "../db/index.js";
import { DeliveryOutboxProcessor } from "./delivery-outbox.js";

test("retries an outbox delivery after restart and marks it processed only on success", async () => {
	const directory = mkdtempSync(join(tmpdir(), "jobot-outbox-"));
	const path = join(directory, "app.db");
	const first = new DeduplicationStorage(path);
	try {
		first.enqueueDelivery("-1001", 9, "frontend", "message");
		const failing = new DeliveryOutboxProcessor(
			{
				sendNotification: async () => {
					throw new Error("temporary");
				},
			},
			first,
		);
		await failing.processDue();
		assert.equal(first.isProcessed("-1001", 9), false);
		assert.equal(first.getOutboxCount(), 1);
		first.close();
		const restarted = new DeduplicationStorage(path);
		const success = new DeliveryOutboxProcessor(
			{ sendNotification: async () => undefined },
			restarted,
		);
		await new Promise((resolve) => setTimeout(resolve, 1_050));
		await success.processDue();
		assert.equal(restarted.isProcessed("-1001", 9), true);
		assert.equal(restarted.getOutboxCount(), 0);
		restarted.close();
	} finally {
		first.close();
		try {
			rmSync(directory, {
				recursive: true,
				force: true,
				maxRetries: 3,
				retryDelay: 100,
			});
		} catch {
			/* Windows can retain a closed SQLite WAL handle briefly. */
		}
	}
});

test("discards a final delivery failure without marking the message processed", async () => {
	const directory = mkdtempSync(join(tmpdir(), "jobot-outbox-"));
	const storage = new DeduplicationStorage(join(directory, "app.db"));
	try {
		storage.enqueueDelivery("-1001", 10, "frontend", "message");
		const task = storage.getDueDeliveries()[0];
		for (let attempt = 0; attempt < 4; attempt += 1)
			storage.rescheduleDelivery(task, Date.now());

		const failing = new DeliveryOutboxProcessor(
			{
				sendNotification: async () => {
					throw new Error("permanent");
				},
			},
			storage,
		);
		await failing.processDue();

		assert.equal(storage.getOutboxCount(), 0);
		assert.equal(storage.isProcessed("-1001", 10), false);
		assert.equal(storage.getCounters().delivery_failed, 1);
	} finally {
		storage.close();
		rmSync(directory, {
			recursive: true,
			force: true,
			maxRetries: 3,
			retryDelay: 100,
		});
	}
});
