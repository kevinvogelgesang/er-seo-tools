// E-E-A-T Quarterly Client Checklist — canonical data + pure logic.
// This file is the runtime source of truth; the data is inlined from
// eeat-checklist.data.json (do not read the JSON at runtime).

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InputKey =
  | 'photos'
  | 'instructors'
  | 'outcomes'
  | 'recognition'
  | 'story';

export type PillarKey =
  | 'experience'
  | 'expertise'
  | 'authoritativeness'
  | 'trust';

export type RoleKey =
  | 'auditor'
  | 'lead'
  | 'writer'
  | 'specialist'
  | 'reviewer'
  | 'account';

export type BucketKey =
  | 'audit'
  | 'trust'
  | 'build'
  | 'structure'
  | 'review'
  | 'outreach';

export type Input = {
  key: InputKey;
  label: string;
  detail: string;
};

export type Pillar = {
  key: PillarKey;
  label: string;
  fedBy: InputKey[];
};

export type Role = {
  key: RoleKey;
  label: string;
};

export type Bucket = {
  key: BucketKey;
  label: string;
  handles: string;
};

export type Task = {
  id: string;
  bucket: BucketKey;
  pillar: PillarKey;
  owner: RoleKey;
  timeMin: number;
  requires: InputKey[];
  triggerMissing: InputKey[];
  name: string;
  description: string;
};

export type Scenario = {
  key: string;
  name: string;
  tagline: string;
  present: InputKey[];
  taskIds: string[];
  totalMin: number;
};

export type PillarStatus = 'covered' | 'at-risk';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const BUDGET_MIN = 480;

export const meta = {
  title: 'E-E-A-T Quarterly Client Checklist',
  source: 'E-E-A-T Team Briefing (QRG Sept 11 2025)',
  purpose:
    "The 'What we handle' work we run for each client every quarter, scoped to which client inputs ('What we need from clients') we actually received.",
  budgetNote:
    'The briefing targets ~8 hrs/quarter (480 min) on the highest-leverage work. Always-on Audit + Trust + Review work is the floor (~275 min). When a client supplies abundant material, build tasks exceed the budget for one quarter — prioritize by the audit (YMYL-critical first) and ROTATE build tasks across quarters rather than rebuilding every page at once. Time totals below are realistic, not capped to 480.',
  version: '1.0',
} as const;

export const INPUTS: Input[] = [
  {
    key: 'photos',
    label: 'Real photos',
    detail: 'Campus, classrooms, clinics, students at work (non-stock).',
  },
  {
    key: 'instructors',
    label: 'Named instructors',
    detail: 'Named instructors with their real licenses and credentials.',
  },
  {
    key: 'outcomes',
    label: 'Named outcomes',
    detail: 'Grads, jobs, licenses passed, and quotable named testimonials.',
  },
  {
    key: 'recognition',
    label: 'Who recognizes them',
    detail: 'Accreditation and licensing details, with verifiable proof.',
  },
  {
    key: 'story',
    label: 'The story only they have',
    detail: 'Externships, placements, what makes the program real.',
  },
];

export const PILLARS: Pillar[] = [
  { key: 'experience', label: 'Experience', fedBy: ['photos', 'outcomes', 'story'] },
  { key: 'expertise', label: 'Expertise', fedBy: ['instructors'] },
  { key: 'authoritativeness', label: 'Authoritativeness', fedBy: ['recognition'] },
  { key: 'trust', label: 'Trust', fedBy: [] },
];

export const ROLES: Role[] = [
  { key: 'auditor', label: 'SEO Auditor' },
  { key: 'lead', label: 'SEO Lead' },
  { key: 'writer', label: 'Content Writer' },
  { key: 'specialist', label: 'SEO Specialist (technical/schema)' },
  { key: 'reviewer', label: 'Credentialed Reviewer' },
  { key: 'account', label: 'Account Manager' },
];

