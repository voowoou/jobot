import type { ProfileStore } from "../config/profile-store.js";
import type { BotDialogState, DeduplicationStorage } from "../db/index.js";
import type { UserProfile } from "../types/index.js";

export interface CommandMessage {
	chatId: string;
	text: string;
}
export interface CommandReplyClient {
	sendText(chatId: string, text: string): Promise<void>;
}
type DialogStorage = Pick<
	DeduplicationStorage,
	"clearBotDialog" | "getBotDialog" | "saveBotDialog" | "getSourceSettings" | "listSourceChats" | "setSourceMode" | "addSourceChat" | "removeSourceChat" | "setNotificationsPaused" | "getOutboxCount"
>;
type Draft = {
	mode: "create" | "edit" | "delete";
	originalId?: string;
	profile?: Partial<UserProfile>;
	id?: string;
};
const steps = [
	"id",
	"title",
	"enabled",
	"primary",
	"context",
	"exclude",
	"grades",
	"workFormats",
	"confirm",
] as const;
type Step = (typeof steps)[number];
const HELP =
	"Команды:\n/start — приветствие\n/help — справка\n/profiles — профили\n/sources — источники\n/pause — приостановить уведомления\n/resume — продолжить уведомления\n/status — состояние\n/test — тестовая карточка\n/cancel — отменить текущую операцию";

export function isOwner(
	chatId: string,
	ownerChatId: string | undefined,
): boolean {
	return ownerChatId !== undefined && chatId === ownerChatId;
}
export function parseCommand(text: string): string | undefined {
	return text
		.trim()
		.match(/^\/([a-z]+)(?:@[a-z0-9_]+)?(?:\s|$)/i)?.[1]
		?.toLowerCase();
}
const ask = (step: Step) =>
	({
		id: "Введите ID профиля:",
		title: "Введите название профиля:",
		enabled: "Включить профиль? (да/нет)",
		primary: "Основные термины через запятую:",
		context: "Маркеры вакансии через запятую или -:",
		exclude: "Исключения через запятую или -:",
		grades: "Грейды через запятую или -:",
		workFormats: "Форматы: remote: remote, удалённо; office: офис, или -:",
		confirm: "Сохранить профиль? (да/нет)",
	})[step];
const boolean = (value: string): boolean | undefined =>
	["да", "д", "yes", "y"].includes(value.trim().toLowerCase())
		? true
		: ["нет", "н", "no", "n"].includes(value.trim().toLowerCase())
			? false
			: undefined;
const list = (value: string, required = false): string[] | undefined =>
	value.trim() === "-" && !required
		? undefined
		: value
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean).length
			? value
					.split(",")
					.map((item) => item.trim())
					.filter(Boolean)
			: undefined;
function workFormats(value: string): Record<string, string[]> | undefined {
	if (value.trim() === "-") return undefined;
	const result: Record<string, string[]> = {};
	for (const part of value.split(";")) {
		const [name, values] = part.split(":", 2).map((item) => item?.trim());
		const items = values ? list(values, true) : undefined;
		if (!name || !items) return undefined;
		result[name] = items;
	}
	return Object.keys(result).length ? result : undefined;
}

