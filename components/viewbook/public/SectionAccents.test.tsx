// PR7 Task 10: decorative code-owned SVG accents, tinted via the client's
// brand --vb-* vars. Pure server components — plain SSR string assertions
// via renderToStaticMarkup (no jsdom/jest-dom needed for markup checks).
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, it, expect } from 'vitest'
import { CornerBracket, TickDivider, DotStack } from './SectionAccents'

describe('SectionAccents', () => {
  it('accents are aria-hidden, tint via --vb-*, and never carry a dark: class', () => {
    for (const el of [<CornerBracket key="a" />, <TickDivider key="b" />, <DotStack key="c" />]) {
      const html = renderToStaticMarkup(el)
      expect(html).toContain('aria-hidden')
      expect(html).toContain('var(--vb-')
      expect(html).not.toContain('dark:')
    }
  })

  it('each accent renders an inline <svg> element', () => {
    for (const el of [<CornerBracket key="a" />, <TickDivider key="b" />, <DotStack key="c" />]) {
      const html = renderToStaticMarkup(el)
      expect(html).toContain('<svg')
    }
  })
})
