import input from "input";

import {
	PROFILE_CONFIG_PATH,
	readUserProfileConfig,
	writeUserProfileConfig,
} from "../config/profile-config.js";
import type { ProfileConfig, UserProfile } from "../types/index.js";

function toTerms(value: string): string[] {
	return value
		.split(",")
		.map((term) => term.trim())
		.filter(Boolean);
}

function askText(label: string, defaultValue?: string): Promise<string> {
	return defaultValue === undefined
		? input.text(label)
		: input.text(label, { default: defaultValue });
}

async function askRequired(label: string, initial?: string): Promise<string> {
	while (true) {
		const value = (await askText(label, initial)).trim();
		if (value) {
			return value;
		}

		console.log("Значение обязательно.");
	}
}

function askTerms(
	label: string,
	initial: string[] | undefined,
	required: true,
): Promise<string[]>;
function askTerms(
	label: string,
	initial: string[] | undefined,
	required?: false,
): Promise<string[] | undefined>;
async function askTerms(
	label: string,
	initial: string[] | undefined,
	required = false,
): Promise<string[] | undefined> {
	const hint = initial
		? " (через запятую; - чтобы очистить)"
		: " (через запятую)";

	while (true) {
		const value = (
			await askText(`${label}${hint}`, initial?.join(", "))
		).trim();

		if (value === "-" && !required) {
			return undefined;
		}

		const terms = toTerms(value);
		if (terms.length) {
			return terms;
		}

		if (!required) {
			return undefined;
		}

		console.log("Укажите хотя бы один термин.");
	}
}

async function askEnabled(initial: boolean | undefined): Promise<boolean> {
	const defaultValue = initial === false ? "нет" : "да";

	while (true) {
		const value = (
			await input.text("Включён? (да/нет)", { default: defaultValue })
		)
			.trim()
			.toLowerCase();
		if (["да", "д", "yes", "y"].includes(value)) {
			return true;
		}
		if (["нет", "н", "no", "n"].includes(value)) {
			return false;
		}

		console.log("Введите «да» или «нет».");
	}
}

async function askWorkFormats(
	initial: Record<string, string[]> | undefined,
): Promise<Record<string, string[]> | undefined> {
	const initialNames = initial ? Object.keys(initial) : undefined;
	const names = await askTerms("Форматы работы", initialNames);
	if (!names) {
		return undefined;
	}

	const result: Record<string, string[]> = {};
	for (const name of names) {
		result[name] = await askTerms(
			`Термины для «${name}»`,
			initial?.[name],
			true,
		);
	}

	return result;
}

async function askProfile(initial?: UserProfile): Promise<UserProfile> {
	return {
		id: await askRequired("ID профиля", initial?.id),
		title: await askRequired("Название профиля", initial?.title),
		enabled: await askEnabled(initial?.enabled),
		primary: await askTerms("Основные технологии", initial?.primary, true),
		context: await askTerms("Маркеры вакансии", initial?.context),
		exclude: await askTerms("Исключения", initial?.exclude),
		grades: await askTerms("Грейды", initial?.grades),
		workFormats: await askWorkFormats(initial?.workFormats),
	};
}

function printProfile(profile: UserProfile): void {
	console.log(`\n${profile.id} — ${profile.title}`);
	console.log(`Включён: ${profile.enabled ? "да" : "нет"}`);
	console.log(`Основные технологии: ${profile.primary.join(", ")}`);
	console.log(`Маркеры вакансии: ${profile.context?.join(", ") || "—"}`);
	console.log(`Исключения: ${profile.exclude?.join(", ") || "—"}`);
	console.log(`Грейды: ${profile.grades?.join(", ") || "—"}`);
	console.log(
		`Форматы: ${
			Object.entries(profile.workFormats ?? {})
				.map(([name, terms]) => `${name} (${terms.join(", ")})`)
				.join("; ") || "—"
		}`,
	);
}

