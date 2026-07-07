// lib/widgets/layout.test.ts
import { describe, it, expect } from 'vitest'
import type { LayoutItem } from './types'
import {
  LAYOUT_STORAGE_KEY,
  LAYOUT_VERSION,
  normalizeLayout,
  loadLayout,
  serializeLayout,
  reorderLayout,
  moveItem,
  cycleSize,
  createLayoutReducer,
  type WidgetMeta,
  type LayoutAction,
} from './layout'

// Small fixture registry — deliberately not the real one (purity: this
// module must never import registry.tsx).
const WIDGETS: WidgetMeta[] = [
  { id: 'a', sizes: ['sm', 'wide'], defaultSize: 'sm' },
  { id: 'b', sizes: ['sm', 'lg', 'xl'], defaultSize: 'lg' },
  { id: 'c', sizes: ['sm'], defaultSize: 'sm' }, // single-size widget
]

const DEFAULT_LAYOUT: LayoutItem[] = [
  { id: 'a', size: 'sm' },
  { id: 'b', size: 'lg' },
  { id: 'c', size: 'sm' },
]

describe('LAYOUT_STORAGE_KEY / LAYOUT_VERSION', () => {
  it('exposes the storage key and current version', () => {
    expect(LAYOUT_STORAGE_KEY).toBe('er-home-layout')
    expect(LAYOUT_VERSION).toBe(1)
  })
})

describe('normalizeLayout', () => {
  it('drops an item whose id is not registered', () => {
    const items: LayoutItem[] = [
      { id: 'a', size: 'sm' },
      { id: 'ghost', size: 'sm' },
      { id: 'b', size: 'lg' },
      { id: 'c', size: 'sm' },
    ]
    const result = normalizeLayout(items, WIDGETS)
    expect(result.find((i) => i.id === 'ghost')).toBeUndefined()
    expect(result).toEqual([
      { id: 'a', size: 'sm' },
      { id: 'b', size: 'lg' },
      { id: 'c', size: 'sm' },
    ])
  })

  it('drops a duplicate id, keeping the first occurrence', () => {
    const items: LayoutItem[] = [
      { id: 'a', size: 'sm' },
      { id: 'b', size: 'lg' },
      { id: 'a', size: 'wide' }, // duplicate — should be dropped
      { id: 'c', size: 'sm' },
    ]
    const result = normalizeLayout(items, WIDGETS)
    const aItems = result.filter((i) => i.id === 'a')
    expect(aItems).toHaveLength(1)
    expect(aItems[0]).toEqual({ id: 'a', size: 'sm' })
  })

  it('drops an item whose size is not a real WidgetSize (garbage-size guard)', () => {
    const items: LayoutItem[] = [
      { id: 'b', size: 'sm' },
      { id: 'a', size: 'huge' as unknown as LayoutItem['size'] },
      { id: 'c', size: 'sm' },
    ]
    const result = normalizeLayout(items, WIDGETS)
    // The garbage-size item is gone outright...
    expect(result.some((i) => (i.size as unknown as string) === 'huge')).toBe(false)
    // ...and because widget 'a' is now missing, it gets appended back at its
    // defaultSize by the append-missing step, so no data silently vanishes.
    expect(result).toEqual([
      { id: 'b', size: 'sm' },
      { id: 'c', size: 'sm' },
      { id: 'a', size: 'sm' },
    ])
  })

  it('clamps a size not supported by the widget to its defaultSize', () => {
    const items: LayoutItem[] = [
      { id: 'a', size: 'sm' },
      { id: 'b', size: 'wide' }, // valid WidgetSize, but not in b.sizes
      { id: 'c', size: 'sm' },
    ]
    const result = normalizeLayout(items, WIDGETS)
    expect(result.find((i) => i.id === 'b')).toEqual({ id: 'b', size: 'lg' })
  })

  it('appends a missing registered widget at defaultSize, in registry order', () => {
    const items: LayoutItem[] = [{ id: 'c', size: 'sm' }]
    const result = normalizeLayout(items, WIDGETS)
    expect(result).toEqual([
      { id: 'c', size: 'sm' },
      { id: 'a', size: 'sm' },
      { id: 'b', size: 'lg' },
    ])
  })

  it('registry-evolution: a stored layout predating a newly-registered widget appends it at defaultSize', () => {
    const staleStoredItems: LayoutItem[] = [
      { id: 'a', size: 'wide' },
      { id: 'b', size: 'xl' },
      // 'c' did not exist when this layout was persisted
    ]
    const result = normalizeLayout(staleStoredItems, WIDGETS)
    expect(result).toEqual([
      { id: 'a', size: 'wide' },
      { id: 'b', size: 'xl' },
      { id: 'c', size: 'sm' },
    ])
  })

  it('returns a valid layout unchanged, preserving order', () => {
    const items: LayoutItem[] = [
      { id: 'c', size: 'sm' },
      { id: 'b', size: 'xl' },
      { id: 'a', size: 'wide' },
    ]
    const result = normalizeLayout(items, WIDGETS)
    expect(result).toEqual(items)
  })

  it('never mutates its input array or the widgets/defaultLayout it is given', () => {
    const input: LayoutItem[] = [
      { id: 'b', size: 'wide' }, // will be clamped
      { id: 'a', size: 'huge' as unknown as LayoutItem['size'] }, // will be dropped
    ]
    Object.freeze(input)
    Object.freeze(input[0])
    Object.freeze(input[1])
    const snapshot = JSON.parse(JSON.stringify(input))

    let result: LayoutItem[] = []
    expect(() => {
      result = normalizeLayout(input, WIDGETS)
    }).not.toThrow()

    // Input is untouched.
    expect(input).toEqual(snapshot)
    // Output is a genuinely new array, not the same reference.
    expect(result).not.toBe(input)
  })

  it('does not mutate a frozen DEFAULT_LAYOUT-shaped array', () => {
    const frozenDefault = Object.freeze(DEFAULT_LAYOUT.map((i) => Object.freeze({ ...i })))
    const snapshot = JSON.parse(JSON.stringify(frozenDefault))
    expect(() => normalizeLayout(frozenDefault as LayoutItem[], WIDGETS)).not.toThrow()
    expect(frozenDefault).toEqual(snapshot)
  })

  it('drops a null entry instead of crashing, and appends the missing widgets it displaced', () => {
    const items: LayoutItem[] = [null as unknown as LayoutItem]
    let result: LayoutItem[] = []
    expect(() => {
      result = normalizeLayout(items, WIDGETS)
    }).not.toThrow()
    expect(result).toEqual(normalizeLayout([], WIDGETS))
  })

  it('drops a non-object entry (string) instead of crashing', () => {
    const items: LayoutItem[] = ['not-an-item' as unknown as LayoutItem]
    expect(() => normalizeLayout(items, WIDGETS)).not.toThrow()
    const result = normalizeLayout(items, WIDGETS)
    expect(result).toEqual(normalizeLayout([], WIDGETS))
  })

  it('drops an item missing an id', () => {
    const items: LayoutItem[] = [{ size: 'sm' } as unknown as LayoutItem]
    const result = normalizeLayout(items, WIDGETS)
    expect(result).toEqual(normalizeLayout([], WIDGETS))
  })

  it('drops an item whose id is not a string', () => {
    const items: LayoutItem[] = [{ id: 42, size: 'sm' } as unknown as LayoutItem]
    const result = normalizeLayout(items, WIDGETS)
    expect(result).toEqual(normalizeLayout([], WIDGETS))
  })

  it('drops malformed items while keeping valid ones alongside them', () => {
    const items: LayoutItem[] = [
      { id: 'a', size: 'sm' },
      null as unknown as LayoutItem,
      { id: 'b', size: 'lg' },
    ]
    const result = normalizeLayout(items, WIDGETS)
    expect(result).toEqual([
      { id: 'a', size: 'sm' },
      { id: 'b', size: 'lg' },
      { id: 'c', size: 'sm' },
    ])
  })
})

