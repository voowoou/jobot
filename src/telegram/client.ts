import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";

import { loadEnvironment } from "../config/env.js";
import type { AppEnvironment } from "../types/index.js";

export function createTelegramClient(
	environment: AppEnvironment = loadEnvironment(),
): TelegramClient {
	return new TelegramClient(
		new StringSession(environment.telegramStringSession),
		environment.telegramApiId,
		environment.telegramApiHash,
		{
			autoReconnect: true,
			connectionRetries: Infinity,
			reconnectRetries: Infinity,
			retryDelay: 1_000,
			useWSS: true,
		},
	);
}
