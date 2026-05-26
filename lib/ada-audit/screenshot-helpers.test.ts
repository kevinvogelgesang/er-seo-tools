import { describe, it, expect, vi } from 'vitest'
import os from 'os'
import path from 'path'
import { promises as fs } from 'fs'
import { captureViolationScreenshots, MAX_SCREENSHOTS_PER_PAGE } from './screenshot-helpers'
import type { AxeViolation } from './types'

function fakePage() {
  return {
    $: vi.fn(async () => ({
      screenshot: vi.fn(async ({ path: p }: { path: string }) => { await fs.writeFile(p, 'x') }),
      dispose: vi.fn(async () => {}),
    })),
    evaluateHandle: vi.fn(async (_fn: unknown, handle: unknown) => handle),
  } as never
}

function violation(id: string, nodeCount: number): AxeViolation {
  return {
    id, impact: 'serious', help: id, description: '', helpUrl: '', tags: [],
    nodes: Array.from({ length: nodeCount }, (_, i) => ({
      html: `<i>${i}</i>`, target: [`#${id}-${i}`], failureSummary: '',
    })),
  } as never
}

describe('captureViolationScreenshots (per-node)', () => {
  it('writes one file per node and sets node.screenshotPath', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ss-'))
    const v = violation('color-contrast', 3)
    await captureViolationScreenshots(fakePage(), [v], dir)
    expect(v.nodes[0].screenshotPath).toBe('color-contrast-0.png')
    expect(v.nodes[2].screenshotPath).toBe('color-contrast-2.png')
    const files = await fs.readdir(dir)
    expect(files.sort()).toEqual(['color-contrast-0.png', 'color-contrast-1.png', 'color-contrast-2.png'])
  })

  it('caps at MAX_SCREENSHOTS_PER_PAGE across violations', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ss-'))
    const many = Array.from({ length: 10 }, (_, k) => violation(`v${k}`, 10)) // 100 nodes
    await captureViolationScreenshots(fakePage(), many, dir)
    const files = await fs.readdir(dir)
    expect(files.length).toBe(MAX_SCREENSHOTS_PER_PAGE)
  })
})
