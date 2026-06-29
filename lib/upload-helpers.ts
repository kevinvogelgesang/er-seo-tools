import path from 'path';
import type { NextRequest } from 'next/server';

// Where uploaded files are stored. Set UPLOADS_DIR env var on RunCloud for persistence.
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');

/**
 * Best client IP for upload-quota keying. Prefers Cloudflare's CF-Connecting-IP
 * (origin only accepts Cloudflare traffic; CF sets the real client IP, not
 * spoofable like the first X-Forwarded-For value), then x-real-ip, then the
 * first XFF value, for local/dev where Cloudflare isn't in front.
 */
export function getClientIp(request: NextRequest): string {
  const cfIp = request.headers.get('cf-connecting-ip')?.trim();
  if (cfIp) return cfIp;
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  return request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export function isValidSessionId(sessionId: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(sessionId);
}

export function getUploadDir(sessionId: string): string {
  return path.join(UPLOADS_DIR, sessionId);
}
