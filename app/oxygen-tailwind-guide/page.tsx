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

export const metadata = {
  title: 'Oxygen Builder + Tailwind CSS Guide',
  description:
    'A practical reference for building WordPress sites with Oxygen Builder 6 and Tailwind CSS — interactive playground, color explorer, spacing visualizer, and UI pattern gallery.',
}

const SECTIONS: SidebarSection[] = [
  { id: 'overview',        label: 'Overview',           group: 'Get oriented' },
  { id: 'interface',       label: 'Interface',          group: 'Get oriented' },
  { id: 'concepts',        label: 'Core concepts',      group: 'Get oriented' },
  { id: 'install',         label: 'Install Oxygen',     group: 'Setup' },
  { id: 'tailwind-setup',  label: 'Add Tailwind',       group: 'Setup' },
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
            Oxygen Builder + Tailwind CSS<br />
            <span className="text-white/60 text-[22px] font-bold">A working guide</span>
          </h1>
          <p className="text-white/40 font-mono text-[12px]">
            oxygen 6 &nbsp;·&nbsp; windpress &nbsp;·&nbsp; tailwind v3/v4 &nbsp;·&nbsp; live playground
          </p>
        </header>

        <div className="flex gap-10">
          <Sidebar sections={SECTIONS} />

          <div className="min-w-0 flex-1">

            {/* ───────────────────────── OVERVIEW ───────────────────────── */}
            <PhaseBanner id="overview" text="— part 01   get oriented" />

            <div className="mb-9">
              <SectionHeader step="01" title="What Oxygen Builder is — and why use it" phase="Overview" />
              <Card>
                <P>
                  <strong>Oxygen Builder</strong> is a visual WordPress site builder that disables your active theme
                  and lets you design every pixel of every page from inside its own editor. Unlike Elementor or Divi,
                  Oxygen does not ship a theme — <strong>Oxygen replaces your theme</strong>. Header, footer,
                  archive, single-post, 404, even the homepage are all built inside Oxygen.
                </P>
                <P>
                  The current major release is <strong>Oxygen 6</strong> (released February 2026), a complete
                  rebuild of the previous Angular-based 3.x/4.x line.
                </P>
                <Sub>What's new in Oxygen 6</Sub>
                <ul className="text-[13px] text-white/65 space-y-1.5 mt-2 pl-1 font-body">
                  {[
                    ['Clean, semantic HTML output', 'Properties panel maps directly to CSS — no nested wrapper-div tax'],
                    ['Full CSS variable support', 'Define design tokens once, reference them everywhere'],
                    ['Reusable Components', 'Symbol/instance system — edit once, propagate everywhere'],
                    ['Loop Builders', 'Map over WordPress posts, CPTs, or taxonomy terms (Term Loop Builder is new)'],
                    ['Element Studio', 'Build your own custom builder elements visually, no PHP registration code'],
                    ['Dynamic Data', 'Native ACF and Meta Box integration'],
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
              <SectionHeader step="02" title="The Oxygen interface" phase="Tour" id="interface" />
              <Card>
                <P>
                  Open any post or page and click <strong>Edit with Oxygen</strong> — the editor takes over the
                  whole browser tab.
                </P>
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
              <SectionHeader step="03" title="Core concepts" phase="Mental model" id="concepts" />
              <Card>
                <Sub>Elements</Sub>
                <P>
                  Everything on a page is an <strong>element</strong>. Two flavors: <strong>containers</strong>{' '}
                  (Section, Div, Columns) and <strong>atoms</strong> (Heading, Text, Link, Image, Icon, Button…).
                  Every element exposes its tag, ID, classes, and HTML attributes.
                </P>

                <Sub>Templates</Sub>
                <P>
                  Templates control which pages or post types display what layout — outside of the page content
                  itself. You'll typically build:
                </P>
                <ul className="text-[12px] text-white/65 space-y-1 mt-1 pl-1 font-body">
                  {[
                    ['Main Template', 'wraps the whole site (header + footer)'],
                    ['Single - Post', 'layout for any blog post'],
                    ['Single - Page', 'layout for any page (often inherits from Main)'],
                    ['Archive - Category', 'category listings'],
                    ['Search Results / 404', 'self-explanatory'],
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
                  Each template has <strong>conditions</strong> deciding where it applies. When conditions
                  overlap, <strong>Priority</strong> (higher wins) decides.
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
                  <strong>Manage → Stylesheets</strong> for site-wide CSS.{' '}
                  <strong>Manage → Settings → Global Styles</strong> for design tokens (colors, font sizes,
                  spacing) as CSS variables. With Tailwind, your tokens generally live in{' '}
                  <InlineCode>tailwind.config</InlineCode> or a <InlineCode>@theme</InlineCode> block, but
                  Oxygen's Global Styles are still useful for non-utility values (custom shadows, gradients,
                  animations).
                </P>

                <Sub>Conditions</Sub>
                <P>
                  Almost any element can be conditionally shown/hidden via{' '}
                  <strong>Advanced → Conditions</strong>. Hide a "Login" button when logged in, show a banner
                  only on the homepage, toggle by URL parameter — all from the UI.
                </P>
              </Card>
            </div>

            {/* ───────────────────────── INSTALL ───────────────────────── */}
            <PhaseBanner id="install" text="— part 02   set up the stack" />

            <div className="mb-9">
              <SectionHeader step={1} title="Install Oxygen Builder" phase="WordPress admin" />
              <Card>
                <Callout type="warn" icon="⚠">
                  <strong>Take a backup first.</strong> Oxygen will disable your active theme.
                </Callout>
                <Sub>Steps</Sub>
                <ol className="text-[13px] text-white/65 space-y-1.5 mt-2 pl-1 font-body list-decimal list-inside">
                  <li>Buy a license from <InlineCode>oxygenbuilder.com</InlineCode></li>
                  <li>WP admin → <strong>Plugins → Add New → Upload Plugin</strong> → upload <InlineCode>oxygen.zip</InlineCode></li>
                  <li><strong>Activate</strong> the plugin</li>
                  <li>Enter your license key under <strong>Oxygen → Settings → License</strong></li>
                  <li>Visit the front of your site — it will look unstyled. <strong>This is normal.</strong></li>
                </ol>
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step={2} title="Build a Main Template (header + footer)" phase="Oxygen" />
              <Card>
                <P>
                  This is the very first thing to do, before any pages. Without it, every page renders unstyled.
                </P>
                <ol className="text-[13px] text-white/65 space-y-1.5 mt-2 pl-1 font-body list-decimal list-inside">
                  <li><strong>Oxygen → Templates → Add New</strong>, name it <InlineCode>Main</InlineCode></li>
                  <li>Inheritance = none, Apply to = Entire Site, Priority = 0</li>
                  <li>Click <strong>Edit with Oxygen</strong></li>
                  <li>Add a <strong>Section</strong> at top → set tag <InlineCode>header</InlineCode>. Drop in logo, nav, etc.</li>
                  <li>At the bottom add an <strong>Inner Content</strong> element — this is where individual page bodies render</li>
                  <li>After that, add another <strong>Section</strong> → tag <InlineCode>footer</InlineCode>, drop in footer content</li>
                  <li>Save</li>
                </ol>
                <Callout type="info" icon="ℹ">
                  If your pages render blank later, <strong>Inner Content</strong> is almost always missing from
                  the Main template.
                </Callout>
              </Card>
            </div>

            {/* ───────────────────────── TAILWIND SETUP ───────────────────────── */}
            <div className="mb-9">
              <SectionHeader step={3} variant="purple" title="Wire in Tailwind via WindPress" phase="Plugin" id="tailwind-setup" />
              <Card>
                <P>
                  Oxygen does not ship Tailwind. You add it via a plugin. Most popular options today:
                </P>
                <KeyTable
                  rows={[
                    { class: 'WindPress', effect: 'Free + Pro · JIT Tailwind v3/v4 · "Plain Classes" input on every Oxygen element with autocomplete' },
                    { class: 'Winden', effect: 'Similar feature set · includes "dequeue builder styles" toggle' },
                    { class: 'OxyMade / OxyNinja', effect: 'Tailwind-style frameworks tailored to Oxygen, batteries-included' },
                    { class: 'TailPress', effect: 'Free, simpler, less Oxygen-specific tooling' },
                  ]}
                />
                <P>This guide assumes <strong>WindPress</strong> — smoothest Oxygen 6 integration, works with stock Tailwind v3 or v4.</P>

                <Sub>Install</Sub>
                <ol className="text-[13px] text-white/65 space-y-1 mt-2 pl-1 font-body list-decimal list-inside">
                  <li><strong>Plugins → Add New</strong> → search <InlineCode>WindPress</InlineCode> → install + activate</li>
                  <li>Open <strong>WindPress → Settings</strong> · confirm Oxygen integration is enabled</li>
                  <li>Pick Tailwind v3 or v4 (v4 recommended for new projects)</li>
                  <li>Optionally enable "Sort classes" and "Autocomplete"</li>
                </ol>

                <Sub>Where to put Tailwind classes in Oxygen</Sub>
                <div className="grid sm:grid-cols-2 gap-3 mt-2">
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                    <div className="font-mono text-[10px] text-amber-400 uppercase tracking-wider mb-1.5">
                      Native "Selectors / Classes" field
                    </div>
                    <div className="text-[12px] text-white/65 leading-relaxed">
                      Designed for <em>named</em> classes that get a stylesheet rule (<InlineCode>.cta-card</InlineCode>).
                      Putting utilities here makes Oxygen treat them as named selectors.
                    </div>
                  </div>
                  <div className="rounded-lg border border-orange/40 bg-orange/5 p-3">
                    <div className="font-mono text-[10px] text-orange uppercase tracking-wider mb-1.5">
                      WindPress "Plain Classes" field
                    </div>
                    <div className="text-[12px] text-white/65 leading-relaxed">
                      <strong className="text-orange">Where utility classes belong.</strong> Autocomplete, hover preview,
                      class sorting, written straight to the rendered <InlineCode>class=&quot;&quot;</InlineCode>.
                    </div>
                  </div>
                </div>

                <Callout type="warn" icon="⚠">
                  <strong>Rule of thumb:</strong> named/component classes (<InlineCode>.btn</InlineCode>,{' '}
                  <InlineCode>.card</InlineCode>) → Oxygen's Selectors field; utility classes (<InlineCode>flex</InlineCode>,{' '}
                  <InlineCode>gap-4</InlineCode>, <InlineCode>bg-slate-900</InlineCode>) → WindPress Plain Classes field.
                </Callout>
              </Card>
            </div>

            {/* ───────────────────────── TAILWIND REFERENCE ───────────────────────── */}
            <PhaseBanner id="philosophy" text="— part 03   tailwind reference" />

            <div className="mb-9">
              <SectionHeader step="04" title="The utility-class philosophy" phase="Foundation" />
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
                  The drawback is class-string verbosity. Mitigate by extracting repeated patterns into Reusable
                  Components in Oxygen, or <InlineCode>@apply</InlineCode> directives in your CSS.
                </P>
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step="▶" variant="purple" title="Live Tailwind playground" phase="Interactive" id="playground" />
              <Card className="p-3">
                <div className="px-2 pt-1 pb-3">
                  <P>
                    Edit the HTML on the left — see Tailwind apply on the right. Sandboxed iframe, runs the real
                    Tailwind compiler, no installs needed. Try the presets, then change classes to see what
                    happens.
                  </P>
                </div>
                <Playground />
              </Card>
            </div>

            <div className="mb-9">
              <SectionHeader step="05" title="Spacing — p, m, gap" phase="Reference" id="spacing" />
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
              <SectionHeader step="06" title="Sizing — w, h, max-w, min-h" phase="Reference" id="sizing" />
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
              <SectionHeader step="07" title="Typography" phase="Reference" id="typography" />
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
              <SectionHeader step="08" variant="purple" title="Color system" phase="Interactive" id="colors" />
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
              <SectionHeader step="09" title="Flexbox" phase="Reference" id="flexbox" />
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
              <SectionHeader step="10" title="Grid" phase="Reference" id="grid-layout" />
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
              <SectionHeader step="11" title="Responsive prefixes (mobile-first)" phase="Reference" id="responsive" />
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
              <SectionHeader step="12" title="State variants" phase="Reference" id="states" />
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
              <SectionHeader step="13" title="Borders, shadows, rounded" phase="Reference" id="borders-shadows" />
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

            {/* ───────────────────────── BUILD WITH IT ───────────────────────── */}
            <PhaseBanner id="patterns" text="— part 04   build with it" />

            <div className="mb-9">
              <SectionHeader step="▣" variant="purple" title="UI pattern gallery" phase="Interactive" />
              <P>
                Live previews + copy-ready class strings. Drop straight into Oxygen's WindPress Plain Classes
                field — these patterns are intentionally framework-stock so they map 1:1 to what your client
                site will render.
              </P>
              <div className="mt-3">
                <PatternGallery />
              </div>
            </div>

            <div className="mb-9">
              <SectionHeader step="14" title="Common workflows" phase="Day-to-day" id="workflows" />
              <Card>
                <Sub>Build a marketing page layout</Sub>
                <ol className="text-[13px] text-white/65 space-y-1 mt-1 pl-1 font-body list-decimal list-inside">
                  <li>Open the page → <strong>Edit with Oxygen</strong></li>
                  <li>Add a <strong>Section</strong> → tag <InlineCode>section</InlineCode>. Plain Classes: <InlineCode>relative isolate overflow-hidden bg-slate-50</InlineCode></li>
                  <li>Inside, add a <strong>Div</strong> → tag <InlineCode>div</InlineCode>. Plain Classes: <InlineCode>mx-auto max-w-7xl px-4 py-24</InlineCode></li>
                  <li>Inside that, a <strong>Heading</strong> (<InlineCode>h1</InlineCode>) and <strong>Text</strong> (<InlineCode>p</InlineCode>), then a Div with two Buttons</li>
                  <li>Switch the responsive viewport between phone, tablet, desktop and adjust with <InlineCode>md:</InlineCode> and <InlineCode>lg:</InlineCode> prefixes</li>
                  <li>Repeat for "Features", "Testimonials", "CTA", "Footer" sections</li>
                </ol>

                <Sub>Make a card a Reusable Component</Sub>
                <ol className="text-[13px] text-white/65 space-y-1 mt-1 pl-1 font-body list-decimal list-inside">
                  <li>Build the card once with all its Tailwind classes</li>
                  <li>Right-click in the structure tree → <strong>Convert to Component</strong></li>
                  <li>Mark the Heading and Text as <strong>parameters</strong> so each instance can pass its own copy</li>
                  <li>Save · insert from the Components library wherever needed</li>
                  <li>Edit the component once → every instance updates</li>
                </ol>

                <Sub>Define brand colors once, use everywhere</Sub>
                <CodeBlock label="tailwind v3 — tailwind.config.js">{`module.exports = {
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef2ff', 100: '#e0e7ff', 500: '#3366ff', 700: '#1e40af',
        },
      },
    },
  },
};`}</CodeBlock>
                <CodeBlock label="tailwind v4 — main.css" language="css">{`@import "tailwindcss";

@theme {
  --color-brand-50:  #eef2ff;
  --color-brand-500: #3366ff;
  --color-brand-700: #1e40af;
}`}</CodeBlock>
                <P>
                  Now you can write <InlineCode>bg-brand-500</InlineCode>,{' '}
                  <InlineCode>text-brand-700</InlineCode>, etc. throughout Oxygen.
                </P>

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
                    ['Always build the Main Template first', 'Without it, every page renders unstyled'],
                    ['Build mobile first', 'Design at the smallest viewport, then add md: / lg: overrides'],
                    ['Use Reusable Components early', 'Once you copy-paste a card twice, convert it'],
                    ['Save often', 'The browser editor is a long-running app — refresh recovery exists but is not magic'],
                    ['Keep a staging site', 'Oxygen takes over your theme — do not learn it on production'],
                  ].map(([t, d]) => (
                    <li key={t} className="flex gap-2">
                      <span className="text-orange flex-shrink-0">▸</span>
                      <span><strong className="text-white">{t}.</strong> <span className="text-white/55">{d}</span></span>
                    </li>
                  ))}
                </ul>

                <Sub>Tailwind specifics</Sub>
                <ul className="text-[13px] text-white/65 space-y-1.5 mt-2 pl-1 font-body">
                  {[
                    ['Sort your classes', 'WindPress can do it automatically · order: layout → spacing → sizing → typography → color → effects → state'],
                    ['Don\'t fight the scale', 'If a design needs padding: 17px, ask whether p-4 (16px) is fine. Arbitrary values like p-[17px] exist but should be rare'],
                    ['Use @apply sparingly', 'Re-creates the named-class problem Tailwind exists to solve. Reserve for true repeating components — buttons, form inputs'],
                    ['Watch class string length', 'If a single element has 30+ classes, break it into a Reusable Component'],
                    ['space-y-* / divide-y only work with direct children', 'Wrapping with another div breaks it'],
                    ['Forgetting flex or grid on the parent', 'is the #1 reason gap-* "doesn\'t work"'],
                  ].map(([t, d]) => (
                    <li key={t} className="flex gap-2">
                      <span className="text-blue-400 flex-shrink-0">▸</span>
                      <span><strong className="text-white">{t}.</strong> <span className="text-white/55">{d}</span></span>
                    </li>
                  ))}
                </ul>

                <Sub>Oxygen specifics</Sub>
                <ul className="text-[13px] text-white/65 space-y-1.5 mt-2 pl-1 font-body">
                  {[
                    ['Don\'t put utilities in the native "Selectors / Classes" field', 'Use the WindPress "Plain Classes" input — Oxygen treats Selectors as named classes that get redundant CSS dumped into your output'],
                    ['Disable Oxygen\'s default body font', 'In Manage → Global Styles, if you want Tailwind\'s font-sans to actually be your font'],
                    ['Backups before plugin updates', 'Major Oxygen updates (5 → 6, etc.) are heavy lifts. Test on staging first'],
                    ['Component parameters are nullable', 'Always provide sensible defaults so an empty parameter doesn\'t break the layout'],
                    ['Inner Content is required in the Main Template', 'If your pages render blank, that\'s almost always why'],
                  ].map(([t, d]) => (
                    <li key={t} className="flex gap-2">
                      <span className="text-purple-400 flex-shrink-0">▸</span>
                      <span><strong className="text-white">{t}.</strong> <span className="text-white/55">{d}</span></span>
                    </li>
                  ))}
                </ul>

                <Sub>Performance</Sub>
                <ul className="text-[13px] text-white/65 space-y-1.5 mt-2 pl-1 font-body">
                  <li className="flex gap-2"><span className="text-orange flex-shrink-0">▸</span><span>Run <strong className="text-white">Manage → CSS Cache → Regenerate</strong> after large changes.</span></li>
                  <li className="flex gap-2"><span className="text-orange flex-shrink-0">▸</span><span>WindPress JIT only ships the utilities you've used — but if a class is generated dynamically (in PHP, etc.) you may need to add it to the <strong>safelist</strong>.</span></li>
                  <li className="flex gap-2"><span className="text-orange flex-shrink-0">▸</span><span>Don't include <InlineCode>@tailwindcss/typography</InlineCode> and <InlineCode>@tailwindcss/forms</InlineCode> if you aren't using them — they each add CSS weight.</span></li>
                  <li className="flex gap-2"><span className="text-orange flex-shrink-0">▸</span><span>For images, prefer Oxygen's Image element + WordPress media library (responsive <InlineCode>srcset</InlineCode> automatically) over hand-rolled <InlineCode>&lt;img&gt;</InlineCode> tags.</span></li>
                </ul>

                <Sub>Debugging</Sub>
                <ul className="text-[13px] text-white/65 space-y-1.5 mt-2 pl-1 font-body">
                  <li className="flex gap-2"><span className="text-red-400 flex-shrink-0">▸</span><span><strong className="text-white">Class isn't applying?</strong> Inspect the element. If the class is in the rendered <InlineCode>class=&quot;&quot;</InlineCode> but no style → wasn't generated (typo or not in safelist). If not in the class string → never made it onto the element.</span></li>
                  <li className="flex gap-2"><span className="text-red-400 flex-shrink-0">▸</span><span><strong className="text-white">Changes don't show on front-end?</strong> Clear Oxygen's CSS cache, clear your page cache, hard-refresh (<InlineCode>Cmd/Ctrl + Shift + R</InlineCode>).</span></li>
                  <li className="flex gap-2"><span className="text-red-400 flex-shrink-0">▸</span><span><strong className="text-white">Editor itself looks broken?</strong> Deactivate WindPress temporarily — utility plugins occasionally conflict with editor styles after major Oxygen updates.</span></li>
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
                    <Pill color="blue">Tailwind</Pill>{' '}
                    <a href="https://tailwindcss.com/docs" target="_blank" rel="noreferrer noopener" className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline">
                      tailwindcss.com/docs
                    </a>
                  </li>
                  <li>
                    <Pill color="purple">WindPress</Pill>{' '}
                    <a href="https://wind.press/" target="_blank" rel="noreferrer noopener" className="text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline">
                      wind.press
                    </a>
                  </li>
                </ul>
              </Card>
            </div>

            {/* Footer */}
            <footer className="mt-14 pt-5 border-t border-navy-border flex justify-between font-mono text-[10px] text-white/40">
              <span>enrollment resources — internal tooling</span>
              <span>oxygen 6 &nbsp;·&nbsp; tailwind v3/v4 &nbsp;·&nbsp; windpress</span>
            </footer>

          </div>
        </div>
      </div>
    </div>
  )
}
