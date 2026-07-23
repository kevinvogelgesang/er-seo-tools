'use client'

import { useEffect } from 'react'

export function FragmentScrubber() {
  useEffect(() => {
    if (/^#g=.+$/.test(window.location.hash)) {
      window.history.replaceState(null, '', window.location.pathname)
    }
  }, [])

  return null
}