export const BUCKETS: Bucket[] = [
  {
    key: 'audit',
    label: '1. Audit',
    handles: 'Audit each site against the E-E-A-T checklist, YMYL-critical issues first.',
  },
  {
    key: 'trust',
    label: '2. Trust foundation',
    handles:
      'Trust plumbing (Pillar 4) — mostly our work, highest trust-per-hour. Done every quarter.',
  },
  {
    key: 'build',
    label: '3. Build pages from material',
    handles: 'Turn raw material into credentialed bios, outcome and proof pages.',
  },
  {
    key: 'structure',
    label: '4. Structure for people + machines',
    handles: 'Schema where it earns its place — markup on a hollow page is still hollow.',
  },
  {
    key: 'review',
    label: '5. Human review gate',
    handles: 'A qualified human owns the thinking on everything we publish.',
  },
  {
    key: 'outreach',
    label: '6. Draw material out of client',
    handles:
      'Actively request missing inputs — the biggest gains are better inputs, not more tactics.',
  },
];

export const TASKS: Task[] = [
  {
    id: 'A1',
    bucket: 'audit',
    pillar: 'trust',
    owner: 'auditor',
    timeMin: 60,
    requires: [],
    triggerMissing: [],
    name: 'E-E-A-T / YMYL site audit',
    description:
      'Run the full E-E-A-T audit against the checklist. Log every gap; flag YMYL-critical issues first (tuition/cost, accreditation, job outcomes, health claims).',
  },
  {
    id: 'A2',
    bucket: 'audit',
    pillar: 'trust',
    owner: 'lead',
    timeMin: 20,
    requires: [],
    triggerMissing: [],
    name: "Prioritize the quarter's work queue",
    description:
      "Triage audit findings into this quarter's ~8-hour queue, highest trust-per-hour first. Note which client inputs each fix needs and what to request.",
  },
  {
    id: 'TR1',
    bucket: 'trust',
    pillar: 'trust',
    owner: 'specialist',
    timeMin: 15,
    requires: [],
    triggerMissing: [],
    name: 'Confirm site security (HTTPS)',
    description:
      'Verify HTTPS everywhere; fix mixed content and any insecure forms. A failure here is an instant trust red flag.',
  },
  {
    id: 'TR2',
    bucket: 'trust',
    pillar: 'trust',
    owner: 'writer',
    timeMin: 25,
    requires: [],
    triggerMissing: [],
    name: 'Verify identity & contact',
    description:
      "Confirm real address, phone, named staff, and a working About / leadership page so it's clear who is responsible.",
  },
  {
    id: 'TR3',
    bucket: 'trust',
    pillar: 'trust',
    owner: 'writer',
    timeMin: 35,
    requires: [],
    triggerMissing: [],
    name: 'Audit disclosure pages',
    description:
      'Check tuition / refund / complaint and outcomes disclosures are present, accurate, and findable. Missing disclosures are exactly what raters penalize on YMYL pages.',
  },
  {
    id: 'TR4',
    bucket: 'trust',
    pillar: 'trust',
    owner: 'writer',
    timeMin: 25,
    requires: [],
    triggerMissing: [],
    name: 'Content hygiene pass',
    description:
      "Ensure 'last reviewed' dates, a corrections policy, and a privacy policy are present and current.",
  },
  {
    id: 'TR5',
    bucket: 'trust',
    pillar: 'trust',
    owner: 'specialist',
    timeMin: 25,
    requires: [],
    triggerMissing: [],
    name: 'Reputation handling',
    description:
      'Confirm genuine reviews are displayed on-site and responded to; check the Google Business Profile is active with stable, consistent NAP.',
  },
  {
    id: 'B1',
    bucket: 'build',
    pillar: 'experience',
    owner: 'writer',
    timeMin: 45,
    requires: ['photos'],
    triggerMissing: [],
    name: 'Build / refresh student-work gallery',
    description:
      'Turn supplied photos into a named, real student-work / before-after gallery. Remove any stock imagery — it reads as the opposite of experience.',
  },
  {
    id: 'B2',
    bucket: 'build',
    pillar: 'expertise',
    owner: 'writer',
    timeMin: 50,
    requires: ['instructors'],
    triggerMissing: [],
    name: 'Credentialed instructor bios',
    description:
      'Turn instructor details into named bios that show real licenses / certifications. The credential must be visible on the page, not implied.',
  },
  {
    id: 'B3',
    bucket: 'build',
    pillar: 'experience',
    owner: 'writer',
    timeMin: 45,
    requires: ['outcomes'],
    triggerMissing: [],
    name: 'Outcome & proof pages',
    description:
      'Build / update pages with named grads, jobs landed, and licenses passed, tied to specific, verifiable outcomes.',
  },
  {
    id: 'B4',
    bucket: 'build',
    pillar: 'experience',
    owner: 'writer',
    timeMin: 30,
    requires: ['outcomes'],
    triggerMissing: [],
    name: 'Authentic named testimonials',
    description:
      'Place named student / grad testimonials tied to a specific outcome (job, license, placement). Remove anonymous or stock quotes.',
  },
  {
    id: 'B5',
    bucket: 'build',
    pillar: 'authoritativeness',
    owner: 'specialist',
    timeMin: 30,
    requires: ['recognition'],
    triggerMissing: [],
    name: 'Surface accreditation recognition',
    description:
      "Verify and link the accreditor's own page that lists the school (ABHES / COE / ACCSC). Authoritativeness cannot be self-declared.",
  },
  {
    id: 'B6',
    bucket: 'build',
    pillar: 'authoritativeness',
    owner: 'specialist',
    timeMin: 20,
    requires: ['recognition'],
    triggerMissing: [],
    name: 'Surface state / provincial recognition',
    description:
      'Surface US licensing-board recognition or BC PTIB / EQA designation, with a link to the recognizing body.',
  },
  {
    id: 'B7',
    bucket: 'build',
    pillar: 'expertise',
    owner: 'writer',
    timeMin: 25,
    requires: ['recognition'],
    triggerMissing: [],
    name: 'Verify cert / license detail',
    description:
      'Correct exam names, requirements, and pass-rate context on program pages so the expertise is accurate and defensible.',
  },
  {
    id: 'B8',
    bucket: 'build',
    pillar: 'experience',
    owner: 'writer',
    timeMin: 45,
    requires: ['story'],
    triggerMissing: [],
    name: 'First-hand experience pieces',
    description:
      "Write externship / clinical-placement stories and instructor field notes from the school's unique material — the 'we've actually done this' signal.",
  },
  {
    id: 'S1',
    bucket: 'structure',
    pillar: 'expertise',
    owner: 'specialist',
    timeMin: 15,
    requires: ['instructors'],
    triggerMissing: [],
    name: 'Person schema for instructors',
    description: 'Add / validate Person schema for named instructors, including their credentials.',
  },
  {
    id: 'S2',
    bucket: 'structure',
    pillar: 'authoritativeness',
    owner: 'specialist',
    timeMin: 15,
    requires: ['recognition'],
    triggerMissing: [],
    name: 'Organization + accreditation schema',
    description:
      'Add / validate Organization schema and accreditation markup so machines read the recognition signals.',
  },
  {
    id: 'S3',
    bucket: 'structure',
    pillar: 'experience',
    owner: 'specialist',
    timeMin: 10,
    requires: ['outcomes'],
    triggerMissing: [],
    name: 'Review / rating schema',
    description: 'Add Review / aggregateRating schema only where genuine, displayed reviews exist.',
  },
  {
    id: 'S4',
    bucket: 'structure',
    pillar: 'trust',
    owner: 'specialist',
    timeMin: 15,
    requires: [],
    triggerMissing: [],
    name: 'Program / Course schema',
    description:
      'Add EducationalOccupationalProgram / Course schema to program pages (these exist regardless of client material).',
  },
  {
    id: 'R1',
    bucket: 'review',
    pillar: 'trust',
    owner: 'reviewer',
    timeMin: 40,
    requires: [],
    triggerMissing: [],
    name: 'Human review gate (qualified)',
    description:
      'A credentialed human reviews everything before publish: fact-check claims, strip generic AI filler, add real expertise and original value. AI assists; a human owns the thinking.',
  },
  {
    id: 'R2',
    bucket: 'review',
    pillar: 'trust',
    owner: 'lead',
    timeMin: 15,
    requires: [],
    triggerMissing: [],
    name: 'Publish & log baseline',
    description:
      "Publish approved changes and log what shipped to seed next quarter's audit baseline.",
  },
  {
    id: 'O1',
    bucket: 'outreach',
    pillar: 'trust',
    owner: 'account',
    timeMin: 20,
    requires: [],
    triggerMissing: ['photos', 'instructors', 'outcomes', 'recognition', 'story'],
    name: 'Send targeted material request',
    description:
      'Send / refresh a specific request naming exactly which inputs are missing (photos, instructor credentials, outcomes & testimonials, accreditation proof, the unique story). The richer the material, the stronger the site we can build.',
  },
  {
    id: 'O2',
    bucket: 'outreach',
    pillar: 'experience',
    owner: 'account',
    timeMin: 25,
    requires: [],
    triggerMissing: ['story'],
    name: 'Story-mining call',
    description:
      'Book a ~20-min call to draw out the unique story and harder-to-get material (externships, placements, what makes it real). We have to actively draw this out, not wait for it.',
  },
];

