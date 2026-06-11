// lib/quarter-push-token.ts
// Stateless JWT signing/verification for the quarter-cycle Teamwork push handoff (B5).
// Mirrors lib/seo-roadmap-token.ts (srt_) — same envelope, qct_ prefix.
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const ISSUER = 'er-seo-tools';
const AUDIENCE = 'quarter-cycle-push';
const EXPIRY_SECONDS = 3600; // 1h
const TOKEN_PREFIX = 'qct_';

/**
 * Dev-only fallback secret. Used ONLY when NODE_ENV !== 'production' and
 * the env var is unset. Production paths throw instead of falling back —
 * see getSecret() below.
 */
const DEV_FALLBACK_SECRET = 'dev-quarter-push-secret-do-not-use-in-prod';

let didWarnAboutDevFallback = false;

export class QuarterPushTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuarterPushTokenError';
  }
}

function getSecret(): Uint8Array {
  const env = process.env.QUARTER_PUSH_TOKEN_SECRET;
  if (env && env.length > 0) {
    return new TextEncoder().encode(env);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new QuarterPushTokenError(
      'QUARTER_PUSH_TOKEN_SECRET is required in production and is unset. Refusing to mint or verify tokens.',
    );
  }
  if (!didWarnAboutDevFallback) {
    // eslint-disable-next-line no-console
    console.warn(
      '[quarter-push-token] QUARTER_PUSH_TOKEN_SECRET unset; using dev fallback. Set the env var in production.',
    );
    didWarnAboutDevFallback = true;
  }
  return new TextEncoder().encode(DEV_FALLBACK_SECRET);
}

export interface MintedToken {
  token: string;       // includes the 'qct_' prefix
  expiresAt: string;   // ISO 8601
}

export async function mintQuarterPushToken(planId: string): Promise<MintedToken> {
  const secret = getSecret();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + EXPIRY_SECONDS;

  const jwt = await new SignJWT({ scope: ['read', 'receipt-write'] })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(planId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(secret);

  return {
    token: TOKEN_PREFIX + jwt,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

export async function verifyQuarterPushToken(
  token: string,
  expectedPlanId: string,
): Promise<JWTPayload> {
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new QuarterPushTokenError('token missing qct_ prefix');
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
    throw new QuarterPushTokenError(
      `token verification failed: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }

  if (payload.sub !== expectedPlanId) {
    throw new QuarterPushTokenError(
      `token sub (${payload.sub}) does not match expected plan id (${expectedPlanId})`,
    );
  }

  return payload;
}
