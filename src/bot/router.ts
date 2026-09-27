import type { ProfileStore } from "../config/profile-store.js";
import type { BotDialogState, DeduplicationStorage } from "../db/index.js";
import { formatNotification } from "../services/formatter.js";
import type { UserProfile } from "../types/index.js";
import type { InlineKeyboard } from "./client.js";

export interface CommandMessage {
	chatId: string;
	text: string;
}
export interface CommandReplyClient {
	sendText(
		chatId: string,
		text: string,
		replyMarkup?: InlineKeyboard,
	): Promise<void>;
	sendNotification?(text: string): Promise<void>;
	answerCallbackQuery?(callbackQueryId: string, text?: string): Promise<void>;
}
export interface CallbackQuery {
	chatId: string;
	callbackId: string;
	data?: string;
}
type DialogStorage = Pick<
	DeduplicationStorage,
	| "clearBotDialog"
	| "getBotDialog"
	| "saveBotDialog"
	| "getSourceSettings"
	| "listSourceChats"
	| "setSourceMode"
	| "addSourceChat"
	| "removeSourceChat"
	| "listRecentSourceChats"
	| "getRecentSourceCount"
	| "setNotificationsPaused"
	| "getOutboxCount"
	| "getCounters"
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
const START =
	"Jobot присылает подходящие вакансии из групп и каналов вашего личного Telegram-аккаунта.\n\n" +
	"С чего начать:\n" +
	"1. Создайте профиль: /profiles add\n" +
	"2. Посмотрите профили: /profiles\n" +
	"3. Отправьте тестовую карточку: /test\n\n" +
	"Источники настраиваются командой /sources. Полный список команд — /help.";
const HELP =
	"Профили\n" +
	"/profiles — показать профили\n" +
	"/profiles add — создать профиль\n" +
	"/profiles edit <id> — изменить профиль, например: /profiles edit frontend\n" +
	"/profiles toggle <id> — включить или выключить профиль, например: /profiles toggle frontend\n" +
	"/profiles remove <id> — удалить профиль, например: /profiles remove frontend\n" +
	"В мастере обязательные поля нельзя пропустить; для необязательных есть кнопка «Пропустить» или отправьте «-». При редактировании «=» сохраняет текущее значение. /cancel отменяет мастер.\n\n" +
	"Источники\n" +
	"/sources — показать режим и список источников\n" +
	"/sources mode <all|allowlist|denylist> — например: /sources mode allowlist\n" +
	"/sources add <chat_id> — например: /sources add -1001234567890\n" +
	"/sources remove <chat_id> — например: /sources remove -1001234567890\n" +
	"all — все группы и каналы; allowlist — только источники из списка; denylist — все, кроме списка. В режиме all список не нужен.\n\n" +
	"Доставка\n" +
	"/pause — приостановить уведомления\n" +
	"/resume — возобновить уведомления\n" +
	"/status — показать состояние\n" +
	"/test — прислать тестовую карточку\n\n" +
	"Прочее\n" +
	"/start — с чего начать\n" +
	"/help — эта справка\n" +
	"/cancel — отменить текущую операцию";

type CallbackAction =
	| "home"
	| "profiles"
	| "sources"
	| "sources-recent"
	| "source-add"
	| "source-remove"
	| "status"
	| "test"
	| "pause"
	| "resume"
	| "profile-add"
	| "profile-edit"
	| "profile-toggle"
	| "profile-delete"
	| "profile-delete-confirm"
	| "profile-delete-cancel"
	| "wizard-yes"
	| "wizard-no"
	| "wizard-skip";
type Callback = {
	action: CallbackAction;
	profileId?: string;
	chatId?: string;
	page?: number;
};
const callbackData = (action: string, profileId?: string) =>
	`v1:${action}${profileId ? `:${profileId}` : ""}`;