async function confirm(message: string): Promise<boolean> {
	const answer = (await input.text(`${message} (да/нет)`, { default: "нет" }))
		.trim()
		.toLowerCase();
	return ["да", "д", "yes", "y"].includes(answer);
}

function getConfig(): ProfileConfig {
	return readUserProfileConfig() ?? { profiles: [] };
}

async function listProfiles(): Promise<void> {
	const config = readUserProfileConfig();
	if (!config || config.profiles.length === 0) {
		console.log(
			"Профилей пока нет. Создайте первый командой pnpm profiles:add.",
		);
		return;
	}

	for (const profile of config.profiles) {
		printProfile(profile);
	}
}

async function addProfile(): Promise<void> {
	const config = getConfig();
	const profile = await askProfile();

	if (config.profiles.some((candidate) => candidate.id === profile.id)) {
		throw new Error(`Профиль с ID «${profile.id}» уже существует.`);
	}

	printProfile(profile);
	if (!(await confirm("Сохранить этот профиль?"))) {
		console.log("Отменено.");
		return;
	}

	writeUserProfileConfig({ profiles: [...config.profiles, profile] });
	console.log(`Профиль сохранён: ${PROFILE_CONFIG_PATH}`);
}

function requireProfileId(): string {
	const id = process.argv[3]?.trim();
	if (!id) {
		throw new Error(
			"Укажите ID профиля: pnpm profiles:edit <id> или pnpm profiles:remove <id>.",
		);
	}
	return id;
}

async function editProfile(): Promise<void> {
	const id = requireProfileId();
	const config = getConfig();
	const index = config.profiles.findIndex((profile) => profile.id === id);
	if (index === -1) {
		throw new Error(`Профиль с ID «${id}» не найден.`);
	}

	const profile = await askProfile(config.profiles[index]);
	if (
		profile.id !== id &&
		config.profiles.some((candidate) => candidate.id === profile.id)
	) {
		throw new Error(`Профиль с ID «${profile.id}» уже существует.`);
	}

	printProfile(profile);
	if (!(await confirm("Сохранить изменения?"))) {
		console.log("Отменено.");
		return;
	}

	const profiles = [...config.profiles];
	profiles[index] = profile;
	writeUserProfileConfig({ profiles });
	console.log(`Профиль обновлён: ${PROFILE_CONFIG_PATH}`);
}

async function removeProfile(): Promise<void> {
	const id = requireProfileId();
	const config = getConfig();
	const profile = config.profiles.find((candidate) => candidate.id === id);
	if (!profile) {
		throw new Error(`Профиль с ID «${id}» не найден.`);
	}

	printProfile(profile);
	if (!(await confirm(`Удалить профиль «${id}»?`))) {
		console.log("Отменено.");
		return;
	}

	writeUserProfileConfig({
		profiles: config.profiles.filter((candidate) => candidate.id !== id),
	});
	console.log(`Профиль удалён: ${PROFILE_CONFIG_PATH}`);
}

function validateProfiles(): void {
	const config = readUserProfileConfig();
	if (!config) {
		console.log(
			"data/profiles.yaml отсутствует. Создайте профиль командой pnpm profiles:add.",
		);
		return;
	}

	console.log(`Конфигурация корректна: ${config.profiles.length} профилей.`);
}

export async function runProfileCli(
	args = process.argv.slice(2),
): Promise<void> {
	switch (args[0]) {
		case "list":
			await listProfiles();
			break;
		case "add":
			await addProfile();
			break;
		case "edit":
			await editProfile();
			break;
		case "remove":
			await removeProfile();
			break;
		case "validate":
			validateProfiles();
			break;
		default:
			throw new Error(
				"Используйте profiles:list, profiles:add, profiles:edit, profiles:remove или profiles:validate.",
			);
	}
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("/profiles/cli.ts")) {
	runProfileCli().catch((error: unknown) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
