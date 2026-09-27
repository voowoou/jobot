import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import { getDisplayName } from "telegram/Utils.js";
import { TelegramBotClient } from "./bot/client.js";
import { BotCommandRouter } from "./bot/router.js";
import { BotUpdateProcessor } from "./bot/updates.js";
import { loadEnvironment } from "./config/env.js";
import { ProfileStore } from "./config/profile-store.js";
import { db } from "./db/index.js";
import { DeliveryOutboxProcessor } from "./services/delivery-outbox.js";
import { vacancyFingerprint } from "./services/fingerprint.js";
import { formatNotification } from "./services/formatter.js";
import { configureLogger, logEvent } from "./services/logger.js";
import { matchVacancy } from "./services/matcher.js";
import { createTelegramClient } from "./telegram/client.js";
import { isAllowedSource, isVacancySource } from "./telegram/source-filter.js";
import type { SearchProfile } from "./types/index.js";

let shuttingDown = false;

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

	let chat = await event.getChat();
	if (!chat && event.client && event.chatId) {
		try {
			chat = await event.client.getEntity(event.chatId);
		} catch {
			// A missing title must not prevent delivery of an otherwise valid vacancy.
		}
	}
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
	profiles: readonly SearchProfile[],
): Promise<void> {
	db.incrementCounter("received");
	const text = event.message.text?.trim();

	if (!text) {
		return;
	}

	const chatId = event.chatId?.toString();
	if (!chatId) {
		throw new Error("Unable to determine the source chat ID");
	}
	const sourceSettings = db.getSourceSettings();
	if (!isAllowedSource(chatId, sourceSettings)) {
		db.incrementCounter("filtered");
		logEvent("debug", "message.skipped", {
			reason: "source_filter",
			chatId,
			messageId: event.message.id,
		});
		return;
	}
	if (sourceSettings.paused) {
		db.incrementCounter("filtered");
		logEvent("debug", "message.skipped", {
			reason: "notifications_paused",
			chatId,
			messageId: event.message.id,
		});
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
		db.incrementCounter("unmatched");
		logEvent("debug", "message.skipped", {
			reason: "no_profile_match",
			source: context.sourceTitle,
			chatId: context.chatId,
			messageId: event.message.id,
		});
		return;
	}
	db.incrementCounter("matched");
	const fingerprint = vacancyFingerprint(text);
	if (db.isCrossChannelDedupEnabled() && db.hasFingerprint(fingerprint)) {
		db.incrementCounter("cross_channel_deduplicated");
		return;
	}
	if (db.isCrossChannelDedupEnabled()) db.saveFingerprint(fingerprint);

	db.enqueueDelivery(
		context.chatId,
		event.message.id,
		vacancy.profileId,
		formatNotification(vacancy),
	);
	logEvent("info", "vacancy.queued", {
		source: context.sourceTitle,
		chatId: context.chatId,
		messageId: event.message.id,
		profileId: vacancy.profileId,
	});
}

async function handleNewMessage(
	event: NewMessageEvent,
	profiles: readonly SearchProfile[],
): Promise<void> {
	try {
		await processMessage(event, profiles);
	} catch (error) {
		logEvent("error", "message.processing_failed", {
			chatId: event.chatId?.toString(),
			messageId: event.message.id,
			errorKind: error instanceof Error ? error.name : "unknown",
		});
	}
}

export async function startApplication(): Promise<void> {
	const environment = loadEnvironment();
	configureLogger(environment.logLevel);
	if (process.env.CROSS_CHANNEL_DEDUP_ENABLED !== undefined) {
		db.setCrossChannelDedupEnabled(process.env.CROSS_CHANNEL_DEDUP_ENABLED === "true");
	}
	const profileStore = new ProfileStore();
	const client = createTelegramClient(environment);
	const bot = new TelegramBotClient(
		environment.telegramBotToken,
		environment.telegramBotChatId,
	);
	const botIdentity = await bot.getMe();
	const commandRouter = new BotCommandRouter(
		bot,
		db,
		environment.telegramBotChatId,
		profileStore,
	);
	const updateProcessor = new BotUpdateProcessor(bot, commandRouter, db);
	const deliveryProcessor = new DeliveryOutboxProcessor(bot, db);

	const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
		if (shuttingDown) {
			return;
		}

		shuttingDown = true;
		logEvent("info", "application.shutting_down", { signal });
		await updateProcessor.stop();
		deliveryProcessor.stop();
		await client.disconnect();
		db.close();
	};

	process.once("SIGINT", () => void shutdown("SIGINT"));
	process.once("SIGTERM", () => void shutdown("SIGTERM"));

	client.addEventHandler(
		(event) => void handleNewMessage(event, profileStore.get()),
		new NewMessage({ incoming: true, func: isVacancySource }),
	);
	await client.connect();

	if (!(await client.isUserAuthorized())) {
		await client.disconnect();
		db.close();
		throw new Error(
			"Telegram session is not authorized. Run `pnpm auth` and set TELEGRAM_STRING_SESSION.",
		);
	}
	updateProcessor.start();
	deliveryProcessor.start();

	logEvent("info", "application.started", {
		bot: botIdentity.username || String(botIdentity.id),
		profileCount: profileStore.get().length,
		enabledProfileCount: profileStore.get().filter((profile) => profile.enabled)
			.length,
		sourceScope: "groups_and_channels",
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