describe('loadLayout', () => {
  it('returns the normalized default when raw is null', () => {
    const result = loadLayout(null, WIDGETS, DEFAULT_LAYOUT)
    expect(result).toEqual(normalizeLayout(DEFAULT_LAYOUT, WIDGETS))
  })

  it('returns the normalized default on malformed JSON', () => {
    const result = loadLayout('{not valid json', WIDGETS, DEFAULT_LAYOUT)
    expect(result).toEqual(normalizeLayout(DEFAULT_LAYOUT, WIDGETS))
  })

  it('returns the normalized default when items is missing', () => {
    const raw = JSON.stringify({ version: LAYOUT_VERSION })
    const result = loadLayout(raw, WIDGETS, DEFAULT_LAYOUT)
    expect(result).toEqual(normalizeLayout(DEFAULT_LAYOUT, WIDGETS))
  })

  it('returns the normalized default when items is not an array', () => {
    const raw = JSON.stringify({ version: LAYOUT_VERSION, items: 'nope' })
    const result = loadLayout(raw, WIDGETS, DEFAULT_LAYOUT)
    expect(result).toEqual(normalizeLayout(DEFAULT_LAYOUT, WIDGETS))
  })

  it('returns the normalized default on a version mismatch (version-bump reset)', () => {
    const raw = JSON.stringify({ version: LAYOUT_VERSION + 1, items: DEFAULT_LAYOUT })
    const result = loadLayout(raw, WIDGETS, DEFAULT_LAYOUT)
    expect(result).toEqual(normalizeLayout(DEFAULT_LAYOUT, WIDGETS))
  })

  it('normalizes items from a valid current-version payload', () => {
    const items: LayoutItem[] = [
      { id: 'c', size: 'sm' },
      { id: 'a', size: 'wide' },
      { id: 'b', size: 'xl' },
    ]
    const raw = JSON.stringify({ version: LAYOUT_VERSION, items })
    const result = loadLayout(raw, WIDGETS, DEFAULT_LAYOUT)
    expect(result).toEqual(normalizeLayout(items, WIDGETS))
  })

  it('drops unknown ids found inside an otherwise-valid payload', () => {
    const items: LayoutItem[] = [
      { id: 'a', size: 'sm' },
      { id: 'ghost', size: 'sm' },
      { id: 'b', size: 'lg' },
      { id: 'c', size: 'sm' },
    ]
    const raw = JSON.stringify({ version: LAYOUT_VERSION, items })
    const result = loadLayout(raw, WIDGETS, DEFAULT_LAYOUT)
    expect(result.find((i) => i.id === 'ghost')).toBeUndefined()
  })

  it('degrades gracefully instead of crashing on a hand-corrupted null item (repro)', () => {
    const raw = '{"version":1,"items":[null]}'
    let result: LayoutItem[] = []
    expect(() => {
      result = loadLayout(raw, WIDGETS, DEFAULT_LAYOUT)
    }).not.toThrow()
    expect(result).toEqual(normalizeLayout([], WIDGETS))
  })
})

