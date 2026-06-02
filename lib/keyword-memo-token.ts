// lib/keyword-memo-token.ts
// Stateless JWT signing/verification for the keyword strategy memo share feature.
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const ISSUER = 'er-seo-tools';
const AUDIENCE = 'keyword-strategy-memo';
const EXPIRY_SECONDS = 3600; // 1h
const TOKEN_PREFIX = 'krt_';

/**
 * Dev-only fallback secret. Used ONLY when NODE_ENV !== 'production' and
 * the env var is unset. Production paths throw instead of falling back —
 * see getSecret() below.
 */
const DEV_FALLBACK_SECRET = 'dev-keyword-memo-secret-do-not-use-in-prod';

let didWarnAboutDevFallback = false;

export class KeywordMemoTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeywordMemoTokenError';
  }
}

function getSecret(): Uint8Array {
  const env = process.env.KEYWORD_MEMO_TOKEN_SECRET;
  if (env && env.length > 0) {
    return new TextEncoder().encode(env);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new KeywordMemoTokenError(
      'KEYWORD_MEMO_TOKEN_SECRET is required in production and is unset. Refusing to mint or verify tokens.',
    );
  }
  if (!didWarnAboutDevFallback) {
    // eslint-disable-next-line no-console
    console.warn(
      '[keyword-memo-token] KEYWORD_MEMO_TOKEN_SECRET unset; using dev fallback. Set the env var in production.',
    );
    didWarnAboutDevFallback = true;
  }
  return new TextEncoder().encode(DEV_FALLBACK_SECRET);
}

export interface MintedToken {
  token: string;       // includes the 'krt_' prefix
  expiresAt: string;   // ISO 8601
}

export async function mintKeywordMemoToken(memoId: string): Promise<MintedToken> {
  const secret = getSecret();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + EXPIRY_SECONDS;

  const jwt = await new SignJWT({ scope: ['read', 'memo-write'] })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(memoId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(secret);

  return {
    token: TOKEN_PREFIX + jwt,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

export async function verifyKeywordMemoToken(
  token: string,
  expectedMemoId: string,
): Promise<JWTPayload> {
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new KeywordMemoTokenError('token missing krt_ prefix');
  }
  const jwt = token.slice(TOKEN_PREFIX.length);

  let payload: JWTPayload;
  try {
    const verified = await jwtVerify(jwt, getSecret(), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    payload = verified.payload;
  } catch (err) {
    throw new KeywordMemoTokenError(
      `token verification failed: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }

  if (payload.sub !== expectedMemoId) {
    throw new KeywordMemoTokenError(
      `token sub (${payload.sub}) does not match expected memo id (${expectedMemoId})`,
    );
  }

  return payload;
}
