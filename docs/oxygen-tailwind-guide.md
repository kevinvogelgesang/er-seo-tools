# Oxygen Builder + Tailwind CSS — Beginner's Guide

A practical, opinionated reference for building WordPress sites with **Oxygen Builder 6** and **Tailwind CSS**. Written for someone who has used a page builder before but is new to both Oxygen and Tailwind. Read the Tailwind reference section in full — that's where most of your day-to-day time will be spent.

---

## Table of contents

1. [What Oxygen Builder is and why use it](#1-what-oxygen-builder-is-and-why-use-it)
2. [The Oxygen interface](#2-the-oxygen-interface)
3. [Core concepts](#3-core-concepts)
4. [Getting started: install, theme, first page](#4-getting-started-install-theme-first-page)
5. [Adding Tailwind to Oxygen](#5-adding-tailwind-to-oxygen)
6. [Tailwind CSS reference (verbose)](#6-tailwind-css-reference-verbose)
7. [Common workflows](#7-common-workflows)
8. [Tips, gotchas, and best practices](#8-tips-gotchas-and-best-practices)

---

## 1. What Oxygen Builder is and why use it

**Oxygen Builder** is a visual WordPress site builder that disables the WordPress theme system and lets you design every pixel of every page from inside its own editor. Unlike Elementor or Divi, Oxygen does not ship a theme; **Oxygen *replaces* your theme**. The header, footer, archive, single-post, 404, and even the homepage are all built inside Oxygen using its templating system.

The current major release is **Oxygen 6**, released February 2026. It is a complete rebuild of the previous Angular-based 3.x/4.x line. Key things Oxygen 6 emphasizes:

- **Clean, semantic HTML output.** The properties panel maps directly to CSS — there is no "wrap your text in 14 nested divs" tax.
- **Full CSS variable support**, so design tokens can be defined once and used everywhere.
- **Reusable Components** (think: symbols / instances) that update site-wide when edited.
- **Loop Builders** for posts, custom post types, and taxonomy terms — the WordPress equivalent of mapping over data.
- **Element Studio** for building your own custom builder elements visually.
- **Dynamic Data** integrations with Advanced Custom Fields (ACF) and Meta Box.

### Why pick Oxygen over other builders

| You want | Oxygen is a fit when |
|---|---|
| Lean HTML/CSS output | Yes — minimal wrapper divs, clean class names |
| Total control over markup | Yes — every element exposes its tag, class, ID |
| To use Tailwind / utility CSS | Yes — works well via WindPress, Winden, OxyMade, etc. |
| To never touch code | Maybe not — Oxygen rewards developers more than it rewards designers-only |
| A drag-and-drop "block library" workflow like Elementor | Not its strong suit — Oxygen is more "design system + components" |

**Mental model:** Oxygen is the WordPress equivalent of Webflow with a developer slant — it gives you the visual canvas, but assumes you can read CSS.

---

## 2. The Oxygen interface

Open any post or page and click **Edit with Oxygen** to launch the builder. The editor takes over the whole browser tab.

```
┌─────────────────────────────────────────────────────────────────────┐
│  TOP BAR  (mode • viewport • undo/redo • save • exit)               │
├──────────┬───────────────────────────────────────────┬──────────────┤
│          │                                           │              │
│ STRUCTURE│             CANVAS                        │  PROPERTIES  │
│   TREE   │      (live preview of the page)           │    PANEL     │
│          │                                           │              │
│ +Add     │                                           │  Primary /   │
│ Element  │                                           │  Advanced    │
│ Library  │                                           │  Tabs        │
│          │                                           │              │
└──────────┴───────────────────────────────────────────┴──────────────┘
```

### The five regions

1. **Top bar** — global actions:
   - **View mode** (Build / Preview)
   - **Responsive viewport** (Desktop, Tablet, Phone Landscape, Phone Portrait, plus custom breakpoints in v6)
   - **Undo / Redo**, **Save**, **Manage** (templates, components, settings), **Exit**
2. **Left rail / Add panel** — opens the **Element Library** (Section, Div, Heading, Text, Link, Button, Image, Icon, etc.) and the **Reusable Components** library.
3. **Structure tree** — DOM-style tree of every element on the page. This is your single most important navigation tool. Click any node to select it; drag to rearrange.
4. **Canvas** — live, in-browser preview of the page being edited. Click an element here to select it.
5. **Properties panel** — edits the selected element. Two main tabs:
   - **Primary** — common, element-specific controls (Typography for a Heading, Source for an Image, etc.)
   - **Advanced** — universal controls available on every element: Layout, Size, Spacing, Borders, Effects, Position, Transform, Conditions, Attributes, Custom CSS

### Key shortcuts

| Action | Shortcut |
|---|---|
| Save | `Ctrl/Cmd + S` |
| Undo | `Ctrl/Cmd + Z` |
| Redo | `Ctrl/Cmd + Shift + Z` |
| Toggle preview mode | `Ctrl/Cmd + P` |
| Search elements / actions | `Ctrl/Cmd + K` (v6) |

---

## 3. Core concepts

### Elements

Everything on a page is an **element**. Elements come in two flavors:

- **Containers** — `Section`, `Div`, `Columns`. They hold other elements.
- **Atoms** — `Heading`, `Text`, `Link`, `Image`, `Icon`, `Button`, `Code Block`, etc. They render content.

Every element exposes:
- **Tag** (`div`, `section`, `article`, `nav`, `header`, …)
- **ID** (auto-generated; you can rename for readability)
- **Classes** (this is where Tailwind utility classes go — see §5)
- **HTML attributes** (data-*, aria-*, role, etc.)

### Templates

Templates control which pages or post types display what layout, **outside** of your page content. You'll typically build:

- **Main Template** — wraps the whole site (header + footer)
- **Single - Post** — layout for any blog post
- **Single - Page** — layout for any page (often inherits from Main)
- **Archive - Category** — layout for category listings
- **Search Results**
- **404**

Each template has **conditions** that decide where it applies (e.g. "Post Type is Post" or "Page is Front Page"). When conditions overlap, the **Priority** field decides which wins (higher number wins).

### Reusable Components (Oxygen 6)

A Reusable Component is a saved chunk of design (e.g. your site header, a CTA card, a pricing tier) that can be **inserted anywhere** and edited **once** to update **everywhere**. Components can have **parameters** so each instance can pass in different content (icon, title, link) while sharing the design.

This is the closest thing Oxygen has to React components. Use them aggressively — they are the antidote to copy-paste hell.

### Global Styles & CSS variables

In **Manage → Stylesheets** you can define site-wide CSS. In **Manage → Settings → Global Styles** you define design tokens (colors, font sizes, spacing) as CSS variables. These then appear throughout the editor as named pickers (e.g. choose "Brand Primary" instead of `#3366ff`).

When using Tailwind, your tokens generally live in `tailwind.config` or a `@theme` block — but Oxygen's Global Styles are still useful for non-utility values (custom shadows, gradients, animations).

### Conditions

Almost any element can be conditionally shown/hidden via **Advanced → Conditions**. Common uses: hide a "Login" button when the user is logged in; show a banner only on the homepage; toggle by URL parameter.

---

## 4. Getting started: install, theme, first page

### 4.1 Prerequisites

- A WordPress site (5.6+) you control. **Take a backup.** Oxygen will disable your active theme.
- An Oxygen Builder license (commercial) — buy from [oxygenbuilder.com](https://oxygenbuilder.com/).

### 4.2 Install

1. WordPress admin → **Plugins → Add New → Upload Plugin** → upload `oxygen.zip`.
2. **Activate** the plugin.
3. Enter your license key under **Oxygen → Settings → License**.
4. Visit the front of your site — it will look unstyled. **This is normal.** Oxygen has disabled your theme's CSS but you haven't built anything yet.

### 4.3 Build a Main Template (header + footer)

This is the very first thing to do, before any pages.

1. **Oxygen → Templates → Add New**
2. Name it `Main`
3. Set **Inheritance** = none, **Apply to** = Entire Site, **Priority** = 0
4. Click **Edit with Oxygen**
5. Add a **Section** at the top → set tag to `header`. Drop in a Logo image, a Nav menu, etc.
6. At the bottom, add a `Inner Content` element — this is the slot where individual page/post bodies will render.
7. After Inner Content, add another **Section** → tag `footer`, drop in your footer content.
8. Save.

### 4.4 Build your first page

1. WordPress admin → **Pages → Add New** (or open an existing page).
2. Click **Edit with Oxygen**.
3. Build your page content — it will render *inside* the Main template's `Inner Content` slot.
4. Save.

That's it. You now have a styled site frame and one page.

---

## 5. Adding Tailwind to Oxygen

Oxygen does **not ship with Tailwind**. You add it via a plugin. The most common options today:

| Plugin | Why pick it |
|---|---|
| **WindPress** | Free + Pro. JIT Tailwind v3/v4 inside WP, no build step. Adds a "Plain Classes" input to every Oxygen element with autocomplete, hover preview, sorting, variable picker. Most popular choice in 2026. |
| **Winden** | dPlugins. Similar feature set, includes a "Dequeue builder styles" toggle to strip Oxygen's default CSS so Tailwind isn't fighting it. |
| **OxyMade / OxyNinja / OxyWind** | Tailwind-style utility frameworks tailored to Oxygen, not raw Tailwind. Good if you want batteries-included. |
| **TailPress** | Free, simpler, less Oxygen-specific tooling. |

The rest of this guide assumes **WindPress** because it has the smoothest Oxygen 6 integration and works with stock Tailwind v4.

### 5.1 Install WindPress

1. **Plugins → Add New** → search `WindPress` → install + activate.
2. Open **WindPress → Settings**:
   - Confirm Oxygen integration is enabled
   - Pick Tailwind v3 or v4 (v4 recommended for new projects)
   - Optionally enable **"Sort classes"** and **"Autocomplete"**

### 5.2 Where Tailwind classes go in Oxygen

There are two places you can put a class on an Oxygen element:

1. **Native Oxygen "CSS Classes" field** (Properties panel → Advanced → "Selectors"/"Classes")
   - Designed for *named* classes that get a stylesheet rule (e.g. `.cta-card`)
   - Adding utility classes here works, but Oxygen will sometimes treat them as CSS rule names
2. **WindPress "Plain Classes" field** (added by the plugin, sits at the top of the Properties panel)
   - This is where Tailwind utilities should live
   - Autocomplete, hover preview, automatic class sorting
   - WindPress writes these straight to the element's `class=""` attribute in the rendered HTML

**Rule of thumb:** named/component classes (`.btn`, `.card`) → Oxygen's Selectors field; utility classes (`flex`, `gap-4`, `bg-slate-900`) → WindPress Plain Classes field.

### 5.3 Stop Oxygen styles from fighting Tailwind

Oxygen ships small default styles (resets, default body font, etc.). Two things to do:

1. In Oxygen's **Manage → Settings → Global Styles**, clear/replace the defaults you don't want.
2. In Winden/WindPress, enable **"Dequeue builder styles"** if you want to fully delegate styling to Tailwind.

### 5.4 Custom Tailwind config

WindPress exposes a `tailwind.config.js` (v3) or `main.css` with `@theme` block (v4) inside its admin UI. Use it to:

- Add brand colors: `colors: { brand: { 500: '#3366ff' } }`
- Add custom spacing
- Add custom fonts
- Enable plugins (`@tailwindcss/typography`, `forms`, etc.)

After saving, the JIT engine regenerates the CSS automatically — no terminal, no `npm run build`.

---

## 6. Tailwind CSS reference (verbose)

This section assumes zero Tailwind background. Read it linearly the first time, then come back to it as a lookup.

### 6.1 The utility-class philosophy

Traditional CSS:

```css
.hero-title {
  font-size: 3rem;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 1.5rem;
}
```

```html
<h1 class="hero-title">Welcome</h1>
```

Tailwind:

```html
<h1 class="text-5xl font-bold text-slate-900 mb-6">Welcome</h1>
```

Each utility class **does one thing**. You compose dozens of them on a single element. The benefits:

- No naming things (no more `.hero-title-wrapper-inner`)
- No context-switching to a separate stylesheet
- No dead CSS — Tailwind only ships utilities you actually used
- Visual consistency comes from the **design tokens** Tailwind enforces (the spacing scale, color shades), not from your discipline

The drawback is class-string verbosity. Mitigate by extracting repeated patterns into Reusable Components in Oxygen, or `@apply` directives in your CSS.

### 6.2 Spacing (`p`, `m`, `gap`, `space`)

Tailwind spacing uses a numeric scale where **1 unit = 0.25rem = 4px** (by default).

```
0   = 0px
0.5 = 2px
1   = 4px
2   = 8px
3   = 12px
4   = 16px   ← default body text spacing
5   = 20px
6   = 24px
8   = 32px
10  = 40px
12  = 48px
16  = 64px
20  = 80px
24  = 96px
32  = 128px
```

Padding (`p`) and margin (`m`) follow this pattern:

| Class | Effect |
|---|---|
| `p-4` | padding on all 4 sides = 16px |
| `pt-2` | padding-top = 8px |
| `pr-4` | padding-right = 16px |
| `pb-6` | padding-bottom = 24px |
| `pl-3` | padding-left = 12px |
| `px-4` | padding left + right = 16px |
| `py-2` | padding top + bottom = 8px |
| `m-4`, `mt-`, `mr-`, `mb-`, `ml-`, `mx-`, `my-` | same pattern for margin |
| `mx-auto` | horizontally center a block element |
| `-mt-4` | negative margin (note the leading `-`) |

For spacing **between siblings inside a flex/grid container**, prefer `gap-*`:

```html
<div class="flex gap-4">…</div>   <!-- 16px between flex children -->
<div class="grid gap-6">…</div>
```

`space-x-4` / `space-y-4` add margin between siblings (older pattern, useful when `gap` doesn't apply).

### 6.3 Sizing (`w`, `h`, `max-w`, `min-h`)

Same numeric scale, plus fractions, percentages, and named sizes.

| Class | Effect |
|---|---|
| `w-4` | width = 16px |
| `w-1/2` | width = 50% |
| `w-full` | width = 100% |
| `w-screen` | width = 100vw |
| `w-fit` | width fits content |
| `w-auto` | width: auto |
| `max-w-md` | max-width = 28rem (448px) — common for body text |
| `max-w-7xl` | max-width = 80rem (1280px) — common page container |
| `min-h-screen` | min-height = 100vh — full viewport height hero |
| `h-12` | height = 48px |
| `aspect-video` / `aspect-square` | locked aspect ratio |

**Common max-width scale**: `max-w-xs` (320px) → `sm` (384) → `md` (448) → `lg` (512) → `xl` (576) → `2xl` (672) → `3xl` … → `7xl` (1280px) → `full` (100%).

### 6.4 Typography

```html
<h1 class="text-4xl font-bold leading-tight tracking-tight text-slate-900">
  Hello
</h1>
```

- **Font size**: `text-xs` (12px) → `text-sm` (14) → `text-base` (16, default) → `text-lg` (18) → `text-xl` (20) → `text-2xl` (24) → `3xl` (30) → `4xl` (36) → `5xl` (48) → `6xl` (60) → `7xl` (72) → `8xl` (96) → `9xl` (128).
- **Font weight**: `font-thin` (100) → `font-light` (300) → `font-normal` (400) → `font-medium` (500) → `font-semibold` (600) → `font-bold` (700) → `font-extrabold` (800) → `font-black` (900).
- **Line height** (`leading-*`): `leading-none` (1), `leading-tight` (1.25), `leading-snug` (1.375), `leading-normal` (1.5), `leading-relaxed` (1.625), `leading-loose` (2). Or numeric: `leading-6` = 1.5rem.
- **Letter spacing** (`tracking-*`): `tracking-tighter`, `tracking-tight`, `tracking-normal`, `tracking-wide`, `tracking-wider`, `tracking-widest`.
- **Alignment**: `text-left`, `text-center`, `text-right`, `text-justify`.
- **Decoration**: `underline`, `no-underline`, `line-through`, `decoration-2`, `decoration-blue-500`.
- **Transform**: `uppercase`, `lowercase`, `capitalize`, `normal-case`.
- **Family**: `font-sans`, `font-serif`, `font-mono` (define your own families in your Tailwind config).
- **Color**: `text-slate-900`, `text-white`, `text-blue-600` — see §6.5.

For long-form prose, install `@tailwindcss/typography` and add `prose prose-lg prose-slate` to a wrapper.

### 6.5 Color system

Tailwind colors are named like `{hue}-{shade}`:

- **Hues**: `slate`, `gray`, `zinc`, `neutral`, `stone` (the five neutrals), then `red`, `orange`, `amber`, `yellow`, `lime`, `green`, `emerald`, `teal`, `cyan`, `sky`, `blue`, `indigo`, `violet`, `purple`, `fuchsia`, `pink`, `rose`.
- **Shades**: `50` (lightest, almost white) → `100` → `200` → `300` → `400` → `500` (the "core" shade) → `600` → `700` → `800` → `900` → `950` (darkest, near black).

Plus: `white`, `black`, `transparent`, `current` (currentColor), `inherit`.

Where colors apply (the prefix tells you which CSS property):

| Prefix | CSS property |
|---|---|
| `text-{color}` | text color |
| `bg-{color}` | background color |
| `border-{color}` | border color |
| `ring-{color}` | focus ring color |
| `outline-{color}` | outline color |
| `placeholder-{color}` | input placeholder color |
| `from-{color}` / `via-{color}` / `to-{color}` | gradient stops |
| `divide-{color}` | borders between siblings |
| `decoration-{color}` | underline color |
| `accent-{color}` | accent color (checkboxes, range inputs) |
| `caret-{color}` | text caret color |
| `fill-{color}` / `stroke-{color}` | SVG |

**Opacity** is a slash suffix: `bg-blue-500/50` = blue-500 at 50% alpha. Common values: `/10`, `/20`, `/40`, `/50`, `/75`, `/90`.

**Custom brand colors**: define in your Tailwind config and they appear in the same naming scheme — `text-brand-500`, `bg-brand-100`, etc.

### 6.6 Flexbox

```html
<div class="flex items-center justify-between gap-4">
  <img class="w-10 h-10 rounded-full" />
  <span class="font-medium">Jane Doe</span>
  <button>Follow</button>
</div>
```

| Class | What it does |
|---|---|
| `flex` | display: flex (default direction = row) |
| `inline-flex` | display: inline-flex |
| `flex-row` / `flex-row-reverse` | direction |
| `flex-col` / `flex-col-reverse` | stack vertically |
| `flex-wrap` / `flex-nowrap` | wrapping |
| `items-start` / `items-center` / `items-end` / `items-stretch` / `items-baseline` | cross-axis alignment |
| `justify-start` / `justify-center` / `justify-end` / `justify-between` / `justify-around` / `justify-evenly` | main-axis distribution |
| `content-*` | aligns multi-row content |
| `self-start` / `self-center` / `self-end` / `self-stretch` | per-child cross-axis override |
| `flex-1` | grow + shrink to fill remaining space |
| `flex-auto` | grow + shrink based on content |
| `flex-none` | don't grow or shrink |
| `grow` / `grow-0` | flex-grow |
| `shrink` / `shrink-0` | flex-shrink |
| `order-1` … `order-12`, `order-first`, `order-last` | reorder children |

**Mental model**: in a `flex flex-row`, `items-*` controls the **vertical** alignment and `justify-*` controls the **horizontal** distribution. Flip those when you switch to `flex-col`.

### 6.7 Grid

```html
<div class="grid grid-cols-3 gap-6">
  <div>1</div><div>2</div><div>3</div>
  <div class="col-span-2">4–5</div>
  <div>6</div>
</div>
```

| Class | What it does |
|---|---|
| `grid` | display: grid |
| `grid-cols-1` … `grid-cols-12` | N equal columns |
| `grid-cols-none` | clear columns |
| `grid-rows-1` … `grid-rows-6` | N equal rows |
| `col-span-2` … `col-span-full` | element spans N columns |
| `row-span-*` | element spans N rows |
| `col-start-2` / `col-end-4` | explicit placement |
| `gap-4`, `gap-x-4`, `gap-y-2` | gutters |
| `auto-cols-*`, `auto-rows-*` | implicit track sizing |
| `grid-flow-row` / `grid-flow-col` / `grid-flow-dense` | auto-placement direction |

For card-grid layouts, the workhorse is something like:

```html
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  <!-- cards -->
</div>
```

### 6.8 Responsive prefixes (mobile-first)

Tailwind is **mobile-first**: an unprefixed class applies at every screen size. A prefixed class applies at that breakpoint **and up**.

| Prefix | Min width | Typical device |
|---|---|---|
| (none) | 0 | mobile |
| `sm:` | 640px | large phone |
| `md:` | 768px | tablet |
| `lg:` | 1024px | small laptop |
| `xl:` | 1280px | desktop |
| `2xl:` | 1536px | large desktop |

```html
<!-- 1 column on mobile, 2 from tablet up, 3 from laptop up -->
<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
```

Read the class string left-to-right as "mobile, then tablet, then desktop". You almost never need to write a `max-` style query; instead, design the small layout first and add overrides for bigger screens.

To target **only one breakpoint**, combine: `md:flex lg:hidden` = visible on tablet only.

### 6.9 State variants

Prefix any utility with a state to apply it only in that state:

| Variant | Triggers when |
|---|---|
| `hover:` | mouse hover |
| `focus:` | element is focused (input, button) |
| `focus-visible:` | focused via keyboard |
| `focus-within:` | a descendant is focused |
| `active:` | mouse-down |
| `disabled:` | element is `disabled` |
| `checked:` | checkbox/radio is checked |
| `group-hover:` | parent marked `group` is hovered |
| `peer-focus:` | a sibling marked `peer` is focused |
| `dark:` | dark mode active (`html.dark` by default in v4) |
| `first:` / `last:` / `odd:` / `even:` | child position |
| `aria-expanded:` / `data-[state=open]:` | aria/data attribute states |
| `motion-reduce:` / `motion-safe:` | user motion preference |
| `print:` | printing |

```html
<button class="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 focus-visible:ring-2 focus-visible:ring-blue-300">
  Save
</button>
```

Stack variants by chaining: `md:hover:bg-blue-700` = on hover, on tablet+.

### 6.10 Borders, shadows, rounded corners

**Borders**:

```
border           = 1px on all sides
border-2         = 2px
border-t         = top only
border-x         = left + right
border-blue-500  = color
border-dashed / border-dotted / border-solid / border-none
divide-y         = horizontal lines between vertically stacked children
```

**Rounded corners**:

```
rounded         = 4px on all corners
rounded-md      = 6px
rounded-lg      = 8px
rounded-xl      = 12px
rounded-2xl     = 16px
rounded-3xl     = 24px
rounded-full    = pill / circle
rounded-t-lg    = top corners only
rounded-tl-lg   = top-left only
```

**Shadows**:

```
shadow-sm       = subtle
shadow          = default
shadow-md       = card-ish
shadow-lg       = lifted
shadow-xl       = strong
shadow-2xl      = dramatic
shadow-none     = remove
shadow-inner    = inset
shadow-blue-500/50  = colored shadow (v3+)
```

**Rings** (a second outline, popular for focus):

```
ring        = 3px ring
ring-2      = 2px ring
ring-blue-300
ring-offset-2 ring-offset-white
```

### 6.11 Common UI patterns

#### Card

```html
<article class="rounded-2xl bg-white p-6 shadow-md ring-1 ring-slate-900/5 hover:shadow-lg transition-shadow">
  <h3 class="text-lg font-semibold text-slate-900">Card title</h3>
  <p class="mt-2 text-sm text-slate-600">A short description that explains the card.</p>
  <a href="#" class="mt-4 inline-block text-sm font-medium text-blue-600 hover:text-blue-700">
    Learn more →
  </a>
</article>
```

#### Primary button

```html
<button class="inline-flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-not-allowed disabled:opacity-50">
  Save changes
</button>
```

#### Secondary / ghost button

```html
<button class="inline-flex items-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
  Cancel
</button>
```

#### Sticky top nav

```html
<header class="sticky top-0 z-40 w-full border-b border-slate-200 bg-white/80 backdrop-blur">
  <div class="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
    <a href="/" class="text-lg font-bold">Acme</a>
    <nav class="hidden md:flex items-center gap-6 text-sm font-medium text-slate-700">
      <a href="#" class="hover:text-slate-900">Features</a>
      <a href="#" class="hover:text-slate-900">Pricing</a>
      <a href="#" class="hover:text-slate-900">About</a>
    </nav>
    <button class="md:hidden">☰</button>
  </div>
</header>
```

#### Hero section

```html
<section class="relative isolate overflow-hidden bg-gradient-to-b from-slate-50 to-white">
  <div class="mx-auto max-w-7xl px-4 py-24 text-center">
    <h1 class="text-4xl md:text-6xl font-bold tracking-tight text-slate-900">
      Build sites faster.
    </h1>
    <p class="mx-auto mt-6 max-w-2xl text-lg text-slate-600">
      Oxygen + Tailwind gives you full control over your markup and your design system.
    </p>
    <div class="mt-10 flex items-center justify-center gap-4">
      <a class="rounded-lg bg-blue-600 px-6 py-3 text-white font-medium hover:bg-blue-700">
        Get started
      </a>
      <a class="text-slate-700 hover:text-slate-900">Learn more →</a>
    </div>
  </div>
</section>
```

#### Form input

```html
<label class="block">
  <span class="block text-sm font-medium text-slate-700">Email</span>
  <input type="email" class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500" />
</label>
```

---

## 7. Common workflows

### 7.1 Build a marketing page layout

1. **Open the page** → Edit with Oxygen.
2. **Add a Section** → tag `section`. In WindPress Plain Classes: `relative isolate overflow-hidden bg-slate-50`.
3. **Inside it**, add a **Div** → tag `div`. Plain Classes: `mx-auto max-w-7xl px-4 py-24`.
4. Inside that, add a **Heading** (`h1`) and a **Text** (`p`), then a **Div** with two **Buttons** inside.
5. Apply utility classes per §6.11 hero example.
6. Repeat for "Features", "Testimonials", "CTA", "Footer" sections.
7. Switch the responsive viewport between phone, tablet, desktop and adjust with `md:` and `lg:` prefixes.

### 7.2 Make a card a Reusable Component

1. Build the card once with all its Tailwind classes.
2. Right-click in the structure tree → **Convert to Component**.
3. Give it a name (e.g. `Feature Card`).
4. In the component editor, mark the **Heading** and **Text** elements as **parameters** so each instance can pass its own copy.
5. Save. Now insert `Feature Card` from the Components library wherever needed and fill in the parameter fields.
6. Edit the component once → every instance updates.

### 7.3 Define brand colors once, use everywhere

In WindPress's `tailwind.config.js` (v3) or `main.css` (v4):

**v3**:
```js
module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff', 100: '#e0e7ff', 500: '#3366ff', 700: '#1e40af',
        },
      },
    },
  },
};
```

**v4** (in `main.css`):
```css
@import "tailwindcss";

@theme {
  --color-brand-50:  #eef2ff;
  --color-brand-500: #3366ff;
  --color-brand-700: #1e40af;
}
```

Now you can write `bg-brand-500`, `text-brand-700`, etc. throughout Oxygen.

### 7.4 Conditionally show content

Example: hide a "Subscribe" CTA from logged-in users.

1. Select the CTA element in Oxygen.
2. Properties → Advanced → **Conditions**.
3. Add condition: `User is Logged In` = `false`.
4. Save.

### 7.5 Use Dynamic Data with ACF

1. Install ACF, define a field group on a CPT (e.g. `Job Listings` with fields `salary_range`, `location`).
2. In Oxygen, edit the **Single - Job Listing** template.
3. Add a Heading. In its Primary tab, click the **Insert Data** icon → choose ACF → pick `salary_range`.
4. Style the heading with Tailwind classes — the styling persists across every post.

---

## 8. Tips, gotchas, and best practices

### Workflow

- **Always build the Main Template first.** Without it, every page renders unstyled.
- **Build mobile first**: design at the smallest viewport, then add `md:` / `lg:` overrides.
- **Use Reusable Components early.** Once you copy-paste a card twice, convert it.
- **Save often.** The browser editor is a long-running app; refresh recovery exists but is not magic.
- **Keep a staging site.** Oxygen takes over your theme — do not learn it on production.

### Tailwind specifics

- **Sort your classes.** WindPress can do it automatically. A consistent order (layout → spacing → sizing → typography → color → effects → state) is much easier to scan.
- **Don't fight the scale.** If a design needs `padding: 17px`, ask whether `p-4` (16px) is fine. Arbitrary values like `p-[17px]` exist but should be rare.
- **Use `@apply` sparingly.** It re-creates the named-class problem Tailwind exists to solve. Reserve it for true repeating components — buttons, form inputs.
- **Watch class string length.** If a single element has 30+ classes, that's a hint to break it into a Reusable Component or extract a `@apply`'d component class.
- **The `space-y-*` / `divide-y` pattern only works with direct children.** Wrapping with another div breaks it.
- **Forgetting `flex` or `grid` on the parent** is the #1 reason `gap-*` "doesn't work."

### Oxygen specifics

- **Don't put Tailwind utilities in Oxygen's "Selectors / Classes" field**, use the WindPress "Plain Classes" input. The Selectors field treats classes as named selectors that get their own stylesheet rules — utilities will get redundant CSS dumped into your output.
- **Disable Oxygen's default body font** in Manage → Global Styles if you want Tailwind's `font-sans` to actually be your font.
- **Backups before plugin updates.** Major Oxygen updates (5 → 6, etc.) are heavy lifts. Test on staging first.
- **Component parameters are nullable.** Always provide sensible defaults so an empty parameter doesn't break the layout.
- **Inner Content is required in the Main Template.** If your pages render blank, that's almost always why.

### Performance

- Run **Manage → CSS Cache → Regenerate** after large changes.
- WindPress JIT only ships the utilities you've used — but if a class is generated dynamically (in PHP, etc.) you may need to add it to the **safelist** in your config.
- Don't include `@tailwindcss/typography` and `@tailwindcss/forms` if you aren't using them — they each add CSS weight.
- For images, prefer Oxygen's Image element + WordPress media library (gives you responsive `srcset` automatically) over hand-rolled `<img>` tags.

### Debugging

- If a class isn't applying: open browser devtools, inspect the element, check whether the class is in the rendered `class=""` string (WindPress writes it there). If yes but no style → the utility wasn't generated (typo, not in safelist). If no → the class never made it onto the element.
- If your changes don't show on the front-end: clear Oxygen's CSS cache, clear your page cache, hard-refresh (`Cmd/Ctrl + Shift + R`).
- If the Oxygen editor itself looks broken: deactivate WindPress temporarily — utility plugins can occasionally conflict with editor styles after major Oxygen updates.

---

## Quick links

- Oxygen Builder docs — https://oxygenbuilder.com/documentation/
- Tailwind CSS docs — https://tailwindcss.com/docs
- WindPress docs — https://wind.press/

That's the whole loop: Oxygen gives you the page structure and templating, WindPress (or your chosen integration) puts Tailwind's utility engine inside the Oxygen editor, and you build with `class=""` strings instead of hand-written CSS. Once that mental model clicks, the only ceiling is your design taste.
