import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { parse, stringify } from "yaml";

import { DEFAULT_SEARCH_PROFILES } from "./profiles.js";
import type { ProfileConfig, SearchProfile, UserProfile } from "../types/index.js";

export const PROFILE_CONFIG_PATH = resolve(process.cwd(), "data", "profiles.yaml");
const WORD_EDGE = "[^\\p{L}\\p{N}_]";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(path: string, message: string): never {
  throw new Error(`Invalid profile configuration: ${path} ${message}`);
}

function readString(value: unknown, path: string): string {
  if (typeof value !== "string" || !value.trim()) {
    fail(path, "must be a non-empty string");
  }

  return value.trim();
}

function readStringList(value: unknown, path: string, required = false): string[] | undefined {
  if (value === undefined) {
    if (required) {
      fail(path, "is required");
    }

    return undefined;
  }

  if (!Array.isArray(value)) {
    fail(path, "must be a list of non-empty strings");
  }

  const items = value.map((item, index) => readString(item, `${path}[${index}]`));

  if (required && items.length === 0) {
    fail(path, "must contain at least one term");
  }

  return items;
}

function readWorkFormats(value: unknown, path: string): Record<string, string[]> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    fail(path, "must be an object whose values are lists of strings");
  }

  return Object.fromEntries(
    Object.entries(value).map(([format, terms]) => {
      const name = readString(format, `${path} key`);
      const list = readStringList(terms, `${path}.${name}`, true)!;
      return [name, list];
    }),
  );
}

function validateProfile(value: unknown, index: number, ids: Set<string>): UserProfile {
  const path = `profiles[${index}]`;

  if (!isRecord(value)) {
    fail(path, "must be an object");
  }

  const id = readString(value.id, `${path}.id`);
  if (ids.has(id)) {
    fail(`${path}.id`, `duplicates profile ID \"${id}\"`);
  }
  ids.add(id);

  if (typeof value.enabled !== "boolean") {
    fail(`${path}.enabled`, "must be a boolean");
  }

  return {
    id,
    title: readString(value.title, `${path}.title`),
    enabled: value.enabled,
    primary: readStringList(value.primary, `${path}.primary`, true)!,
    context: readStringList(value.context, `${path}.context`),
    exclude: readStringList(value.exclude, `${path}.exclude`),
    grades: readStringList(value.grades, `${path}.grades`),
    workFormats: readWorkFormats(value.workFormats, `${path}.workFormats`),
  };
}

export function validateProfileConfig(value: unknown): ProfileConfig {
  if (!isRecord(value)) {
    fail("root", "must be an object with a profiles list");
  }

  if (!Array.isArray(value.profiles)) {
    fail("profiles", "must be a list");
  }

  const ids = new Set<string>();
  return { profiles: value.profiles.map((profile, index) => validateProfile(profile, index, ids)) };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Converts a plain YAML term into a case-insensitive, Unicode word-safe expression. */
export function compileSearchTerm(term: string): RegExp {
  return new RegExp(`(?:^|${WORD_EDGE})${escapeRegExp(term)}(?=$|${WORD_EDGE})`, "iu");
}

function compileWorkFormatTerms(terms: string[]): RegExp {
  const alternatives = terms.map(
    (term) => `(?:^|${WORD_EDGE})${escapeRegExp(term)}(?=$|${WORD_EDGE})`,
  );
  return new RegExp(alternatives.join("|"), "iu");
}

export function compileUserProfile(profile: UserProfile): SearchProfile {
  const compileTerms = (terms: string[] | undefined): RegExp[] | undefined => terms?.map(compileSearchTerm);
  const workFormats = profile.workFormats
    ? Object.fromEntries(
        Object.entries(profile.workFormats).map(([format, terms]) => [format, compileWorkFormatTerms(terms)]),
      )
    : undefined;

  return {
    id: profile.id,
    title: profile.title,
    enabled: profile.enabled,
    keywords: {
      primary: compileTerms(profile.primary)!,
      context: compileTerms(profile.context),
      exclude: compileTerms(profile.exclude),
    },
    attributes: {
      grades: compileTerms(profile.grades),
      workFormats,
    },
  };
}

export function readUserProfileConfig(profilePath = PROFILE_CONFIG_PATH): ProfileConfig | undefined {
  let rawConfig: string;

  try {
    rawConfig = readFileSync(profilePath, "utf8");
  } catch (error: unknown) {
    if (isRecord(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }

  if (!rawConfig.trim()) {
    return { profiles: [] };
  }

  let parsed: unknown;
  try {
    parsed = parse(rawConfig);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to parse profile configuration at ${profilePath}: ${message}`);
  }

  return validateProfileConfig(parsed);
}

export function writeUserProfileConfig(config: ProfileConfig, profilePath = PROFILE_CONFIG_PATH): void {
  const validated = validateProfileConfig(config);
  const directory = dirname(profilePath);
  const temporaryPath = `${profilePath}.${process.pid}.${Date.now()}.tmp`;

  mkdirSync(directory, { recursive: true });
  writeFileSync(temporaryPath, stringify(validated), "utf8");
  renameSync(temporaryPath, profilePath);
}

export function loadSearchProfiles(profilePath = PROFILE_CONFIG_PATH): SearchProfile[] {
  const config = readUserProfileConfig(profilePath);
  return !config || config.profiles.length === 0
    ? DEFAULT_SEARCH_PROFILES
    : config.profiles.map(compileUserProfile);
}