describe('serializeLayout', () => {
  it('round-trips through loadLayout to the same normalized shape', () => {
    const items: LayoutItem[] = [
      { id: 'c', size: 'sm' },
      { id: 'a', size: 'wide' },
      { id: 'b', size: 'xl' },
    ]
    const raw = serializeLayout(items)
    const loaded = loadLayout(raw, WIDGETS, DEFAULT_LAYOUT)
    expect(loaded).toEqual(normalizeLayout(items, WIDGETS))
  })

  it('always stamps the current LAYOUT_VERSION', () => {
    const raw = serializeLayout(DEFAULT_LAYOUT)
    const parsed = JSON.parse(raw)
    expect(parsed.version).toBe(LAYOUT_VERSION)
    expect(parsed.items).toEqual(DEFAULT_LAYOUT)
  })
})

describe('reorderLayout', () => {
  const items: LayoutItem[] = [
    { id: 'a', size: 'sm' },
    { id: 'b', size: 'lg' },
    { id: 'c', size: 'sm' },
  ]

  it('moves an item forward, inserting it before the target in the reduced array', () => {
    // Drag 'a' onto 'c': remove a -> [b, c]; insert a before c -> [b, a, c]
    const result = reorderLayout(items, 'a', 'c')
    expect(result.map((i) => i.id)).toEqual(['b', 'a', 'c'])
  })

  it('moves an item backward, inserting it before the target in the reduced array', () => {
    // Drag 'c' onto 'a': remove c -> [a, b]; insert c before a -> [c, a, b]
    const result = reorderLayout(items, 'c', 'a')
    expect(result.map((i) => i.id)).toEqual(['c', 'a', 'b'])
  })

  it('is a no-op when draggedId is not found', () => {
    const result = reorderLayout(items, 'ghost', 'b')
    expect(result).toEqual(items)
  })

  it('appends the dragged item to the end when targetId is null', () => {
    const result = reorderLayout(items, 'a', null)
    expect(result.map((i) => i.id)).toEqual(['b', 'c', 'a'])
  })

  it('is a no-op when targetId is not found (does NOT append)', () => {
    const result = reorderLayout(items, 'a', 'ghost')
    expect(result).toEqual(items)
  })

  it('is a no-op when draggedId === targetId', () => {
    const result = reorderLayout(items, 'b', 'b')
    expect(result).toEqual(items)
  })

  it('is a no-op when the dragged item is already immediately before the target', () => {
    // 'a' is already immediately before 'b'
    const result = reorderLayout(items, 'a', 'b')
    expect(result).toEqual(items)
  })

  it('never mutates its input array', () => {
    const snapshot = JSON.parse(JSON.stringify(items))
    reorderLayout(items, 'a', 'c')
    expect(items).toEqual(snapshot)
  })
})

