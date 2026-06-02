import { BaseParser } from '../base.parser';
import { ParsedData } from '../../types';
import { GapKeyword } from '../../types';

// ---------------------------------------------------------------------------
// Header aliases
// ---------------------------------------------------------------------------
const KEYWORD_ALIASES = ['Keyword'];
const VOLUME_ALIASES = ['Search Volume', 'Volume'];
const DIFFICULTY_ALIASES = ['Keyword Difficulty', 'Keyword Difficulty %', 'KD', 'KD %'];
const INTENT_ALIASES = ['Intent', 'Keyword Intent', 'Keyword Intents'];

// Headers that must NOT be present — they distinguish Organic Positions, Organic
// Pages, Position Tracking, or other SEMRush exports from the Keyword Gap report.
// NOTE: Real SEMRush "Keyword Gap → Missing" exports typically use 'Volume' and
// 'KD %' as column names.  Validate this list against an actual export before
// deploying to production, as SEMRush occasionally renames columns between UI
// versions.
const DISQUALIFYING_HEADERS = [
  'URL',
  'Landing Page',
  'Page',
  'Position',
  'Previous position',
  'Number of Keywords',
  'Adwords Positions',
  'Average Position',
  'Avg. Position',
  'Estimated Traffic',
];

function normalizeHeaders(headers: string[]): string[] {
  return headers.map(h => h.trim());
}

function parseIntWithCommas(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const str = String(value).replace(/,/g, '');
  const parsed = parseInt(str, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseFloatStrip(value: unknown): number {
  if (value === null || value === undefined || value === '') return 0;
  const str = String(value).replace(/%/g, '').replace(/,/g, '');
  const parsed = parseFloat(str);
  return Number.isFinite(parsed) ? parsed : 0;
}

export interface SemrushKeywordGapResult extends ParsedData {
  gap_keywords: GapKeyword[];
  gap_keywords_count: number;
  total_gap_volume: number;
}

export class SemrushKeywordGapParser extends BaseParser {
  static parserKey = 'semrushkeywordgap';
  static filenamePattern = '';
  static displayName = 'SEMRush Keyword Gap';

  static matchesContent(headers: string[]): boolean {
    if (headers.length === 0) return false;
    const normalized = normalizeHeaders(headers);

    // Must include Keyword
    const hasKeyword = KEYWORD_ALIASES.some(alias =>
      normalized.some(h => h.toLowerCase() === alias.toLowerCase())
    );
    if (!hasKeyword) return false;

    // Must include a volume alias
    const hasVolume = VOLUME_ALIASES.some(alias =>
      normalized.some(h => h.toLowerCase() === alias.toLowerCase())
    );
    if (!hasVolume) return false;

    // Must include a difficulty alias
    const hasDifficulty = DIFFICULTY_ALIASES.some(alias =>
      normalized.some(h => h.toLowerCase() === alias.toLowerCase())
    );
    if (!hasDifficulty) return false;

    // Must NOT include any disqualifying header
    const hasDisqualifying = DISQUALIFYING_HEADERS.some(bad =>
      normalized.some(h => h.toLowerCase() === bad.toLowerCase())
    );
    if (hasDisqualifying) return false;

    return true;
  }

  parse(): SemrushKeywordGapResult {
    if (this.isEmpty) {
      return { gap_keywords: [], gap_keywords_count: 0, total_gap_volume: 0 };
    }

    const keywordCol = this.findColumn(KEYWORD_ALIASES);
    const volumeCol = this.findColumn(VOLUME_ALIASES);
    const difficultyCol = this.findColumn(DIFFICULTY_ALIASES);
    const intentCol = this.findColumn(INTENT_ALIASES);

    const gap_keywords: GapKeyword[] = [];

    for (const row of this.data) {
      const keyword = keywordCol ? String(row[keywordCol] ?? '').trim() : '';
      if (!keyword) continue;

      const volume = parseIntWithCommas(volumeCol ? row[volumeCol] : null);

      const entry: GapKeyword = { keyword, volume };

      if (difficultyCol) {
        const raw = row[difficultyCol];
        if (raw !== null && raw !== undefined && raw !== '') {
          entry.difficulty = parseFloatStrip(raw);
        }
      }

      if (intentCol) {
        const raw = row[intentCol];
        if (raw !== null && raw !== undefined && raw !== '') {
          entry.intent = String(raw).trim();
        }
      }

      gap_keywords.push(entry);
    }

    const total_gap_volume = gap_keywords.reduce((sum, k) => sum + k.volume, 0);

    return {
      gap_keywords,
      gap_keywords_count: gap_keywords.length,
      total_gap_volume,
    };
  }
}
