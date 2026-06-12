// lib/report/wcag-criteria.ts
// Static WCAG success-criteria table (A + AA, versions 2.0/2.1/2.2) and the
// axe wcagTags → criterion mapping. AAA is out of scope by design.

export interface WcagCriterion {
  id: string            // '1.4.12'
  name: string
  level: 'A' | 'AA'
  version: '2.0' | '2.1' | '2.2'
}

export const WCAG_CRITERIA: WcagCriterion[] = [
  { id: '1.1.1', name: 'Non-text Content', level: 'A', version: '2.0' },
  { id: '1.2.1', name: 'Audio-only and Video-only (Prerecorded)', level: 'A', version: '2.0' },
  { id: '1.2.2', name: 'Captions (Prerecorded)', level: 'A', version: '2.0' },
  { id: '1.2.3', name: 'Audio Description or Media Alternative (Prerecorded)', level: 'A', version: '2.0' },
  { id: '1.2.4', name: 'Captions (Live)', level: 'AA', version: '2.0' },
  { id: '1.2.5', name: 'Audio Description (Prerecorded)', level: 'AA', version: '2.0' },
  { id: '1.3.1', name: 'Info and Relationships', level: 'A', version: '2.0' },
  { id: '1.3.2', name: 'Meaningful Sequence', level: 'A', version: '2.0' },
  { id: '1.3.3', name: 'Sensory Characteristics', level: 'A', version: '2.0' },
  { id: '1.3.4', name: 'Orientation', level: 'AA', version: '2.1' },
  { id: '1.3.5', name: 'Identify Input Purpose', level: 'AA', version: '2.1' },
  { id: '1.4.1', name: 'Use of Color', level: 'A', version: '2.0' },
  { id: '1.4.2', name: 'Audio Control', level: 'A', version: '2.0' },
  { id: '1.4.3', name: 'Contrast (Minimum)', level: 'AA', version: '2.0' },
  { id: '1.4.4', name: 'Resize Text', level: 'AA', version: '2.0' },
  { id: '1.4.5', name: 'Images of Text', level: 'AA', version: '2.0' },
  { id: '1.4.10', name: 'Reflow', level: 'AA', version: '2.1' },
  { id: '1.4.11', name: 'Non-text Contrast', level: 'AA', version: '2.1' },
  { id: '1.4.12', name: 'Text Spacing', level: 'AA', version: '2.1' },
  { id: '1.4.13', name: 'Content on Hover or Focus', level: 'AA', version: '2.1' },
  { id: '2.1.1', name: 'Keyboard', level: 'A', version: '2.0' },
  { id: '2.1.2', name: 'No Keyboard Trap', level: 'A', version: '2.0' },
  { id: '2.1.4', name: 'Character Key Shortcuts', level: 'A', version: '2.1' },
  { id: '2.2.1', name: 'Timing Adjustable', level: 'A', version: '2.0' },
  { id: '2.2.2', name: 'Pause, Stop, Hide', level: 'A', version: '2.0' },
  { id: '2.3.1', name: 'Three Flashes or Below Threshold', level: 'A', version: '2.0' },
  { id: '2.4.1', name: 'Bypass Blocks', level: 'A', version: '2.0' },
  { id: '2.4.2', name: 'Page Titled', level: 'A', version: '2.0' },
  { id: '2.4.3', name: 'Focus Order', level: 'A', version: '2.0' },
  { id: '2.4.4', name: 'Link Purpose (In Context)', level: 'A', version: '2.0' },
  { id: '2.4.5', name: 'Multiple Ways', level: 'AA', version: '2.0' },
  { id: '2.4.6', name: 'Headings and Labels', level: 'AA', version: '2.0' },
  { id: '2.4.7', name: 'Focus Visible', level: 'AA', version: '2.0' },
  { id: '2.4.11', name: 'Focus Not Obscured (Minimum)', level: 'AA', version: '2.2' },
  { id: '2.5.1', name: 'Pointer Gestures', level: 'A', version: '2.1' },
  { id: '2.5.2', name: 'Pointer Cancellation', level: 'A', version: '2.1' },
  { id: '2.5.3', name: 'Label in Name', level: 'A', version: '2.1' },
  { id: '2.5.4', name: 'Motion Actuation', level: 'A', version: '2.1' },
  { id: '2.5.7', name: 'Dragging Movements', level: 'AA', version: '2.2' },
  { id: '2.5.8', name: 'Target Size (Minimum)', level: 'AA', version: '2.2' },
  { id: '3.1.1', name: 'Language of Page', level: 'A', version: '2.0' },
  { id: '3.1.2', name: 'Language of Parts', level: 'AA', version: '2.0' },
  { id: '3.2.1', name: 'On Focus', level: 'A', version: '2.0' },
  { id: '3.2.2', name: 'On Input', level: 'A', version: '2.0' },
  { id: '3.2.3', name: 'Consistent Navigation', level: 'AA', version: '2.0' },
  { id: '3.2.4', name: 'Consistent Identification', level: 'AA', version: '2.0' },
  { id: '3.2.6', name: 'Consistent Help', level: 'A', version: '2.2' },
  { id: '3.3.1', name: 'Error Identification', level: 'A', version: '2.0' },
  { id: '3.3.2', name: 'Labels or Instructions', level: 'A', version: '2.0' },
  { id: '3.3.3', name: 'Error Suggestion', level: 'AA', version: '2.0' },
  { id: '3.3.4', name: 'Error Prevention (Legal, Financial, Data)', level: 'AA', version: '2.0' },
  { id: '3.3.7', name: 'Redundant Entry', level: 'A', version: '2.2' },
  { id: '3.3.8', name: 'Accessible Authentication (Minimum)', level: 'AA', version: '2.2' },
  { id: '4.1.1', name: 'Parsing (obsolete in WCAG 2.2)', level: 'A', version: '2.0' },
  { id: '4.1.2', name: 'Name, Role, Value', level: 'A', version: '2.0' },
  { id: '4.1.3', name: 'Status Messages', level: 'AA', version: '2.1' },
]

const BY_ID = new Map(WCAG_CRITERIA.map((c) => [c.id, c]))

/** 'wcag1412' → '1.4.12'; level/meta/category tags → null.
 *  Digit layout: principle (1 digit) + guideline (1 digit) + criterion (1-2 digits). */
export function criterionFromTag(tag: string): string | null {
  const m = /^wcag(\d{3,4})$/.exec(tag)
  if (!m) return null
  const d = m[1]
  return `${d[0]}.${d[1]}.${d.slice(2)}`
}

export function criterionById(id: string): WcagCriterion | undefined {
  return BY_ID.get(id)
}

/** Criteria in scan scope for a wcagLevel ('wcag21aa' excludes 2.2 additions). */
export function criteriaForLevel(wcagLevel: string): WcagCriterion[] {
  return wcagLevel === 'wcag22aa' ? WCAG_CRITERIA : WCAG_CRITERIA.filter((c) => c.version !== '2.2')
}
