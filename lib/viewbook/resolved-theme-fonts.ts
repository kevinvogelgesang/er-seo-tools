// Serializable, client-safe metadata resolved on the server for public
// rendering. Keep this file type/data-only: importing it from public client
// components must never pull the full Google Fonts catalog into their bundle.
export interface ResolvedThemeFont {
  key: string
  family: string
  gfQuery: string
}

export interface ResolvedThemeFonts {
  href: string
  heading: ResolvedThemeFont
  body: ResolvedThemeFont
}