export class BotCommandRouter {
	public constructor(
		private readonly client: CommandReplyClient,
		private readonly storage: DialogStorage,
		private readonly ownerChatId?: string,
		private readonly profiles?: ProfileStore,
	) {}
	public async handle(message: CommandMessage): Promise<void> {
		const command = parseCommand(message.text);
		if (!command && !this.storage.getBotDialog(message.chatId)) return;
		if (!isOwner(message.chatId, this.ownerChatId))
			return void (await this.client.sendText(
				message.chatId,
				command === "start" && !this.ownerChatId
					? "Jobot ещё не настроен. Добавьте ID этого личного чата в TELEGRAM_BOT_CHAT_ID через pnpm bot:setup, затем перезапустите приложение."
					: "У вас нет доступа к управлению Jobot.",
			));
		if (command === "start")
			return void (await this.client.sendText(
				message.chatId,
				"Jobot присылает подходящие вакансии из групп и каналов вашего личного Telegram-аккаунта.\n\n" +
					HELP,
			));
		if (command === "help")
			return void (await this.client.sendText(message.chatId, HELP));
		if (command === "cancel")
			return void (await this.client.sendText(
				message.chatId,
				this.storage.clearBotDialog(message.chatId)
					? "Текущая операция отменена."
					: "Нет активной операции для отмены.",
			));
		if (command === "profiles") return this.profilesCommand(message);
		if (command === "sources") return this.sourcesCommand(message);
		if (command === "pause") { this.storage.setNotificationsPaused(true); return void await this.client.sendText(message.chatId, "Уведомления приостановлены. Новые сообщения не будут помечены обработанными."); }
		if (command === "resume") { this.storage.setNotificationsPaused(false); return void await this.client.sendText(message.chatId, "Уведомления возобновлены."); }
		if (command === "status") return void await this.client.sendText(message.chatId, this.statusText());
		if (command === "test") return void await this.client.sendText(message.chatId, "🎯 Тестовая карточка Jobot\nИсточник: тестовый канал\nФормат: remote\nПрофиль: Frontend");
		if (!command) return this.wizard(message);
		await this.client.sendText(
			message.chatId,
			"Неизвестная команда. Используйте /help.",
		);
	}
	private async sourcesCommand(message: CommandMessage): Promise<void> {
		const [, action, chatId, ...titleParts] = message.text.trim().split(/\s+/);
		if (!action) return void await this.client.sendText(message.chatId, this.sourcesText());
		if (action === "mode" && (chatId === "all" || chatId === "allowlist" || chatId === "denylist")) { this.storage.setSourceMode(chatId); return void await this.client.sendText(message.chatId, `Режим источников: ${chatId}.`); }
		if ((action === "add" || action === "remove") && (!chatId || !/^-\d+$/.test(chatId))) return void await this.client.sendText(message.chatId, "Укажите отрицательный ID группы, супергруппы или канала. Личные диалоги добавлять нельзя.");
		if (action === "add" && chatId) { this.storage.addSourceChat(chatId, titleParts.join(" ") || undefined); return void await this.client.sendText(message.chatId, `Источник ${chatId} добавлен.`); }
		if (action === "remove" && chatId) return void await this.client.sendText(message.chatId, this.storage.removeSourceChat(chatId) ? `Источник ${chatId} удалён.` : `Источника ${chatId} нет в списке.`);
		await this.client.sendText(message.chatId, "Используйте /sources, /sources mode <all|allowlist|denylist>, /sources add <chat_id> или /sources remove <chat_id>.");
	}
	private sourcesText(): string {
		const settings = this.storage.getSourceSettings(); const chats = this.storage.listSourceChats();
		return `Режим: ${settings.mode}\nВыбранные источники:\n${chats.length ? chats.map((chat) => `${chat.chat_id}${chat.title ? ` — ${chat.title}` : ""}`).join("\n") : "—"}`;
	}
	private statusText(): string {
		const settings = this.storage.getSourceSettings(); const active = this.profiles?.get().filter((profile) => profile.enabled).length ?? 0;
		return `Уведомления: ${settings.paused ? "пауза" : "включены"}\nПрофилей активно: ${active}\nРежим источников: ${settings.mode}\nОжидают доставки: ${this.storage.getOutboxCount()}`;
	}
	private async profilesCommand(message: CommandMessage): Promise<void> {
		const profileStore = this.profiles;
		if (!profileStore)
			return void (await this.client.sendText(
				message.chatId,
				"Управление профилями недоступно.",
			));
		const [, action, id] = message.text.trim().split(/\s+/);
		const existing = profileStore.getUserProfiles();
		const existingProfiles = existing ?? [];
		if (!action)
			return void (await this.client.sendText(
				message.chatId,
				!existing?.length
					? "Пользовательских профилей нет: используется встроенный Frontend-профиль.\n\n/profiles add — создать профиль."
					: existing
							.map(
								(p) =>
									`${p.id} — ${p.title} (${p.enabled ? "включён" : "выключен"})`,
							)
							.join("\n"),
			));
		if (action === "add")
			return this.begin(message.chatId, { mode: "create", profile: {} }, "id");
		if (!id)
			return void (await this.client.sendText(
				message.chatId,
				"Укажите ID профиля.",
			));
		const profile = existingProfiles.find((p) => p.id === id);
		if (!profile)
			return void (await this.client.sendText(
				message.chatId,
				`Профиль «${id}» не найден.`,
			));
		if (action === "toggle") {
			profileStore.saveUserProfiles(
				existingProfiles.map((p) =>
					p.id === id ? { ...p, enabled: !p.enabled } : p,
				),
			);
			return void (await this.client.sendText(
				message.chatId,
				`Профиль «${id}» ${profile.enabled ? "выключен" : "включён"}.`,
			));
		}
		if (action === "edit")
			return this.begin(
				message.chatId,
				{ mode: "edit", originalId: id, profile },
				"id",
			);
		if (action === "remove")
			return this.begin(message.chatId, { mode: "delete", id }, "confirm");
		await this.client.sendText(
			message.chatId,
			"Используйте add, edit, toggle или remove.",
		);
	}
	private async begin(chatId: string, draft: Draft, step: Step): Promise<void> {
		this.storage.saveBotDialog(chatId, "profiles", step, draft);
		await this.client.sendText(
			chatId,
			draft.mode === "delete"
				? `Удалить профиль «${draft.id}»? (да/нет)`
				: ask(step),
		);
	}
	private async wizard(message: CommandMessage): Promise<void> {
		const profileStore = this.profiles;
		if (!profileStore) return;
		const state = this.storage.getBotDialog(message.chatId);
		if (state?.command !== "profiles") return;
		const draft = state.draft as Draft;
		if (draft.mode === "delete")
			return this.finishDelete(message.chatId, draft, message.text);
		const step = state.step as Step;
		if (step === "confirm")
			return this.finishProfile(message.chatId, draft, message.text);
		const profile = { ...draft.profile };
		if (step === "id" || step === "title") {
			if (!message.text.trim())
				return void (await this.client.sendText(
					message.chatId,
					`Значение обязательно. ${ask(step)}`,
				));
			profile[step] = message.text.trim();
		} else if (step === "enabled") {
			const value = boolean(message.text);
			if (value === undefined)
				return void (await this.client.sendText(message.chatId, ask(step)));
			profile.enabled = value;
		} else if (step === "primary") {
			const value = list(message.text, true);
			if (!value)
				return void (await this.client.sendText(
					message.chatId,
					"Укажите хотя бы один термин.",
				));
			profile.primary = value;
		} else if (step === "workFormats") {
			const value = workFormats(message.text);
			if (message.text.trim() !== "-" && !value)
				return void (await this.client.sendText(message.chatId, ask(step)));
			profile.workFormats = value;
		} else profile[step] = list(message.text);
		const next = steps[steps.indexOf(step) + 1];
		this.storage.saveBotDialog(message.chatId, "profiles", next, {
			...draft,
			profile,
		});
		await this.client.sendText(
			message.chatId,
			next === "confirm"
				? `${profile.id} — ${profile.title}\nОсновные: ${profile.primary?.join(", ")}\n\n${ask(next)}`
				: ask(next),
		);
	}
	private async finishProfile(
		chatId: string,
		draft: Draft,
		answer: string,
	): Promise<void> {
		const profileStore = this.profiles;
		if (!profileStore) return;
		const approved = boolean(answer);
		if (approved === undefined)
			return void (await this.client.sendText(chatId, ask("confirm")));
		if (!approved) {
			this.storage.clearBotDialog(chatId);
			return void (await this.client.sendText(chatId, "Сохранение отменено."));
		}
		try {
			const existing = profileStore.getUserProfiles() ?? [];
			const profile = draft.profile as UserProfile;
			const rest = existing.filter((p) => p.id !== draft.originalId);
			if (rest.some((p) => p.id === profile.id))
				throw new Error(`Профиль с ID «${profile.id}» уже существует.`);
			profileStore.saveUserProfiles([...rest, profile]);
			this.storage.clearBotDialog(chatId);
			await this.client.sendText(
				chatId,
				`Профиль «${profile.id}» сохранён и сразу применяется.`,
			);
		} catch (error) {
			await this.client.sendText(
				chatId,
				error instanceof Error
					? `Не удалось сохранить: ${error.message}`
					: "Не удалось сохранить профиль.",
			);
		}
	}
	private async finishDelete(
		chatId: string,
		draft: Draft,
		answer: string,
	): Promise<void> {
		const profileStore = this.profiles;
		if (!profileStore) return;
		const approved = boolean(answer);
		if (approved === undefined)
			return void (await this.client.sendText(
				chatId,
				"Удалить профиль? (да/нет)",
			));
		this.storage.clearBotDialog(chatId);
		if (!approved)
			return void (await this.client.sendText(chatId, "Удаление отменено."));
		profileStore.saveUserProfiles(
			(profileStore.getUserProfiles() ?? []).filter((p) => p.id !== draft.id),
		);
		await this.client.sendText(chatId, `Профиль «${draft.id}» удалён.`);
	}
	public getDialog(chatId: string): BotDialogState | undefined {
		return this.storage.getBotDialog(chatId);
	}
}
