// lib/handoff/token.ts
// Generic mint/verify token factory (D1 consolidation, Task 5). This is a
// byte-behavioral clone of lib/pillar-token.ts's logic (see that module for
// the canonical shape), parameterized by a HandoffTokenConfig from
// lib/handoff/registry.ts. Task 6 re-points the six legacy lib/<x>-token.ts
// modules to become thin facades over createHandoffTokenFamily().
//
// Message templates below are WIRE-ADJACENT — routes message-sniff them
// ('missing <prefix> prefix', 'does not match', 'signature') — never reword.
// Pinned wart (verified 2026-07-12, see lib/handoff/route-auth-characterization.test.ts):
// jose's expiry error message ('"exp" claim timestamp check failed') does
// NOT contain the word 'expired'. The wrap below reproduces jose's message
// verbatim and must never add/normalize words onto it.
import 'server-only';
import { SignJWT, jwtVerify, type JWTPayload } from 'jose';
import type { HandoffTokenConfig } from './registry';

const ISSUER = 'er-seo-tools';

/**
 * Per-family dev-fallback warn-once state, keyed by config.prefix. Each
 * family gets its own independent "have we warned yet" flag, mirroring
 * the module-level `didWarnAboutDevFallback` boolean each legacy module
 * declared individually.
 */
const didWarnAboutDevFallback = new Map<string, boolean>();

export interface MintedHandoffToken {
  /** Includes the family's token prefix, e.g. 'pat_...'. */
  token: string;
  /** ISO 8601. */
  expiresAt: string;
}

export interface HandoffTokenFamily {
  mint(id: string): Promise<MintedHandoffToken>;
  verify(token: string, expectedId: string): Promise<JWTPayload>;
}

function getSecret(config: HandoffTokenConfig): Uint8Array {
  const env = process.env[config.secretEnv];
  if (env && env.length > 0) {
    return new TextEncoder().encode(env);
  }
  if (process.env.NODE_ENV === 'production') {
    throw config.makeError(
      `${config.secretEnv} is required in production and is unset. Refusing to mint or verify tokens.`,
    );
  }
  if (!didWarnAboutDevFallback.get(config.prefix)) {
    // eslint-disable-next-line no-console
    console.warn(
      `${config.devFallbackWarnPrefix} ${config.secretEnv} unset; using dev fallback. Set the env var in production.`,
    );
    didWarnAboutDevFallback.set(config.prefix, true);
  }
  return new TextEncoder().encode(config.devFallbackSecret);
}

/**
 * Builds a stateless JWT mint/verify pair for one handoff token family. The
 * returned functions are the exact behavioral clone of e.g.
 * mintPillarToken/verifyPillarToken, parameterized entirely by `config`.
 */
export function createHandoffTokenFamily(config: HandoffTokenConfig): HandoffTokenFamily {
  async function mint(id: string): Promise<MintedHandoffToken> {
    const secret = getSecret(config);
    const issuedAt = Math.floor(Date.now() / 1000);
    const expiresAt = issuedAt + config.ttlSeconds;

    const jwt = await new SignJWT({ scope: [...config.scopes] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer(ISSUER)
      .setAudience(config.audience)
      .setSubject(id)
      .setIssuedAt(issuedAt)
      .setExpirationTime(expiresAt)
      .sign(secret);

    return {
      token: config.prefix + jwt,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  async function verify(token: string, expectedId: string): Promise<JWTPayload> {
    if (!token.startsWith(config.prefix)) {
      throw config.makeError(`token missing ${config.prefix} prefix`);
    }
    const jwt = token.slice(config.prefix.length);

    let payload: JWTPayload;
    try {
      const verified = await jwtVerify(jwt, getSecret(config), {
        issuer: ISSUER,
        audience: config.audience,
      });
      payload = verified.payload;
    } catch (err) {
      throw config.makeError(
        `token verification failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }

    if (payload.sub !== expectedId) {
      throw config.makeError(
        `token sub (${payload.sub}) does not match expected ${config.subNoun} (${expectedId})`,
      );
    }

    return payload;
  }

  return { mint, verify };
}
