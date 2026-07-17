// Client-safe display labels for launch-questionnaire field categories
// (relocated out of DataSourceSection.tsx in PR7 Task 8 so toc-index.ts can
// share it — DRY, behavior-preserving).
export const CATEGORY_LABELS: Record<string, string> = {
  school: 'Your school',
  programs: 'Programs',
  'team-access': 'Team & access',
  'crm-leads': 'CRM & leads',
  admissions: 'Admissions',
  positioning: 'Positioning',
  'student-experience': 'Student experience',
  'brand-materials': 'Brand & materials',
}
