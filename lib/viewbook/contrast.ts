// v2 PR6: THE ONE shared WCAG relative-luminance / contrast implementation
// (spec §9, Codex fix 12). Client-safe, pure. theme.ts's onThemeColorText
// refactors onto relativeLuminance. Inputs are already-validated #rrggbb hex
// (parseStoredTheme / theme validator), so no internal guarding — matching the
// prior onThemeColorText contract.

function channelLuminance(v: number): number {
  const c = v / 255
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export function relativeLuminance(hex: string): number {
  const r = channelLuminance(parseInt(hex.slice(1, 3), 16))
  const g = channelLuminance(parseInt(hex.slice(3, 5), 16))
  const b = channelLuminance(parseInt(hex.slice(5, 7), 16))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(hexA: string, hexB: string): number {
  const la = relativeLuminance(hexA)
  const lb = relativeLuminance(hexB)
  const light = Math.max(la, lb)
  const dark = Math.min(la, lb)
  return (light + 0.05) / (dark + 0.05)
}

export const CONTRAST_BANDS = {
  aaNormal: 4.5,
  aaLarge: 3.0,
  aaaNormal: 7.0,
  aaaLarge: 4.5,
} as const

export type ContrastBands = {
  aaNormal: boolean
  aaLarge: boolean
  aaaNormal: boolean
  aaaLarge: boolean
}

export function contrastBands(ratio: number): ContrastBands {
  return {
    aaNormal: ratio >= CONTRAST_BANDS.aaNormal,
    aaLarge: ratio >= CONTRAST_BANDS.aaLarge,
    aaaNormal: ratio >= CONTRAST_BANDS.aaaNormal,
    aaaLarge: ratio >= CONTRAST_BANDS.aaaLarge,
  }
}
