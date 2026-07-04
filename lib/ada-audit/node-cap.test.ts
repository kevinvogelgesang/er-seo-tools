// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { capViolationNodesForStorage, STORED_NODE_LIMIT } from './node-cap'
import type { AxeViolation } from './types'

function v(id: string, nodeN: number): AxeViolation {
  return {
    id, impact: 'serious', help: '', description: '', helpUrl: '', tags: [],
    nodes: Array.from({ length: nodeN }, (_, i) => ({ html: `<a${i}>` })),
  }
}

describe('capViolationNodesForStorage', () => {
  it('records the raw count and truncates nodes to the limit', () => {
    const [out] = capViolationNodesForStorage([v('image-alt', 200)])
    expect(out.nodeCount).toBe(200)
    expect(out.nodes.length).toBe(STORED_NODE_LIMIT)
  })
  it('leaves sub-limit violations intact with an exact count', () => {
    const [out] = capViolationNodesForStorage([v('label', 3)])
    expect(out.nodeCount).toBe(3)
    expect(out.nodes.length).toBe(3)
  })
  it('does not mutate the input array elements', () => {
    const input = [v('x', 50)]
    capViolationNodesForStorage(input)
    expect(input[0].nodes.length).toBe(50)
    expect(input[0].nodeCount).toBeUndefined()
  })
})
