// @vitest-environment jsdom
import { render, screen, cleanup } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import { StatusPill } from './StatusPill'

afterEach(cleanup)

describe('StatusPill', () => {
  it('renders the label', () => {
    render(<StatusPill label="running" tone="running" />)
    expect(screen.getByText('running')).toBeTruthy()
  })
  it('defaults to neutral tone without throwing', () => {
    render(<StatusPill label="queued" />)
    expect(screen.getByText('queued')).toBeTruthy()
  })
})
