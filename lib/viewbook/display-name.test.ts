import { describe, expect, it } from 'vitest'
import { viewbookDisplayName } from './display-name'

describe('viewbookDisplayName', () => {
  it('uses the trimmed school-name value when non-empty', () => {
    expect(
      viewbookDisplayName({ schoolNameValue: '  Pro Way Hair School  ', clientName: 'Acme CRM Client' }),
    ).toBe('Pro Way Hair School')
  })

  it('falls back to clientName when schoolNameValue is null', () => {
    expect(viewbookDisplayName({ schoolNameValue: null, clientName: 'Acme CRM Client' })).toBe(
      'Acme CRM Client',
    )
  })

  it('falls back to clientName when schoolNameValue is an empty string', () => {
    expect(viewbookDisplayName({ schoolNameValue: '', clientName: 'Acme CRM Client' })).toBe(
      'Acme CRM Client',
    )
  })

  it('falls back to clientName when schoolNameValue is whitespace-only', () => {
    expect(viewbookDisplayName({ schoolNameValue: '   ', clientName: 'Acme CRM Client' })).toBe(
      'Acme CRM Client',
    )
  })
})
