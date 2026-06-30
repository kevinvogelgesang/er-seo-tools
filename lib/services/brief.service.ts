import Papa from 'papaparse';

// =============================================================================
// TYPES
// =============================================================================

interface Page {
  url: string;
  title: string;
  statusCode: number;
  indexability: string;
  wordCount: number;
  inlinks: number;
  h1: string;
  metaDesc: string;
}

interface SchemaEntry {
  url: string;
  schemaType: string;
}

interface Keyword {
  keyword: string;
  volume: number;
  position: number;
  difficulty: number;
  intent: string;
  url: string;
  cpc: number;
}

interface KeywordCategories {
  winning: Keyword[];
  opportunity: Keyword[];
  striking: Keyword[];
  gaps: Keyword[];
}

interface KeywordStats {
  total: number;
  withVolume: number;
  totalVolume: number;
  avgVolume: number;
  withPosition: number;
  avgPosition: number;
  byIntent: Record<string, number>;
}

interface SchemaAnalysis {
  faqPages: string[];
  otherSchema: Record<string, string[]>;
  pagesNeedingFaq: string[];
}

export interface BriefResult {
  brief: string;
  stats: {
    pages: number;
    schemaEntries: number;
    keywords: number;
    outputChars: number;
    estimatedTokens: number;
  };
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

function cleanCsvContent(content: string): string {
  // Remove BOM
  if (content.startsWith('\ufeff')) {
    content = content.slice(1);
  }
  // Normalize line endings
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stripHeaderBlock(content: string): string {
  const lines = content.split('\n');

  // Check if first non-empty line looks like metadata
  let firstContentLine = '';
  for (const line of lines) {
    if (line.trim()) {
      firstContentLine = line.trim();
      break;
    }
  }

  // If first line looks like a normal CSV header, don't strip anything
  if (firstContentLine && firstContentLine.includes(',') && !firstContentLine.startsWith('-') && !firstContentLine.startsWith(';')) {
    if (firstContentLine.startsWith('"') || /^[a-zA-Z]/.test(firstContentLine)) {
      return content;
    }
  }

  // Otherwise, strip metadata block
  let startIdx = 0;
  for (let i = 0; i < lines.length; i++) {
    const stripped = lines[i].trim();

    // Skip metadata lines
    if (stripped.startsWith(';') || stripped.startsWith('---')) {
      startIdx = i + 1;
      continue;
    }
    // Skip lines that look like "Key: Value" metadata
    if (stripped.includes(':') && !stripped.includes(',')) {
      startIdx = i + 1;
      continue;
    }
    // Skip empty lines at the start
    if (!stripped) {
      startIdx = i + 1;
      continue;
    }
    // Found the header row (has commas, starts with text)
    if (stripped.includes(',') && (/^[a-zA-Z]/.test(stripped) || stripped.startsWith('"'))) {
      break;
    }
  }

  return lines.slice(startIdx).join('\n');
}

function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseNumber(value: string | number | null | undefined, defaultVal = 0): number {
  if (value === null || value === undefined) return defaultVal;
  if (typeof value === 'number') return value;
  const str = String(value).toLowerCase();
  if (!str || str === 'n/a' || str === 'na' || str === '-' || str === '') return defaultVal;
  try {
    return Math.floor(parseFloat(str.replace(/,/g, '').replace(/%/g, '')));
  } catch {
    return defaultVal;
  }
}

function parseFloat2(value: string | number | null | undefined, defaultVal = 0): number {
  if (value === null || value === undefined) return defaultVal;
  if (typeof value === 'number') return value;
  const str = String(value).toLowerCase();
  if (!str || str === 'n/a' || str === 'na' || str === '-' || str === '') return defaultVal;
  try {
    return parseFloat(str.replace(/,/g, '').replace(/%/g, ''));
  } catch {
    return defaultVal;
  }
}

function parseCsvFlexible(content: string): Record<string, string>[] {
  content = cleanCsvContent(content);
  content = stripHeaderBlock(content);

  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
  });

  return result.data.map(row => {
    const normalized: Record<string, string> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key) {
        normalized[normalizeHeader(key)] = String(value ?? '');
      }
    }
    return normalized;
  });
}

// =============================================================================
// SCREAMING FROG PARSERS
// =============================================================================

