// lib/handoff/errors.ts
// Single home for the six handoff token error classes (D1 consolidation).
// Names and shape (extends Error, sets this.name) are frozen — routes
// message-sniff and `instanceof` these across the codebase. The legacy
// lib/<x>-token.ts modules keep defining their own copies for now; Task 6
// re-points each legacy module to re-export its class from here so there is
// exactly one runtime identity per error type. No server-only import here —
// these are plain classes with no I/O.

export class PillarTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PillarTokenError';
  }
}

export class SeoRoadmapTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeoRoadmapTokenError';
  }
}

export class KeywordMemoTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeywordMemoTokenError';
  }
}

export class KeywordStrategyTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'KeywordStrategyTokenError';
  }
}

export class ContentAuditTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ContentAuditTokenError';
  }
}

export class QuarterPushTokenError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuarterPushTokenError';
  }
}
