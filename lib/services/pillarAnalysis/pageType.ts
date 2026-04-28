// lib/services/pillarAnalysis/pageType.ts
import type { PageType } from './types';

export interface PageTypeInput {
  url: string;
  schemaTypes: string[]; // schema.org @type values found on the page
  crawlDepth: number | null;
}

export interface PageTypeResult {
  pageType: PageType;
  pageTypeConfidence: number;
}

const SLUG_RULES: Array<{ pattern: RegExp; type: PageType }> = [
  { pattern: /\/programs?\//i, type: 'program' },
  { pattern: /\/(blog|news)\//i, type: 'blog' },
  { pattern: /\/(resources?|career[-_]guides?|guides?)\//i, type: 'resource' },
  { pattern: /\/(about|contact|team|staff|leadership|careers)(\/|$)/i, type: 'nav' },
];

const SCHEMA_RULES: Record<string, PageType> = {
  Course: 'program',
  EducationalOccupationalProgram: 'program',
  Article: 'blog',
  BlogPosting: 'blog',
  NewsArticle: 'news',
};

export function classifyPageType(input: PageTypeInput): PageTypeResult {
  const path = safeUrlPath(input.url);

  // Homepage
  if (path === '/' || path === '') {
    return { pageType: 'home', pageTypeConfidence: 0.95 };
  }

  // 1. URL-slug primary (high confidence when matched)
  const slugMatches = SLUG_RULES.filter((r) => r.pattern.test(path));
  if (slugMatches.length === 1) {
    return { pageType: slugMatches[0].type, pageTypeConfidence: 0.85 };
  }
  // If multiple slug rules match (ambiguous), fall through to schema

  // 2. Schema.org tiebreaker (medium confidence)
  for (const schemaType of input.schemaTypes) {
    if (schemaType in SCHEMA_RULES) {
      return { pageType: SCHEMA_RULES[schemaType], pageTypeConfidence: 0.7 };
    }
  }

  // 3. Crawl-depth tertiary (low confidence)
  const depth = input.crawlDepth ?? 99;
  if (depth <= 2) {
    return { pageType: 'nav', pageTypeConfidence: 0.4 };
  }

  return { pageType: 'unknown', pageTypeConfidence: 0.2 };
}

function safeUrlPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
