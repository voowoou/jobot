import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ProfileStore } from "../config/profile-store.js";
import type { BotDialogState } from "../db/index.js";
import { BotCommandRouter, isOwner, parseCallback, parseCommand } from "./router.js";

const sourceControls = {
	getSourceSettings: () => ({ mode: "all" as const, chatIds: [], paused: false }),
	listSourceChats: () => [],
	setSourceMode: () => undefined,
	addSourceChat: () => undefined,
	removeSourceChat: () => false,
	listRecentSourceChats: () => [],
	getRecentSourceCount: () => 0,
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

test("parses only versioned callback data with valid profile IDs", () => {
	assert.deepEqual(parseCallback("v1:profiles"), { action: "profiles", profileId: undefined });
	assert.deepEqual(parseCallback("v1:profile-edit:frontend_2"), { action: "profile-edit", profileId: "frontend_2" });
	assert.equal(parseCallback("v1:profile-edit"), undefined);
	assert.equal(parseCallback("v0:profiles"), undefined);
	assert.equal(parseCallback("v1:profile-edit:../../secret"), undefined);
	assert.deepEqual(parseCallback("v1:source-add:-100123"), { action: "source-add", chatId: "-100123" });
	assert.deepEqual(parseCallback("v1:sources-recent:2"), { action: "sources-recent", page: 2 });
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

test("callback controls enforce ownership and require deletion confirmation", async () => {
	const directory = mkdtempSync(join(tmpdir(), "jobot-callback-"));
	const replies: Array<{ text: string; markup?: unknown }> = [];
	const answers: string[] = [];
	const profiles = new ProfileStore(join(directory, "profiles.yaml"));
	profiles.saveUserProfiles([{ id: "frontend", title: "Frontend", enabled: true, primary: ["react"] }]);
	const router = new BotCommandRouter(
		{
			sendText: async (_chatId, text, markup) => void replies.push({ text, markup }),
			answerCallbackQuery: async (_id, text) => void answers.push(text ?? ""),
		},
		{
			...sourceControls,
			clearBotDialog: () => false,
			getBotDialog: () => undefined,
			saveBotDialog: () => undefined,
		},
		"1",
		profiles,
	);
	try {
		await router.handleCallback({ chatId: "2", callbackId: "other", data: "v1:profile-delete:frontend" });
		assert.equal(profiles.getUserProfiles()?.length, 1);
		assert.equal(answers[0], "Нет доступа.");

		await router.handleCallback({ chatId: "1", callbackId: "delete", data: "v1:profile-delete:frontend" });
		assert.match(replies.at(-1)?.text ?? "", /Удалить профиль/);
		assert.equal(profiles.getUserProfiles()?.length, 1);

		await router.handleCallback({ chatId: "1", callbackId: "confirm", data: "v1:profile-delete-confirm:frontend" });
		assert.equal(profiles.getUserProfiles()?.length, 0);

		await router.handleCallback({ chatId: "1", callbackId: "stale", data: "v1:profile-edit:frontend" });
		assert.match(replies.at(-1)?.text ?? "", /устарела/i);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("recent sources paginate and can be selected through callbacks", async () => {
	const replies: Array<{ text: string; markup?: { inline_keyboard: Array<Array<{ callback_data: string }>> } }> = [];
	const selected = new Set<string>();
	const recent = Array.from({ length: 7 }, (_, index) => ({
		chatId: `-100${index + 1}`,
		title: `Source ${index + 1}`,
		type: "channel" as const,
		lastSeenAt: index,
	}));
	const router = new BotCommandRouter(
		{
			sendText: async (_chatId, text, markup) => void replies.push({ text, markup }),
			answerCallbackQuery: async () => undefined,
		},
		{
			...sourceControls,
			getSourceSettings: () => ({ mode: "all" as const, chatIds: [...selected], paused: false }),
			listRecentSourceChats: (limit, offset = 0) => recent.slice(offset, offset + limit),
			getRecentSourceCount: () => recent.length,
			addSourceChat: (chatId) => void selected.add(chatId),
			removeSourceChat: (chatId) => selected.delete(chatId),
			clearBotDialog: () => false,
			getBotDialog: () => undefined,
			saveBotDialog: () => undefined,
		},
		"1",
	);
	await router.handle({ chatId: "1", text: "/sources recent" });
	assert.match(replies[0].text, /1\/2/);
	assert.match(JSON.stringify(replies[0].markup), /sources-recent:1/);
	await router.handleCallback({ chatId: "1", callbackId: "add", data: "v1:source-add:-1001" });
	assert.equal(selected.has("-1001"), true);
	assert.match(JSON.stringify(replies.at(-1)?.markup), /source-remove:-1001/);
});

test("switching to allowlist explains the effect before changing the mode", async () => {
	const replies: string[] = [];
	let mode: "all" | "allowlist" | "denylist" = "all";
	let dialog: BotDialogState | undefined;
	const router = new BotCommandRouter(
		{ sendText: async (_chatId, text) => void replies.push(text) },
		{
			...sourceControls,
			getSourceSettings: () => ({ mode, chatIds: [], paused: false }),
			setSourceMode: (next) => { mode = next; },
			clearBotDialog: () => { const exists = dialog !== undefined; dialog = undefined; return exists; },
			getBotDialog: () => dialog,
			saveBotDialog: (chatId, command, step, draft) => { dialog = { chatId, command, step, draft, updatedAt: "now" }; },
		},
		"1",
	);
	await router.handle({ chatId: "1", text: "/sources mode allowlist" });
	assert.equal(mode, "all");
	assert.match(replies[0], /остальные перестанут/i);
	await router.handle({ chatId: "1", text: "да" });
	assert.equal(mode, "allowlist");
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
