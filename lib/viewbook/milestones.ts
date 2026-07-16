// Client-safe default milestone seed for new viewbooks (spec §5).
// The service seeds the first stage as 'current'; operators rename/add/remove
// per client afterwards.

export const DEFAULT_MILESTONES = [
  { title: 'Kickoff', blurb: 'Orientation call — process, timeline, what we need from you.', sortOrder: 1 },
  { title: 'Materials in', blurb: 'Logos, photos, policies, testimonials delivered.', sortOrder: 2 },
  { title: 'Design', blurb: 'Brand direction and page designs take shape.', sortOrder: 3 },
  { title: 'Build', blurb: 'Your site is assembled on our stack.', sortOrder: 4 },
  { title: 'First review', blurb: 'Homepage + one program page, ready for your feedback.', sortOrder: 5 },
  { title: 'Full-site review', blurb: 'The whole site, ready for your walkthrough.', sortOrder: 6 },
  { title: 'Launch', blurb: 'Go live.', sortOrder: 7 },
] as const
