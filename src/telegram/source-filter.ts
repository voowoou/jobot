export interface MessageSource {
	isGroup: boolean | undefined;
	isChannel: boolean;
}

export function isVacancySource(source: MessageSource): boolean {
	return source.isGroup === true || source.isChannel;
}
