// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import {
  Explainer,
  ExplainerSummary,
  ExplainerTags,
  ExplainerColumns,
  ExplainerNote,
} from './Explainer'

afterEach(cleanup)

function panelFor(trigger: HTMLElement): HTMLElement {
  const id = trigger.getAttribute('aria-controls')
  expect(id).toBeTruthy()
  const panel = document.getElementById(id!)
  expect(panel).toBeTruthy()
  return panel!
}

describe('Explainer', () => {
  it('renders collapsed by default: trigger aria-expanded=false, panel aria-hidden + inert + invisible', () => {
    render(
      <Explainer label="What does this measure?">
        <ExplainerSummary>Methodology prose.</ExplainerSummary>
      </Explainer>,
    )
    const trigger = screen.getByRole('button', { name: 'What does this measure?' })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    const panel = panelFor(trigger)
    expect(panel.getAttribute('aria-hidden')).toBe('true')
    expect(panel.hasAttribute('inert')).toBe(true)
    // Safari 14 focus fallback: visibility:hidden removes the subtree from
    // the tab order on browsers without native inert support.
    expect(panel.className).toMatch(/\binvisible\b/)
  })

  it('expands on click: aria-expanded flips, aria-hidden/inert/invisible removed; collapses again on second click', () => {
    render(
      <Explainer label="What is this?">
        <ExplainerSummary>Prose.</ExplainerSummary>
      </Explainer>,
    )
    const trigger = screen.getByRole('button', { name: 'What is this?' })
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    const panel = panelFor(trigger)
    expect(panel.getAttribute('aria-hidden')).toBeNull()
    expect(panel.hasAttribute('inert')).toBe(false)
    expect(panel.className).not.toMatch(/\binvisible\b/)
    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(panel.hasAttribute('inert')).toBe(true)
    expect(panel.className).toMatch(/\binvisible\b/)
  })

  it('defaultOpen renders expanded', () => {
    render(
      <Explainer label="How this score is calculated" defaultOpen>
        <ExplainerSummary>Open from the start.</ExplainerSummary>
      </Explainer>,
    )
    const trigger = screen.getByRole('button', { name: 'How this score is calculated' })
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(panelFor(trigger).hasAttribute('inert')).toBe(false)
  })

  it('collapsed panel is genuinely inaccessible: an interactive child is not in the a11y tree until expanded', () => {
    render(
      <Explainer label="Details">
        <a href="https://example.com">docs link</a>
      </Explainer>,
    )
    // Collapsed: role queries respect aria-hidden — the link must be unreachable.
    expect(screen.queryByRole('link')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Details' }))
    expect(screen.getByRole('link', { name: 'docs link' })).toBeTruthy()
  })

  it('ExplainerTags renders a chip per tag and null for empty', () => {
    const { container } = render(<ExplainerTags tags={['Density-based', 'Severity-weighted']} />)
    expect(screen.getByText('Density-based')).toBeTruthy()
    expect(screen.getByText('Severity-weighted')).toBeTruthy()
    expect(container.querySelectorAll('li')).toHaveLength(2)
    const { container: empty } = render(<ExplainerTags tags={[]} />)
    expect(empty.firstChild).toBeNull()
  })

  it('ExplainerColumns renders both labelled lists with check/cross markers', () => {
    const { container } = render(
      <ExplainerColumns
        good={{ label: 'Helps the score', items: ['Unique titles'] }}
        bad={{ label: 'Hurts the score', items: ['Thin content'] }}
      />,
    )
    expect(screen.getByText('Helps the score')).toBeTruthy()
    expect(screen.getByText('Hurts the score')).toBeTruthy()
    expect(screen.getByText('Unique titles')).toBeTruthy()
    expect(screen.getByText('Thin content')).toBeTruthy()
    expect(container.textContent).toContain('✓')
    expect(container.textContent).toContain('✗')
  })

  it('ExplainerNote renders the flagged footer callout text', () => {
    render(<ExplainerNote>Weights as scored; current weights may differ.</ExplainerNote>)
    expect(screen.getByText(/Weights as scored/)).toBeTruthy()
  })

  it('card variant applies the bordered panel chrome; plain does not', () => {
    const { container: card } = render(
      <Explainer label="About" variant="card">
        <ExplainerSummary>x</ExplainerSummary>
      </Explainer>,
    )
    expect((card.firstChild as HTMLElement).className).toMatch(/border/)
    const { container: plain } = render(
      <Explainer label="About2" variant="plain">
        <ExplainerSummary>x</ExplainerSummary>
      </Explainer>,
    )
    expect((plain.firstChild as HTMLElement).className).not.toMatch(/border/)
  })
})
