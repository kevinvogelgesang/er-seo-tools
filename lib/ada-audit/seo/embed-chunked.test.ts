import { describe, it, expect, vi } from 'vitest'
import { embedChunked } from './embed-chunked'

describe('embedChunked', () => {
  it('preserves input→vector order across chunk boundaries', async () => {
    const texts = Array.from({ length: 10 }, (_, i) => `t${i}`)
    const embed = vi.fn(async (chunk: string[]) => chunk.map((t) => [Number(t.slice(1))]))
    const out = await embedChunked(texts, { embed, chunkSize: 3, yieldFn: async () => {} })
    expect(out).toEqual(texts.map((_, i) => [i]))
    expect(embed).toHaveBeenCalledTimes(4) // 3+3+3+1
  })

  it('yields between chunks but not after the last', async () => {
    const yieldFn = vi.fn(async () => {})
    const embed = async (chunk: string[]) => chunk.map(() => [0])
    await embedChunked(['a', 'b', 'c', 'd'], { embed, chunkSize: 2, yieldFn })
    expect(yieldFn).toHaveBeenCalledTimes(1) // one gap between the two chunks
  })

  it('abandons to null when shouldAbort fires mid-stream (no partial result)', async () => {
    let calls = 0
    const embed = vi.fn(async (chunk: string[]) => chunk.map(() => [0]))
    const shouldAbort = () => {
      calls += 1
      return calls > 1 // allow first chunk, abort before the second
    }
    const out = await embedChunked(['a', 'b', 'c', 'd'], { embed, chunkSize: 2, yieldFn: async () => {}, shouldAbort })
    expect(out).toBeNull()
    expect(embed).toHaveBeenCalledTimes(1)
  })
})
