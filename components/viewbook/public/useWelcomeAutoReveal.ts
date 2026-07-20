'use client'
import { useCallback, useEffect, useRef } from 'react'
export function welcomeRevealedKey(viewbookId: number): string { return `vb:welcome-revealed:${viewbookId}` }
const memoryFlags = new Set<string>()
function readFlag(key: string): boolean { try { return localStorage.getItem(key) === '1' } catch { return memoryFlags.has(key) } }
function writeFlag(key: string): void { try { localStorage.setItem(key, '1') } catch { memoryFlags.add(key) } }

export function useWelcomeAutoReveal({
  viewbookId, enabled, ready, collapsed, expand, delayMs, previewMode = false,
}: {
  viewbookId: number; enabled: boolean; ready: boolean; collapsed: boolean
  expand: () => void; delayMs: number; previewMode?: boolean
}): { consume: () => void } {
  const key = welcomeRevealedKey(viewbookId)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const raf = useRef<number | null>(null)
  const cancel = useCallback(() => {
    if (timer.current !== null) { clearTimeout(timer.current); timer.current = null }
    if (raf.current !== null) { cancelAnimationFrame(raf.current); raf.current = null }
  }, [])
  const consume = useCallback(() => { writeFlag(key); cancel() }, [key, cancel])

  useEffect(() => {
    if (!enabled || previewMode || !ready) return
    if (readFlag(key)) return
    if (!collapsed) { writeFlag(key); return } // already open — consume the one-shot
    const fire = () => {
      timer.current = null; raf.current = null
      if (readFlag(key)) return       // another tab won
      writeFlag(key)                  // claim BEFORE expand (best-effort, non-atomic)
      expand()
    }
    if (delayMs <= 0) raf.current = requestAnimationFrame(fire)
    else timer.current = setTimeout(fire, delayMs)
    const onStorage = (e: StorageEvent) => { if (e.key === key && e.newValue === '1') cancel() }
    try { window.addEventListener('storage', onStorage) } catch { /* noop */ }
    return () => { cancel(); try { window.removeEventListener('storage', onStorage) } catch { /* noop */ } }
  }, [key, enabled, ready, collapsed, expand, delayMs, previewMode, cancel])

  return { consume }
}
