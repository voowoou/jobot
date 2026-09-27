import { FloodWaitError } from "telegram/errors/index.js";
import { NewMessage, type NewMessageEvent } from "telegram/events/index.js";
import { getDisplayName } from "telegram/Utils.js";

import { db } from "./db/index.js";
import { formatNotification } from "./services/formatter.js";
import { matchVacancy } from "./services/matcher.js";
import { createTelegramClient } from "./telegram/client.js";

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
  const username = chat && "username" in chat && typeof chat.username === "string" ? chat.username : undefined;

  return {
    chatId,
    directLink: username
      ? `https://t.me/${username}/${event.message.id}`
      : getInternalPostLink(chatId, event.message.id),
    sourceTitle: chat ? getDisplayName(chat) : "Неизвестный чат",
  };
}

async function processMessage(event: NewMessageEvent): Promise<void> {
  const text = event.message.text?.trim();

  if (!text) {
    return;
  }

  const context = await getMessageContext(event);

  if (db.isProcessed(context.chatId, event.message.id)) {
    return;
  }

  const vacancy = matchVacancy(text, context);

  if (!vacancy) {
    return;
  }

  const notification = formatNotification(vacancy);

  if (!event.client) {
    throw new Error("Telegram client is not attached to the message event");
  }

  await event.client.sendMessage("me", {
    message: notification,
    parseMode: "markdownv2",
    linkPreview: false,
  });
  db.markProcessed(context.chatId, event.message.id);
  console.info(`Sent vacancy notification from ${context.sourceTitle}: ${event.message.id}`);
}

async function handleNewMessage(event: NewMessageEvent): Promise<void> {
  while (!shuttingDown) {
    try {
      await waitForFloodPause();
      await processMessage(event);
      return;
    } catch (error) {
      if (!isFloodWaitError(error)) {
        console.error("Failed to process Telegram message:", error);
        return;
      }

      const delayMilliseconds = Math.max(1, error.seconds) * 1_000;
      floodWaitUntil = Math.max(floodWaitUntil, Date.now() + delayMilliseconds);
      console.warn(`Telegram requested FloodWait; pausing for ${error.seconds} seconds.`);
      await waitForFloodPause();
    }
  }
}

export async function startApplication(): Promise<void> {
  const client = createTelegramClient();

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    console.info(`Received ${signal}; shutting down.`);
    await client.disconnect();
    db.close();
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  client.addEventHandler((event) => void handleNewMessage(event), new NewMessage({ incoming: true }));
  await client.connect();

  if (!(await client.isUserAuthorized())) {
    await client.disconnect();
    db.close();
    throw new Error("Telegram session is not authorized. Run `pnpm auth` and set TELEGRAM_STRING_SESSION.");
  }

  console.info("Jobot is running and listening for new incoming messages.");
}

startApplication().catch((error: unknown) => {
  console.error("Unable to start Jobot:", error);
  db.close();
  process.exitCode = 1;
});
