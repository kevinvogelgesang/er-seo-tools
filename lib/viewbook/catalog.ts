// Client-safe seeded question catalog for the viewbook Data Source section,
// modeled on the Jotform onboarding document (spec §5).
//
// Additive-only contract: never rename or remove a defKey once shipped —
// existing ViewbookField rows reference them. New questions appear in new
// viewbooks at creation and reach existing viewbooks via syncCatalogQuestions.

export const CATALOG_CATEGORIES = [
  'school',
  'programs',
  'team-access',
  'crm-leads',
  'admissions',
  'positioning',
  'student-experience',
  'brand-materials',
] as const

export type CatalogCategory = (typeof CATALOG_CATEGORIES)[number]

export interface CatalogEntry {
  defKey: string
  category: CatalogCategory
  label: string
  fieldType: 'text' | 'textarea' | 'list'
  sortOrder: number
}

export const CATALOG: CatalogEntry[] = [
  { defKey: 'school-name', category: 'school', label: 'School name', fieldType: 'text', sortOrder: 1 },
  { defKey: 'school-contact-name', category: 'school', label: 'Primary contact name', fieldType: 'text', sortOrder: 2 },
  { defKey: 'school-contact-email', category: 'school', label: 'Primary contact email', fieldType: 'text', sortOrder: 3 },
  { defKey: 'school-services', category: 'school', label: 'Services in your subscription', fieldType: 'list', sortOrder: 4 },
  { defKey: 'school-ad-name', category: 'school', label: 'How do you refer to your school in advertising? Any abbreviations?', fieldType: 'textarea', sortOrder: 5 },
  { defKey: 'programs-roster', category: 'programs', label: 'Programs to market (one per line)', fieldType: 'list', sortOrder: 1 },
  { defKey: 'programs-highlights', category: 'programs', label: 'Key features / highlights per program', fieldType: 'textarea', sortOrder: 2 },
  { defKey: 'team-staff-accounts', category: 'team-access', label: 'Staff needing accounts / lead notifications (name + email)', fieldType: 'list', sortOrder: 1 },
  { defKey: 'team-website-approver', category: 'team-access', label: 'Who approves website changes? (name, title, email)', fieldType: 'text', sortOrder: 2 },
  { defKey: 'team-technical-contact', category: 'team-access', label: 'Technical contact for coordination (name, title, email)', fieldType: 'text', sortOrder: 3 },
  { defKey: 'crm-lead-delivery', category: 'crm-leads', label: 'How would you like to receive leads?', fieldType: 'text', sortOrder: 1 },
  { defKey: 'crm-notification-emails', category: 'crm-leads', label: 'Emails that should receive lead notifications', fieldType: 'list', sortOrder: 2 },
  { defKey: 'crm-in-use', category: 'crm-leads', label: 'CRM / notification integrations in use', fieldType: 'text', sortOrder: 3 },
  { defKey: 'crm-credential-method', category: 'crm-leads', label: 'Preferred method for sharing CRM access', fieldType: 'text', sortOrder: 4 },
  { defKey: 'crm-lead-volume', category: 'crm-leads', label: 'Current leads per month + where they come from', fieldType: 'textarea', sortOrder: 5 },
  { defKey: 'crm-enrollment-time', category: 'crm-leads', label: 'Average enrollment time (inquiry → enrolled)', fieldType: 'text', sortOrder: 6 },
  { defKey: 'admissions-staff-title', category: 'admissions', label: 'What do you call your admissions staff?', fieldType: 'text', sortOrder: 1 },
  { defKey: 'admissions-next-step', category: 'admissions', label: 'What do you call the admissions interview / next step?', fieldType: 'text', sortOrder: 2 },
  { defKey: 'admissions-tour-format', category: 'admissions', label: 'Tour: online, in-person, or both?', fieldType: 'text', sortOrder: 3 },
  { defKey: 'admissions-accreditations', category: 'admissions', label: 'Accreditations (association names + URLs)', fieldType: 'list', sortOrder: 4 },
  { defKey: 'positioning-advantages', category: 'positioning', label: 'What unique advantages set your school apart?', fieldType: 'list', sortOrder: 1 },
  { defKey: 'positioning-top5', category: 'positioning', label: 'Top 5 reasons someone chooses your school', fieldType: 'list', sortOrder: 2 },
  { defKey: 'positioning-differentiators', category: 'positioning', label: 'What do you do differently that makes you stand out?', fieldType: 'list', sortOrder: 3 },
  { defKey: 'positioning-demographic', category: 'positioning', label: 'What best describes your demographic?', fieldType: 'text', sortOrder: 4 },
  { defKey: 'positioning-ideal-student', category: 'positioning', label: 'Ideal student per program (demographics / characteristics)', fieldType: 'textarea', sortOrder: 5 },
  { defKey: 'studentexp-motivations', category: 'student-experience', label: 'Common prospect motivations for going back to school', fieldType: 'list', sortOrder: 1 },
  { defKey: 'studentexp-barriers', category: 'student-experience', label: 'Common barriers for prospects', fieldType: 'list', sortOrder: 2 },
  { defKey: 'studentexp-feedback', category: 'student-experience', label: 'Most common feedback from students / graduates', fieldType: 'textarea', sortOrder: 3 },
  { defKey: 'studentexp-culture', category: 'student-experience', label: 'Anything else about your students and culture', fieldType: 'textarea', sortOrder: 4 },
  { defKey: 'brand-guidelines-status', category: 'brand-materials', label: 'Existing brand guidelines / style guide?', fieldType: 'text', sortOrder: 1 },
  { defKey: 'brand-privacy-policy', category: 'brand-materials', label: 'Privacy policy status', fieldType: 'text', sortOrder: 2 },
  { defKey: 'brand-testimonials', category: 'brand-materials', label: 'Student testimonials available?', fieldType: 'text', sortOrder: 3 },
  { defKey: 'brand-domain-registrar', category: 'brand-materials', label: 'Domain registrar (e.g. GoDaddy, Namecheap)', fieldType: 'text', sortOrder: 4 },
]
