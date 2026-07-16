// Client-safe display titles for the fixed public section order (spec §8).
import type { SectionKey } from '@/lib/viewbook/theme'

export const SECTION_TITLES: Record<SectionKey, string> = {
  welcome: 'Welcome & Team',
  milestones: 'Process & Milestones',
  'data-source': 'Data Source',
  brand: 'Brand Guidelines',
  assessment: 'Current-Site Assessment',
  strategy: 'SEO, GEO & E-E-A-T Strategy',
  materials: 'Materials & Links',
}
