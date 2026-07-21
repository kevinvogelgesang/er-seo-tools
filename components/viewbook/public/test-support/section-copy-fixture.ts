// Shared test fixture for ViewbookPublicData.sectionCopy (Feature A, Task 6).
// Mirrors the production loader's fully-populated map by resolving each section
// key to its code-default copy. Every ViewbookPublicData test fixture needs this
// field since Task 7 made SectionShell read `data.sectionCopy[section.sectionKey]`.
import { SECTION_KEYS, type SectionKey } from '@/lib/viewbook/theme'
import { resolveSectionCopy, type ResolvedSectionCopy } from '@/lib/viewbook/section-copy-content'

export const SECTION_COPY_FIXTURE = Object.fromEntries(
  SECTION_KEYS.map((k) => [k, resolveSectionCopy(k, null, null)]),
) as Record<SectionKey, ResolvedSectionCopy>