export function parseScreamingFrogInternal(content: string): { pages: Page[] } {
  const rows = parseCsvFlexible(content);
  const pages: Page[] = [];

  for (const row of rows) {
    const url = row.address || row.url || '';
    if (!url || !url.startsWith('http')) continue;

    pages.push({
      url,
      title: row.title1 || row.title || '',
      statusCode: parseNumber(row.statuscode || row.status),
      indexability: row.indexability || row.indexabilitystatus || 'Unknown',
      wordCount: parseNumber(row.wordcount || row.words),
      inlinks: parseNumber(row.inlinks || row.uniqueinlinks),
      h1: row.h11 || row.h1 || '',
      metaDesc: row.metadescription1 || row.metadescription || '',
    });
  }

  return { pages };
}

export function parseScreamingFrogStructuredData(content: string): { schema: SchemaEntry[] } {
  const rows = parseCsvFlexible(content);
  const schemaData: SchemaEntry[] = [];

  for (const row of rows) {
    const url = row.address || row.url || '';
    if (!url) continue;

    // Try single schema type column first
    const schemaType = row.schematype || row.type || row.itemtype || '';

    if (schemaType) {
      schemaData.push({ url, schemaType });
    } else {
      // Handle Type-1, Type-2, etc. format from ScreamingFrog
      for (let i = 1; i <= 14; i++) {
        const typeKey = `type${i}`;
        const type = row[typeKey] || '';
        if (type && type.trim()) {
          schemaData.push({ url, schemaType: type.trim() });
        }
      }
    }
  }

  return { schema: schemaData };
}

// =============================================================================
// SEMRUSH PARSERS
// =============================================================================

export function parseSemrushKeywords(content: string): { keywords: Keyword[]; type: string } {
  content = cleanCsvContent(content);
  content = stripHeaderBlock(content);

  const result = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: true,
  });

  const rows = result.data;
  if (!rows.length) return { keywords: [], type: 'empty' };

  // Detect position tracking format with dynamic column names
  const firstRow = rows[0];
  let positionCol: string | null = null;
  let landingCol: string | null = null;

  for (const col of Object.keys(firstRow)) {
    if (!col) continue;
    const colLower = col.toLowerCase();

    // Position tracking format: *.domain.com/*_YYYYMMDD
    if (/_\d{8}$/.test(col) &&
        !colLower.includes('visibility') &&
        !colLower.includes('difference') &&
        !colLower.includes('type') &&
        !colLower.includes('landing')) {
      positionCol = col;
    }
    if (/_\d{8}_landing$/i.test(col) || (colLower.includes('landing') && !landingCol)) {
      landingCol = col;
    }
    if (colLower === 'position') {
      positionCol = col;
    }
  }

  const exportType = positionCol ? 'position_tracking' : 'keyword_research';
  const keywords: Keyword[] = [];

  const intentMap: Record<string, string> = {
    i: 'informational',
    c: 'commercial',
    t: 'transactional',
    n: 'navigational',
  };

  for (const row of rows) {
    const keyword = row.Keyword || row.keyword || row.Query || row.query || '';
    if (!keyword) continue;

    // Get position from detected column or standard name
    let position = 0;
    if (positionCol && row[positionCol]) {
      position = parseNumber(row[positionCol]);
    } else if (row.Position) {
      position = parseNumber(row.Position);
    }

    // Get landing page URL
    let url = '';
    if (landingCol && row[landingCol]) {
      url = row[landingCol];
    } else {
      url = row.URL || row.url || row['Landing Page'] || '';
    }

    // Normalize intent codes
    let intentRaw = row.Intents || row.Intent || row['Search Intent'] || '';
    if (intentRaw.includes('|')) {
      intentRaw = intentRaw.split('|')[0];
    }
    const intent = intentMap[intentRaw.toLowerCase()] || intentRaw.toLowerCase() || 'unknown';

    // Get volume and difficulty
    const volume = parseNumber(row['Search Volume'] || row.Volume || row.searchvolume);
    const difficulty = parseNumber(row['Keyword Difficulty'] || row.KD || row.Difficulty || row.keyworddifficulty);
    const cpc = parseFloat2(row.CPC || row.cpc);

    keywords.push({
      keyword,
      volume,
      position,
      difficulty,
      intent,
      url,
      cpc,
    });
  }

  return { keywords, type: exportType };
}

// =============================================================================
// ANALYSIS FUNCTIONS
// =============================================================================

