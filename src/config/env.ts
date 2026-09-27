import "dotenv/config";

import type { AppEnvironment, BotEnvironment, LogLevel, TelegramEnvironment } from "../types/index.js";

const LOG_LEVELS: ReadonlySet<string> = new Set(["debug", "info", "warn", "error"]);

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function parseApiId(value: string): number {
  const apiId = Number(value);

  if (!Number.isSafeInteger(apiId) || apiId <= 0) {
    throw new Error("TELEGRAM_API_ID must be a positive integer");
  }

  return apiId;
}

function parseLogLevel(value: string | undefined): LogLevel {
  const level = value?.trim().toLowerCase() || "info";

  if (!LOG_LEVELS.has(level)) {
    throw new Error("LOG_LEVEL must be one of: debug, info, warn, error");
  }

  return level as LogLevel;
}

export function loadTelegramEnvironment(): TelegramEnvironment {
  return {
    telegramApiId: parseApiId(requireEnv("TELEGRAM_API_ID")),
    telegramApiHash: requireEnv("TELEGRAM_API_HASH"),
    telegramStringSession: process.env.TELEGRAM_STRING_SESSION?.trim() || "",
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
  };
}

export function loadBotEnvironment(requireChatId = false): BotEnvironment {
  const chatId = process.env.TELEGRAM_BOT_CHAT_ID?.trim();

  if (requireChatId && !chatId) {
    throw new Error("Missing required environment variable: TELEGRAM_BOT_CHAT_ID. Run `pnpm bot:setup`.");
  }

  if (chatId && !/^-?\d+$/.test(chatId)) {
    throw new Error("TELEGRAM_BOT_CHAT_ID must be a numeric chat ID");
  }

  return {
    telegramBotToken: requireEnv("TELEGRAM_BOT_TOKEN"),
    telegramBotChatId: chatId,
  };
}

export function loadEnvironment(): AppEnvironment {
  const botEnvironment = loadBotEnvironment(true);

  if (!botEnvironment.telegramBotChatId) {
    throw new Error("Missing required environment variable: TELEGRAM_BOT_CHAT_ID");
  }

  return {
    ...loadTelegramEnvironment(),
    telegramBotToken: botEnvironment.telegramBotToken,
    telegramBotChatId: botEnvironment.telegramBotChatId,
  };
}

export const telegramEnv = loadTelegramEnvironment();
