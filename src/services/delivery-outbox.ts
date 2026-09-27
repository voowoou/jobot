import { BotApiError, type TelegramBotClient } from "../bot/client.js";
import type { DeduplicationStorage, DeliveryTask } from "../db/index.js";
import { logEvent } from "./logger.js";

const MAX_ATTEMPTS = 5;
const MAX_BACKOFF_MS = 15 * 60_000;

export function retryDelay(task: DeliveryTask, error: unknown): number {
	if (error instanceof BotApiError && error.retryAfterSeconds)
		return error.retryAfterSeconds * 1_000;
	return Math.min(1_000 * 2 ** task.attempts, MAX_BACKOFF_MS);
}

export class DeliveryOutboxProcessor {
	private timer: NodeJS.Timeout | undefined;
	private running = false;
	public constructor(
		private readonly bot: Pick<TelegramBotClient, "sendNotification">,
		private readonly storage: Pick<
			DeduplicationStorage,
			| "getDueDeliveries"
			| "markDeliverySucceeded"
			| "rescheduleDelivery"
			| "discardDelivery"
			| "getOutboxCount"
			| "incrementCounter"
		>,
	) {}
	public start(): void {
		if (!this.timer) {
			void this.processDue();
			this.timer = setInterval(() => void this.processDue(), 5_000);
		}
	}
	public stop(): void {
		if (this.timer) clearInterval(this.timer);
		this.timer = undefined;
	}
	public async processDue(): Promise<void> {
		if (this.running) return;
		this.running = true;
		try {
			for (const task of this.storage.getDueDeliveries())
				await this.deliver(task);
		} finally {
			this.running = false;
		}
	}
	private async deliver(task: DeliveryTask): Promise<void> {
		try {
			await this.bot.sendNotification(task.notification);
			this.storage.markDeliverySucceeded(task);
			this.storage.incrementCounter("delivered");
			logEvent("info", "vacancy.delivered", {
				chatId: task.chatId,
				messageId: task.messageId,
				profileId: task.profileId,
				delivery: "sent",
			});
		} catch (error) {
			if (task.attempts + 1 >= MAX_ATTEMPTS) {
				this.storage.discardDelivery(task);
				this.storage.incrementCounter("delivery_failed");
				logEvent("error", "vacancy.delivery_failed", {
					chatId: task.chatId,
					messageId: task.messageId,
					profileId: task.profileId,
					delivery: "discarded_after_final_failure",
					errorKind: error instanceof BotApiError ? "bot_api" : "unknown",
				});
				return;
			}
			const delay = retryDelay(task, error);
			this.storage.rescheduleDelivery(task, Date.now() + delay);
			this.storage.incrementCounter("delivery_retry");
			logEvent("warn", "vacancy.delivery_retry_scheduled", {
				chatId: task.chatId,
				messageId: task.messageId,
				profileId: task.profileId,
				retryAfterMilliseconds: delay,
			});
		}
	}
}
