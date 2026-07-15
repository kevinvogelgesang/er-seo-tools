// @vitest-environment jsdom
import '../../test/setup-jsdom-observers'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  Explainer,
  ExplainerSummary,
  ExplainerTags,
  ExplainerColumns,
  ExplainerNote,
} from './Explainer'

afterEach(cleanup)

function sample() {
  return (
    <Explainer title="SEO Health Score" label="What is the SEO health score?">
      <ExplainerSummary>Methodology prose.</ExplainerSummary>
      <ExplainerTags tags={['Indexability', 'Errors']} />
      <ExplainerNote>Lab data, not field.</ExplainerNote>
    </Explainer>
  )
}

describe('Explainer hover card', () => {
  it('is closed by default: trigger present, no panel in the DOM', () => {
    render(sample())
    expect(
      screen.getByRole('button', { name: 'What is the SEO health score?' }),
    ).toBeTruthy()
    expect(screen.queryByRole('tooltip')).toBeNull()
    expect(screen.queryByText('Methodology prose.')).toBeNull()
  })

  it('opens on hover and closes on Escape', async () => {
    const user = userEvent.setup()
    render(sample())
    const trigger = screen.getByRole('button', {
      name: 'What is the SEO health score?',
    })
    await user.hover(trigger)
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
    expect(screen.getByText('Methodology prose.')).toBeTruthy()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('opens on keyboard focus (a11y path)', async () => {
    const user = userEvent.setup()
    render(sample())
    await user.tab()
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
  })

  it('opens on click (touch/tap path)', async () => {
    const user = userEvent.setup()
    render(sample())
    await user.click(
      screen.getByRole('button', { name: 'What is the SEO health score?' }),
    )
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
  })

  it('pins open: hover then click keeps it open after unhover; second click closes', async () => {
    const user = userEvent.setup()
    render(sample())
    const trigger = screen.getByRole('button', {
      name: 'What is the SEO health score?',
    })
    await user.hover(trigger)
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
    await user.click(trigger)
    await user.unhover(trigger)
    // stickIfOpen: the hover-opened card stays open through the first click
    expect(screen.getByRole('tooltip')).toBeTruthy()
    await user.click(trigger)
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('closes on outside press', async () => {
    const user = userEvent.setup()
    render(
      <div>
        <button type="button">outside</button>
        {sample()}
      </div>,
    )
    await user.click(
      screen.getByRole('button', { name: 'What is the SEO health score?' }),
    )
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
    await user.click(screen.getByRole('button', { name: 'outside' }))
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull())
  })

  it('renders subcomponent structure inside the open card', async () => {
    const user = userEvent.setup()
    render(
      <Explainer label="cols">
        <ExplainerColumns
          good={{ label: 'Do', items: ['lead with data'] }}
          bad={{ label: "Don't", items: ['overwhelm'] }}
        />
      </Explainer>,
    )
    await user.click(screen.getByRole('button', { name: 'cols' }))
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy())
    expect(screen.getByText('Do')).toBeTruthy()
    expect(screen.getByText("Don't")).toBeTruthy()
    expect(screen.getByText('lead with data')).toBeTruthy()
    expect(screen.getByText('overwhelm')).toBeTruthy()
  })

  it('trigger carries the accessible label and a comfortable hit area', () => {
    render(sample())
    const trigger = screen.getByRole('button', {
      name: 'What is the SEO health score?',
    })
    expect(trigger.getAttribute('aria-label')).toBe(
      'What is the SEO health score?',
    )
    expect(trigger.className).toMatch(/min-h-7/)
    expect(trigger.className).toMatch(/min-w-7/)
  })
})
