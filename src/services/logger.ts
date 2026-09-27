import type { LogLevel } from "../types/index.js";

const LOG_PRIORITIES: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

let minimumLevel: LogLevel = "info";

export function configureLogger(level: LogLevel): void {
  minimumLevel = level;
}

export function logEvent(
  level: LogLevel,
  event: string,
  details: Record<string, string | number | boolean | undefined> = {},
): void {
  if (LOG_PRIORITIES[level] < LOG_PRIORITIES[minimumLevel]) {
    return;
  }

  const fields = Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
  console[level](JSON.stringify({ timestamp: new Date().toISOString(), level, event, ...fields }));
}
