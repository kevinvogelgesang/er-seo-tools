// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup } from '@testing-library/react'
import { AnchorTextSection } from './AnchorTextSection'

afterEach(() => cleanup())

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (over: any) => ({ anchorSummaryJson: null, findings: [], ...over }) as any

describe('AnchorTextSection', () => {
  it('not-analyzed when anchorSummaryJson is null', () => {
    const { container } = render(<AnchorTextSection run={run({})} />)
    expect(container.textContent).toMatch(/not analyzed|no anchor/i)
  })
  it('clean when analyzed with zero anchor findings', () => {
    const { container } = render(<AnchorTextSection run={run({ anchorSummaryJson: '{"v":1,"targetsObserved":5}' })} />)
    expect(container.textContent).toMatch(/no anchor-text issues|clean/i)
  })
  it('lists anchor findings', () => {
    const { container } = render(<AnchorTextSection run={run({
      anchorSummaryJson: '{"v":1}',
      findings: [{ scope: 'run', type: 'empty_anchor_text', count: 4, severity: 'warning' }],
    })} />)
    expect(container.textContent).toMatch(/Empty anchor text/)
    expect(container.textContent).toMatch(/4/)
  })
})