export const SCENARIOS: Scenario[] = [
  {
    key: 'full',
    name: 'Full Buy-In',
    tagline: 'Client supplied everything we asked for.',
    present: ['photos', 'instructors', 'outcomes', 'recognition', 'story'],
    taskIds: [
      'A1', 'A2', 'TR1', 'TR2', 'TR3', 'TR4', 'TR5', 'B1', 'B2', 'B3', 'B4',
      'B5', 'B6', 'B7', 'B8', 'S1', 'S2', 'S3', 'S4', 'R1', 'R2',
    ],
    totalMin: 605,
  },
  {
    key: 'none',
    name: 'No Material Yet',
    tagline: 'Nothing received — audit, fix our own plumbing, and chase inputs.',
    present: [],
    taskIds: ['A1', 'A2', 'TR1', 'TR2', 'TR3', 'TR4', 'TR5', 'S4', 'R1', 'R2', 'O1', 'O2'],
    totalMin: 320,
  },
  {
    key: 'photos_instructors',
    name: 'Photos + Instructors, No Outcomes / Recognition / Story',
    tagline: 'They gave us photos and instructors, but no outcomes or testimonials.',
    present: ['photos', 'instructors'],
    taskIds: [
      'A1', 'A2', 'TR1', 'TR2', 'TR3', 'TR4', 'TR5', 'B1', 'B2', 'S1', 'S4',
      'R1', 'R2', 'O1', 'O2',
    ],
    totalMin: 430,
  },
  {
    key: 'credentials_recognition',
    name: 'Compliance-Forward: Credentials + Recognition Only',
    tagline: 'Instructor credentials and accreditation proof, but no photos, outcomes, or story.',
    present: ['instructors', 'recognition'],
    taskIds: [
      'A1', 'A2', 'TR1', 'TR2', 'TR3', 'TR4', 'TR5', 'B2', 'B5', 'B6', 'B7',
      'S1', 'S2', 'S4', 'R1', 'R2', 'O1', 'O2',
    ],
    totalMin: 475,
  },
  {
    key: 'experience_no_credentials',
    name: 'Experience-Rich, Expertise-Thin',
    tagline: 'Photos, outcomes, and the story — but no named instructors or accreditation proof.',
    present: ['photos', 'outcomes', 'story'],
    taskIds: [
      'A1', 'A2', 'TR1', 'TR2', 'TR3', 'TR4', 'TR5', 'B1', 'B3', 'B4', 'B8',
      'S3', 'S4', 'R1', 'R2', 'O1',
    ],
    totalMin: 470,
  },
  {
    key: 'assets_no_story',
    name: 'Everything But the Story',
    tagline: 'Photos, instructors, outcomes, and recognition — missing the unique narrative.',
    present: ['photos', 'instructors', 'outcomes', 'recognition'],
    taskIds: [
      'A1', 'A2', 'TR1', 'TR2', 'TR3', 'TR4', 'TR5', 'B1', 'B2', 'B3', 'B4',
      'B5', 'B6', 'B7', 'S1', 'S2', 'S3', 'S4', 'R1', 'R2', 'O1', 'O2',
    ],
    totalMin: 605,
  },
  {
    key: 'outcomes_only',
    name: 'Outcomes / Testimonials Only',
    tagline: 'Proud of grad outcomes, but nothing else supplied yet.',
    present: ['outcomes'],
    taskIds: [
      'A1', 'A2', 'TR1', 'TR2', 'TR3', 'TR4', 'TR5', 'B3', 'B4', 'S3', 'S4',
      'R1', 'R2', 'O1', 'O2',
    ],
    totalMin: 405,
  },
];