export function parseCallback(data: string | undefined): Callback | undefined {
	if (!data) return undefined;
	if (/^v1:wizard-(yes|no|skip)$/.test(data))
		return { action: data.slice(3) as CallbackAction };
	const sourceMatch = data.match(/^v1:(sources-recent)(?::(\d{1,3}))?$/);
	if (sourceMatch)
		return { action: "sources-recent", page: Number(sourceMatch[2] ?? 0) };
	const sourceAction = data.match(
		/^v1:(source-add|source-remove):(-\d{1,20})$/,
	);
	if (sourceAction)
		return {
			action: sourceAction[1] as CallbackAction,
			chatId: sourceAction[2],
		};
	const match = data.match(
		/^v1:(home|profiles|sources|status|test|pause|resume|profile-add|profile-edit|profile-toggle|profile-delete|profile-delete-confirm|profile-delete-cancel)(?::([a-z0-9][a-z0-9_-]{0,63}))?$/i,
	);
	if (!match) return undefined;
	const action = match[1] as CallbackAction;
	const needsProfile =
		action.startsWith("profile-") && action !== "profile-add";
	if (needsProfile !== Boolean(match[2])) return undefined;
	return { action, profileId: match[2] };
}
const mainKeyboard = (paused: boolean): InlineKeyboard => ({
	inline_keyboard: [
		[
			{ text: "Профили", callback_data: callbackData("profiles") },
			{ text: "Источники", callback_data: callbackData("sources") },
		],
		[
			{ text: "Статус", callback_data: callbackData("status") },
			{ text: "Тест", callback_data: callbackData("test") },
		],
		[
			{
				text: paused ? "Возобновить" : "Пауза",
				callback_data: callbackData(paused ? "resume" : "pause"),
			},
		],
	],
});

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
		id: "ID профиля — короткое имя латиницей, без пробелов.\nПример: frontend",
		title:
			"Название для карточек вакансий.\nПример: Frontend Developer — React / Next.js",
		enabled: "Включить профиль сразу? Выберите «Да» или «Нет».",
		primary:
			"Главные технологии: найдётся вакансия с хотя бы одним словом.\nПример: react, typescript, next.js, фронтенд",
		context:
			"Признаки именно вакансии. Необязательный шаг.\nПример: вакансия, ищем, frontend-разработчик\nОтправьте «-», чтобы пропустить.",
		exclude:
			"Слова, при которых вакансию нужно пропустить. Необязательный шаг.\nПример: senior, lead\nОтправьте «-», чтобы пропустить.",
		grades:
			"Подходящие уровни. Необязательный шаг.\nПример: junior, middle\nОтправьте «-», чтобы принимать любой уровень.",
		workFormats:
			"Формат: название: варианты через запятую; несколько форматов разделяйте «;».\nПример: remote: remote, удалённо; hybrid: hybrid, гибрид\nОтправьте «-», чтобы принимать любой формат.",
		confirm: "Сохранить профиль?",
	})[step];
