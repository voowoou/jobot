import type { BotDialogState, DeduplicationStorage } from "../db/index.js";

export interface CommandMessage {
  chatId: string;
  text: string;
}

export interface CommandReplyClient {
  sendText(chatId: string, text: string): Promise<void>;
}

export function isOwner(chatId: string, ownerChatId: string | undefined): boolean {
  return ownerChatId !== undefined && chatId === ownerChatId;
}

export function parseCommand(text: string): string | undefined {
  const match = text.trim().match(/^\/([a-z]+)(?:@[a-z0-9_]+)?(?:\s|$)/i);
  return match?.[1]?.toLowerCase();
}

const HELP = "Команды:\n/start — приветствие\n/help — справка\n/cancel — отменить текущую операцию";

export class BotCommandRouter {
  public constructor(
    private readonly client: CommandReplyClient,
    private readonly storage: Pick<DeduplicationStorage, "clearBotDialog" | "getBotDialog">,
    private readonly ownerChatId?: string,
  ) {}

  public async handle(message: CommandMessage): Promise<void> {
    const command = parseCommand(message.text);
    if (!command) return;

    if (!isOwner(message.chatId, this.ownerChatId)) {
      if (command === "start" && !this.ownerChatId) {
        await this.client.sendText(message.chatId, "Jobot ещё не настроен. Добавьте ID этого личного чата в TELEGRAM_BOT_CHAT_ID через pnpm bot:setup, затем перезапустите приложение.");
      } else {
        await this.client.sendText(message.chatId, "У вас нет доступа к управлению Jobot.");
      }
      return;
    }

    switch (command) {
      case "start":
        await this.client.sendText(message.chatId, "Jobot присылает подходящие вакансии из групп и каналов вашего личного Telegram-аккаунта.\n\n" + HELP);
        return;
      case "help":
        await this.client.sendText(message.chatId, HELP);
        return;
      case "cancel": {
        const cancelled = this.storage.clearBotDialog(message.chatId);
        await this.client.sendText(message.chatId, cancelled ? "Текущая операция отменена." : "Нет активной операции для отмены.");
        return;
      }
      default:
        await this.client.sendText(message.chatId, "Неизвестная команда. Используйте /help.");
    }
  }

  public getDialog(chatId: string): BotDialogState | undefined {
    return this.storage.getBotDialog(chatId);
  }
}
