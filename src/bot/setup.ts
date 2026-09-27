import { loadBotEnvironment } from "../config/env.js";
import { TelegramBotClient } from "./client.js";

async function setupBot(): Promise<void> {
  const environment = loadBotEnvironment();
  const bot = new TelegramBotClient(environment.telegramBotToken);
  const identity = await bot.getMe();
  const updates = await bot.getUpdates();
  const chats = new Map<number, NonNullable<(typeof updates)[number]["message"]>["chat"]>();

  for (const update of updates) {
    const chat = update.message?.chat;

    if (chat?.type === "private") {
      chats.set(chat.id, chat);
    }
  }

  if (chats.size === 0) {
    throw new Error("No private chat found. Open the bot and send /start, then run this command again.");
  }

  if (chats.size > 1) {
    console.log(`Several private chats were found for @${identity.username || identity.id}:`);

    for (const chat of chats.values()) {
      console.log(`${chat.id}  ${[chat.first_name, chat.last_name, chat.username && `@${chat.username}`].filter(Boolean).join(" ")}`);
    }

    console.log("Copy the correct ID to TELEGRAM_BOT_CHAT_ID in .env.");
    return;
  }

  const [chat] = chats.values();
  console.log(`Bot @${identity.username || identity.id} is ready.`);
  console.log(`Add this line to .env:\nTELEGRAM_BOT_CHAT_ID=${chat.id}`);
}

setupBot().catch((error: unknown) => {
  console.error("Bot setup failed:", error);
  process.exitCode = 1;
});
