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
        /\bвакансия\b/i,
        /\bhiring\b/i,
        /\bищем\b/i,
        /\bjob\b/i,
        /\bmiddle\b/i,
        /\bjunior\b/i,
        /\bintern\b/i,
        /\bстажер\b/i,
      ],
      exclude: [/\bsenior\b/i, /\blead\b/i, /\bhead of\b/i, /\bflutter\b/i],
    },
    attributes: {
      grades: [/\bstag[ee]r\b/i, /\bстажер\b/i, /\bjunior\b/i, /\bmiddle\b/i],
      workFormats: {
        "Удаленка": /\b(remote|удаленка|удаленный|удаленная)\b/i,
        "Офис": /\b(office|офис)\b/i,
        "Гибрид": /\b(hybrid|гибрид)\b/i,
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
