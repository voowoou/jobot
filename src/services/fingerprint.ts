import { createHash } from "node:crypto";

/** Conservative normalization for optional cross-channel duplicate suppression. */
export function normalizeVacancyFingerprint(text: string): string {
	return text
		.toLowerCase()
		.replace(/https?:\/\/\S+/gu, " ")
		.replace(/^(вакансия|ищем|job)\s*[:\-—]*/u, "")
		.replace(/\s+/gu, " ")
		.trim();
}

export function vacancyFingerprint(text: string): string {
	return createHash("sha256").update(normalizeVacancyFingerprint(text)).digest("hex");
}
