export interface SearchProfile {
  id: string;
  title: string;
  enabled: boolean;
  keywords: {
    /** At least one expression must match. */
    primary: RegExp[];
    /** Optional vacancy-context markers. At least one must match when supplied. */
    context?: RegExp[];
    /** Any match rejects the message for this profile. */
    exclude?: RegExp[];
  };
  attributes?: {
    grades?: RegExp[];
    workFormats?: Record<string, RegExp>;
  };
}

export interface ParsedVacancy {
  originalText: string;
  profileId: string;
  profileTitle: string;
  sourceTitle?: string;
  grades: string[];
  workFormats: string[];
  matchedKeywords: string[];
  directLink: string;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface TelegramEnvironment {
  telegramApiId: number;
  telegramApiHash: string;
  telegramStringSession: string;
  logLevel: LogLevel;
}

export interface BotEnvironment {
  telegramBotToken: string;
  telegramBotChatId?: string;
}

export interface AppEnvironment extends TelegramEnvironment {
  telegramBotToken: string;
  telegramBotChatId: string;
}
