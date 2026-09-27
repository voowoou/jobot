import assert from "node:assert/strict";
import test from "node:test";
import { normalizeVacancyFingerprint, vacancyFingerprint } from "./fingerprint.js";

test("normalizes links, whitespace, case, and common vacancy prefixes", () => {
	assert.equal(normalizeVacancyFingerprint("Вакансия: React developer  https://example.com/a"), "react developer");
	assert.equal(vacancyFingerprint("ИЩЕМ React developer"), vacancyFingerprint("react developer"));
});
