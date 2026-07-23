// Client-safe display titles for the fixed public section order (spec §8).
import type { SectionKey } from '@/lib/viewbook/theme'

export const SECTION_TITLES: Record<SectionKey, string> = {
  assessment: 'Current-Site Assessment',
  brand: 'Brand Guidelines',
  'data-source': 'What we need from you',
  'kickoff-next': 'Next Steps',
  materials: 'Materials & Links',
  milestones: 'Process & Milestones',
  'pc-intro': 'Welcome',
  'pc-invite': 'Invite Your Team',
  'pc-setup': 'Set Up Your Onboarding Viewbook',
  'pc-thanks': 'Thank You',
  strategy: 'SEO, GEO & E-E-A-T Strategy',
  welcome: 'Welcome & Team',
  'ws-intro': 'Website Specifics',
}
