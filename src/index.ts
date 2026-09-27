import { FloodWaitError } from "telegram/errors/index.js";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import { getDisplayName } from "telegram/Utils.js";
import { BotApiError, TelegramBotClient } from "./bot/client.js";
import { loadEnvironment } from "./config/env.js";
import { loadSearchProfiles } from "./config/profile-config.js";
import { db } from "./db/index.js";
import { formatNotification } from "./services/formatter.js";
import { configureLogger, logEvent } from "./services/logger.js";
import { matchVacancy } from "./services/matcher.js";
import { createTelegramClient } from "./telegram/client.js";
import type { SearchProfile } from "./types/index.js";

let floodWaitUntil = 0;
let shuttingDown = false;

function sleep(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForFloodPause(): Promise<void> {
	const remainingMilliseconds = floodWaitUntil - Date.now();

	if (remainingMilliseconds > 0) {
		await sleep(remainingMilliseconds);
	}
}

function isFloodWaitError(error: unknown): error is FloodWaitError {
	return error instanceof FloodWaitError;
}

function getInternalPostLink(chatId: string, messageId: number): string {
	const internalChatId = chatId.replace(/^-100/, "");
	return `https://t.me/c/${internalChatId}/${messageId}`;
}

async function getMessageContext(event: NewMessageEvent): Promise<{
	chatId: string;
	directLink: string;
	sourceTitle: string;
}> {
	const chatId = event.chatId?.toString();

	if (!chatId) {
		throw new Error("Unable to determine the source chat ID");
	}

	const chat = await event.getChat();
	const username =
		chat && "username" in chat && typeof chat.username === "string"
			? chat.username
			: undefined;

	return {
		chatId,
		directLink: username
			? `https://t.me/${username}/${event.message.id}`
			: getInternalPostLink(chatId, event.message.id),
		sourceTitle: chat ? getDisplayName(chat) : "Неизвестный чат",
	};
}

async function processMessage(
	event: NewMessageEvent,
	bot: TelegramBotClient,
	profiles: readonly SearchProfile[],
): Promise<void> {
	const text = event.message.text?.trim();

	if (!text) {
		return;
	}

	const context = await getMessageContext(event);

	if (db.isProcessed(context.chatId, event.message.id)) {
		logEvent("debug", "message.skipped", {
			reason: "already_processed",
			source: context.sourceTitle,
			chatId: context.chatId,
			messageId: event.message.id,
		});
		return;
	}

	const vacancy = matchVacancy(text, profiles, context);

	if (!vacancy) {
		logEvent("debug", "message.skipped", {
			reason: "no_profile_match",
			source: context.sourceTitle,
			chatId: context.chatId,
			messageId: event.message.id,
		});
		return;
	}

	const notification = formatNotification(vacancy);

	try {
		await bot.sendNotification(notification);
	} catch (error) {
		logEvent("warn", "vacancy.delivery_failed", {
			source: context.sourceTitle,
			chatId: context.chatId,
			messageId: event.message.id,
			profileId: vacancy.profileId,
			delivery: "not_sent",
			errorKind: error instanceof BotApiError ? "bot_api" : "unknown",
			statusCode: error instanceof BotApiError ? error.statusCode : undefined,
			errorMessage: error instanceof BotApiError ? error.message : undefined,
		});
		throw error;
	}

	db.markProcessed(context.chatId, event.message.id);
	logEvent("info", "vacancy.delivered", {
		source: context.sourceTitle,
		chatId: context.chatId,
		messageId: event.message.id,
		profileId: vacancy.profileId,
		delivery: "sent",
	});
}

async function handleNewMessage(
	event: NewMessageEvent,
	bot: TelegramBotClient,
	profiles: readonly SearchProfile[],
): Promise<void> {
	while (!shuttingDown) {
		try {
			await waitForFloodPause();
			await processMessage(event, bot, profiles);
			return;
		} catch (error) {
			const retryAfterSeconds = isFloodWaitError(error)
				? error.seconds
				: error instanceof BotApiError
					? error.retryAfterSeconds
					: undefined;

			if (!retryAfterSeconds) {
				logEvent("error", "message.processing_failed", {
					chatId: event.chatId?.toString(),
					messageId: event.message.id,
					errorKind: isFloodWaitError(error)
						? "flood_wait"
						: error instanceof BotApiError
							? "bot_api"
							: "unknown",
					statusCode:
						error instanceof BotApiError ? error.statusCode : undefined,
					errorMessage:
						error instanceof BotApiError ? error.message : undefined,
				});
				return;
			}

			const delayMilliseconds = Math.max(1, retryAfterSeconds) * 1_000;
			floodWaitUntil = Math.max(floodWaitUntil, Date.now() + delayMilliseconds);
			logEvent("warn", "telegram.retry_scheduled", {
				chatId: event.chatId?.toString(),
				messageId: event.message.id,
				retryAfterSeconds,
				errorKind: isFloodWaitError(error) ? "flood_wait" : "bot_api",
			});
			await waitForFloodPause();
		}
	}
}

export async function startApplication(): Promise<void> {
	const environment = loadEnvironment();
	configureLogger(environment.logLevel);
	const profiles = loadSearchProfiles();
	const client = createTelegramClient(environment);
	const bot = new TelegramBotClient(
		environment.telegramBotToken,
		environment.telegramBotChatId,
	);
	const botIdentity = await bot.getMe();

	const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
		if (shuttingDown) {
			return;
		}

		shuttingDown = true;
		logEvent("info", "application.shutting_down", { signal });
		await client.disconnect();
		db.close();
	};

	process.once("SIGINT", () => void shutdown("SIGINT"));
	process.once("SIGTERM", () => void shutdown("SIGTERM"));

	client.addEventHandler(
		(event) => void handleNewMessage(event, bot, profiles),
		new NewMessage({ incoming: true }),
	);
	await client.connect();

	if (!(await client.isUserAuthorized())) {
		await client.disconnect();
		db.close();
		throw new Error(
			"Telegram session is not authorized. Run `pnpm auth` and set TELEGRAM_STRING_SESSION.",
		);
	}

	logEvent("info", "application.started", {
		bot: botIdentity.username || String(botIdentity.id),
		profileCount: profiles.length,
		enabledProfileCount: profiles.filter((profile) => profile.enabled).length,
	});
}

startApplication().catch((error: unknown) => {
	logEvent("error", "application.start_failed", {
		errorKind: error instanceof Error ? error.name : "unknown",
		errorMessage:
			error instanceof Error ? error.message : "Unknown startup error",
	});
	db.close();
	process.exitCode = 1;
});
