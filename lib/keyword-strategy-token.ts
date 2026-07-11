// lib/keyword-strategy-token.ts
// Stateless JWT signing/verification for the KS-5 keyword strategy client export.
// Structural clone of lib/keyword-memo-token.ts — deliberately shares
// KEYWORD_MEMO_TOKEN_SECRET with that module (no new prod env var); the
// distinct AUDIENCE is what isolates the two token families from each other.
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const ISSUER = 'er-seo-tools';
const AUDIENCE = 'keyword-strategy-client';
const EXPIRY_SECONDS = 3600; // 1h
const TOKEN_PREFIX = 'kst_';

export const KEYWORD_STRATEGY_TOKEN_SCOPES = ['read', 'memo-write', 'volume-lookup'] as const;

/**
 * Dev-only fallback secret. Used ONLY when NODE_ENV !== 'production' and
 * the env var is unset. Production paths throw instead of falling back —
 * see getSecret() below.
 */
const DEV_FALLBACK_SECRET = 'dev-keyword-memo-secret-do-not-use-in-prod';

let didWarnAboutDevFallback = false;

export class KeywordStrategyTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeywordStrategyTokenError';
  }
}

function getSecret(): Uint8Array {
  const env = process.env.KEYWORD_MEMO_TOKEN_SECRET;
  if (env && env.length > 0) {
    return new TextEncoder().encode(env);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new KeywordStrategyTokenError(
      'KEYWORD_MEMO_TOKEN_SECRET is required in production and is unset. Refusing to mint or verify tokens.',
    );
  }
  if (!didWarnAboutDevFallback) {
    // eslint-disable-next-line no-console
    console.warn(
      '[keyword-strategy-token] KEYWORD_MEMO_TOKEN_SECRET unset; using dev fallback. Set the env var in production.',
    );
    didWarnAboutDevFallback = true;
  }
  return new TextEncoder().encode(DEV_FALLBACK_SECRET);
}

export interface MintedToken {
  token: string;       // includes the 'kst_' prefix
  expiresAt: string;   // ISO 8601
}

export async function mintKeywordStrategyToken(sessionId: string): Promise<MintedToken> {
  const secret = getSecret();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + EXPIRY_SECONDS;

  const jwt = await new SignJWT({ scope: [...KEYWORD_STRATEGY_TOKEN_SCOPES] })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(sessionId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(secret);

  return {
    token: TOKEN_PREFIX + jwt,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

export async function verifyKeywordStrategyToken(
  token: string,
  expectedSessionId: string,
): Promise<JWTPayload> {
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new KeywordStrategyTokenError('token missing kst_ prefix');
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
    throw new KeywordStrategyTokenError(
      `token verification failed: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }

  if (payload.sub !== expectedSessionId) {
    throw new KeywordStrategyTokenError(
      `token sub (${payload.sub}) does not match expected session id (${expectedSessionId})`,
    );
  }

  return payload;
}
