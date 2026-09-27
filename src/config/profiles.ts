import type { SearchProfile } from "../types/index.js";

export const SEARCH_PROFILES: SearchProfile[] = [
  {
    id: "frontend",
    title: "Frontend (React / JS)",
    enabled: true,
    keywords: {
      primary: [
        /\breact(\.js)?\b/i,
        /\bnext(\.js)?\b/i,
        /\bjavascript\b/i,
        /\bfrontend\b/i,
        /\bfront-end\b/i,
      ],
      context: [
        /(?:^|[^\p{L}\p{N}_])вакансия(?![\p{L}\p{N}_])/iu,
        /\bhiring\b/i,
        /(?:^|[^\p{L}\p{N}_])ищем(?![\p{L}\p{N}_])/iu,
        /\bjob\b/i,
        /\bmiddle\b/i,
        /\bjunior\b/i,
        /\bintern\b/i,
        /(?:^|[^\p{L}\p{N}_])стаж[её]р(?![\p{L}\p{N}_])/iu,
      ],
      exclude: [/\bsenior\b/i, /\blead\b/i, /\bhead of\b/i, /\bflutter\b/i],
    },
    attributes: {
      grades: [
        /\bstag[ee]r\b/i,
        /(?:^|[^\p{L}\p{N}_])стаж[её]р(?![\p{L}\p{N}_])/iu,
        /\bjunior\b/i,
        /\bmiddle\b/i,
      ],
      workFormats: {
        "Удаленка": /(?:\bremote\b|(?:^|[^\p{L}\p{N}_])удал[её]н(?:ка|ный|ная)(?![\p{L}\p{N}_]))/iu,
        "Офис": /(?:\boffice\b|(?:^|[^\p{L}\p{N}_])офис(?![\p{L}\p{N}_]))/iu,
        "Гибрид": /(?:\bhybrid\b|(?:^|[^\p{L}\p{N}_])гибрид(?![\p{L}\p{N}_]))/iu,
      },
    },
  },
  {
    id: "fullstack",
    title: "Fullstack Node.js + React",
    enabled: false,
    keywords: {
      primary: [/\bfullstack\b/i, /\bnode\.?js\b/i],
    },
  },
];
