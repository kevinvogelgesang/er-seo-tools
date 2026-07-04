export type ParserClass = {
  name: string;
  filenamePattern: string | string[];
  parserKey: string;
  streaming?: boolean;
  matchesFile(filename: string): boolean;
  matchesContent(headers: string[]): boolean;
  matchesRawContent(rawContent: string): boolean;
};

/** Build the case-insensitive lookup map exactly as BaseParser did:
 *  original-case + lowercase key per header, in order (later duplicates overwrite). */
export function buildHeaderMap(headers: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const h of headers) {
    map.set(h, h);
    map.set(h.toLowerCase(), h);
  }
  return map;
}

export function findColumnInMap(map: Map<string, string>, names: string[]): string | null {
  for (const name of names) {
    const found = map.get(name) ?? map.get(name.toLowerCase());
    if (found !== undefined) return found;
  }
  return null;
}

export function mostCommonHostname(counts: Map<string, number>): string | null {
  if (counts.size === 0) return null;
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
}

export function filenameMatches(pattern: string | string[], filename: string): boolean {
  if (!pattern) return false;
  const lower = filename.toLowerCase();
  if (Array.isArray(pattern)) {
    return pattern.some((p) => lower.includes(p.toLowerCase()));
  }
  return lower.includes(pattern.toLowerCase());
}
