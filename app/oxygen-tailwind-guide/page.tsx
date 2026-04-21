import {
  Callout,
  Card,
  CodeBlock,
  Divider,
  InlineCode,
  KeyTable,
  P,
  PhaseBanner,
  Pill,
  SectionHeader,
  Sub,
} from './_components/shared'
import { Sidebar, type SidebarSection } from './_components/sidebar'
import { Playground } from './_components/playground'
import { ColorPalette } from './_components/color-palette'
import { SpacingScale } from './_components/spacing-scale'
import { BreakpointIndicator } from './_components/breakpoint-indicator'
import { PatternGallery } from './_components/pattern-gallery'
import { DaisyComponentsSection } from './_components/daisy-components'

export const metadata = {
  title: 'Oxygen Builder + Tailwind + DaisyUI Guide',
  description:
    'A practical reference for building WordPress sites with Oxygen Builder 6, Tailwind CSS v4, and DaisyUI — as actually shipped via the ER FusionCore plugin. Interactive playground, color explorer, spacing visualizer, and a full DaisyUI components reference.',
}

const SECTIONS: SidebarSection[] = [
  { id: 'overview',        label: 'Overview',           group: 'Get oriented' },
  { id: 'interface',       label: 'Interface',          group: 'Get oriented' },
  { id: 'concepts',        label: 'Core concepts',      group: 'Get oriented' },
  { id: 'how-it-ships',    label: 'How it ships',       group: 'The ER stack' },
  { id: 'design-tokens',   label: 'Design tokens',      group: 'The ER stack' },
  { id: 'classes-where',   label: 'Where classes go',   group: 'The ER stack' },
  { id: 'philosophy',      label: 'Utility philosophy', group: 'Tailwind reference' },
  { id: 'playground',      label: 'Live playground',    group: 'Tailwind reference' },
  { id: 'spacing',         label: 'Spacing scale',      group: 'Tailwind reference' },
  { id: 'sizing',          label: 'Sizing',             group: 'Tailwind reference' },
  { id: 'typography',      label: 'Typography',         group: 'Tailwind reference' },
  { id: 'colors',          label: 'Colors',             group: 'Tailwind reference' },
  { id: 'flexbox',         label: 'Flexbox',            group: 'Tailwind reference' },
  { id: 'grid-layout',     label: 'Grid',               group: 'Tailwind reference' },
  { id: 'responsive',      label: 'Responsive',         group: 'Tailwind reference' },
  { id: 'states',          label: 'State variants',     group: 'Tailwind reference' },
  { id: 'borders-shadows', label: 'Borders & shadows',  group: 'Tailwind reference' },
  { id: 'daisy-buttons',   label: 'Buttons',            group: 'DaisyUI components' },
  { id: 'daisy-forms',     label: 'Forms',              group: 'DaisyUI components' },
  { id: 'daisy-layout',    label: 'Cards & layout',     group: 'DaisyUI components' },
  { id: 'daisy-navigation',label: 'Navigation',         group: 'DaisyUI components' },
  { id: 'daisy-feedback',  label: 'Feedback',           group: 'DaisyUI components' },
  { id: 'daisy-data',      label: 'Data display',       group: 'DaisyUI components' },
  { id: 'patterns',        label: 'UI patterns',        group: 'Build with it' },
  { id: 'workflows',       label: 'Workflows',          group: 'Build with it' },
  { id: 'tips',            label: 'Tips & gotchas',     group: 'Build with it' },
]

