import path from 'path';
import { describe, it, expect } from 'vitest';
import { isValidSessionId, getUploadDir, UPLOADS_DIR } from '@/lib/upload-helpers';

describe('isValidSessionId', () => {
  it('accepts a valid UUID v4', () => {
    expect(isValidSessionId('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
  });

  it('accepts a valid UUID v4 (uppercase)', () => {
    expect(isValidSessionId('550E8400-E29B-41D4-A716-446655440000')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidSessionId('')).toBe(false);
  });

  it('rejects a random string', () => {
    expect(isValidSessionId('not-a-uuid-at-all')).toBe(false);
  });

  it('rejects a UUID with wrong length', () => {
    expect(isValidSessionId('550e8400-e29b-41d4-a716-44665544')).toBe(false);
  });

  it('rejects a UUID with wrong version digit (not 4)', () => {
    // version position is "3" instead of "4"
    expect(isValidSessionId('550e8400-e29b-31d4-a716-446655440000')).toBe(false);
  });

  it('rejects a UUID with wrong variant digit', () => {
    // variant position is "0" (must be 8, 9, a, or b)
    expect(isValidSessionId('550e8400-e29b-41d4-0716-446655440000')).toBe(false);
  });

  it('rejects a UUID v1 (version digit is 1)', () => {
    expect(isValidSessionId('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(false);
  });
});

describe('getUploadDir', () => {
  it('returns UPLOADS_DIR joined with the sessionId', () => {
    const sessionId = '550e8400-e29b-41d4-a716-446655440000';
    expect(getUploadDir(sessionId)).toBe(path.join(UPLOADS_DIR, sessionId));
  });
});
