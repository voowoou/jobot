import "dotenv/config";

import type { AppEnvironment, LogLevel } from "../types/index.js";

const LOG_LEVELS: ReadonlySet<string> = new Set(["debug", "info", "warn", "error"]);

function requireEnv(name: "TELEGRAM_API_ID" | "TELEGRAM_API_HASH"): string {
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

export function loadEnvironment(): AppEnvironment {
  return {
    telegramApiId: parseApiId(requireEnv("TELEGRAM_API_ID")),
    telegramApiHash: requireEnv("TELEGRAM_API_HASH"),
    telegramStringSession: process.env.TELEGRAM_STRING_SESSION?.trim() || "",
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
  };
}

export const env = loadEnvironment();
