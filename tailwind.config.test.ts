import { describe, it, expect } from 'vitest'
import config from './tailwind.config'

// Regression guard for the 2026-07-07 widget-grid purge bug: spanClass() in
// lib/widgets/grid.ts emits Tailwind utility classes (col-span-*, md:col-span-2,
// lg:row-span-2, lg:col-span-4). If lib/ leaves the content globs, Tailwind
// purges those classes and the homepage widget sizes silently collapse to a
// single column. Keep lib/ scanned.
describe('tailwind content globs', () => {
  const content = config.content as string[]

  it('scans app, components, and lib for class names', () => {
    expect(Array.isArray(content)).toBe(true)
    const covers = (dir: string) => content.some((g) => g.includes(`./${dir}/`))
    expect(covers('app'), 'app/ must be scanned').toBe(true)
    expect(covers('components'), 'components/ must be scanned').toBe(true)
    expect(covers('lib'), 'lib/ must be scanned — spanClass() classes purge otherwise').toBe(true)
  })
})
