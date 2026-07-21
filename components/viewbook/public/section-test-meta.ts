// Shared test helper (Task 7): a default `SectionRenderMeta` for the component
// suites that render a section directly, so each test doesn't hand-roll the
// full shape. Override any field via `over`. Not production code — imported
// only by *.test.tsx files (which tsc excludes), but kept a plain typed module
// so the fixture stays honest to the real `SectionRenderMeta` contract.
import type { SectionRenderMeta } from '@/lib/viewbook/section-status'

export function defaultMeta(over: Partial<SectionRenderMeta> = {}): SectionRenderMeta {
  return { heroSize: 'chapter', chapterNumber: 1, status: 'current', isLead: false, ...over }
}
