import { SEARCH_PROFILES } from "../config/profiles.js";
import type { ParsedVacancy, SearchProfile } from "../types/index.js";

export interface MatchContext {
  directLink?: string;
  sourceTitle?: string;
}

function getMatchedValues(text: string, expressions: RegExp[] | undefined): string[] {
  if (!expressions) {
    return [];
  }

  const values = expressions.flatMap((expression) => {
    const match = text.match(expression)?.[0]?.trim();
    return match ? [match] : [];
  });

  return [...new Set(values)];
}

function matchesProfile(text: string, profile: SearchProfile): boolean {
  const { primary, context, exclude } = profile.keywords;

  if (exclude?.some((expression) => expression.test(text))) {
    return false;
  }

  if (!primary.some((expression) => expression.test(text))) {
    return false;
  }

  return !context || context.some((expression) => expression.test(text));
}

function parseVacancy(profile: SearchProfile, text: string, context: MatchContext): ParsedVacancy {
  const grades = getMatchedValues(text, profile.attributes?.grades);
  const workFormats = Object.entries(profile.attributes?.workFormats ?? {})
    .filter(([, expression]) => expression.test(text))
    .map(([format]) => format);

  return {
    originalText: text,
    profileId: profile.id,
    profileTitle: profile.title,
    sourceTitle: context.sourceTitle,
    grades,
    workFormats,
    matchedKeywords: getMatchedValues(text, profile.keywords.primary),
    directLink: context.directLink ?? "",
  };
}

export function matchVacancy(text: string, context: MatchContext = {}): ParsedVacancy | null {
  const normalizedText = text.trim();

  if (!normalizedText) {
    return null;
  }

  const profile = SEARCH_PROFILES.find(
    (candidate) => candidate.enabled && matchesProfile(normalizedText, candidate),
  );

  return profile ? parseVacancy(profile, normalizedText, context) : null;
}
