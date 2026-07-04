// Pure node-truncation for storage. Extracted from runner.ts so the raw-count
// preservation is unit-testable without puppeteer.
import type { AxeViolation } from './types'

export const STORED_NODE_LIMIT = 20

/** Preserve the raw failing-node count, then truncate `nodes` for storage. */
export function capViolationNodesForStorage(violations: AxeViolation[]): AxeViolation[] {
  return violations.map((v) => ({
    ...v,
    nodeCount: v.nodes.length,
    nodes: v.nodes.slice(0, STORED_NODE_LIMIT),
  }))
}
