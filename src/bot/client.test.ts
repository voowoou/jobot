import assert from "node:assert/strict";
import test from "node:test";

import { BotApiError, TelegramBotClient } from "./client.js";

test("calls getMe and sendMessage through the Bot API", async () => {
	const originalFetch = globalThis.fetch;
	const calls: Array<{ url: string; body: URLSearchParams }> = [];
	globalThis.fetch = async (input, init) => {
		calls.push({
			url: String(input),
			body: new URLSearchParams(String(init?.body)),
		});
		const isGetMe = String(input).endsWith("/getMe");
		return new Response(
			JSON.stringify({
				ok: true,
				result: isGetMe ? { id: 1, username: "jobot" } : {},
			}),
			{
				headers: { "content-type": "application/json" },
			},
		);
	};

	try {
		const client = new TelegramBotClient("test-token", "123");
		assert.deepEqual(await client.getMe(), { id: 1, username: "jobot" });
		await client.sendNotification("Hello");
		await client.sendText("123", "Controls", {
			inline_keyboard: [[{ text: "Status", callback_data: "v1:status" }]],
		});
		await client.answerCallbackQuery("callback-id");

		assert.equal(calls.length, 4);
		assert.equal(calls[1].url.endsWith("/sendMessage"), true);
		assert.equal(calls[1].body.get("chat_id"), "123");
		assert.equal(calls[1].body.get("parse_mode"), "MarkdownV2");
		assert.match(calls[2].body.get("reply_markup") ?? "", /inline_keyboard/);
		assert.equal(calls[3].url.endsWith("/answerCallbackQuery"), true);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("exposes Bot API retry_after without sending a real request", async () => {
	const originalFetch = globalThis.fetch;
	globalThis.fetch = async () =>
		new Response(
			JSON.stringify({
				ok: false,
				error_code: 429,
				description: "Too Many Requests",
				parameters: { retry_after: 3 },
			}),
			{ status: 429, headers: { "content-type": "application/json" } },
		);

	try {
		const client = new TelegramBotClient("test-token", "123");
		await assert.rejects(
			() => client.sendNotification("Hello"),
			(error: unknown) =>
				error instanceof BotApiError &&
				error.statusCode === 429 &&
				error.retryAfterSeconds === 3,
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
