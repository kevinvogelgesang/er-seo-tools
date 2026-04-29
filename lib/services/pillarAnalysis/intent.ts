// lib/services/pillarAnalysis/intent.ts
import type { IntentClass, PageType } from './types';

export interface IntentInput {
  title: string | null;
  h1: string | null;
  url: string;
  pageType: PageType;
  schemaTypes: string[];
}

export interface IntentResult {
  intentClass: IntentClass;
  intentConfidence: number;
}

const INFORMATIONAL_PATTERNS = [
  /\bhow to\b/i,
  /\bwhat is\b/i,
  /\bguide\b/i,
  /\btips\b/i,
  /\b(vs\.?|versus)\b/i,
  /\bexamples?\b/i,
  /\?\s*$/,
];

const COMMERCIAL_PATTERNS = [
  /\bbest\b/i,
  /\btop\s*\d*\b/i,
  /\breview\b/i,
  /\bcost of\b/i,
  /\bpricing\b/i,
];

const TRANSACTIONAL_PATTERNS = [
  /\bapply\b/i,
  /\benroll\b/i,
  /\bregister\b/i,
];

const TRANSACTIONAL_SCHEMAS = ['Course', 'EducationalOccupationalProgram'];

export function classifyIntent(input: IntentInput): IntentResult {
  const text = `${input.title || ''} ${input.h1 || ''}`;

  let infoHits = 0;
  let commHits = 0;
  let transHits = 0;

  for (const p of INFORMATIONAL_PATTERNS) if (p.test(text)) infoHits++;
  for (const p of COMMERCIAL_PATTERNS) if (p.test(text)) commHits++;
  for (const p of TRANSACTIONAL_PATTERNS) if (p.test(text)) transHits++;

  // Schema gives a strong transactional boost on program-like pages
  if (input.schemaTypes.some((s) => TRANSACTIONAL_SCHEMAS.includes(s))) {
    transHits += 2;
  }
  if (input.pageType === 'program') {
    transHits += 1;
  }

  const totalHits = infoHits + commHits + transHits;

  // No rules fired → fall back to pageType default
  if (totalHits === 0) {
    return { ...defaultByPageType(input.pageType), intentConfidence: 0.5 };
  }

  // Pick the winning class
  const hits = { informational: infoHits, commercial: commHits, transactional: transHits };
  const winner = (Object.keys(hits) as Array<keyof typeof hits>)
    .reduce((a, b) => (hits[a] > hits[b] ? a : b));

  // Confidence: dominant class share, capped 0.95
  // If there's conflict (runner-up has equal hits), lower the confidence significantly
  const sortedHits = Object.values(hits).sort((a, b) => b - a);
  const hasConflict = sortedHits.length > 1 && sortedHits[0] === sortedHits[1];

  const dominantShare = hits[winner] / totalHits;
  let confidence = Math.min(0.95, 0.5 + dominantShare * 0.45);

  if (hasConflict) {
    confidence = Math.max(0.4, confidence * 0.6); // Reduce confidence by 40% if conflicting
  }

  return { intentClass: winner as IntentClass, intentConfidence: confidence };
}

function defaultByPageType(pt: PageType): { intentClass: IntentClass } {
  switch (pt) {
    case 'program': return { intentClass: 'transactional' };
    case 'blog':
    case 'news':
    case 'resource': return { intentClass: 'informational' };
    case 'nav':
    case 'home': return { intentClass: 'navigational' };
    default: return { intentClass: 'unknown' };
  }
}
