// lib/seo-roadmap-token.ts
// Stateless JWT signing/verification for the SEO audit roadmap share feature.
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';

const ISSUER = 'er-seo-tools';
const AUDIENCE = 'seo-audit-roadmap';
const EXPIRY_SECONDS = 3600; // 1h
const TOKEN_PREFIX = 'srt_';

/**
 * Dev-only fallback secret. Used ONLY when NODE_ENV !== 'production' and
 * the env var is unset. Production paths throw instead of falling back —
 * see getSecret() below.
 */
const DEV_FALLBACK_SECRET = 'dev-seo-roadmap-secret-do-not-use-in-prod';

let didWarnAboutDevFallback = false;

export class SeoRoadmapTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeoRoadmapTokenError';
  }
}

function getSecret(): Uint8Array {
  const env = process.env.SEO_ROADMAP_TOKEN_SECRET;
  if (env && env.length > 0) {
    return new TextEncoder().encode(env);
  }
  if (process.env.NODE_ENV === 'production') {
    throw new SeoRoadmapTokenError(
      'SEO_ROADMAP_TOKEN_SECRET is required in production and is unset. Refusing to mint or verify tokens.',
    );
  }
  if (!didWarnAboutDevFallback) {
    // eslint-disable-next-line no-console
    console.warn(
      '[seo-roadmap-token] SEO_ROADMAP_TOKEN_SECRET unset; using dev fallback. Set the env var in production.',
    );
    didWarnAboutDevFallback = true;
  }
  return new TextEncoder().encode(DEV_FALLBACK_SECRET);
}

export interface MintedToken {
  token: string;       // includes the 'srt_' prefix
  expiresAt: string;   // ISO 8601
}

export async function mintSeoRoadmapToken(roadmapId: string): Promise<MintedToken> {
  const secret = getSecret();
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + EXPIRY_SECONDS;

  const jwt = await new SignJWT({ scope: ['read', 'roadmap-write'] })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(roadmapId)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .sign(secret);

  return {
    token: TOKEN_PREFIX + jwt,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
  };
}

export async function verifySeoRoadmapToken(
  token: string,
  expectedRoadmapId: string,
): Promise<JWTPayload> {
  if (!token.startsWith(TOKEN_PREFIX)) {
    throw new SeoRoadmapTokenError('token missing srt_ prefix');
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
    throw new SeoRoadmapTokenError(
      `token verification failed: ${err instanceof Error ? err.message : 'unknown'}`,
    );
  }

  if (payload.sub !== expectedRoadmapId) {
    throw new SeoRoadmapTokenError(
      `token sub (${payload.sub}) does not match expected roadmap id (${expectedRoadmapId})`,
    );
  }

  return payload;
}