const PROGRAM_INDICATORS = [
  'program', 'degree', 'certificate', 'diploma', 'major', 'minor',
  'nursing', 'dental', 'medical', 'hvac', 'welding', 'cosmetology',
  'business', 'accounting', 'marketing', 'mba', 'computer', 'engineering',
  'education', 'criminal-justice', 'healthcare', 'paralegal', 'pharmacy',
  'radiology', 'respiratory', 'surgical', 'veterinary', 'automotive',
  'electrical', 'plumbing', 'carpentry', 'culinary', 'massage',
  'phlebotomy', 'emt', 'paramedic', 'cna', 'lpn', 'lvn', 'rn', 'bsn',
];

function identifyPrograms(pages: Page[]): Page[] {
  const programs: Page[] = [];
  const seenUrls = new Set<string>();

  for (const page of pages) {
    const urlLower = page.url.toLowerCase();
    const titleLower = page.title.toLowerCase();

    // Skip non-indexable, error pages, and duplicates
    if (page.statusCode >= 400) continue;
    if (page.indexability.toLowerCase() === 'non-indexable') continue;
    if (seenUrls.has(urlLower)) continue;

    // Check if it's a program page
    let isProgram = false;
    for (const indicator of PROGRAM_INDICATORS) {
      if (urlLower.includes(indicator) || titleLower.includes(indicator)) {
        isProgram = true;
        break;
      }
    }

    if (isProgram) {
      seenUrls.add(urlLower);
      programs.push(page);
    }
  }

  // Sort by inlinks (authority proxy)
  programs.sort((a, b) => b.inlinks - a.inlinks);
  return programs;
}

function analyzeSchemaConverage(schemaData: SchemaEntry[], pages: Page[], programPages: Page[]): SchemaAnalysis {
  const faqPages = new Set<string>();
  const otherSchema: Record<string, string[]> = {};

  for (const item of schemaData) {
    const schemaType = item.schemaType.toLowerCase();
    const url = item.url;

    if (schemaType.includes('faq')) {
      faqPages.add(url);
    } else {
      // Simplify schema type name
      const simpleType = schemaType.replace('https://schema.org/', '').replace('http://schema.org/', '');
      if (!otherSchema[simpleType]) {
        otherSchema[simpleType] = [];
      }
      otherSchema[simpleType].push(url);
    }
  }

  // Find high-value pages without FAQ
  const pagesNeedingFaq: string[] = [];

  for (const prog of programPages.slice(0, 30)) {
    if (!faqPages.has(prog.url)) {
      pagesNeedingFaq.push(prog.url);
    }
  }

  return {
    faqPages: Array.from(faqPages),
    otherSchema,
    pagesNeedingFaq: pagesNeedingFaq.slice(0, 10),
  };
}

function categorizeKeywords(keywords: Keyword[]): KeywordCategories {
  const winning: Keyword[] = [];
  const opportunity: Keyword[] = [];
  const striking: Keyword[] = [];
  const gaps: Keyword[] = [];

  for (const kw of keywords) {
    const pos = kw.position;
    const volume = kw.volume;

    if (volume < 10) continue; // Skip very low volume

    if (pos >= 1 && pos <= 10) {
      winning.push(kw);
    } else if (pos >= 11 && pos <= 20) {
      opportunity.push(kw);
    } else if (pos >= 21 && pos <= 30) {
      striking.push(kw);
    } else if (pos === 0 || pos > 100) {
      gaps.push(kw);
    }
  }

  // Sort each by volume
  winning.sort((a, b) => b.volume - a.volume);
  opportunity.sort((a, b) => b.volume - a.volume);
  striking.sort((a, b) => b.volume - a.volume);
  gaps.sort((a, b) => b.volume - a.volume);

  return { winning, opportunity, striking, gaps };
}

function calculateKeywordStats(keywords: Keyword[]): KeywordStats {
  if (!keywords.length) {
    return {
      total: 0,
      withVolume: 0,
      totalVolume: 0,
      avgVolume: 0,
      withPosition: 0,
      avgPosition: 0,
      byIntent: {},
    };
  }

  const volumes = keywords.filter(kw => kw.volume > 0).map(kw => kw.volume);
  const positions = keywords.filter(kw => kw.position > 0 && kw.position <= 100).map(kw => kw.position);

  const byIntent: Record<string, number> = {};
  for (const kw of keywords) {
    const intent = kw.intent || 'unknown';
    byIntent[intent] = (byIntent[intent] || 0) + 1;
  }

  return {
    total: keywords.length,
    withVolume: volumes.length,
    totalVolume: volumes.reduce((a, b) => a + b, 0),
    avgVolume: volumes.length ? Math.floor(volumes.reduce((a, b) => a + b, 0) / volumes.length) : 0,
    withPosition: positions.length,
    avgPosition: positions.length ? positions.reduce((a, b) => a + b, 0) / positions.length : 0,
    byIntent,
  };
}

