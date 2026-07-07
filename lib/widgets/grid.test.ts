// lib/widgets/grid.test.ts
import { describe, it, expect } from 'vitest'
import { spanClass } from './grid'

describe('spanClass', () => {
  it('sm is a single cell at every breakpoint', () => {
    expect(spanClass('sm')).toBe('col-span-1 row-span-1')
  })
  it('wide spans two columns from md up, one row', () => {
    expect(spanClass('wide')).toBe('col-span-1 row-span-1 md:col-span-2')
  })
  it('lg spans two columns and two rows from md/lg up', () => {
    expect(spanClass('lg')).toBe('col-span-1 row-span-1 md:col-span-2 lg:row-span-2')
  })
  it('xl spans the full four columns on lg and two rows', () => {
    expect(spanClass('xl')).toBe('col-span-1 row-span-1 md:col-span-2 lg:col-span-4 lg:row-span-2')
  })
})