export default function OxygenTailwindGuidePage() {
  return (
    <div className="min-h-screen bg-navy text-white/70 font-body text-[14px] leading-relaxed py-12 px-6">
      <BreakpointIndicator />

      <div className="max-w-[1200px] mx-auto">
        {/* Header */}
        <header className="border-l-[3px] border-orange pl-5 mb-9">
          <div className="font-mono text-[11px] text-orange tracking-[0.15em] uppercase mb-1.5">
            // enrollment resources — internal tooling
          </div>
          <h1 className="font-display text-[32px] font-extrabold text-white leading-tight mb-2">
            Oxygen + Tailwind + DaisyUI<br />
            <span className="text-white/60 text-[22px] font-bold">The ER house stack — a working guide</span>
          </h1>
          <p className="text-white/40 font-mono text-[12px]">
            oxygen 6 &nbsp;·&nbsp; tailwind v4 &nbsp;·&nbsp; daisyui v5 &nbsp;·&nbsp; shipped via fusioncore
          </p>
        </header>

        <div className="flex gap-10">
          <Sidebar sections={SECTIONS} />

          <div className="min-w-0 flex-1">

            {/* ───────────────────────── OVERVIEW ───────────────────────── */}
            <PhaseBanner id="overview" text="— part 01   get oriented" />

            <div className="mb-9">
              <SectionHeader step="01" title="The ER house stack — at a glance" phase="Overview" />
              <Card>
                <P>
                  Every ER client site shares the same front-end stack. This guide is your reference for it.
                </P>
                <div className="grid sm:grid-cols-2 gap-3 mt-3">
                  {[
                    { label: 'Page builder', value: 'Oxygen 6.0.0', desc: 'Visual WP builder · semantic HTML output' },
                    { label: 'CSS framework', value: 'Tailwind CSS v4', desc: 'Utility classes · @theme tokens · oklch colors' },
                    { label: 'Component library', value: 'DaisyUI v5', desc: '.btn / .card / .alert / .menu / etc.' },
                    { label: 'Distribution', value: 'ER FusionCore', desc: 'In-house plugin enqueues a precompiled bundle' },
                  ].map((it) => (
                    <div key={it.label} className="rounded-lg border border-navy-border bg-navy-deep/50 p-3">
                      <div className="font-mono text-[10px] text-white/40 tracking-widest uppercase mb-1">{it.label}</div>
                      <div className="font-display font-bold text-[15px] text-white">{it.value}</div>
                      <div className="text-[12px] text-white/55 mt-0.5">{it.desc}</div>
                    </div>
                  ))}
                </div>
                <Callout type="tip" icon="💡">
                  No build step, no plugin to install per-site, no <InlineCode>tailwind.config</InlineCode> to
                  edit. Tailwind + DaisyUI are precompiled into FusionCore and enqueued on every page. You write
                  utility classes; they just work.
                </Callout>
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step="02" title="What Oxygen Builder is — and why use it" phase="Background" />
              <Card>
                <P>
                  <strong>Oxygen Builder</strong> is a visual WordPress site builder that disables your active theme
                  and lets you design every pixel of every page from inside its own editor. Unlike Elementor or Divi,
                  Oxygen does not ship a theme — <strong>Oxygen replaces your theme</strong>. Header, footer,
                  archive, single-post, 404, even the homepage are all built inside Oxygen.
                </P>
                <P>
                  The current major release is <strong>Oxygen 6</strong> (released February 2026), a rebuild of
                  the previous Angular-based 3.x/4.x line. ER's client sites are on Oxygen 6.0.0 with the{' '}
                  <InlineCode>Oxygen Zero</InlineCode> stub theme active.
                </P>
                <Sub>Oxygen 6 highlights</Sub>
                <ul className="text-[13px] text-white/65 space-y-1.5 mt-2 pl-1 font-body">
                  {[
                    ['Clean, semantic HTML output', 'Properties panel maps directly to CSS — no nested wrapper-div tax'],
                    ['Full CSS variable support', 'Reads from FusionCore\'s @theme tokens out of the box'],
                    ['Reusable Components', 'Symbol/instance system — edit once, propagate everywhere'],
                    ['Loop Builders', 'Map over WordPress posts, CPTs, or taxonomy terms'],
                    ['Element Studio', 'Build your own custom builder elements visually, no PHP registration code'],
                    ['Dynamic Data', 'Native ACF Pro integration (already used heavily on ER sites)'],
                  ].map(([t, d]) => (
                    <li key={t} className="flex gap-2">
                      <span className="text-orange flex-shrink-0">▸</span>
                      <span>
                        <strong className="text-white">{t}.</strong> <span className="text-white/55">{d}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <Callout type="tip" icon="💡">
                  Mental model: Oxygen is the WordPress equivalent of Webflow with a developer slant — it gives you
                  the visual canvas, but assumes you can read CSS.
                </Callout>
              </Card>
            </div>

            {/* ───────────────────────── INTERFACE ───────────────────────── */}
            <div className="mb-9">
              <SectionHeader step="03" title="The Oxygen interface" phase="Tour" id="interface" />
              <Card>
                <Sub>Where Oxygen lives in WP admin</Sub>
                <P>
                  In the WordPress admin sidebar, the <strong>Oxygen</strong> menu has eight top-level entries
                  (yes, eight — they're not consolidated under Templates the way you'd expect from a v6 builder):
                </P>
                <KeyTable
                  rows={[
                    { class: 'Oxygen → Home',          effect: 'Plugin landing page' },
                    { class: 'Oxygen → Templates',     effect: 'Page templates with conditions + priority (excludes header/footer)' },
                    { class: 'Oxygen → Headers',       effect: 'Site header templates — separate from Templates' },
                    { class: 'Oxygen → Footers',       effect: 'Site footer templates — also separate' },
                    { class: 'Oxygen → Components',    effect: 'Reusable design components (the Oxygen 6 instance system)' },
                    { class: 'Oxygen → Design Library', effect: 'Pre-made starter sections / blocks' },
                    { class: 'Oxygen → Partner Discounts', effect: 'Marketing — ignore' },
                    { class: 'Oxygen → Settings',      effect: 'Plugin settings · class manager · cache · Code block defaults' },
                  ]}
                />
                <Callout type="info" icon="ℹ">
                  To open the visual builder for any page or post, edit it the normal WP way and click{' '}
                  <strong>Edit with Oxygen</strong> — or hit the URL{' '}
                  <InlineCode>?oxygen=builder&id=&lt;post_id&gt;</InlineCode> directly. The builder takes over
                  the whole browser tab.
                </Callout>

                <Sub>Inside the builder</Sub>
                {/* Visual diagram */}
                <div className="mt-3 rounded-lg border border-navy-border overflow-hidden bg-navy-deep/60">
                  <div className="bg-[#0f1118] border-b border-navy-border px-3 py-1.5 flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500/60" />
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
                    <span className="font-mono text-[10px] text-white/40 ml-3 tracking-wider uppercase">
                      Oxygen editor — top bar
                    </span>
                    <span className="ml-auto font-mono text-[10px] text-white/30">
                      [build / preview] · [📱 💻 🖥] · [⤺ ⤻] · save · exit
                    </span>
                  </div>
                  <div className="grid grid-cols-[180px_1fr_220px] min-h-[200px] divide-x divide-navy-border">
                    <div className="p-3 bg-navy-deep">
                      <div className="font-mono text-[10px] text-white/40 tracking-widest uppercase mb-2">
                        Structure tree
                      </div>
                      <div className="space-y-1 font-mono text-[10px] text-white/55">
                        <div>▸ section.hero</div>
                        <div className="pl-3">▸ div.container</div>
                        <div className="pl-6 text-orange">h1.title</div>
                        <div className="pl-6">p.lede</div>
                        <div className="pl-6">a.cta</div>
                        <div>▸ section.features</div>
                        <div>▸ footer</div>
                      </div>
                    </div>
                    <div className="bg-navy/40 p-4 flex items-center justify-center">
                      <div className="text-center">
                        <div className="font-mono text-[10px] text-white/30 tracking-widest uppercase mb-2">
                          Canvas (live preview)
                        </div>
                        <div className="bg-white/5 border border-dashed border-navy-border rounded p-6">
                          <div className="text-white/40 font-mono text-[11px]">
                            Click an element here<br />to select it
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="p-3 bg-navy-deep">
                      <div className="font-mono text-[10px] text-white/40 tracking-widest uppercase mb-2">
                        Properties
                      </div>
                      <div className="space-y-1.5 font-mono text-[10px]">
                        <div className="flex gap-2 pb-1.5 border-b border-navy-border">
                          <span className="text-orange font-bold">Primary</span>
                          <span className="text-white/40">Advanced</span>
                        </div>
                        <div className="text-white/55">Typography ▸</div>
                        <div className="text-white/55">Layout ▸</div>
                        <div className="text-white/55">Size ▸</div>
                        <div className="text-white/55">Spacing ▸</div>
                        <div className="text-white/55">Borders ▸</div>
                        <div className="text-white/55">Effects ▸</div>
                        <div className="text-white/55">Conditions ▸</div>
                      </div>
                    </div>
                  </div>
                </div>

                <Sub>Five regions to remember</Sub>
                <ul className="text-[12px] text-white/65 space-y-1.5 mt-1 font-body">
                  <li>
                    <strong className="text-white">Top bar</strong> — view mode, responsive viewport, undo/redo,
                    save, manage, exit
                  </li>
                  <li>
                    <strong className="text-white">Left rail</strong> — element library + reusable components library
                  </li>
                  <li>
                    <strong className="text-white">Structure tree</strong> — DOM-style nav (your single most
                    important navigation tool)
                  </li>
                  <li>
                    <strong className="text-white">Canvas</strong> — live, in-browser preview
                  </li>
                  <li>
                    <strong className="text-white">Properties panel</strong> — Primary tab (element-specific) +
                    Advanced tab (universal: layout, size, spacing, borders, conditions, attributes, custom CSS)
                  </li>
                </ul>

                <Sub>Useful shortcuts</Sub>
                <KeyTable
                  rows={[
                    { class: 'Ctrl/Cmd + S', effect: 'Save' },
                    { class: 'Ctrl/Cmd + Z', effect: 'Undo' },
                    { class: 'Ctrl/Cmd + Shift + Z', effect: 'Redo' },
                    { class: 'Ctrl/Cmd + P', effect: 'Toggle preview mode' },
                    { class: 'Ctrl/Cmd + K', effect: 'Search elements / actions (v6)' },
                  ]}
                />
              </Card>
            </div>

            {/* ───────────────────────── CONCEPTS ───────────────────────── */}
            <div className="mb-9">
              <SectionHeader step="04" title="Core concepts" phase="Mental model" id="concepts" />
              <Card>
                <Sub>Elements</Sub>
                <P>
                  Everything on a page is an <strong>element</strong>. Two flavors: <strong>containers</strong>{' '}
                  (Section, Div, Columns) and <strong>atoms</strong> (Heading, Text, Link, Image, Icon, Button…).
                  Every element exposes its tag, ID, classes, and HTML attributes — and that classes field is
                  where Tailwind utilities go (see <a href="#classes-where" className="text-orange hover:text-orange-light underline-offset-2 hover:underline">Where classes go</a>).
                </P>

                <Sub>Templates, Headers & Footers</Sub>
                <P>
                  Oxygen splits site-wide layout into <strong>three</strong> separate admin sections rather
                  than one — Templates (the page body shells), Headers (the top bar), and Footers (the bottom).
                  Each is its own list of records with its own conditions + priority.
                </P>
                <ul className="text-[12px] text-white/65 space-y-1 mt-1 pl-1 font-body">
                  {[
                    ['Templates', 'Single - Post · Single - Page · Archive - Category · Search Results · 404 · Main / fallback'],
                    ['Headers', 'One per layout variant (e.g. main header, landing-page slim header, microsite header)'],
                    ['Footers', 'Same — each header/footer is wired to a template via conditions'],
                  ].map(([n, d]) => (
                    <li key={n} className="flex gap-2">
                      <span className="text-orange flex-shrink-0">▸</span>
                      <span>
                        <strong className="text-white">{n}</strong> — {d}
                      </span>
                    </li>
                  ))}
                </ul>
                <P>
                  Each entry has <strong>conditions</strong> deciding where it applies. When conditions overlap,{' '}
                  <strong>Priority</strong> (higher wins) decides.
                </P>

                <Sub>Reusable Components (Oxygen 6)</Sub>
                <P>
                  A Reusable Component is a saved chunk of design that can be inserted anywhere and edited{' '}
                  <strong>once</strong> to update <strong>everywhere</strong>. Components can have{' '}
                  <strong>parameters</strong> so each instance can pass in different content (icon, title, link)
                  while sharing the design. The closest thing Oxygen has to React components.
                </P>

                <Sub>Global Styles & CSS variables</Sub>
                <P>
                  Oxygen has its own <strong>Manage → Stylesheets</strong> and{' '}
                  <strong>Manage → Settings → Global Styles</strong> screens, but on ER sites you generally{' '}
                  <em>don't</em> use them for design tokens — those come from FusionCore's compiled Tailwind
                  bundle (<InlineCode>--color-primary</InlineCode>,{' '}
                  <InlineCode>--font-headings</InlineCode>, etc.) Reserve Oxygen's Stylesheets for one-off
                  per-page overrides or non-utility CSS (custom keyframes, complex gradients).
                </P>

                <Sub>Conditions</Sub>
                <P>
                  Almost any element can be conditionally shown/hidden via{' '}
                  <strong>Advanced → Conditions</strong>. Hide a "Login" button when logged in, show a banner
                  only on the homepage, toggle by URL parameter — all from the UI.
                </P>
              </Card>
            </div>

            {/* ───────────────────────── THE ER STACK ───────────────────────── */}
            <PhaseBanner id="how-it-ships" text="— part 02   the er stack" />

            <div className="mb-9">
              <SectionHeader step="05" title="How Tailwind ships at ER" phase="FusionCore" />
              <Card>
                <P>
                  There is no Tailwind plugin to install per-site. The ER FusionCore plugin ships a precompiled
                  Tailwind v4 + DaisyUI v5 stylesheet and enqueues it on every page automatically. As of writing,
                  the bundle is roughly 190 KB and lives at:
                </P>
                <CodeBlock label="enqueued css">{`/wp-content/uploads/er-plugin/assets/style.<hash>.css`}</CodeBlock>
                <P>
                  Practical implications for day-to-day work:
                </P>
                <ul className="text-[13px] text-white/65 space-y-1.5 mt-2 pl-1 font-body">
                  {[
                    ['No build step', 'You don\'t run npm. Tailwind is compiled inside FusionCore at plugin build time'],
                    ['No JIT scanning', 'Every Tailwind utility is already in the bundle — type any class string in Oxygen and it works without rescan'],
                    ['No per-site config', 'The Tailwind config is in FusionCore. To add a new token or DaisyUI plugin, ship a new FusionCore version'],
                    ['DaisyUI is included', '.btn, .card, .alert, .menu, .navbar, .toggle, .input, etc. are all available out of the box'],
                    ['Brand tokens vary per client', 'Each client site overrides --color-primary / -secondary / -tertiary in their own theme — same class name, different value'],
                  ].map(([t, d]) => (
                    <li key={t} className="flex gap-2">
                      <span className="text-orange flex-shrink-0">▸</span>
                      <span>
                        <strong className="text-white">{t}.</strong> <span className="text-white/55">{d}</span>
                      </span>
                    </li>
                  ))}
                </ul>
                <Callout type="tip" icon="💡">
                  Need a new utility class or theme token sitewide? It's a FusionCore PR, not a per-site change.
                  Edit per-page CSS in Oxygen's Stylesheets only for genuine one-offs.
                </Callout>
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step="06" title="Design tokens" phase="Theme" id="design-tokens" />
              <Card>
                <P>
                  FusionCore exposes a fixed set of <strong>brand tokens</strong>. The token <em>names</em> are
                  the same on every client; the <em>values</em> are overridden per client. Use the token name —
                  never hard-code a hex.
                </P>
                <Sub>Brand color tokens</Sub>
                <KeyTable
                  rows={[
                    { class: 'primary',              effect: 'Primary brand color · use as bg-primary, text-primary, border-primary' },
                    { class: 'secondary',            effect: 'Secondary brand color · supporting surfaces' },
                    { class: 'tertiary',             effect: 'Accent / call-to-action color · usually warm' },
                    { class: 'background',           effect: 'Page background — usually white' },
                    { class: 'background-secondary', effect: 'Alternate row / panel background' },
                    { class: 'text',                 effect: 'Body text color · usually black or near-black' },
                    { class: 'link',                 effect: 'Text-link color (often = text)' },
                    { class: 'button',               effect: 'Default button background (often = tertiary)' },
                    { class: 'buttontext',           effect: 'Default button text color' },
                  ]}
                />

                <Sub>DaisyUI semantic tokens (also available)</Sub>
                <KeyTable
                  rows={[
                    { class: 'base-100 / base-200 / base-300', effect: 'Neutral surface scale (lightest → darkest)' },
                    { class: 'base-content',          effect: 'Default text color on a base surface' },
                    { class: 'accent',                effect: 'DaisyUI accent (separate from your tertiary)' },
                    { class: 'neutral / neutral-content', effect: 'Neutral surface + matching text color' },
                    { class: 'info / success / warning / error', effect: 'Status colors with paired -content text colors' },
                  ]}
                />

                <Sub>Typography token</Sub>
                <KeyTable
                  rows={[
                    { class: 'font-headings', effect: 'Per-client heading font (resolves via --client-heading-font)' },
                    { class: 'font-sans',     effect: 'Default UI sans family (system stack)' },
                    { class: 'font-mono',     effect: 'Monospace family' },
                  ]}
                />

                <Sub>Spacing aliases</Sub>
                <KeyTable
                  rows={[
                    { class: '--spacing-xs (0.25rem)',  effect: 'Smallest gap unit (= space-1)' },
                    { class: '--spacing-sm (0.5rem)',   effect: '= space-2' },
                    { class: '--spacing-md (1rem)',     effect: '= space-4' },
                    { class: '--spacing-lg (1.5rem)',   effect: '= space-6' },
                    { class: '--spacing-xl (2rem)',     effect: '= space-8' },
                  ]}
                />

                <Callout type="warn" icon="⚠">
                  <strong>Token names are universal; values are per-client.</strong>{' '}
                  <InlineCode>bg-primary</InlineCode> renders different hex values on different client sites —
                  always reference by token name. To change a value sitewide, change it in FusionCore, not in
                  Oxygen.
                </Callout>

                <Sub>Example — using brand tokens in Oxygen</Sub>
                <CodeBlock label="hero — token-driven" language="html">{`<section class="bg-primary text-white py-16 px-6">
  <div class="max-w-7xl mx-auto text-center">
    <h1 class="font-headings text-5xl font-bold">Welcome to Pro Way</h1>
    <p class="mt-4 text-white/85 max-w-xl mx-auto">
      Career-focused programs in cosmetology and barbering.
    </p>
    <a class="btn btn-primary mt-8">Apply Now</a>
  </div>
</section>`}</CodeBlock>
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step="07" title="Where Tailwind classes go in Oxygen" phase="In the builder" id="classes-where" />
              <Card>
                <P>
                  ER sites don't use WindPress, Winden, or any other Tailwind plugin wrapper. There is no
                  separate "Plain Classes" input. Utility classes go in <strong>Oxygen's native CSS Class field</strong>,
                  same place you'd put any class name.
                </P>

                <Sub>The two class-related fields in the properties panel</Sub>
                <div className="grid sm:grid-cols-2 gap-3 mt-2">
                  <div className="rounded-lg border border-orange/40 bg-orange/5 p-3">
                    <div className="font-mono text-[10px] text-orange uppercase tracking-wider mb-1.5">
                      CSS Class field
                    </div>
                    <div className="text-[12px] text-white/65 leading-relaxed">
                      <strong className="text-orange">Where everything goes.</strong> Type space-separated
                      utility classes — <InlineCode>flex items-center gap-4 bg-primary text-white</InlineCode>{' '}
                      — straight into the Class input. Renders directly into the element's{' '}
                      <InlineCode>class=&quot;&quot;</InlineCode> attribute.
                    </div>
                  </div>
                  <div className="rounded-lg border border-blue-500/30 bg-blue-500/5 p-3">
                    <div className="font-mono text-[10px] text-blue-300 uppercase tracking-wider mb-1.5">
                      Selectors panel (advanced)
                    </div>
                    <div className="text-[12px] text-white/65 leading-relaxed">
                      For defining a <em>named</em> selector with its own CSS rules (<InlineCode>.cta-card</InlineCode>{' '}
                      → custom CSS). Rarely needed — the FusionCore bundle covers most cases. Use only for
                      genuinely reusable, non-utility-expressible patterns.
                    </div>
                  </div>
                </div>

                <Callout type="info" icon="ℹ">
                  Oxygen also auto-adds its own per-element classes (<InlineCode>oxy-container-4824-241</InlineCode>,{' '}
                  <InlineCode>oxy-text-37-101</InlineCode>, etc.) — those are internal, used by Oxygen for its
                  own per-element styling. Ignore them; just write your utility classes alongside.
                </Callout>

                <Sub>Real example from a live page</Sub>
                <CodeBlock label="rendered html — typical card on a client site" language="html">{`<a class="oxy-container-link oxy-container-link-4824-220 flex flex-col items-center
        gap-2 p-4 rounded-md bg-base-100 hover:bg-base-200 transition-colors">
  <svg class="oxy-svg-icon oxy-svg-icon-4824-221 w-8 h-8 text-tertiary">…</svg>
  <span class="oxy-text oxy-text-4824-222 text-sm font-semibold text-primary">
    Apply Now
  </span>
</a>`}</CodeBlock>
                <P>
                  The <InlineCode>oxy-*</InlineCode> classes are auto-generated by Oxygen for its internal
                  per-element CSS. Everything else — <InlineCode>flex</InlineCode>,{' '}
                  <InlineCode>flex-col</InlineCode>, <InlineCode>gap-2</InlineCode>,{' '}
                  <InlineCode>bg-base-100</InlineCode>, <InlineCode>text-primary</InlineCode> — is what your
                  team typed into the CSS Class field.
                </P>
              </Card>
            </div>

            {/* ───────────────────────── TAILWIND REFERENCE ───────────────────────── */}
            <PhaseBanner id="philosophy" text="— part 03   tailwind reference" />

            <div className="mb-9">
              <SectionHeader step="08" title="The utility-class philosophy" phase="Foundation" />
              <Card>
                <P>Traditional CSS:</P>
                <CodeBlock label="traditional css" language="css">{`.hero-title {
  font-size: 3rem;
  font-weight: 700;
  color: #0f172a;
  margin-bottom: 1.5rem;
}

<h1 class="hero-title">Welcome</h1>`}</CodeBlock>
                <P>Tailwind:</P>
                <CodeBlock label="tailwind" language="html">{`<h1 class="text-5xl font-bold text-slate-900 mb-6">Welcome</h1>`}</CodeBlock>
                <P>
                  Each utility class <strong>does one thing</strong>. You compose dozens of them on a single
                  element. Benefits: no naming things, no context-switching to a separate stylesheet, no dead CSS,
                  visual consistency from the design tokens Tailwind enforces (the spacing scale, the color shades).
                </P>
                <P>
                  The drawback is class-string verbosity. When a pattern repeats often enough that you're
                  copy-pasting it, lift it into an Oxygen <strong>Reusable Component</strong> — that's the ER
                  equivalent of a React component.
                </P>
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step="▶" variant="purple" title="Live playground (Tailwind v4 + DaisyUI v5)" phase="Interactive" id="playground" />
              <Card className="p-3">
                <div className="px-2 pt-1 pb-3">
                  <P>
                    Edit the HTML on the left — see Tailwind apply on the right. Sandboxed iframe runs the same
                    Tailwind v4 + DaisyUI v5 versions FusionCore ships in production. Brand tokens (
                    <InlineCode>primary</InlineCode>, <InlineCode>secondary</InlineCode>,{' '}
                    <InlineCode>tertiary</InlineCode>, <InlineCode>font-headings</InlineCode>) are pre-stubbed
                    so token-driven examples render with sensible (though not client-specific) values.
                  </P>
                </div>
                <Playground />
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step="09" title="Spacing — p, m, gap" phase="Reference" id="spacing" />
              <Card>
                <P>
                  Tailwind spacing uses a numeric scale where{' '}
                  <strong>1 unit = 0.25rem = 4px</strong> (by default). Click any row below to preview that
                  spacing applied as <InlineCode>padding</InlineCode>, <InlineCode>margin</InlineCode>, or{' '}
                  <InlineCode>gap</InlineCode>.
                </P>
                <div className="mt-3">
                  <SpacingScale />
                </div>
                <Sub>Pattern recap</Sub>
                <KeyTable
                  rows={[
                    { class: 'p-4', effect: 'padding all 4 sides = 16px' },
                    { class: 'pt-2 / pr-4 / pb-6 / pl-3', effect: 'individual sides' },
                    { class: 'px-4 / py-2', effect: 'horizontal / vertical pairs' },
                    { class: 'mx-auto', effect: 'horizontally center a block element' },
                    { class: '-mt-4', effect: 'negative margin (note the leading -)' },
                    { class: 'gap-4', effect: 'space between flex/grid children (preferred over space-x/y)' },
                  ]}
                />
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step="10" title="Sizing — w, h, max-w, min-h" phase="Reference" id="sizing" />
              <Card>
                <P>Same numeric scale as spacing, plus fractions, percentages, and named sizes.</P>
                <KeyTable
                  rows={[
                    { class: 'w-4',           effect: 'width = 16px' },
                    { class: 'w-1/2 / w-2/3', effect: 'fractional widths' },
                    { class: 'w-full / w-screen / w-fit / w-auto', effect: '100% / 100vw / fit-content / auto' },
                    { class: 'max-w-md',      effect: '28rem (448px) — common body-text width' },
                    { class: 'max-w-7xl',    effect: '80rem (1280px) — common page container' },
                    { class: 'min-h-screen',  effect: '100vh — full viewport hero' },
                    { class: 'h-12',          effect: 'height = 48px' },
                    { class: 'aspect-video / aspect-square', effect: 'locked aspect ratio' },
                  ]}
                />
                <Callout type="info" icon="ℹ">
                  Common max-width scale: <InlineCode>xs</InlineCode> (320) → <InlineCode>sm</InlineCode> (384) →{' '}
                  <InlineCode>md</InlineCode> (448) → <InlineCode>lg</InlineCode> (512) →{' '}
                  <InlineCode>xl</InlineCode> (576) → <InlineCode>2xl</InlineCode> (672) → … →{' '}
                  <InlineCode>7xl</InlineCode> (1280) → <InlineCode>full</InlineCode> (100%).
                </Callout>
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step="11" title="Typography" phase="Reference" id="typography" />
              <Card>
                <CodeBlock label="example">{`<h1 class="text-4xl font-bold leading-tight tracking-tight text-slate-900">
  Hello
</h1>`}</CodeBlock>
                <Sub>Font size scale</Sub>
                <div className="rounded-lg border border-navy-border bg-navy-deep/50 p-3 mt-2">
                  <div className="space-y-0.5 font-mono text-white">
                    <div className="text-[12px]"><span className="text-orange mr-3">text-xs</span>The quick brown fox · 12px</div>
                    <div className="text-[14px]"><span className="text-orange mr-3">text-sm</span>The quick brown fox · 14px</div>
                    <div className="text-[16px]"><span className="text-orange mr-3">text-base</span>The quick brown fox · 16px</div>
                    <div className="text-[18px]"><span className="text-orange mr-3">text-lg</span>The quick brown fox · 18px</div>
                    <div className="text-[20px]"><span className="text-orange mr-3">text-xl</span>The quick brown fox · 20px</div>
                    <div className="text-[24px]"><span className="text-orange mr-3">text-2xl</span>The quick brown fox · 24px</div>
                    <div className="text-[30px]"><span className="text-orange mr-3">text-3xl</span>The quick brown fox · 30px</div>
                    <div className="text-[36px]"><span className="text-orange mr-3">text-4xl</span>Quick brown fox · 36px</div>
                    <div className="text-[48px] leading-tight"><span className="text-orange mr-3 text-[14px] align-middle">text-5xl</span>Quick fox · 48px</div>
                  </div>
                </div>

                <Sub>Weight, line height, tracking</Sub>
                <KeyTable
                  rows={[
                    { class: 'font-thin … font-black', effect: 'font-weight 100 → 900 (normal=400, semibold=600, bold=700)' },
                    { class: 'leading-none / tight / snug / normal / relaxed / loose', effect: 'line-height 1 / 1.25 / 1.375 / 1.5 / 1.625 / 2' },
                    { class: 'tracking-tight / normal / wide / wider / widest', effect: 'letter-spacing' },
                    { class: 'text-left / center / right / justify', effect: 'alignment' },
                    { class: 'underline / no-underline / line-through', effect: 'decoration' },
                    { class: 'uppercase / lowercase / capitalize', effect: 'text-transform' },
                    { class: 'font-sans / serif / mono', effect: 'family (override defaults in tailwind.config)' },
                  ]}
                />
                <Callout type="tip" icon="💡">
                  For long-form prose: install <InlineCode>@tailwindcss/typography</InlineCode> and add{' '}
                  <InlineCode>prose prose-lg prose-slate</InlineCode> to a wrapper.
                </Callout>
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step="12" variant="purple" title="Color system" phase="Interactive" id="colors" />
              <Card className="p-3">
                <div className="px-2 pt-1 pb-3">
                  <P>
                    Tailwind colors are named <InlineCode>{`{hue}-{shade}`}</InlineCode>. 22 hues × 11 shades
                    (50 → 950). Click a swatch to copy <InlineCode>bg-slate-500</InlineCode>,{' '}
                    <InlineCode>text-blue-700</InlineCode>, etc. Switch the prefix toggle for{' '}
                    <InlineCode>text-</InlineCode>, <InlineCode>border-</InlineCode>, gradients, and more.
                  </P>
                </div>
                <ColorPalette />
                <Sub>Where colors apply</Sub>
                <KeyTable
                  rows={[
                    { class: 'text-{color}',    effect: 'text color' },
                    { class: 'bg-{color}',      effect: 'background' },
                    { class: 'border-{color}',  effect: 'border' },
                    { class: 'ring-{color}',    effect: 'focus ring' },
                    { class: 'placeholder-{color}', effect: 'input placeholder' },
                    { class: 'from-{color} / via-{color} / to-{color}', effect: 'gradient stops' },
                    { class: 'divide-{color}',  effect: 'borders between siblings' },
                    { class: 'fill-{color} / stroke-{color}', effect: 'SVG' },
                    { class: 'bg-blue-500/50',  effect: 'opacity (slash suffix)' },
                  ]}
                />
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step="13" title="Flexbox" phase="Reference" id="flexbox" />
              <Card>
                <CodeBlock label="example">{`<div class="flex items-center justify-between gap-4">
  <img class="w-10 h-10 rounded-full" />
  <span class="font-medium">Jane Doe</span>
  <button>Follow</button>
</div>`}</CodeBlock>
                <KeyTable
                  rows={[
                    { class: 'flex / inline-flex', effect: 'display: flex (default direction = row)' },
                    { class: 'flex-row / flex-col (-reverse)', effect: 'main-axis direction' },
                    { class: 'flex-wrap / flex-nowrap', effect: 'wrapping' },
                    { class: 'items-start / center / end / stretch / baseline', effect: 'cross-axis alignment' },
                    { class: 'justify-start / center / end / between / around / evenly', effect: 'main-axis distribution' },
                    { class: 'self-start / center / end / stretch', effect: 'per-child cross-axis override' },
                    { class: 'flex-1 / flex-auto / flex-none', effect: 'grow + shrink presets' },
                    { class: 'grow / grow-0 / shrink / shrink-0', effect: 'individual grow/shrink' },
                    { class: 'order-1 … order-12 / order-first / order-last', effect: 'reorder children' },
                  ]}
                />
                <Callout type="tip" icon="💡">
                  In <InlineCode>flex flex-row</InlineCode>, <InlineCode>items-*</InlineCode> controls the{' '}
                  <strong>vertical</strong> alignment and <InlineCode>justify-*</InlineCode> controls the{' '}
                  <strong>horizontal</strong> distribution. Flip those when you switch to{' '}
                  <InlineCode>flex-col</InlineCode>.
                </Callout>
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step="14" title="Grid" phase="Reference" id="grid-layout" />
              <Card>
                <CodeBlock label="example">{`<div class="grid grid-cols-3 gap-6">
  <div>1</div><div>2</div><div>3</div>
  <div class="col-span-2">4–5</div>
  <div>6</div>
</div>`}</CodeBlock>
                <KeyTable
                  rows={[
                    { class: 'grid', effect: 'display: grid' },
                    { class: 'grid-cols-1 … grid-cols-12', effect: 'N equal columns' },
                    { class: 'grid-rows-1 … grid-rows-6', effect: 'N equal rows' },
                    { class: 'col-span-2 … col-span-full', effect: 'element spans N columns' },
                    { class: 'row-span-*', effect: 'element spans N rows' },
                    { class: 'col-start-2 / col-end-4', effect: 'explicit placement' },
                    { class: 'gap-4 / gap-x-4 / gap-y-2', effect: 'gutters' },
                    { class: 'auto-cols-* / auto-rows-*', effect: 'implicit track sizing' },
                  ]}
                />
                <Sub>The card-grid workhorse</Sub>
                <CodeBlock label="responsive card grid">{`<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
  <!-- cards -->
</div>`}</CodeBlock>
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step="15" title="Responsive prefixes (mobile-first)" phase="Reference" id="responsive" />
              <Card>
                <P>
                  Tailwind is <strong>mobile-first</strong>: an unprefixed class applies at every size.
                  A prefixed class applies at that breakpoint <strong>and up</strong>.
                </P>
                <KeyTable
                  rows={[
                    { class: '(none)', effect: '0px and up — mobile' },
                    { class: 'sm:',  effect: '640px and up — large phone' },
                    { class: 'md:',  effect: '768px and up — tablet' },
                    { class: 'lg:',  effect: '1024px and up — small laptop' },
                    { class: 'xl:',  effect: '1280px and up — desktop' },
                    { class: '2xl:', effect: '1536px and up — large desktop' },
                  ]}
                />
                <CodeBlock label="example — 1 col mobile, 2 tablet, 3 laptop+">{`<div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">`}</CodeBlock>
                <Callout type="tip" icon="💡">
                  Watch the breakpoint pill in the bottom-right corner of this page — resize your window to see
                  it shift between <strong>mobile → sm → md → lg → xl → 2xl</strong>.
                </Callout>
                <Callout type="info" icon="ℹ">
                  To target only one breakpoint, combine: <InlineCode>md:flex lg:hidden</InlineCode> = visible on
                  tablet only.
                </Callout>
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step="16" title="State variants" phase="Reference" id="states" />
              <Card>
                <KeyTable
                  rows={[
                    { class: 'hover:',       effect: 'mouse hover' },
                    { class: 'focus:',       effect: 'element is focused' },
                    { class: 'focus-visible:', effect: 'focused via keyboard' },
                    { class: 'focus-within:', effect: 'a descendant is focused' },
                    { class: 'active:',      effect: 'mouse-down' },
                    { class: 'disabled:',    effect: 'disabled attribute' },
                    { class: 'checked:',     effect: 'checkbox/radio is checked' },
                    { class: 'group-hover:', effect: 'parent marked group is hovered' },
                    { class: 'peer-focus:',  effect: 'sibling marked peer is focused' },
                    { class: 'dark:',        effect: 'dark mode active' },
                    { class: 'first: / last: / odd: / even:', effect: 'child position' },
                    { class: 'aria-expanded: / data-[state=open]:', effect: 'aria/data attribute states' },
                    { class: 'motion-reduce: / motion-safe:', effect: 'user motion preference' },
                    { class: 'print:', effect: 'when printing' },
                  ]}
                />
                <CodeBlock label="example — fully styled button">{`<button class="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 focus-visible:ring-2 focus-visible:ring-blue-300">
  Save
</button>`}</CodeBlock>
                <Callout type="tip" icon="💡">
                  Stack variants by chaining: <InlineCode>md:hover:bg-blue-700</InlineCode> = on hover, on
                  tablet+.
                </Callout>
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step="17" title="Borders, shadows, rounded" phase="Reference" id="borders-shadows" />
              <Card>
                <Sub>Borders</Sub>
                <KeyTable
                  rows={[
                    { class: 'border', effect: '1px on all sides' },
                    { class: 'border-2 / border-4 / border-8', effect: 'thicker' },
                    { class: 'border-t / border-x / border-b', effect: 'side-specific' },
                    { class: 'border-blue-500', effect: 'color' },
                    { class: 'border-dashed / border-dotted / border-solid / border-none', effect: 'style' },
                    { class: 'divide-y / divide-x', effect: 'lines between stacked children' },
                  ]}
                />

                <Sub>Rounded corners</Sub>
                <KeyTable
                  rows={[
                    { class: 'rounded',     effect: '4px on all corners' },
                    { class: 'rounded-md',  effect: '6px' },
                    { class: 'rounded-lg',  effect: '8px' },
                    { class: 'rounded-xl',  effect: '12px' },
                    { class: 'rounded-2xl', effect: '16px' },
                    { class: 'rounded-full', effect: 'pill / circle' },
                    { class: 'rounded-t-lg / rounded-tl-lg', effect: 'side / corner specific' },
                  ]}
                />

                <Sub>Shadows</Sub>
                <KeyTable
                  rows={[
                    { class: 'shadow-sm', effect: 'subtle' },
                    { class: 'shadow',    effect: 'default' },
                    { class: 'shadow-md', effect: 'card-ish' },
                    { class: 'shadow-lg', effect: 'lifted' },
                    { class: 'shadow-xl', effect: 'strong' },
                    { class: 'shadow-2xl', effect: 'dramatic' },
                    { class: 'shadow-inner', effect: 'inset' },
                    { class: 'shadow-blue-500/50', effect: 'colored (v3+)' },
                  ]}
                />

                <Sub>Rings (focus outline alternative)</Sub>
                <KeyTable
                  rows={[
                    { class: 'ring',                       effect: '3px ring' },
                    { class: 'ring-2',                     effect: '2px ring' },
                    { class: 'ring-blue-300',              effect: 'color' },
                    { class: 'ring-offset-2 ring-offset-white', effect: 'gap between element and ring' },
                  ]}
                />
              </Card>
            </div>

            {/* ───────────────────────── DAISYUI COMPONENTS ───────────────────────── */}
            <PhaseBanner id="daisy-buttons" text="— part 04   daisyui components" />

            <div className="mb-9">
              <SectionHeader step="✦" variant="purple" title="DaisyUI component reference" phase="Pre-built" />
              <Card>
                <P>
                  DaisyUI ships <strong>component classes</strong> on top of Tailwind utilities — pre-styled
                  buttons, cards, navbars, alerts, etc. that respect your brand tokens automatically. Use
                  these <em>before</em> reaching for raw utilities — the team has less to maintain, the result
                  is more consistent across pages, and theme changes propagate for free.
                </P>
                <Callout type="tip" icon="💡">
                  Every component below picks up your client's brand colors via the same{' '}
                  <InlineCode>primary</InlineCode>, <InlineCode>secondary</InlineCode>,{' '}
                  <InlineCode>accent</InlineCode> tokens documented in{' '}
                  <a href="#design-tokens" className="text-orange hover:text-orange-light underline-offset-2 hover:underline">
                    Design tokens
                  </a>. Try any example by pasting it into the{' '}
                  <a href="#playground" className="text-orange hover:text-orange-light underline-offset-2 hover:underline">
                    playground
                  </a>.
                </Callout>
              </Card>
            </div>

            <div className="mb-9">
              <DaisyComponentsSection />
            </div>

            {/* ───────────────────────── BUILD WITH IT ───────────────────────── */}
            <PhaseBanner id="patterns" text="— part 05   build with it" />

            <div className="mb-9">
              <SectionHeader step="▣" variant="purple" title="UI pattern gallery" phase="Interactive" />
              <P>
                Live previews + copy-ready class strings. Drop straight into Oxygen's CSS Class field — these
                patterns map 1:1 to what your client sites render. Where it makes sense, prefer the DaisyUI
                versions in the section above (<InlineCode>.btn</InlineCode>,{' '}
                <InlineCode>.card</InlineCode>) — these raw-utility versions are useful as fallbacks or when
                you need finer control than DaisyUI provides.
              </P>
              <div className="mt-3">
                <PatternGallery />
              </div>
            </div>

            <div className="mb-9">
              <SectionHeader step="18" title="Common workflows" phase="Day-to-day" id="workflows" />
              <Card>
                <Sub>Build a marketing section</Sub>
                <ol className="text-[13px] text-white/65 space-y-1 mt-1 pl-1 font-body list-decimal list-inside">
                  <li>Open the page → <strong>Edit with Oxygen</strong></li>
                  <li>Add a <strong>Section</strong> element → set tag <InlineCode>section</InlineCode>. CSS Class field: <InlineCode>relative isolate overflow-hidden bg-base-100</InlineCode></li>
                  <li>Inside, add a <strong>Div</strong> → tag <InlineCode>div</InlineCode>. Class field: <InlineCode>mx-auto max-w-7xl px-4 py-24</InlineCode></li>
                  <li>Drop in a Heading (<InlineCode>h2 font-headings text-4xl font-bold text-primary</InlineCode>), a Text (<InlineCode>mt-4 text-base text-base-content max-w-2xl</InlineCode>), then a Code Block / Div with a DaisyUI button (<InlineCode>btn btn-primary mt-8</InlineCode>)</li>
                  <li>Switch viewports (phone / tablet / desktop) and add <InlineCode>md:</InlineCode> / <InlineCode>lg:</InlineCode> overrides where the small layout breaks</li>
                  <li>Repeat for "Features", "Testimonials", "CTA", "Footer" sections — or convert each into a Reusable Component once you've built the second instance</li>
                </ol>

                <Sub>Lift a repeated section into a Reusable Component</Sub>
                <ol className="text-[13px] text-white/65 space-y-1 mt-1 pl-1 font-body list-decimal list-inside">
                  <li>Build it once with the right utility classes</li>
                  <li>Right-click in the structure tree → <strong>Convert to Component</strong></li>
                  <li>Mark variable parts (Heading text, Image src, Link URL) as <strong>parameters</strong> so each instance passes its own values</li>
                  <li>Save · insert from <strong>Oxygen → Components</strong> wherever needed</li>
                  <li>Edit the component once → every instance updates everywhere it appears</li>
                </ol>

                <Sub>Add a new design token sitewide</Sub>
                <P>
                  Tokens live in FusionCore — <strong>not</strong> in Oxygen, and not in any per-site
                  <InlineCode>tailwind.config</InlineCode>. To add a token (e.g. a new
                  <InlineCode>--color-quaternary</InlineCode> or a new spacing alias):
                </P>
                <ol className="text-[13px] text-white/65 space-y-1 mt-1 pl-1 font-body list-decimal list-inside">
                  <li>Open the FusionCore repo, edit the Tailwind <InlineCode>@theme</InlineCode> block</li>
                  <li>Bump the FusionCore plugin version, build, ship</li>
                  <li>Update FusionCore on each client site → new token is available everywhere as <InlineCode>bg-quaternary</InlineCode> / <InlineCode>text-quaternary</InlineCode></li>
                </ol>
                <Callout type="warn" icon="⚠">
                  Don't define new theme tokens in Oxygen's per-page Stylesheets — they'll only exist on that
                  one page and won't show up in autocomplete on the rest of the site.
                </Callout>

                <Sub>Style a button — DaisyUI vs raw Tailwind</Sub>
                <CodeBlock label="daisyui — preferred">{`<a class="btn btn-primary btn-lg">Apply Now</a>`}</CodeBlock>
                <CodeBlock label="raw tailwind — only when DaisyUI doesn't fit">{`<a class="inline-flex items-center justify-center rounded-lg bg-primary px-6 py-3 text-base font-medium text-white shadow-sm hover:opacity-90 transition-opacity">
  Apply Now
</a>`}</CodeBlock>

                <Sub>Conditionally show content</Sub>
                <P>
                  Example: hide a "Subscribe" CTA from logged-in users. Select the element → Properties →
                  Advanced → <strong>Conditions</strong> → add <InlineCode>User is Logged In = false</InlineCode>{' '}
                  → save.
                </P>
              </Card>
            </div>

            <Divider />

            <div className="mb-9">
              <SectionHeader step="!" variant="warn" title="Tips, gotchas & best practices" phase="Read me" id="tips" />
              <Card>
                <Sub>Workflow</Sub>
                <ul className="text-[13px] text-white/65 space-y-1.5 mt-2 pl-1 font-body">
                  {[
                    ['Reach for DaisyUI before raw utilities', 'A .btn / .card / .alert / .menu is one short class string + auto theme integration. Raw utilities are the fallback when those don\'t fit'],
                    ['Build mobile first', 'Design at the smallest viewport, then add md: / lg: overrides — never the reverse'],
                    ['Use Reusable Components early', 'Once you copy-paste a card or section twice, convert it'],
                    ['Save often', 'The browser editor is a long-running app — refresh recovery exists but is not magic'],
                    ['Use the staging site', 'erstaging.site is for experiments. Don\'t learn the builder on a live client site'],
                  ].map(([t, d]) => (
                    <li key={t} className="flex gap-2">
                      <span className="text-orange flex-shrink-0">▸</span>
                      <span><strong className="text-white">{t}.</strong> <span className="text-white/55">{d}</span></span>
                    </li>
                  ))}
                </ul>

                <Sub>Tailwind & DaisyUI specifics</Sub>
                <ul className="text-[13px] text-white/65 space-y-1.5 mt-2 pl-1 font-body">
                  {[
                    ['Use brand tokens, not hex values', 'bg-primary not bg-[#0b192e] — same class works on every client; hex codes drift'],
                    ['Don\'t fight the scale', 'If a design needs padding: 17px, ask whether p-4 (16px) is fine. Arbitrary values like p-[17px] exist but should be rare'],
                    ['Sort your classes', 'Convention: layout → spacing → sizing → typography → color → effects → state. Aids readability and diff review'],
                    ['Use @apply sparingly', 'Re-creates the named-class problem Tailwind exists to solve. Reserve for true repeating components — and even then, prefer DaisyUI'],
                    ['Watch class string length', 'If a single element has 30+ classes, break it into a Reusable Component'],
                    ['space-y-* / divide-y only work on direct children', 'Wrapping with another div silently breaks them'],
                    ['Forgetting flex or grid on the parent', 'is the #1 reason gap-* "doesn\'t work"'],
                    ['DaisyUI color modifiers chain', 'btn-primary, alert-success, badge-warning — same {component}-{semantic} pattern across all components'],
                  ].map(([t, d]) => (
                    <li key={t} className="flex gap-2">
                      <span className="text-blue-400 flex-shrink-0">▸</span>
                      <span><strong className="text-white">{t}.</strong> <span className="text-white/55">{d}</span></span>
                    </li>
                  ))}
                </ul>

                <Sub>Oxygen + FusionCore specifics</Sub>
                <ul className="text-[13px] text-white/65 space-y-1.5 mt-2 pl-1 font-body">
                  {[
                    ['Utility classes go in the CSS Class field', 'Not in the Selectors panel — that\'s for defining named CSS rules'],
                    ['Don\'t edit FusionCore CSS per-site', 'Per-site Stylesheets are for one-off overrides only. Token + utility changes belong in the FusionCore repo'],
                    ['Component parameters are nullable', 'Always provide sensible defaults so an empty parameter doesn\'t break the layout'],
                    ['oxy-* classes are auto-generated', 'You\'ll see oxy-container-1234-567 etc. in the rendered HTML — those are Oxygen\'s, not yours. Ignore them'],
                    ['Headers / Footers are separate from Templates', 'Updating the page-template won\'t touch the header or footer. They\'re three different admin sections'],
                  ].map(([t, d]) => (
                    <li key={t} className="flex gap-2">
                      <span className="text-purple-400 flex-shrink-0">▸</span>
                      <span><strong className="text-white">{t}.</strong> <span className="text-white/55">{d}</span></span>
                    </li>
                  ))}
                </ul>

                <Sub>Performance</Sub>
                <ul className="text-[13px] text-white/65 space-y-1.5 mt-2 pl-1 font-body">
                  <li className="flex gap-2"><span className="text-orange flex-shrink-0">▸</span><span>Run <strong className="text-white">Oxygen → Settings → CSS Cache → Regenerate</strong> after large structural changes.</span></li>
                  <li className="flex gap-2"><span className="text-orange flex-shrink-0">▸</span><span>FusionCore is precompiled — there's no JIT scanning step at runtime. Every Tailwind class in the bundle is always available; you don't need a safelist.</span></li>
                  <li className="flex gap-2"><span className="text-orange flex-shrink-0">▸</span><span>For images, prefer Oxygen's Image element + WordPress media library (responsive <InlineCode>srcset</InlineCode> automatically) over hand-rolled <InlineCode>&lt;img&gt;</InlineCode> tags.</span></li>
                  <li className="flex gap-2"><span className="text-orange flex-shrink-0">▸</span><span>The FusionCore bundle is ~190 KB compiled. If you find yourself adding a third-party CSS lib, ask whether DaisyUI already has the component first.</span></li>
                </ul>

                <Sub>Debugging</Sub>
                <ul className="text-[13px] text-white/65 space-y-1.5 mt-2 pl-1 font-body">
                  <li className="flex gap-2"><span className="text-red-400 flex-shrink-0">▸</span><span><strong className="text-white">Class isn't applying?</strong> Inspect the element. If the class is in the rendered <InlineCode>class=&quot;&quot;</InlineCode> but no style → typo (FusionCore has every real Tailwind class). If not in the class string → never made it onto the element via Oxygen.</span></li>
                  <li className="flex gap-2"><span className="text-red-400 flex-shrink-0">▸</span><span><strong className="text-white">Brand color looks wrong?</strong> Verify <InlineCode>--color-primary</InlineCode> at <InlineCode>:root</InlineCode> in DevTools. If it's the FusionCore default and not the client value → the per-client theme override isn't loading. Check FusionCore is active and the client config is in place.</span></li>
                  <li className="flex gap-2"><span className="text-red-400 flex-shrink-0">▸</span><span><strong className="text-white">Changes don't show on front-end?</strong> Clear Oxygen's CSS cache, clear your page cache, hard-refresh (<InlineCode>Cmd/Ctrl + Shift + R</InlineCode>).</span></li>
                  <li className="flex gap-2"><span className="text-red-400 flex-shrink-0">▸</span><span><strong className="text-white">DaisyUI component looks unstyled?</strong> Confirm FusionCore is enqueued — check that <InlineCode>/wp-content/uploads/er-plugin/assets/style.&lt;hash&gt;.css</InlineCode> is loading on the page.</span></li>
                </ul>
              </Card>
            </div>

            <Divider />

            <div className="mb-9">
              <Card>
                <Sub>Quick links</Sub>
                <ul className="text-[13px] text-white/65 space-y-1 mt-2 font-body">
                  <li>
                    <Pill color="orange">Oxygen</Pill>{' '}
                    <a href="https://oxygenbuilder.com/documentation/" target="_blank" rel="noreferrer noopener" className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline">
                      oxygenbuilder.com/documentation
                    </a>
                  </li>
                  <li>
                    <Pill color="blue">Tailwind v4</Pill>{' '}
                    <a href="https://tailwindcss.com/docs" target="_blank" rel="noreferrer noopener" className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline">
                      tailwindcss.com/docs
                    </a>
                  </li>
                  <li>
                    <Pill color="purple">DaisyUI v5</Pill>{' '}
                    <a href="https://daisyui.com/components/" target="_blank" rel="noreferrer noopener" className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline">
                      daisyui.com/components
                    </a>
                  </li>
                </ul>
              </Card>
            </div>

            {/* Footer */}
            <footer className="mt-14 pt-5 border-t border-navy-border flex justify-between font-mono text-[10px] text-white/40">
              <span>enrollment resources — internal tooling</span>
              <span>oxygen 6 &nbsp;·&nbsp; tailwind v4 &nbsp;·&nbsp; daisyui v5 &nbsp;·&nbsp; fusioncore</span>
            </footer>

          </div>
        </div>
      </div>
    </div>
  )
}
