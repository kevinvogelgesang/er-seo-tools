// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { SECTION_KEYS } from '@/lib/viewbook/theme'
import { TemplateEditor } from './TemplateEditor'
import type { TemplateSectionView, TemplateTree } from './template-editor-types'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

// One section per canonical SECTION_KEYS entry, sortOrder in catalog order.
// Only 'welcome' (roster), 'data-source' (field grid), and 'brand' (plain
// copy-only section, used for the copy-save/conflict tests) carry non-trivial
// fixtures — the rest are minimal 'none'/no-fields placeholders, matching a
// freshly-seeded F1a tree.
function buildTree(): TemplateTree {
  const sections: TemplateSectionView[] = SECTION_KEYS.map((templateKey, index) => {
    const id = index + 1
    const sortOrder = (index + 1) * 10
    const base = {
      id,
      templateKey,
      rendererType: templateKey,
      title: `${templateKey} title`,
      copy: { purpose: `${templateKey} purpose`, whatThis: `${templateKey} what-this`, whatWeNeed: null },
      sortOrder,
      version: 1,
      archivedAt: null,
    }

    if (templateKey === 'welcome') {
      return {
        ...base,
        subsections: [{
          id: 101,
          subsectionKey: 'main',
          title: 'Welcome',
          offeringWebsite: true,
          offeringVa: false,
          offeringPpc: false,
          copy: { intro: 'Welcome intro', whatWeNeed: null },
          content: {
            v: 1,
            team: [{ name: 'Casey CSM', role: 'CSM', photo: null, blurb: 'Bio here', isCsm: true, email: 'casey@example.com' }],
            process: { blocks: [{ heading: 'Step one', body: 'Body one' }] },
            why: { blocks: [{ heading: 'Why one', body: 'Why body' }] },
          },
          contentKind: 'welcome',
          sortOrder: 10,
          version: 1,
          archivedAt: null,
          fields: [],
        }],
      }
    }

    if (templateKey === 'data-source') {
      return {
        ...base,
        subsections: [{
          id: 301,
          subsectionKey: 'school',
          title: 'School',
          offeringWebsite: false,
          offeringVa: false,
          offeringPpc: false,
          copy: null,
          content: null,
          contentKind: 'none',
          sortOrder: 10,
          version: 1,
          archivedAt: null,
          fields: [
            { id: 9001, fieldKey: 'school-name', label: 'School name', fieldType: 'text', sortOrder: 1, version: 1, archivedAt: null },
          ],
        }],
      }
    }

    if (templateKey === 'materials') {
      return {
        ...base,
        subsections: [
          {
            id: 401,
            subsectionKey: 'main',
            title: 'Materials',
            offeringWebsite: false,
            offeringVa: false,
            offeringPpc: false,
            copy: null,
            content: null,
            contentKind: 'none',
            sortOrder: 10,
            version: 1,
            archivedAt: null,
            fields: [],
          },
          {
            id: 402,
            subsectionKey: 'legacy-notes',
            title: 'Legacy notes',
            offeringWebsite: false,
            offeringVa: false,
            offeringPpc: false,
            copy: null,
            content: { v: 1, blocks: [] },
            contentKind: 'generic',
            sortOrder: 20,
            version: 1,
            archivedAt: '2026-01-01T00:00:00.000Z',
            fields: [],
          },
        ],
      }
    }

    return {
      ...base,
      subsections: [{
        id: id * 100,
        subsectionKey: 'main',
        title: `${templateKey} main`,
        offeringWebsite: false,
        offeringVa: false,
        offeringPpc: false,
        copy: null,
        content: null,
        contentKind: 'none',
        sortOrder: 10,
        version: 1,
        archivedAt: null,
        fields: [],
      }],
    }
  })

  return { sections }
}

function findSectionEl(container: HTMLElement, templateKey: string): HTMLElement {
  const el = container.querySelector(`[data-section-key="${templateKey}"]`)
  if (!el) throw new Error(`section panel not found: ${templateKey}`)
  return el as HTMLElement
}

function findSubsectionEl(container: HTMLElement, templateKey: string, subsectionKey: string): HTMLElement {
  const section = findSectionEl(container, templateKey)
  const el = section.querySelector(`[data-subsection-key="${subsectionKey}"]`)
  if (!el) throw new Error(`subsection panel not found: ${templateKey}/${subsectionKey}`)
  return el as HTMLElement
}

