// lib/shell/sidebar-pref.test.ts
import { describe, it, expect } from 'vitest'
import { readSidebarPref, SIDEBAR_STORAGE_KEY } from './sidebar-pref'

describe('readSidebarPref', () => {
  it('only the literal "collapsed" collapses; everything else expands', () => {
    expect(readSidebarPref('collapsed')).toBe('collapsed')
    expect(readSidebarPref('expanded')).toBe('expanded')
    expect(readSidebarPref(null)).toBe('expanded')
    expect(readSidebarPref('')).toBe('expanded')
    expect(readSidebarPref('true')).toBe('expanded')
    expect(readSidebarPref('COLLAPSED')).toBe('expanded')
  })
  it('storage key is stable', () => {
    expect(SIDEBAR_STORAGE_KEY).toBe('er-sidebar')
  })
})
