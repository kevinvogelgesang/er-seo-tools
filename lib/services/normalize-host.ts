export function normalizeHost(input: string | null | undefined): string | null {
  if (!input) return null;
  let host = input.trim();
  if (host.includes('://')) {
    try { host = new URL(host).hostname; } catch { /* fall through */ }
  }
  host = host.toLowerCase();
  host = host.split('/')[0].split('?')[0];
  host = host.split(':')[0]; // drop any :port
  host = host.replace(/\.+$/, ''); // drop trailing dot(s) on absolute FQDNs (example.edu. -> example.edu)
  if (host.startsWith('www.')) host = host.slice(4);
  return host || null;
}
