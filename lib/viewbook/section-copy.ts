// Code-owned, client-safe per-section reading copy (spec §4.2). Keyed by the
// fixed SECTION_KEYS catalog; no operator data, no server imports. Light-only UI.
import type { SectionKey } from './theme'

export interface SectionCopy {
  purpose: string            // one sentence — chapter header + rail tooltip
  whatThis: string           // "What this is" — 1–2 sentences
  whatWeNeed: string | null  // "What we need from you" — null = nothing needed
}

export const INPUT_EXPECTING_KEYS: ReadonlySet<SectionKey> = new Set<SectionKey>([
  'pc-setup', 'pc-invite', 'data-source', 'brand', 'assessment', 'materials',
])

export const SECTION_COPY: Record<SectionKey, SectionCopy> = {
  'pc-intro': { purpose: 'Welcome to your viewbook.', whatThis: 'A living space that walks you through every step of your new website, from kickoff to launch.', whatWeNeed: null },
  'pc-setup': { purpose: "Confirm your school's core details.", whatThis: 'The essentials we build everything else on — name, contacts, and web address.', whatWeNeed: 'Fill in the org-basics fields below.' },
  'pc-invite': { purpose: 'Bring your team into the viewbook.', whatThis: 'Invite the people who should follow along and collaborate on the build.', whatWeNeed: 'Invite the people who should collaborate.' },
  'data-source': { purpose: "Connect the analytics we'll report on.", whatThis: 'Grants us read access to your traffic data so progress is measured, not guessed.', whatWeNeed: 'Grant access to your analytics.' },
  'pc-thanks': { purpose: "You're all set for kickoff.", whatThis: 'Everything we need to begin is in. Here is what happens next.', whatWeNeed: null },
  'welcome': { purpose: 'Meet your team and how we work.', whatThis: 'Who you are working with, why we do this, and the process ahead.', whatWeNeed: null },
  'milestones': { purpose: 'The plan and where we are in it.', whatThis: 'The build broken into milestones so you always know the current step.', whatWeNeed: null },
  'strategy': { purpose: 'How we will grow your enrollment.', whatThis: 'The SEO, GEO, and E-E-A-T approach guiding the new site.', whatWeNeed: null },
  'brand': { purpose: 'Your brand guidelines for the new site.', whatThis: 'The logos, colors, and rules that keep the site unmistakably you.', whatWeNeed: 'Share logos, colors, and brand rules.' },
  'assessment': { purpose: 'What we found on your current site.', whatThis: 'A review of the existing site so we carry forward what works and fix what does not.', whatWeNeed: 'Review and add notes.' },
  'materials': { purpose: 'Shared links and working files.', whatThis: 'A shared home for the links and files this project relies on.', whatWeNeed: 'Add any links or files we should have.' },
  'ws-intro': { purpose: 'What we build in this stage.', whatThis: 'The website-specifics work that turns strategy into a real site.', whatWeNeed: null },
  'kickoff-next': { purpose: 'Your next actions.', whatThis: 'A short, clear list of what to do next to keep the build moving.', whatWeNeed: 'Complete the highlighted items.' },
}
