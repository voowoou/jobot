import type { ParsedVacancy } from "../types/index.js";

const MARKDOWN_V2_SPECIAL_CHARACTERS = /([_\*\[\]\(\)~`>#+\-=|{}.!\\])/g;
const CODE_SPECIAL_CHARACTERS = /([`\\])/g;
const LINK_URL_SPECIAL_CHARACTERS = /([)\\])/g;
const MAX_PREVIEW_LENGTH = 350;

function escapeMarkdownV2(value: string): string {
  return value.replace(MARKDOWN_V2_SPECIAL_CHARACTERS, "\\$1");
}

function escapeCode(value: string): string {
  return value.replace(CODE_SPECIAL_CHARACTERS, "\\$1");
}

function escapeLinkUrl(value: string): string {
  return value.replace(LINK_URL_SPECIAL_CHARACTERS, "\\$1");
}

function makePreview(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();

  if (normalized.length <= MAX_PREVIEW_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_PREVIEW_LENGTH - 3).trimEnd()}...`;
}

export function formatNotification(vacancy: ParsedVacancy): string {
  const formats = vacancy.workFormats.join(" / ") || "Не указан";
  const matches = [...vacancy.matchedKeywords, ...vacancy.grades].join(", ") || "Не указаны";
  const lines = [
    `🎯 *\\[${escapeMarkdownV2(vacancy.profileTitle)}\\] Новая вакансия*`,
    "",
    `📢 *Канал:* \`${escapeCode(vacancy.sourceTitle || "Не указан")}\``,
    `💼 *Формат:* ${escapeMarkdownV2(formats)}`,
    `🏷 *Совпадения:* \`${escapeCode(matches)}\``,
    "",
    "📝 *Превью текста:*",
    `> ${escapeMarkdownV2(makePreview(vacancy.originalText))}`,
  ];

  if (vacancy.directLink) {
    lines.push("", `🔗 [Открыть пост в Telegram](${escapeLinkUrl(vacancy.directLink)})`);
  }

  return lines.join("\n");
}
