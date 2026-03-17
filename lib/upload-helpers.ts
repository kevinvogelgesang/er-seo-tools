import path from 'path';

// Where uploaded files are stored. Set UPLOADS_DIR env var on RunCloud for persistence.
export const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(process.cwd(), 'uploads');

export function isValidSessionId(sessionId: string): boolean {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(sessionId);
}

export function getUploadDir(sessionId: string): string {
  return path.join(UPLOADS_DIR, sessionId);
}