const optionalSteps: readonly Step[] = [
	"context",
	"exclude",
	"grades",
	"workFormats",
];
const stepNumber = (step: Step) => steps.indexOf(step) + 1;
function wizardKeyboard(step: Step): InlineKeyboard | undefined {
	if (step === "enabled" || step === "confirm")
		return {
			inline_keyboard: [
				[
					{ text: "Да", callback_data: callbackData("wizard-yes") },
					{ text: "Нет", callback_data: callbackData("wizard-no") },
				],
			],
		};
	if (optionalSteps.includes(step))
		return {
			inline_keyboard: [
				[{ text: "Пропустить", callback_data: callbackData("wizard-skip") }],
			],
		};
}
function currentValue(
	step: Step,
	profile: Partial<UserProfile> | undefined,
): string {
	if (!profile) return "—";
	if (step === "workFormats")
		return profile.workFormats
			? Object.entries(profile.workFormats)
					.map(([name, values]) => `${name}: ${values.join(", ")}`)
					.join("; ")
			: "—";
	const value = profile[step as keyof UserProfile];
	return Array.isArray(value)
		? value.join(", ")
		: value === undefined
			? "—"
			: String(value);
}
function wizardPrompt(step: Step, draft: Draft): string {
	const editHint =
		draft.mode === "edit"
			? `\nТекущее значение: ${currentValue(step, draft.profile)}\nОтправьте =, чтобы оставить его без изменения.`
			: "";
	return `Шаг ${stepNumber(step)}/${steps.length}\n${ask(step)}${editHint}`;
}
function profileSummary(profile: Partial<UserProfile>): string {
	const formats = profile.workFormats
		? Object.entries(profile.workFormats)
				.map(([name, values]) => `${name}: ${values.join(", ")}`)
				.join("; ")
		: "—";
	return `ID: ${profile.id ?? "—"}\nНазвание: ${profile.title ?? "—"}\nВключён: ${profile.enabled ? "да" : "нет"}\nОсновные: ${profile.primary?.join(", ") ?? "—"}\nКонтекст: ${profile.context?.join(", ") ?? "—"}\nИсключения: ${profile.exclude?.join(", ") ?? "—"}\nГрейды: ${profile.grades?.join(", ") ?? "—"}\nФорматы: ${formats}`;
}
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
			return void (command === "start" && !this.ownerChatId
				? await this.client.sendText(
						message.chatId,
						"Jobot ещё не настроен. Добавьте ID этого личного чата в TELEGRAM_BOT_CHAT_ID через pnpm bot:setup, затем перезапустите приложение.",
					)
				: undefined);
		if (command === "start")
			return void (await this.client.sendText(
				message.chatId,
				START,
				mainKeyboard(this.storage.getSourceSettings().paused),
			));
		if (command === "help")
			return void (await this.client.sendText(
				message.chatId,
				HELP,
				mainKeyboard(this.storage.getSourceSettings().paused),
			));
		if (command === "cancel")
			return void (await this.client.sendText(
				message.chatId,
				this.storage.clearBotDialog(message.chatId)
					? "Текущая операция отменена."
					: "Нет активной операции для отмены.",
			));
		if (command === "profiles") return this.profilesCommand(message);
		if (command === "sources") return this.sourcesCommand(message);
		if (command === "pause") {
			this.storage.setNotificationsPaused(true);
			return void (await this.client.sendText(
				message.chatId,
				"Уведомления приостановлены. Новые сообщения не будут помечены обработанными.",
			));
		}
		if (command === "resume") {
			this.storage.setNotificationsPaused(false);
			return void (await this.client.sendText(
				message.chatId,
				"Уведомления возобновлены.",
			));
		}
		if (command === "status")
			return void (await this.client.sendText(
				message.chatId,
				this.statusText(),
			));
		if (command === "test") {
			const card = formatNotification({
				originalText: "Вакансия: ищем React middle разработчика, remote.",
				profileId: "frontend",
				profileTitle: "Frontend (React / JS)",
				sourceTitle: "Тестовый канал",
				grades: ["middle"],
				workFormats: ["Удалёнка"],
				matchedKeywords: ["React"],
				directLink: "https://t.me/example/1",
			});
			if (this.client.sendNotification)
				return this.client.sendNotification(card);
			return void (await this.client.sendText(message.chatId, card));
		}
		if (!command) return this.wizard(message);
		await this.client.sendText(
			message.chatId,
			"Неизвестная команда. Используйте /help.",
		);
	}
	public async handleCallback(query: CallbackQuery): Promise<void> {
		const callback = parseCallback(query.data);
		const answer = async (text?: string) =>
			this.client.answerCallbackQuery?.(query.callbackId, text);
		if (!isOwner(query.chatId, this.ownerChatId)) {
			await answer("Нет доступа.");
			return;
		}
		if (!callback) {
			await answer("Эта кнопка устарела. Откройте /start заново.");
			return;
		}
		await answer();
		if (callback.action === "home")
			return this.handle({ chatId: query.chatId, text: "/start" });
		if (callback.action === "profiles") return this.sendProfiles(query.chatId);
		if (callback.action === "sources") return this.sendSources(query.chatId);
		if (callback.action === "sources-recent")
			return this.sendRecentSources(query.chatId, callback.page ?? 0);
		if (
			(callback.action === "source-add" ||
				callback.action === "source-remove") &&
			callback.chatId
		) {
			const source = this.storage
				.listRecentSourceChats(100)
				.find((item) => item.chatId === callback.chatId);
			if (!source)
				return void (await this.client.sendText(
					query.chatId,
					"Эта кнопка устарела: источник больше недоступен. Откройте /sources recent.",
				));
			if (callback.action === "source-add")
				this.storage.addSourceChat(source.chatId, source.title);
			else this.storage.removeSourceChat(source.chatId);
			return this.sendRecentSources(query.chatId, 0);
		}
		if (callback.action === "status")
			return this.handle({ chatId: query.chatId, text: "/status" });
		if (callback.action === "test")
			return this.handle({ chatId: query.chatId, text: "/test" });
		if (callback.action === "pause")
			return this.handle({ chatId: query.chatId, text: "/pause" });
		if (callback.action === "resume")
			return this.handle({ chatId: query.chatId, text: "/resume" });
		if (
			callback.action === "wizard-yes" ||
			callback.action === "wizard-no" ||
			callback.action === "wizard-skip"
		) {
			const state = this.storage.getBotDialog(query.chatId);
			if (state?.command !== "profiles")
				return void (await this.client.sendText(
					query.chatId,
					"Эта кнопка устарела. Откройте /profiles.",
				));
			const value =
				callback.action === "wizard-yes"
					? "да"
					: callback.action === "wizard-no"
						? "нет"
						: (state.draft as Draft).mode === "edit"
							? "="
							: "-";
			return this.handle({ chatId: query.chatId, text: value });
		}
		const profile = this.profiles
			?.getUserProfiles()
			?.find((item) => item.id === callback.profileId);
		if (callback.action === "profile-add")
			return this.begin(query.chatId, { mode: "create", profile: {} }, "id");
		if (!profile || !callback.profileId)
			return void (await this.client.sendText(
				query.chatId,
				"Эта кнопка устарела: профиль больше не существует. Откройте /profiles.",
			));
		if (callback.action === "profile-edit")
			return this.begin(
				query.chatId,
				{ mode: "edit", originalId: profile.id, profile },
				"id",
			);
		if (callback.action === "profile-toggle")
			return this.handle({
				chatId: query.chatId,
				text: `/profiles toggle ${profile.id}`,
			});
		if (callback.action === "profile-delete")
			return void (await this.client.sendText(
				query.chatId,
				`Удалить профиль «${profile.id}»?`,
				{
					inline_keyboard: [
						[
							{
								text: "Удалить",
								callback_data: callbackData(
									"profile-delete-confirm",
									profile.id,
								),
							},
							{
								text: "Отмена",
								callback_data: callbackData(
									"profile-delete-cancel",
									profile.id,
								),
							},
						],
					],
				},
			));
		if (callback.action === "profile-delete-cancel")
			return void (await this.client.sendText(
				query.chatId,
				"Удаление отменено.",
			));
		if (callback.action === "profile-delete-confirm") {
			this.deleteProfile(profile.id);
			return void (await this.client.sendText(
				query.chatId,
				`Профиль «${profile.id}» удалён.`,
			));
		}
	}
	private async sourcesCommand(message: CommandMessage): Promise<void> {
		const [, action, chatId, ...titleParts] = message.text.trim().split(/\s+/);
		if (!action)
			return void (await this.client.sendText(
				message.chatId,
				this.sourcesText(),
				this.sourcesKeyboard(),
			));
		if (action === "recent")
			return this.sendRecentSources(message.chatId, Number(chatId ?? "0"));
		if (
			action === "mode" &&
			(chatId === "all" || chatId === "allowlist" || chatId === "denylist")
		) {
			if (chatId === "allowlist") {
				this.storage.saveBotDialog(message.chatId, "sources", "confirm-mode", {
					mode: chatId,
				});
				return void (await this.client.sendText(
					message.chatId,
					"В режиме allowlist будут обрабатываться только выбранные источники; все остальные перестанут обрабатываться. Переключить режим? (да/нет)",
				));
			}
			this.storage.setSourceMode(chatId);
			return void (await this.client.sendText(
				message.chatId,
				`Режим источников: ${chatId}.`,
			));
		}
		if (
			(action === "add" || action === "remove") &&
			(!chatId || !/^-\d+$/.test(chatId))
		)
			return void (await this.client.sendText(
				message.chatId,
				`Укажите отрицательный ID группы, супергруппы или канала. Например: /sources ${action} -1001234567890. Личные диалоги добавлять нельзя.`,
			));
		if (action === "add" && chatId) {
			this.storage.addSourceChat(chatId, titleParts.join(" ") || undefined);
			return void (await this.client.sendText(
				message.chatId,
				`Источник ${chatId} добавлен.`,
			));
		}
		if (action === "remove" && chatId)
			return void (await this.client.sendText(
				message.chatId,
				this.storage.removeSourceChat(chatId)
					? `Источник ${chatId} удалён.${this.storage.getSourceSettings().mode === "allowlist" ? " В allowlist он больше не будет обрабатываться." : this.storage.getSourceSettings().mode === "denylist" ? " В denylist он снова будет обрабатываться." : " В режиме all это не меняет обработку."}`
					: `Источника ${chatId} нет в списке.`,
			));
		await this.client.sendText(
			message.chatId,
			"Неверные аргументы. Например: /sources mode allowlist, /sources add -1001234567890 или /sources remove -1001234567890.",
		);
	}
	private sourcesKeyboard(): InlineKeyboard {
		return {
			inline_keyboard: [
				[
					{
						text: "Недавние источники",
						callback_data: callbackData("sources-recent"),
					},
				],
			],
		};
	}
	private async sendSources(chatId: string): Promise<void> {
		await this.client.sendText(
			chatId,
			this.sourcesText(),
			this.sourcesKeyboard(),
		);
	}
	private async sendRecentSources(
		chatId: string,
		requestedPage: number,
	): Promise<void> {
		const pageSize = 6;
		const total = this.storage.getRecentSourceCount();
		const pages = Math.max(1, Math.ceil(total / pageSize));
		const page = Math.min(
			Math.max(0, Number.isInteger(requestedPage) ? requestedPage : 0),
			pages - 1,
		);
		const sources = this.storage.listRecentSourceChats(
			pageSize,
			page * pageSize,
		);
		if (!sources.length)
			return void (await this.client.sendText(
				chatId,
				"Недавних групп и каналов пока нет. Когда Jobot увидит новое сообщение из источника, он появится здесь.",
			));
		const selected = new Set(this.storage.getSourceSettings().chatIds);
		const keyboard: InlineKeyboard = { inline_keyboard: [] };
		for (const source of sources)
			keyboard.inline_keyboard.push([
				{
					text: `${selected.has(source.chatId) ? "Убрать" : "Добавить"}: ${source.title}`,
					callback_data: callbackData(
						selected.has(source.chatId) ? "source-remove" : "source-add",
						source.chatId,
					),
				},
			]);
		const navigation = [];
		if (page > 0)
			navigation.push({
				text: "←",
				callback_data: callbackData("sources-recent", String(page - 1)),
			});
		if (page < pages - 1)
			navigation.push({
				text: "→",
				callback_data: callbackData("sources-recent", String(page + 1)),
			});
		if (navigation.length) keyboard.inline_keyboard.push(navigation);
		await this.client.sendText(
			chatId,
			`Недавние источники (${page + 1}/${pages})\n${sources.map((source) => `${source.title} — ${source.type}`).join("\n")}`,
			keyboard,
		);
	}
	private sourcesText(): string {
		const settings = this.storage.getSourceSettings();
		const chats = this.storage.listSourceChats();
		const list = chats.length
			? chats
					.map(
						(chat) => `${chat.chat_id}${chat.title ? ` — ${chat.title}` : ""}`,
					)
					.join("\n")
			: "—";
		return `Режим: ${settings.mode}\nВыбранные источники:\n${list}${settings.mode === "all" ? "\n\nВ режиме all список не требуется: обрабатываются все группы и каналы." : ""}`;
	}
	private statusText(): string {
		const settings = this.storage.getSourceSettings();
		const active =
			this.profiles?.get().filter((profile) => profile.enabled).length ?? 0;
		const counters = this.storage.getCounters();
		return `Уведомления: ${settings.paused ? "пауза" : "включены"}\nПрофилей активно: ${active}\nРежим источников: ${settings.mode}\nПолучено: ${counters.received ?? 0}\nСовпало: ${counters.matched ?? 0}\nДоставлено: ${counters.delivered ?? 0}\nRetry: ${counters.delivery_retry ?? 0}\nОжидают доставки: ${this.storage.getOutboxCount()}`;
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
		if (!action) return this.sendProfiles(message.chatId);
		if (action === "add")
			return this.begin(message.chatId, { mode: "create", profile: {} }, "id");
		if (!id)
			return void (await this.client.sendText(
				message.chatId,
				`Укажите ID профиля. Например: /profiles ${action} frontend.`,
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
			"Неверное действие. Например: /profiles add, /profiles edit frontend, /profiles toggle frontend или /profiles remove frontend.",
		);
	}
	private async sendProfiles(chatId: string): Promise<void> {
		const profiles = this.profiles?.getUserProfiles() ?? [];
		const keyboard: InlineKeyboard = {
			inline_keyboard: [
				[
					{
						text: "Создать профиль",
						callback_data: callbackData("profile-add"),
					},
				],
			],
		};
		for (const profile of profiles)
			keyboard.inline_keyboard.push([
				{
					text: `Изменить: ${profile.title}`,
					callback_data: callbackData("profile-edit", profile.id),
				},
				{
					text: profile.enabled ? "Выключить" : "Включить",
					callback_data: callbackData("profile-toggle", profile.id),
				},
				{
					text: "Удалить",
					callback_data: callbackData("profile-delete", profile.id),
				},
			]);
		await this.client.sendText(
			chatId,
			profiles.length
				? profiles
						.map(
							(profile) =>
								`${profile.id} — ${profile.title} (${profile.enabled ? "включён" : "выключен"})`,
						)
						.join("\n")
				: "Профилей пока нет. Создайте первый: /profiles add. Пока профиль не создан, Jobot не присылает вакансии.",
			keyboard,
		);
	}
	private async begin(chatId: string, draft: Draft, step: Step): Promise<void> {
		this.storage.saveBotDialog(chatId, "profiles", step, draft);
		await this.client.sendText(
			chatId,
			draft.mode === "delete"
				? `Удалить профиль «${draft.id}»? (да/нет)`
				: wizardPrompt(step, draft),
			draft.mode === "delete" ? undefined : wizardKeyboard(step),
		);
	}
	private async wizard(message: CommandMessage): Promise<void> {
		const profileStore = this.profiles;
		const state = this.storage.getBotDialog(message.chatId);
		if (state?.command === "sources")
			return this.sourceWizard(message.chatId, state.draft, message.text);
		if (!profileStore) return;
		if (state?.command !== "profiles") return;
		const draft = state.draft as Draft;
		if (draft.mode === "delete")
			return this.finishDelete(message.chatId, draft, message.text);
		const step = state.step as Step;
		if (step === "confirm")
			return this.finishProfile(message.chatId, draft, message.text);
		const profile = { ...draft.profile };
		if (message.text.trim() === "=" && draft.mode === "edit") {
			const next = steps[steps.indexOf(step) + 1];
			this.storage.saveBotDialog(message.chatId, "profiles", next, draft);
			return this.sendWizardStep(message.chatId, next, draft);
		}
		if (step === "id" || step === "title") {
			if (!message.text.trim())
				return void (await this.client.sendText(
					message.chatId,
					`Шаг ${stepNumber(step)}: значение обязательно. ${wizardPrompt(step, draft)}`,
				));
			profile[step] = message.text.trim();
		} else if (step === "enabled") {
			const value = boolean(message.text);
			if (value === undefined)
				return void (await this.client.sendText(
					message.chatId,
					`Шаг ${stepNumber(step)}: выберите Да или Нет.`,
					wizardKeyboard(step),
				));
			profile.enabled = value;
		} else if (step === "primary") {
			const value = list(message.text, true);
			if (!value)
				return void (await this.client.sendText(
					message.chatId,
					`Шаг ${stepNumber(step)}: укажите хотя бы один термин. Например: react, typescript.`,
				));
			profile.primary = value;
		} else if (step === "workFormats") {
			const value = workFormats(message.text);
			if (message.text.trim() !== "-" && !value)
				return void (await this.client.sendText(
					message.chatId,
					`Шаг ${stepNumber(step)}: используйте формат remote: remote, удалённо или -.`,
					wizardKeyboard(step),
				));
			profile.workFormats = value;
		} else profile[step] = list(message.text);
		const next = steps[steps.indexOf(step) + 1];
		this.storage.saveBotDialog(message.chatId, "profiles", next, {
			...draft,
			profile,
		});
		await this.sendWizardStep(message.chatId, next, { ...draft, profile });
	}
	private async sendWizardStep(
		chatId: string,
		step: Step,
		draft: Draft,
	): Promise<void> {
		const text =
			step === "confirm"
				? `Проверьте профиль:\n${profileSummary(draft.profile ?? {})}\n\nШаг ${stepNumber(step)}/${steps.length}. Сохранить профиль?`
				: wizardPrompt(step, draft);
		await this.client.sendText(chatId, text, wizardKeyboard(step));
	}
	private async sourceWizard(
		chatId: string,
		draft: unknown,
		answer: string,
	): Promise<void> {
		const mode = (draft as { mode?: string }).mode;
		const approved = boolean(answer);
		if (mode !== "allowlist" || approved === undefined)
			return void (await this.client.sendText(
				chatId,
				"Подтвердите переключение на allowlist: да или нет.",
			));
		this.storage.clearBotDialog(chatId);
		if (!approved)
			return void (await this.client.sendText(
				chatId,
				"Режим источников не изменён.",
			));
		this.storage.setSourceMode("allowlist");
		await this.client.sendText(
			chatId,
			"Режим источников: allowlist. Обрабатываются только выбранные источники.",
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
			return void (await this.sendWizardStep(chatId, "confirm", draft));
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
					? `Не удалось сохранить профиль: ${error.message}`
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
		this.deleteProfile(draft.id ?? "");
		await this.client.sendText(chatId, `Профиль «${draft.id}» удалён.`);
	}
	private deleteProfile(id: string): void {
		const profileStore = this.profiles;
		if (!profileStore) return;
		profileStore.saveUserProfiles(
			(profileStore.getUserProfiles() ?? []).filter(
				(profile) => profile.id !== id,
			),
		);
	}
	public getDialog(chatId: string): BotDialogState | undefined {
		return this.storage.getBotDialog(chatId);
	}
}
