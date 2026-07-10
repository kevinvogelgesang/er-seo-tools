// components/clients/alert-tone.ts
//
// Fleet-alert kind → SeverityBadge tone, BY COLOR — a canonical palette
// mapping (hue-preserving; bg/text strength canonicalizes to the badge's
// palette), same pattern as ada-audit/status-tone.ts. Kept as a module so
// the mapping is unit-testable.
import type { BadgeTone } from '@/components/ui/SeverityBadge'

export type FleetAlertKind = 'score-drop' | 'error' | 'stale' | 'regression'

export function alertTone(kind: FleetAlertKind): BadgeTone {
  switch (kind) {
    case 'error':
      return 'red'
    case 'score-drop':
      return 'amber'
    case 'regression':
      return 'purple'
    case 'stale':
      return 'gray'
  }
}
