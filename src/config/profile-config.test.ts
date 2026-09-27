import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
	compileUserProfile,
	loadSearchProfiles,
	validateProfileConfig,
	writeUserProfileConfig,
} from "./profile-config.js";
import { ProfileStore } from "./profile-store.js";

test("validates, persists, and compiles a user profile", () => {
	const directory = mkdtempSync(join(tmpdir(), "jobot-profiles-"));
	const profilePath = join(directory, "profiles.yaml");

	try {
		const config = validateProfileConfig({
			profiles: [
				{
					id: "c-plus-plus",
					title: "C++ Backend",
					enabled: true,
					primary: ["C++"],
					context: ["vacancy"],
					workFormats: { Remote: ["remote", "distributed"] },
				},
			],
		});

		writeUserProfileConfig(config, profilePath);
		const [profile] = loadSearchProfiles(profilePath);

		assert.equal(profile.id, "c-plus-plus");
		assert.equal(
			profile.keywords.primary[0].test("We need a C++ engineer"),
			true,
		);
		assert.equal(profile.keywords.primary[0].test("C++X engineer"), false);
		assert.equal(
			profile.attributes?.workFormats?.Remote.test("distributed team"),
			true,
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("rejects duplicate profile IDs and an empty primary list", () => {
	assert.throws(
		() =>
			validateProfileConfig({
				profiles: [{ id: "x", title: "X", enabled: true, primary: [] }],
			}),
		/primary must contain at least one term/,
	);
	assert.throws(
		() =>
			validateProfileConfig({
				profiles: [
					{ id: "same", title: "One", enabled: true, primary: ["one"] },
					{ id: "same", title: "Two", enabled: true, primary: ["two"] },
				],
			}),
		/duplicates profile ID/,
	);
});

test("uses no profiles when the user file is absent", () => {
	const directory = mkdtempSync(join(tmpdir(), "jobot-profiles-"));
	try {
		const profiles = loadSearchProfiles(join(directory, "missing.yaml"));
		assert.deepEqual(profiles, []);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("compiles a validated profile without interpreting YAML terms as regex", () => {
	const [profile] = validateProfileConfig({
		profiles: [
			{ id: "literal", title: "Literal", enabled: true, primary: ["react.js"] },
		],
	}).profiles;
	const compiled = compileUserProfile(profile);

	assert.equal(compiled.keywords.primary[0].test("react.js developer"), true);
	assert.equal(compiled.keywords.primary[0].test("reactXjs developer"), false);
});

test("hot-reloads profiles only after a validated atomic write", () => {
	const directory = mkdtempSync(join(tmpdir(), "jobot-profiles-"));
	const profilePath = join(directory, "profiles.yaml");
	const store = new ProfileStore(profilePath);
	try {
		assert.deepEqual(store.get(), []);
		store.saveUserProfiles([
			{ id: "go", title: "Go", enabled: true, primary: ["golang"] },
		]);
		assert.equal(store.get()[0].id, "go");
		assert.throws(() =>
			store.saveUserProfiles([
				{ id: "broken", title: "Broken", enabled: true, primary: [] },
			]),
		);
		assert.equal(store.get()[0].id, "go");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
