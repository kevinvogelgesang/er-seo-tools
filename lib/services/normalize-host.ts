export function normalizeHost(input: string | null | undefined): string | null {
  if (!input) return null;
  let host = input.trim();
  if (host.includes('://')) {
    try { host = new URL(host).host; } catch { /* fall through */ }
  }
  host = host.toLowerCase();
  host = host.split('/')[0].split('?')[0];
  if (host.startsWith('www.')) host = host.slice(4);
  return host || null;
}
