export interface MessageSource {
	isGroup: boolean | undefined;
	isChannel: boolean;
}

export function isVacancySource(source: MessageSource): boolean {
	return source.isGroup === true || source.isChannel;
}

export function isAllowedSource(
	chatId: string,
	settings: { mode: "all" | "allowlist" | "denylist"; chatIds: string[] },
): boolean {
	if (settings.mode === "all") return true;
	const listed = settings.chatIds.includes(chatId);
	return settings.mode === "allowlist" ? listed : !listed;
}
