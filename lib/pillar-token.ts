// lib/pillar-token.ts
// Stateless JWT signing/verification for the pillar-analysis clipboard prompt.
// See docs/superpowers/specs/2026-04-29-pillar-analysis-phase-2-1-clipboard-prompt-design.md
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const ISSUER = 'er-seo-tools';
const AUDIENCE = 'pillar-analysis-narrative';
const EXPIRY_SECONDS = 3600; // 1h
const TOKEN_PREFIX = 'pat_';

/**
 * Dev-only fallback secret. Used ONLY when NODE_ENV !== 'production' and
 * the env var is unset. Production paths throw instead of falling back —
 * see getSecret() below.
 */
const DEV_FALLBACK_SECRET = 'dev-pillar-token-secret-do-not-use-in-prod';

let didWarnAboutDevFallback = false;

export class PillarTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PillarTokenError';
  }
}

function getSecret(): Uint8Array {
  const env = process.env.PILLAR_TOKEN_SECRET;
  if (env && env.length > 0) {
    return new TextEncoder().encode(env);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new PillarTokenError(
      'PILLAR_TOKEN_SECRET is required in production and is unset. Refusing to mint or verify tokens.',
    );
  }
  if (!didWarnAboutDevFallback) {
    // eslint-disable-next-line no-console
    console.warn(
      '[pillar-token] PILLAR_TOKEN_SECRET unset; using dev fallback. Set the env var in production.',
    );
    didWarnAboutDevFallback = true;
  }
  return new TextEncoder().encode(DEV_FALLBACK_SECRET);
}

export interface MintedToken {
  token: string;       // includes the 'pat_' prefix
  expiresAt: string;   // ISO 8601
}

export async function mintPillarToken(analysisId: string): Promise<MintedToken> {
  const secret = getSecret();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + EXPIRY_SECONDS;

  const jwt = await new SignJWT({ scope: ['read', 'narrative-write'] })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(analysisId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(secret);

  return {
    token: TOKEN_PREFIX + jwt,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

export async function verifyPillarToken(
  token: string,
  expectedAnalysisId: string,
): Promise<JWTPayload> {
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new PillarTokenError('token missing pat_ prefix');
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
    throw new PillarTokenError(
      `token verification failed: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }

  if (payload.sub !== expectedAnalysisId) {
    throw new PillarTokenError(
      `token sub (${payload.sub}) does not match expected analysis id (${expectedAnalysisId})`,
    );
  }

  return payload;
}