describe('moveItem', () => {
  const items: LayoutItem[] = [
    { id: 'a', size: 'sm' },
    { id: 'b', size: 'lg' },
    { id: 'c', size: 'sm' },
  ]

  it('moves an item up, swapping with its previous neighbor', () => {
    const result = moveItem(items, 'b', 'up')
    expect(result.map((i) => i.id)).toEqual(['b', 'a', 'c'])
  })

  it('moves an item down, swapping with its next neighbor', () => {
    const result = moveItem(items, 'b', 'down')
    expect(result.map((i) => i.id)).toEqual(['a', 'c', 'b'])
  })

  it('is a no-op moving up from index 0', () => {
    const result = moveItem(items, 'a', 'up')
    expect(result).toEqual(items)
  })

  it('is a no-op moving down from the last index', () => {
    const result = moveItem(items, 'c', 'down')
    expect(result).toEqual(items)
  })

  it('is a no-op for an unknown id', () => {
    const result = moveItem(items, 'ghost', 'up')
    expect(result).toEqual(items)
  })

  it('never mutates its input array', () => {
    const snapshot = JSON.parse(JSON.stringify(items))
    moveItem(items, 'b', 'up')
    expect(items).toEqual(snapshot)
  })
})

describe('cycleSize', () => {
  it('cycles to the next supported size', () => {
    const items: LayoutItem[] = [{ id: 'a', size: 'sm' }]
    const result = cycleSize(items, 'a', WIDGETS)
    expect(result).toEqual([{ id: 'a', size: 'wide' }])
  })

  it('wraps from the last size back to the first', () => {
    const items: LayoutItem[] = [{ id: 'b', size: 'xl' }]
    const result = cycleSize(items, 'b', WIDGETS)
    expect(result).toEqual([{ id: 'b', size: 'sm' }])
  })

  it('is a no-op for a single-size widget', () => {
    const items: LayoutItem[] = [{ id: 'c', size: 'sm' }]
    const result = cycleSize(items, 'c', WIDGETS)
    expect(result).toEqual([{ id: 'c', size: 'sm' }])
  })

  it('resets to defaultSize when the current size is not supported', () => {
    const items: LayoutItem[] = [{ id: 'b', size: 'wide' }] // not in b.sizes
    const result = cycleSize(items, 'b', WIDGETS)
    expect(result).toEqual([{ id: 'b', size: 'lg' }]) // b.defaultSize
  })

  it('is a no-op for an unknown id', () => {
    const items: LayoutItem[] = [{ id: 'a', size: 'sm' }]
    const result = cycleSize(items, 'ghost', WIDGETS)
    expect(result).toEqual(items)
  })

  it('never mutates its input array', () => {
    const items: LayoutItem[] = [{ id: 'a', size: 'sm' }]
    const snapshot = JSON.parse(JSON.stringify(items))
    cycleSize(items, 'a', WIDGETS)
    expect(items).toEqual(snapshot)
  })
})

describe('createLayoutReducer', () => {
  const reducer = createLayoutReducer(WIDGETS, DEFAULT_LAYOUT)
  const state: LayoutItem[] = [
    { id: 'a', size: 'sm' },
    { id: 'b', size: 'lg' },
    { id: 'c', size: 'sm' },
  ]

  it('hydrate normalizes incoming items', () => {
    const incoming: LayoutItem[] = [
      { id: 'a', size: 'sm' },
      { id: 'ghost', size: 'sm' },
      { id: 'b', size: 'lg' },
      { id: 'c', size: 'sm' },
    ]
    const result = reducer(state, { type: 'hydrate', items: incoming })
    expect(result).toEqual(normalizeLayout(incoming, WIDGETS))
  })

  it('reorder delegates to reorderLayout', () => {
    const result = reducer(state, { type: 'reorder', draggedId: 'a', targetId: 'c' })
    expect(result).toEqual(reorderLayout(state, 'a', 'c'))
  })

  it('move delegates to moveItem', () => {
    const result = reducer(state, { type: 'move', id: 'b', dir: 'up' })
    expect(result).toEqual(moveItem(state, 'b', 'up'))
  })

  it('resize delegates to cycleSize', () => {
    const result = reducer(state, { type: 'resize', id: 'a' })
    expect(result).toEqual(cycleSize(state, 'a', WIDGETS))
  })

  it('reset returns a normalized copy of defaultLayout', () => {
    const messyDefault: LayoutItem[] = [
      { id: 'ghost', size: 'sm' },
      { id: 'a', size: 'sm' },
      { id: 'b', size: 'lg' },
      // 'c' intentionally missing
    ]
    const reducerWithMessyDefault = createLayoutReducer(WIDGETS, messyDefault)
    const result = reducerWithMessyDefault(state, { type: 'reset' })
    expect(result).toEqual(normalizeLayout(messyDefault, WIDGETS))
  })

  it('leaves state unchanged for an unknown action type', () => {
    const unknownAction = { type: 'bogus' } as unknown as LayoutAction
    const result = reducer(state, unknownAction)
    expect(result).toEqual(state)
  })
})
