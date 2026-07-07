// lib/widgets/layout.ts
// Pure layout module — the spine of the homepage widget editor (PR 3, spec
// §7). No React, no `window`/DOM access, and no import of `registry.tsx`
// (that file imports live React components — importing it here would make
// this module impure). Every function returns a NEW array and never
// mutates its inputs (including a passed-in DEFAULT_LAYOUT).
import type { LayoutItem, WidgetSize, WidgetDef } from './types'

// Narrow view of the registry — only the fields layout logic needs. Proves
// at the type level that Component is never touched here.
export type WidgetMeta = Pick<WidgetDef, 'id' | 'sizes' | 'defaultSize'>

export const LAYOUT_STORAGE_KEY = 'er-home-layout'
export const LAYOUT_VERSION = 1

const ALL_SIZES: readonly WidgetSize[] = ['sm', 'wide', 'lg', 'xl']

function isWidgetSize(value: unknown): value is WidgetSize {
  return typeof value === 'string' && (ALL_SIZES as readonly string[]).includes(value)
}

// Load-time reconciler. Registry is authoritative. Returns a NEW array;
// never mutates inputs (incl. DEFAULT_LAYOUT):
//  - drop ids not in `widgets`                              (unknown-id drop)
//  - drop duplicate ids (keep first occurrence)
//  - drop items whose size is not a real WidgetSize          (garbage-size guard)
//  - clamp: an item whose size ∉ widget.sizes → widget.defaultSize
//  - append every registered widget missing from `items`, at defaultSize,
//    in `widgets` (registry) order
export function normalizeLayout(items: LayoutItem[], widgets: WidgetMeta[]): LayoutItem[] {
  const byId = new Map(widgets.map((w) => [w.id, w]))
  const seen = new Set<string>()
  const result: LayoutItem[] = []

  for (const item of items) {
    const widget = byId.get(item.id)
    if (!widget) continue // unknown id
    if (seen.has(item.id)) continue // duplicate — keep first occurrence
    if (!isWidgetSize(item.size)) continue // garbage-size guard

    seen.add(item.id)
    const size = widget.sizes.includes(item.size) ? item.size : widget.defaultSize
    result.push({ id: item.id, size })
  }

  for (const widget of widgets) {
    if (!seen.has(widget.id)) {
      result.push({ id: widget.id, size: widget.defaultSize })
    }
  }

  return result
}

interface StoredLayout {
  version: number
  items: LayoutItem[]
}

function isStoredLayout(value: unknown): value is StoredLayout {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return typeof candidate.version === 'number' && Array.isArray(candidate.items)
}

// Parse a raw localStorage string into a clean layout.
//  - null / malformed JSON / wrong shape (items not array) → normalizeLayout(defaultLayout, …)
//  - parsed.version !== LAYOUT_VERSION → normalizeLayout(defaultLayout, …)  (version-bump reset)
//  - else → normalizeLayout(parsed.items, widgets)
export function loadLayout(
  raw: string | null,
  widgets: WidgetMeta[],
  defaultLayout: LayoutItem[]
): LayoutItem[] {
  if (raw === null) return normalizeLayout(defaultLayout, widgets)

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return normalizeLayout(defaultLayout, widgets)
  }

  if (!isStoredLayout(parsed)) return normalizeLayout(defaultLayout, widgets)
  if (parsed.version !== LAYOUT_VERSION) return normalizeLayout(defaultLayout, widgets)

  return normalizeLayout(parsed.items, widgets)
}

export function serializeLayout(items: LayoutItem[]): string {
  return JSON.stringify({ version: LAYOUT_VERSION, items })
}

// Pure ops used by the reducer (each returns a NEW array, never mutates).
//  - draggedId missing → unchanged
//  - targetId null → append dragged to end
//  - targetId not found → unchanged (NOT append)
//  - draggedId === targetId → unchanged
//  - dragged already immediately before target → unchanged
//  - otherwise: remove dragged, compute target index IN THE REDUCED array,
//    insert before it
export function reorderLayout(
  items: LayoutItem[],
  draggedId: string,
  targetId: string | null
): LayoutItem[] {
  const draggedIndex = items.findIndex((item) => item.id === draggedId)
  if (draggedIndex === -1) return items.slice()
  if (draggedId === targetId) return items.slice()

  const dragged = items[draggedIndex]

  if (targetId === null) {
    const reduced = items.filter((item) => item.id !== draggedId)
    return [...reduced, dragged]
  }

  const targetIndex = items.findIndex((item) => item.id === targetId)
  if (targetIndex === -1) return items.slice()
  if (draggedIndex === targetIndex - 1) return items.slice() // already immediately before target

  const reduced = items.filter((item) => item.id !== draggedId)
  const insertAt = reduced.findIndex((item) => item.id === targetId)
  const result = reduced.slice()
  result.splice(insertAt, 0, dragged)
  return result
}

// Swap with neighbor; clamp at ends; unknown id → unchanged.
export function moveItem(items: LayoutItem[], id: string, dir: 'up' | 'down'): LayoutItem[] {
  const index = items.findIndex((item) => item.id === id)
  if (index === -1) return items.slice()

  const swapWith = dir === 'up' ? index - 1 : index + 1
  if (swapWith < 0 || swapWith >= items.length) return items.slice()

  const result = items.slice()
  const tmp = result[index]
  result[index] = result[swapWith]
  result[swapWith] = tmp
  return result
}

// Next size in widget.sizes, wrapping; single-size → unchanged; current ∉
// sizes → defaultSize; unknown id → unchanged.
export function cycleSize(items: LayoutItem[], id: string, widgets: WidgetMeta[]): LayoutItem[] {
  const widget = widgets.find((w) => w.id === id)
  if (!widget) return items.slice()

  return items.map((item) => {
    if (item.id !== id) return item

    const currentIndex = widget.sizes.indexOf(item.size)
    if (currentIndex === -1) return { ...item, size: widget.defaultSize }
    if (widget.sizes.length === 1) return { ...item }

    const nextIndex = (currentIndex + 1) % widget.sizes.length
    return { ...item, size: widget.sizes[nextIndex] }
  })
}

// The reducer the hook drives. Factory binds registry meta + default so
// actions stay data-only. All state transitions go through here (incl.
// hydrate).
export type LayoutAction =
  | { type: 'hydrate'; items: LayoutItem[] }
  | { type: 'reorder'; draggedId: string; targetId: string | null }
  | { type: 'move'; id: string; dir: 'up' | 'down' }
  | { type: 'resize'; id: string }
  | { type: 'reset' }

export function createLayoutReducer(widgets: WidgetMeta[], defaultLayout: LayoutItem[]) {
  return function layoutReducer(state: LayoutItem[], action: LayoutAction): LayoutItem[] {
    switch (action.type) {
      case 'hydrate':
        return normalizeLayout(action.items, widgets)
      case 'reorder':
        return reorderLayout(state, action.draggedId, action.targetId)
      case 'move':
        return moveItem(state, action.id, action.dir)
      case 'resize':
        return cycleSize(state, action.id, widgets)
      case 'reset':
        return normalizeLayout(defaultLayout, widgets)
      default:
        return state
    }
  }
}
