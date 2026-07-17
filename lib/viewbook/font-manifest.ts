// Generated catalog snapshot for the searchable viewbook font picker.
// Source: Google Fonts Developer API v1 (`webfonts?sort=alpha`), 2026-07-17.
// Generation policy: retain families with a regular face, select only weights
// reported by that family, slug the family name for new keys, and preserve the
// original twelve stored keys exactly. This curated snapshot keeps the public
// bundle small; font-manifest.test.ts enforces metadata and a 32 KiB ceiling.

export interface FontManifestEntry {
  family: string
  supportedWeights: readonly string[]
  gfQuery: string
}

export const FONT_MANIFEST = {
  archivo: font('Archivo', ['400', '600', '800']),
  'barlow-condensed': font('Barlow Condensed', ['400', '600', '700']),
  bitter: font('Bitter', ['400', '600', '700']),
  'cabin': font('Cabin', ['400', '600', '700']),
  'crimson-pro': font('Crimson Pro', ['400', '600', '700']),
  'dm-sans': font('DM Sans', ['400', '600', '700']),
  'dm-serif-display': font('DM Serif Display', ['400']),
  'eb-garamond': font('EB Garamond', ['400', '600', '700']),
  'fira-sans': font('Fira Sans', ['400', '600', '700']),
  'fraunces': font('Fraunces', ['400', '600', '700']),
  'ibm-plex-sans': font('IBM Plex Sans', ['400', '600', '700']),
  'ibm-plex-serif': font('IBM Plex Serif', ['400', '600', '700']),
  inter: font('Inter', ['400', '600', '800']),
  'josefin-sans': font('Josefin Sans', ['400', '600', '700']),
  lato: font('Lato', ['400', '700', '900']),
  'libre-baskerville': font('Libre Baskerville', ['400', '700']),
  'libre-franklin': font('Libre Franklin', ['400', '600', '800']),
  lora: font('Lora', ['400', '600', '700']),
  manrope: font('Manrope', ['400', '600', '800']),
  merriweather: font('Merriweather', ['400', '700', '900']),
  'merriweather-sans': font('Merriweather Sans', ['400', '600', '700']),
  montserrat: font('Montserrat', ['400', '600', '800']),
  'noto-sans': font('Noto Sans', ['400', '600', '700']),
  'noto-serif': font('Noto Serif', ['400', '600', '700']),
  'nunito-sans': font('Nunito Sans', ['400', '600', '800']),
  'open-sans': font('Open Sans', ['400', '600', '700']),
  oswald: font('Oswald', ['400', '600', '700']),
  'outfit': font('Outfit', ['400', '600', '800']),
  'playfair-display': font('Playfair Display', ['400', '700', '900']),
  poppins: font('Poppins', ['400', '600', '800']),
  'pt-sans': font('PT Sans', ['400', '700']),
  'pt-serif': font('PT Serif', ['400', '700']),
  'raleway': font('Raleway', ['400', '600', '800']),
  roboto: font('Roboto', ['100', '300', '400', '500', '700', '900']),
  'roboto-condensed': font('Roboto Condensed', ['400', '600', '700']),
  'roboto-slab': font('Roboto Slab', ['400', '600', '700']),
  'source-sans-3': font('Source Sans 3', ['400', '600', '700']),
  'source-serif-4': font('Source Serif 4', ['400', '600', '700']),
  'space-grotesk': font('Space Grotesk', ['400', '600', '700']),
  'urbanist': font('Urbanist', ['400', '600', '800']),
  'work-sans': font('Work Sans', ['400', '600', '800']),
} as const satisfies Readonly<Record<string, FontManifestEntry>>

function font(family: string, supportedWeights: readonly string[]): FontManifestEntry {
  return {
    family,
    supportedWeights,
    gfQuery: `family=${family.replaceAll(' ', '+')}:wght@${supportedWeights.join(';')}`,
  }
}

export type FontKey = keyof typeof FONT_MANIFEST

export function isAllowedFont(key: unknown): key is FontKey {
  return typeof key === 'string' && Object.prototype.hasOwnProperty.call(FONT_MANIFEST, key)
}
