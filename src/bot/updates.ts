import type { DeduplicationStorage } from "../db/index.js";
import { logEvent } from "../services/logger.js";
import { BotApiError, type BotUpdate, TelegramBotClient } from "./client.js";
import type { BotCommandRouter } from "./router.js";

const POLL_TIMEOUT_SECONDS = 25;
const RETRY_DELAY_MS = 1_000;

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class BotUpdateProcessor {
  private controller: AbortController | undefined;
  private running: Promise<void> | undefined;

  public constructor(
    private readonly client: TelegramBotClient,
    private readonly router: BotCommandRouter,
    private readonly storage: Pick<DeduplicationStorage, "getNextBotUpdateId" | "setNextBotUpdateId">,
  ) {}

  public start(): void {
    if (!this.running) {
      this.controller = new AbortController();
      this.running = this.poll(this.controller);
    }
  }

  public async stop(): Promise<void> {
    this.controller?.abort();
    await this.running;
  }

  private async poll(controller: AbortController): Promise<void> {
    while (!controller.signal.aborted) {
      try {
        const updates = await this.client.getUpdates(this.storage.getNextBotUpdateId(), POLL_TIMEOUT_SECONDS, controller.signal);
        for (const update of updates) {
          if (controller.signal.aborted) return;
          await this.process(update);
          this.storage.setNextBotUpdateId(update.update_id + 1);
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        logEvent("warn", "bot.updates_failed", {
          errorKind: error instanceof BotApiError ? "bot_api" : "unknown",
          statusCode: error instanceof BotApiError ? error.statusCode : undefined,
        });
        await sleep(error instanceof BotApiError && error.retryAfterSeconds ? error.retryAfterSeconds * 1_000 : RETRY_DELAY_MS);
      }
    }
  }

  private async process(update: BotUpdate): Promise<void> {
    const message = update.message;
    if (!message?.text) return;
    await this.router.handle({ chatId: String(message.chat.id), text: message.text });
  }
}