describe('TemplateEditor', () => {
  it('renders the section list from the GET tree in sortOrder order with F2 helper text on title fields', async () => {
    const tree = buildTree()
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/viewbook-templates') return jsonResponse(tree)
      throw new Error(`unexpected fetch ${String(input)}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<TemplateEditor />)

    await screen.findByDisplayValue('welcome title')

    const panels = container.querySelectorAll('[data-section-key]')
    expect(panels).toHaveLength(SECTION_KEYS.length)
    expect(Array.from(panels).map((el) => el.getAttribute('data-section-key'))).toEqual([...SECTION_KEYS])

    expect(screen.getAllByText('applies after template cutover (F2)').length).toBeGreaterThanOrEqual(SECTION_KEYS.length)
  })

  it("editing brand's purpose and saving PATCHes the section with { version, copy }", async () => {
    const tree = buildTree()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/viewbook-templates') return jsonResponse(tree)
      if (url === '/api/viewbook-templates/sections/4' && init?.method === 'PATCH') return jsonResponse({ ok: true })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<TemplateEditor />)
    await screen.findByDisplayValue('welcome title')

    const brand = findSectionEl(container, 'brand')
    const purposeField = within(brand).getByLabelText(/purpose/i)
    fireEvent.change(purposeField, { target: { value: 'New purpose text' } })
    fireEvent.click(within(brand).getByRole('button', { name: /save brand.*copy/i }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u) === '/api/viewbook-templates/sections/4' && i?.method === 'PATCH')
      expect(call).toBeDefined()
      const body = JSON.parse(String(call?.[1]?.body))
      expect(body).toMatchObject({ version: 1, copy: { purpose: 'New purpose text' } })
    })
  })

  it('shows a conflict message and refetches the tree on a 409 version_conflict', async () => {
    const tree = buildTree()
    let getCalls = 0
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/viewbook-templates') { getCalls += 1; return jsonResponse(tree) }
      if (url === '/api/viewbook-templates/sections/4' && init?.method === 'PATCH') {
        return jsonResponse({ error: 'version_conflict' }, 409)
      }
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<TemplateEditor />)
    await screen.findByDisplayValue('welcome title')
    expect(getCalls).toBe(1)

    const brand = findSectionEl(container, 'brand')
    fireEvent.click(within(brand).getByRole('button', { name: /save brand.*copy/i }))

    await screen.findByText(/someone else edited this/i)
    await waitFor(() => expect(getCalls).toBe(2))
  })

  it('renders the welcome roster form and saves the full { team, process, why } content in one subsection PATCH', async () => {
    const tree = buildTree()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/viewbook-templates') return jsonResponse(tree)
      if (url === '/api/viewbook-templates/sections/1/subsections/101' && init?.method === 'PATCH') return jsonResponse({ ok: true })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<TemplateEditor />)
    await screen.findByDisplayValue('welcome title')

    const welcomeSub = findSubsectionEl(container, 'welcome', 'main')
    expect(within(welcomeSub).getByDisplayValue('Casey CSM')).toBeTruthy()
    expect(within(welcomeSub).getByDisplayValue('CSM')).toBeTruthy()
    expect(within(welcomeSub).getByDisplayValue('casey@example.com')).toBeTruthy()
    expect((within(welcomeSub).getByRole('checkbox', { name: /csm/i }) as HTMLInputElement).checked).toBe(true)
    expect(within(welcomeSub).getByDisplayValue('Bio here')).toBeTruthy()

    fireEvent.click(within(welcomeSub).getByRole('button', { name: /save subsection/i }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u) === '/api/viewbook-templates/sections/1/subsections/101' && i?.method === 'PATCH')
      expect(call).toBeDefined()
      const body = JSON.parse(String(call?.[1]?.body))
      expect(body.version).toBe(1)
      expect(body.content).toMatchObject({
        team: [{ name: 'Casey CSM', role: 'CSM', blurb: 'Bio here', isCsm: true, email: 'casey@example.com' }],
        process: { blocks: [{ heading: 'Step one', body: 'Body one' }] },
        why: { blocks: [{ heading: 'Why one', body: 'Why body' }] },
      })
      expect(body.content.v).toBeUndefined()
    })
  })

  it('renders the data-source field grid; add-field validates FIELD_KEY_RE client-side and POSTs a valid key', async () => {
    const tree = buildTree()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/viewbook-templates') return jsonResponse(tree)
      if (url === '/api/viewbook-templates/subsections/301/fields' && init?.method === 'POST') return jsonResponse({ ok: true })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<TemplateEditor />)
    await screen.findByDisplayValue('welcome title')

    const schoolSub = findSubsectionEl(container, 'data-source', 'school')
    expect(within(schoolSub).getByDisplayValue('School name')).toBeTruthy()
    expect(within(schoolSub).getByText('school-name')).toBeTruthy()

    const keyInput = within(schoolSub).getByLabelText(/field key/i)
    const labelInput = within(schoolSub).getByLabelText(/^label$/i)
    fireEvent.change(keyInput, { target: { value: 'Bad Key!' } })
    fireEvent.change(labelInput, { target: { value: 'New Field' } })
    fireEvent.click(within(schoolSub).getByRole('button', { name: /add field/i }))

    expect(await within(schoolSub).findByText(/invalid key/i)).toBeTruthy()
    expect(fetchMock.mock.calls.some(([u, i]) => String(u) === '/api/viewbook-templates/subsections/301/fields' && i?.method === 'POST')).toBe(false)

    fireEvent.change(keyInput, { target: { value: 'new-field' } })
    fireEvent.click(within(schoolSub).getByRole('button', { name: /add field/i }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u) === '/api/viewbook-templates/subsections/301/fields' && i?.method === 'POST')
      expect(call).toBeDefined()
      const body = JSON.parse(String(call?.[1]?.body))
      expect(body).toMatchObject({ version: 1, fieldKey: 'new-field', label: 'New Field', fieldType: 'text' })
    })
  })

  it('add-subsection form POSTs with offering checkboxes', async () => {
    const tree = buildTree()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/viewbook-templates') return jsonResponse(tree)
      if (url === '/api/viewbook-templates/sections/7/subsections' && init?.method === 'POST') return jsonResponse({ ok: true })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<TemplateEditor />)
    await screen.findByDisplayValue('welcome title')

    const materials = findSectionEl(container, 'materials')
    const addForm = within(materials).getByTestId('add-subsection-form')
    fireEvent.change(within(addForm).getByLabelText(/subsection key/i), { target: { value: 'extra-notes' } })
    fireEvent.change(within(addForm).getByLabelText(/subsection title/i), { target: { value: 'Extra notes' } })
    fireEvent.click(within(addForm).getByRole('checkbox', { name: /website/i }))
    fireEvent.click(within(addForm).getByRole('button', { name: /add subsection/i }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u) === '/api/viewbook-templates/sections/7/subsections' && i?.method === 'POST')
      expect(call).toBeDefined()
      const body = JSON.parse(String(call?.[1]?.body))
      expect(body).toMatchObject({
        version: 1,
        subsectionKey: 'extra-notes',
        title: 'Extra notes',
        offeringWebsite: true,
        offeringVa: false,
        offeringPpc: false,
      })
    })
  })

  it('renders an archived subsection collapsed with an Archived pill and a Restore button that PATCHes archived:false', async () => {
    const tree = buildTree()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/viewbook-templates') return jsonResponse(tree)
      if (url === '/api/viewbook-templates/sections/7/subsections/402' && init?.method === 'PATCH') return jsonResponse({ ok: true })
      throw new Error(`unexpected fetch ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { container } = render(<TemplateEditor />)
    await screen.findByDisplayValue('welcome title')

    const archivedSub = findSubsectionEl(container, 'materials', 'legacy-notes')
    expect(within(archivedSub).getByText('Archived')).toBeTruthy()
    expect(within(archivedSub).queryByRole('button', { name: /save subsection/i })).toBeNull()

    fireEvent.click(within(archivedSub).getByRole('button', { name: /restore/i }))

    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([u, i]) => String(u) === '/api/viewbook-templates/sections/7/subsections/402' && i?.method === 'PATCH')
      expect(call).toBeDefined()
      const body = JSON.parse(String(call?.[1]?.body))
      expect(body).toMatchObject({ version: 1, archived: false })
    })
  })
})
