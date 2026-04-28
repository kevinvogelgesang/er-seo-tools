// lib/services/pillarAnalysis/topicNaming.ts
import type { UrlRecord } from './types';

const STOPWORDS = new Set([
  'the','a','an','and','or','but','of','for','to','in','on','at','by','with','from','as','is','are','was','were','be','been','being','it','this','that','these','those','your','our','their','his','her','its','do','does','did','doing','have','has','had','having','will','would','should','could','can','may','might','must','i','you','he','she','we','they','what','which','who','whom','how','why','when','where','about','into','through','during','before','after','above','below','between','among','than','also','more','most','some','any','all','each','every','no','not','only','same','so','than','too','very','just','off','out','over','under','again','further','then','once','here','there','up','down','if','because','while','until','since','though','although','unless','whether','near','within','without','among','via','plus','even','let','says','said','get','got','vs','versus','best','top','review','tips','guide','guides','how','what','why','when','where',
]);

export function nameClusters(records: UrlRecord[]): Map<number, string> {
  const out = new Map<number, string>();
  const byCluster = new Map<number, UrlRecord[]>();
  for (const r of records) {
    if (r.topicClusterId == null || r.topicClusterId < 0) continue;
    const arr = byCluster.get(r.topicClusterId) ?? [];
    arr.push(r);
    byCluster.set(r.topicClusterId, arr);
  }

  for (const [id, members] of byCluster.entries()) {
    const counts = new Map<string, number>();
    for (const m of members) {
      const tokens = tokenize(`${m.title || ''} ${m.h1 || ''}`);
      for (const t of tokens) {
        counts.set(t, (counts.get(t) ?? 0) + 1);
      }
    }
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 3).map(([t]) => t);
    if (top.length === 0) {
      out.set(id, `Cluster ${id + 1}`);
      continue;
    }
    out.set(id, top.map(capitalize).join(' '));
  }
  return out;
}

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

function capitalize(s: string): string {
  return s[0].toUpperCase() + s.slice(1);
}
