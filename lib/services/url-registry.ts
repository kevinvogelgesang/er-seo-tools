import { UrlRegistry, UrlRegistryEntry, UrlKind, UrlRef } from '../types';
import { normalizeUrl } from './url-normalize';

export class UrlRegistryBuilder {
  private origin: { scheme: string; host: string };
  private hosts: string[] = [];
  private urls: UrlRegistryEntry[] = [];
  private keyToId = new Map<string, number>();

  constructor(origin: { scheme: string; host: string }) {
    this.origin = { scheme: origin.scheme.toLowerCase(), host: origin.host.toLowerCase() };
    this.hostId(this.origin.host);
  }

  private hostId(host: string): number {
    let i = this.hosts.indexOf(host);
    if (i === -1) { i = this.hosts.length; this.hosts.push(host); }
    return i;
  }

  intern(rawUrl: string, kind: UrlKind): UrlRef {
    const n = normalizeUrl(rawUrl);
    const host = n.host || this.origin.host;
    const scheme = n.scheme || this.origin.scheme;
    const key = `${scheme}://${host}${n.path}${n.query ? '?' + n.query : ''}|${n.originalUrl ?? ''}`;
    const existing = this.keyToId.get(key);
    if (existing !== undefined) return existing;
    const id = this.urls.length;
    this.urls.push({
      id, kind, scheme,
      hostId: this.hostId(host),
      path: n.path,
      query: n.query,
      originalUrl: n.host ? n.originalUrl : rawUrl,
    });
    this.keyToId.set(key, id);
    return id;
  }

  build(): UrlRegistry {
    return { sessionOrigin: this.origin, hosts: this.hosts, urls: this.urls };
  }
}

export function rehydrate(reg: UrlRegistry, ref: UrlRef): string {
  const e = reg.urls[ref];
  if (!e) return '';
  if (e.originalUrl && e.path === '') return e.originalUrl;
  const host = reg.hosts[e.hostId] ?? reg.sessionOrigin.host;
  const scheme = e.scheme || reg.sessionOrigin.scheme;
  const q = e.query ? `?${e.query}` : '';
  return `${scheme}://${host}${e.path}${q}`;
}
