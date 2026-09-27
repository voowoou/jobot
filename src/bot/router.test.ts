import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProfileStore } from "../config/profile-store.js";
import type { BotDialogState } from "../db/index.js";
import { BotCommandRouter, isOwner, parseCommand } from "./router.js";

const sourceControls = {
	getSourceSettings: () => ({ mode: "all" as const, chatIds: [], paused: false }),
	listSourceChats: () => [],
	setSourceMode: () => undefined,
	addSourceChat: () => undefined,
	removeSourceChat: () => false,
	setNotificationsPaused: () => undefined,
	getOutboxCount: () => 0,
	getCounters: () => ({}),
};

test("parses bot commands and compares owner IDs as strings", () => {
	assert.equal(parseCommand(" /START@jobot hello"), "start");
	assert.equal(parseCommand("plain text"), undefined);
	assert.equal(isOwner("-100123", "-100123"), true);
	assert.equal(isOwner("-100123", "100123"), false);
});

test("router denies non-owner and cancels only the owner's active dialog", async () => {
	const replies: Array<{ chatId: string; text: string }> = [];
	const cleared: string[] = [];
	const router = new BotCommandRouter(
		{
			...sourceControls,
			sendText: async (chatId, text) => {
				replies.push({ chatId, text });
			},
		},
		{
			...sourceControls,
			clearBotDialog: (chatId) => {
				cleared.push(chatId);
				return true;
			},
			getBotDialog: () => undefined,
			saveBotDialog: () => undefined,
		},
		"-1005",
	);

	await router.handle({ chatId: "42", text: "/cancel" });
	assert.match(replies[0].text, /нет доступа/i);
	assert.deepEqual(cleared, []);

	await router.handle({ chatId: "-1005", text: "/cancel" });
	assert.deepEqual(cleared, ["-1005"]);
	assert.match(replies[1].text, /отменена/i);
});

test("start gives setup guidance only while owner is unconfigured", async () => {
	const replies: string[] = [];
	const router = new BotCommandRouter(
		{
			...sourceControls,
			sendText: async (_chatId, text) => {
				replies.push(text);
			},
		},
		{
			...sourceControls,
			clearBotDialog: () => false,
			getBotDialog: () => undefined,
			saveBotDialog: () => undefined,
		},
	);
	await router.handle({ chatId: "55", text: "/start" });
	assert.match(replies[0], /TELEGRAM_BOT_CHAT_ID/);
});

test("onboarding and help expose the next actions and command arguments", async () => {
	const replies: string[] = [];
	const router = new BotCommandRouter(
		{ sendText: async (_chatId, text) => void replies.push(text) },
		{
			...sourceControls,
			clearBotDialog: () => false,
			getBotDialog: () => undefined,
			saveBotDialog: () => undefined,
		},
		"1",
	);
	await router.handle({ chatId: "1", text: "/start" });
	await router.handle({ chatId: "1", text: "/help" });
	assert.match(replies[0], /\/profiles add/);
	assert.match(replies[0], /\/profiles/);
	assert.match(replies[0], /\/test/);
	assert.match(replies[1], /\/profiles edit <id>/);
	assert.match(replies[1], /\/sources mode <all\|allowlist\|denylist>/);
	assert.match(replies[1], /режиме all список не нужен/i);
	assert.match(replies[1], /отправьте «-»/);
});

test("empty sources explains that all mode does not need a list", async () => {
	const replies: string[] = [];
	const router = new BotCommandRouter(
		{ sendText: async (_chatId, text) => void replies.push(text) },
		{
			...sourceControls,
			clearBotDialog: () => false,
			getBotDialog: () => undefined,
			saveBotDialog: () => undefined,
		},
		"1",
	);
	await router.handle({ chatId: "1", text: "/sources" });
	assert.match(replies[0], /режиме all список не требуется/i);
});

test("creates, cancels, rejects duplicate IDs, and deletes profiles through the wizard", async () => {
	const directory = mkdtempSync(join(tmpdir(), "jobot-router-"));
	let dialog: BotDialogState | undefined;
	const replies: string[] = [];
	const profiles = new ProfileStore(join(directory, "profiles.yaml"));
	const router = new BotCommandRouter(
		{
			sendText: async (_chatId, text) => {
				replies.push(text);
			},
		},
		{
			...sourceControls,
			getBotDialog: () => dialog,
			clearBotDialog: () => {
				const exists = dialog !== undefined;
				dialog = undefined;
				return exists;
			},
			saveBotDialog: (chatId, command, step, draft) => {
				dialog = { chatId, command, step, draft, updatedAt: "now" };
			},
		},
		"1",
		profiles,
	);
	const send = (text: string) => router.handle({ chatId: "1", text });

	try {
		await send("/profiles add");
		for (const value of [
			"backend",
			"Backend",
			"да",
			"node.js, typescript",
			"vacancy",
			"senior",
			"middle",
			"remote: remote",
			"да",
		])
			await send(value);
		assert.equal(profiles.getUserProfiles()?.[0].id, "backend");
		assert.equal(profiles.get()[0].id, "backend");

		await send("/profiles add");
		await send("discarded");
		await send("/cancel");
		assert.equal(dialog, undefined);

		await send("/profiles add");
		for (const value of [
			"backend",
			"Other",
			"да",
			"go",
			"-",
			"-",
			"-",
			"-",
			"да",
		])
			await send(value);
		assert.equal(profiles.getUserProfiles()?.length, 1);
		assert.match(replies.at(-1) ?? "", /уже существует/);

		await send("/profiles remove backend");
		await send("да");
		assert.equal(profiles.getUserProfiles()?.length, 0);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