// =============================================================================
// BRIEF GENERATION
// =============================================================================

export function generateBrief(
  clientName: string,
  pages: Page[],
  schemaData: SchemaEntry[],
  keywords: Keyword[],
): BriefResult {
  const lines: string[] = [];

  lines.push(`# SEO Data Brief: ${clientName}`);
  lines.push('*Generated for Claude keyword strategy analysis*\n');
  lines.push('---\n');

  // =========================
  // SITE STRUCTURE SECTION
  // =========================
  lines.push('## Site Structure\n');

  const programs = identifyPrograms(pages);

  if (pages.length) {
    const indexable = pages.filter(
      p => p.indexability.toLowerCase() !== 'non-indexable' && p.statusCode < 400
    );
    const orphaned = indexable.filter(p => p.inlinks === 0);


    lines.push(`- **Total pages crawled:** ${pages.length}`);
    lines.push(`- **Indexable pages:** ${indexable.length}`);
    lines.push(`- **Program pages identified:** ${programs.length}`);
    lines.push(`- **Orphaned pages (0 inlinks):** ${orphaned.length}`);
    lines.push('');

    if (programs.length) {
      lines.push('### Program Pages (Top 15 by internal links)\n');
      lines.push('| URL | Title | Words | Links |');
      lines.push('|-----|-------|-------|-------|');
      for (const prog of programs.slice(0, 15)) {
        const urlShort = prog.url.length > 60 ? prog.url.slice(0, 60) + '...' : prog.url;
        const titleShort = prog.title.length > 40 ? prog.title.slice(0, 40) + '...' : prog.title;
        lines.push(`| ${urlShort} | ${titleShort} | ${prog.wordCount} | ${prog.inlinks} |`);
      }
      lines.push('');
    }
  } else {
    lines.push('*No crawl data provided*\n');
  }

  // =========================
  // SCHEMA COVERAGE SECTION
  // =========================
  lines.push('## Schema Coverage\n');

  if (schemaData.length) {
    const analysis = analyzeSchemaConverage(schemaData, pages, programs);

    lines.push(`- **Pages with FAQ schema:** ${analysis.faqPages.length}`);

    if (Object.keys(analysis.otherSchema).length) {
      const otherSummary = Object.entries(analysis.otherSchema)
        .slice(0, 5)
        .map(([k, v]) => `${k} (${v.length})`)
        .join(', ');
      lines.push(`- **Other schema types:** ${otherSummary}`);
    }

    if (analysis.faqPages.length) {
      lines.push('\n### Pages WITH FAQ Schema');
      for (const url of analysis.faqPages.slice(0, 10)) {
        lines.push(`- ${url}`);
      }
    }

    if (analysis.pagesNeedingFaq.length) {
      lines.push('\n### High-Value Pages MISSING FAQ Schema');
      for (const url of analysis.pagesNeedingFaq) {
        lines.push(`- ${url}`);
      }
    }
    lines.push('');
  } else {
    lines.push('*No structured data export provided*\n');
  }

  // =========================
  // KEYWORD DATA SECTION
  // =========================
  lines.push('## Keyword Performance\n');

  if (keywords.length) {
    const stats = calculateKeywordStats(keywords);
    const cats = categorizeKeywords(keywords);

    lines.push(`- **Total keywords:** ${stats.total}`);
    lines.push(`- **Total search volume:** ${stats.totalVolume.toLocaleString()}`);
    if (Object.keys(stats.byIntent).length) {
      const intentStr = Object.entries(stats.byIntent)
        .map(([k, v]) => `${k}: ${v}`)
        .join(', ');
      lines.push(`- **By intent:** ${intentStr}`);
    }
    lines.push('');

    lines.push('### Position Distribution');
    lines.push(`- **Winning (1-10):** ${cats.winning.length} keywords`);
    lines.push(`- **Opportunity (11-20):** ${cats.opportunity.length} keywords`);
    lines.push(`- **Striking Distance (21-30):** ${cats.striking.length} keywords`);
    lines.push(`- **Not Ranking / Gaps:** ${cats.gaps.length} keywords`);
    lines.push('');

    // Top Wins
    if (cats.winning.length) {
      lines.push('### Current Wins (Position 1-10, Top 15 by Volume)\n');
      lines.push('| Keyword | Pos | Volume | Intent |');
      lines.push('|---------|-----|--------|--------|');
      for (const kw of cats.winning.slice(0, 15)) {
        const intentCode = (kw.intent || 'U')[0].toUpperCase();
        lines.push(`| ${kw.keyword} | ${kw.position} | ${kw.volume.toLocaleString()} | ${intentCode} |`);
      }
      lines.push('');
    }

    // Top Opportunities (11-20)
    if (cats.opportunity.length) {
      lines.push('### Quick Win Opportunities (Position 11-20, Top 20 by Volume)\n');
      lines.push('| Keyword | Pos | Volume | Intent |');
      lines.push('|---------|-----|--------|--------|');
      for (const kw of cats.opportunity.slice(0, 20)) {
        const intentCode = (kw.intent || 'U')[0].toUpperCase();
        lines.push(`| ${kw.keyword} | ${kw.position} | ${kw.volume.toLocaleString()} | ${intentCode} |`);
      }
      lines.push('');
    }

    // Striking Distance (21-30)
    if (cats.striking.length) {
      lines.push('### Striking Distance (Position 21-30, Top 15 by Volume)\n');
      lines.push('| Keyword | Pos | Volume | Intent |');
      lines.push('|---------|-----|--------|--------|');
      for (const kw of cats.striking.slice(0, 15)) {
        const intentCode = (kw.intent || 'U')[0].toUpperCase();
        lines.push(`| ${kw.keyword} | ${kw.position} | ${kw.volume.toLocaleString()} | ${intentCode} |`);
      }
      lines.push('');
    }

    // Gaps (not ranking)
    if (cats.gaps.length) {
      lines.push('### Keyword Gaps (Not Ranking, Top 20 by Volume)\n');
      lines.push('| Keyword | Volume | Difficulty | Intent |');
      lines.push('|---------|--------|------------|--------|');
      for (const kw of cats.gaps.slice(0, 20)) {
        const intentCode = (kw.intent || 'U')[0].toUpperCase();
        lines.push(`| ${kw.keyword} | ${kw.volume.toLocaleString()} | ${kw.difficulty || 'N/A'} | ${intentCode} |`);
      }
      lines.push('');
    }
  } else {
    lines.push('*No keyword data provided*\n');
  }

  // =========================
  // ANALYSIS PROMPTS
  // =========================
  lines.push('---\n');
  lines.push('## Analysis Request\n');
  lines.push('Using the data above and your reference documents, please generate:');
  lines.push('1. **Strategy Overview** - Summarize opportunities and recommended focus areas');
  lines.push('2. **Current Gaps Analysis** - Identify highest-value gaps to address');
  lines.push('3. **Quick Wins** - Pages/keywords at positions 11-20 to prioritize');
  lines.push('4. **100 Keyword Targets** - Organized by program area with intent codes');
  lines.push('5. **FAQ Recommendations** - 5 pages that should add FAQ schema with suggested questions');
  lines.push('6. **Keyword List** - Line-separated for SEMRush import');
  lines.push('');

  const brief = lines.join('\n');

  return {
    brief,
    stats: {
      pages: pages.length,
      schemaEntries: schemaData.length,
      keywords: keywords.length,
      outputChars: brief.length,
      estimatedTokens: Math.ceil(brief.length / 4),
    },
  };
}

// =============================================================================
// MAIN SERVICE CLASS
// =============================================================================

export class BriefService {
  private pages: Page[] = [];
  private schemaData: SchemaEntry[] = [];
  private keywords: Keyword[] = [];
  private keywordType = 'unknown';

  parseInternalCsv(content: string): number {
    const result = parseScreamingFrogInternal(content);
    this.pages = result.pages;
    return this.pages.length;
  }

  parseStructuredDataCsv(content: string): number {
    const result = parseScreamingFrogStructuredData(content);
    this.schemaData = result.schema;
    return this.schemaData.length;
  }

  parseSemrushCsv(content: string): number {
    const result = parseSemrushKeywords(content);
    // Merge with existing keywords, deduplicating
    const seen = new Set(this.keywords.map(kw => kw.keyword.toLowerCase()));
    for (const kw of result.keywords) {
      const key = kw.keyword.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        this.keywords.push(kw);
      }
    }
    this.keywordType = result.type;
    return result.keywords.length;
  }

  generate(clientName: string): BriefResult {
    return generateBrief(clientName, this.pages, this.schemaData, this.keywords);
  }

  reset(): void {
    this.pages = [];
    this.schemaData = [];
    this.keywords = [];
    this.keywordType = 'unknown';
  }
}
