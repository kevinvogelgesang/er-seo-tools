# Plan: Add Favicon (ER Orange Box)

## Current State

- No favicon configured in `app/layout.tsx`
- `public/` directory is empty
- The ER logo exists only as a React component (pure CSS: orange `div` with "ER" text in Barlow Extrabold)
- No SVG or image source file exists — must be created

---

## Approach: app/icon.svg (Next.js 15 App Router)

Next.js 15 natively supports `app/icon.svg` — it auto-generates the `<link rel="icon">` tag without any metadata config. This is the cleanest approach.

---

## Step 1: Create the SVG

Create `app/icon.svg` with the ER orange box design, matching the nav exactly:

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <!-- Orange rounded rectangle background -->
  <rect width="32" height="32" rx="4" fill="#f5a623"/>
  <!-- "ER" text in navy, Barlow Extrabold equivalent -->
  <text
    x="16"
    y="22"
    text-anchor="middle"
    font-family="'Barlow', 'Arial Black', sans-serif"
    font-weight="800"
    font-size="13"
    letter-spacing="-0.5"
    fill="#1c2d4a"
  >ER</text>
</svg>
```

**Colors from `tailwind.config.ts`:**
- Orange: `#f5a623`
- Navy: `#1c2d4a`

**Note on font:** `app/icon.svg` is served as a static file — the Barlow font won't load from Google Fonts in this context. Use `font-family="'Barlow', 'Arial Black', sans-serif"` with `font-weight="800"`. For pixel-perfect matching, embed the path data for "ER" glyphs instead (see Option B below).

---

## Option B: Embedded Paths (Most Reliable)

If the text doesn't render correctly due to font availability, use a React-based icon generator. Next.js supports `app/icon.tsx` as a route that returns an `ImageResponse`:

**Create `app/icon.tsx`:**
```typescript
import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 32,
          height: 32,
          borderRadius: 4,
          backgroundColor: '#f5a623',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            color: '#1c2d4a',
            fontSize: 13,
            fontWeight: 800,
            letterSpacing: '-0.5px',
            lineHeight: 1,
          }}
        >
          ER
        </span>
      </div>
    ),
    { ...size }
  )
}
```

**Pros:** Uses `next/og` (ImageResponse) which renders with a built-in font engine — no external font dependency. Generates a PNG automatically.

**Cons:** Adds `next/og` as a dependency (it's already part of Next.js, no extra install). Slightly more code.

---

## Also: Apple Touch Icon (Optional)

For iOS home screen bookmarks, add `app/apple-icon.tsx` using the same pattern but `size = { width: 180, height: 180 }`.

---

## Recommendation

**Use Option B (`app/icon.tsx` with ImageResponse)** — the most reliable, handles font rendering correctly, no external files needed.

---

## Files to Create

| File | Description |
|------|-------------|
| `app/icon.tsx` | Next.js App Router icon route using ImageResponse |
| `app/apple-icon.tsx` | (Optional) Apple touch icon at 180×180 |

## Files to Change

None required — Next.js auto-discovers `app/icon.tsx`.

## Effort

Tiny — one new file, ~20 lines.
