// Shared theme definitions for the playground iframe and DaisyUI live previews.
// All previews share the same Tailwind v4 + DaisyUI v5 CDN setup; only the
// brand-token @theme block + DaisyUI data-theme differ between themes.

export type ThemeId = 'pro-way' | 'demo-mint' | 'light' | 'dark'

export interface ThemeDef {
  id: ThemeId
  label: string
  hint: string
  /** DaisyUI data-theme attribute on <html>. */
  daisyTheme: 'light' | 'dark'
  /** Brand-token @theme overrides. Empty string for "stock DaisyUI defaults, no overrides". */
  themeBlock: string
}

export const THEMES: ThemeDef[] = [
  {
    id: 'pro-way',
    label: 'Pro Way',
    hint: 'navy + orange',
    daisyTheme: 'light',
    themeBlock: `@theme {
  --color-primary:   #0b192e;
  --color-secondary: #32435e;
  --color-tertiary:  #e6963d;
  --font-headings: ui-sans-serif, system-ui, sans-serif;
}`,
  },
  {
    id: 'demo-mint',
    label: 'Demo Mint',
    hint: 'teal + amber',
    daisyTheme: 'light',
    themeBlock: `@theme {
  --color-primary:   #0f766e;
  --color-secondary: #134e4a;
  --color-tertiary:  #f59e0b;
  --font-headings: 'Georgia', serif;
}`,
  },
  {
    id: 'light',
    label: 'DaisyUI Light',
    hint: 'stock defaults',
    daisyTheme: 'light',
    themeBlock: '',
  },
  {
    id: 'dark',
    label: 'DaisyUI Dark',
    hint: 'stock defaults',
    daisyTheme: 'dark',
    themeBlock: '',
  },
]

export function getTheme(id: ThemeId): ThemeDef {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}

/**
 * Build the srcDoc HTML for a sandboxed Tailwind v4 + DaisyUI v5 preview iframe.
 * Matches the FusionCore production stack.
 */
export function buildPreviewSrcDoc(
  innerHtml: string,
  themeId: ThemeId,
  options: { bg?: 'light' | 'dark'; centered?: boolean } = {}
): string {
  const theme = getTheme(themeId)
  const { bg, centered = true } = options
  // If no explicit bg requested, mirror the daisy theme.
  const effectiveBg = bg ?? (theme.daisyTheme === 'dark' ? 'dark' : 'light')
  const bodyBgClass = effectiveBg === 'dark' ? 'bg-base-300' : 'bg-base-200'
  const layoutClass = centered
    ? 'flex items-center justify-center'
    : 'block'

  return `<!doctype html>
<html lang="en" data-theme="${theme.daisyTheme}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script src="https://unpkg.com/@tailwindcss/browser@4"></script>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/daisyui@5" />
<style type="text/tailwindcss">
${theme.themeBlock}
  html, body { height: 100%; }
  body { margin: 0; padding: 24px; }
</style>
</head>
<body class="${bodyBgClass} font-sans antialiased ${layoutClass}">
  <div class="w-full">
${innerHtml}
  </div>
</body>
</html>`
}