// ---------------------------------------------------------------------------
// Pure logic
// ---------------------------------------------------------------------------

/**
 * A task is included for a given set of present inputs when:
 *   (a) requires is empty AND triggerMissing is empty (always-on); OR
 *   (b) requires is non-empty and ALL listed inputs are present; OR
 *   (c) triggerMissing is non-empty and AT LEAST ONE listed input is absent.
 */
export function isTaskIncluded(task: Task, present: Set<InputKey>): boolean {
  const hasRequires = task.requires.length > 0;
  const hasTriggerMissing = task.triggerMissing.length > 0;

  if (!hasRequires && !hasTriggerMissing) {
    return true;
  }

  if (hasRequires && task.requires.every((k) => present.has(k))) {
    return true;
  }

  if (hasTriggerMissing && task.triggerMissing.some((k) => !present.has(k))) {
    return true;
  }

  return false;
}

/**
 * Catalog tasks filtered by inclusion, ordered by BUCKETS order then catalog order.
 */
export function tasksForInputs(present: Set<InputKey>): Task[] {
  const bucketOrder = new Map<BucketKey, number>(
    BUCKETS.map((b, i) => [b.key, i]),
  );

  return TASKS.map((task, index) => ({ task, index }))
    .filter(({ task }) => isTaskIncluded(task, present))
    .sort((a, b) => {
      const bucketDelta =
        (bucketOrder.get(a.task.bucket) ?? 0) - (bucketOrder.get(b.task.bucket) ?? 0);
      return bucketDelta !== 0 ? bucketDelta : a.index - b.index;
    })
    .map(({ task }) => task);
}

export function totalMinutes(tasks: Task[]): number {
  return tasks.reduce((sum, task) => sum + task.timeMin, 0);
}

/**
 * A pillar is 'covered' if it has no fedBy inputs (Trust) OR at least one of
 * its fedBy inputs is present; otherwise 'at-risk'.
 */
export function pillarCoverage(
  present: Set<InputKey>,
): { pillar: Pillar; status: PillarStatus }[] {
  return PILLARS.map((pillar) => {
    const covered =
      pillar.fedBy.length === 0 || pillar.fedBy.some((k) => present.has(k));
    return { pillar, status: covered ? 'covered' : 'at-risk' };
  });
}

export function roleLabel(key: RoleKey): string {
  return ROLES.find((r) => r.key === key)?.label ?? key;
}

export function bucketLabel(key: BucketKey): string {
  return BUCKETS.find((b) => b.key === key)?.label ?? key;
}
