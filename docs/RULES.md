# deslop rules

48 rules: 5 `fail` (block "done" until fixed) and 43 `warn` (fix, or justify
in one line against the project's design system). Each entry says why the
pattern reads as AI-generated and how to fix it.

The **2026 defaults pack** (8 rules) hunts the new default look — cream +
serif + sage, un-themed shadcn tokens, hero badge pills, hover:scale-105 —
and is deliberately combo-first: single signals are design choices, pairs
are templates.

The last section is the **RTL pack**: 9 rules for Urdu/Arabic
(right-to-left) UI that the Western anti-slop canon cannot see, because it
assumes every page is LTR and Latin-script. They activate automatically on
files that contain Arabic-script text, `lang="ur"`/`lang="ar"`, `dir="rtl"`
or `direction: rtl` — and stay silent everywhere else.

## Fail rules

### `inter-only-font`
**What:** a `font-family` (or `--font-*` variable) stack whose only named
typeface is Inter.
**Why it reads as slop:** Inter is a fine font that became the factory
default of generated UI. When every product uses it, none of them has a
voice.
**Fix:** choose a typeface with a point of view and pair it deliberately —
a serif display with a neutral text face, a grotesque with real character,
anything *chosen*.

### `purple-blue-gradient`
**What:** a CSS `linear-gradient(...)` mixing a violet-family colour
(purple/violet/indigo/fuchsia or their hexes) with a blue-family one.
**Why it reads as slop:** it is the universal "tech startup hero" gradient
of generated landing pages — decoration that signals nothing about the
product.
**Fix:** a solid brand colour, a same-hue tint ramp, a duotone treatment of
real photography.

### `tailwind-purple-gradient`
**What:** `bg-gradient-to-*` / `bg-linear-to-*` combined with
`from-`/`via-` in violet, indigo, purple or fuchsia.
**Why it reads as slop:** the Tailwind spelling of the same default hero.
**Fix:** as above — colour from the brand, not from the class palette's
most-reached-for corner.

### `lorem-ipsum`
**What:** "Lorem ipsum" anywhere in a UI file.
**Why it reads as slop:** placeholder copy that escaped into production is
the clearest possible sign nobody reviewed the page.
**Fix:** write the real copy; if copy is genuinely pending, flag the block
visibly in the handoff instead of shipping filler.

## Warn rules — colour & surface

### `gradient-text`
**What:** `background-clip: text` / `bg-clip-text` over a gradient.
**Why:** rainbow headline fill is a signature generated-landing-page move.
**Fix:** one strong colour; emphasis from weight and size.

### `gradient-blob`
**What:** a blurred (`blur-3xl`) violet/fuchsia/purple/indigo element used
as background decoration.
**Why:** pure decoration carrying zero information — the "aurora" backdrop
of a thousand AI heroes.
**Fix:** whitespace, a grid, or real imagery.

### `gradient-border`
**What:** a gradient used as `border-image`.
**Why:** decoration standing in for hierarchy.
**Fix:** a plain 1px border in a considered colour.

### `flat-gray-backgrounds`
**What:** 3+ uses of `bg-gray/slate/zinc/neutral-50/100` in one file.
**Why:** default light-gray surfaces mean no neutral palette was ever
chosen.
**Fix:** pick a warm or cool neutral ramp on purpose, from the brand.

### `no-design-tokens`
**What:** 8+ different hard-coded hex colours in one file.
**Why:** a palette is a decision made once; scattered hexes are decisions
made never.
**Fix:** define colour tokens (CSS variables or a theme) and reference them.

### `default-blue-buttons`
**What:** `bg-blue-500/600/700` used 3+ times in one file.
**Why:** framework blue is the un-themed placeholder primary colour.
**Fix:** define the primary colour from the brand and use it consistently.

## Warn rules — shape & depth

### `giant-border-radius`
**What:** a border radius of 24px or more (`border-radius`, `rounded-3xl`,
or a large arbitrary value).
**Why:** when every card is pillowy, the interface looks inflated.
**Fix:** a small radius scale (4/8/12px); full rounding only for pills and
avatars.

### `rounded-full-misuse`
**What:** `rounded-full` on a full-width or large (≥ `w-24`/`h-24`)
non-avatar element.
**Why:** circles are for avatars, dots and pills — not hero media and cards.
**Fix:** use the radius scale for media and cards.

### `giant-shadow`
**What:** `shadow-2xl`, or a `box-shadow` whose blur is 40px or more.
**Why:** giant soft shadows make everything float in the same fog.
**Fix:** one light source, a small elevation scale; most cards need a 1px
border, not a cloud.

### `shadow-on-everything`
**What:** 5+ large shadows (`shadow-lg/xl/2xl`) in one file.
**Why:** if everything is elevated, nothing is.
**Fix:** borders for structure; shadow for the one thing that truly floats.

### `glassmorphism`
**What:** `backdrop-filter: blur(...)` or `backdrop-blur` classes.
**Why:** frosted-glass panels were a 2021 trend that generation models
never let go of.
**Fix:** opaque surfaces with a real border/shadow hierarchy; blur only for
genuine overlays.

## Warn rules — copy & content

### `ai-copy-words`
**What:** AI-marketing vocabulary in UI strings: *supercharge, elevate
your, seamless(ly), cutting-edge, unlock the power, delve, revolutionize,
game-changer, next-level, harness the power, empower your, streamline your,
effortlessly, in today's fast-paced, take your … to the next level, powered
by AI, world-class solution, robust solution.*
**Why:** these phrases are the statistical centre of marketing copy; they
say nothing about the specific product.
**Fix:** the concrete verb and the number — "Exports a CSV in one click".

### `welcome-hero`
**What:** a heading that starts "Welcome to …".
**Why:** a greeting is not a headline; it wastes the most valuable line on
the page.
**Fix:** lead with what the visitor gets or does here.

### `generic-cta`
**What:** buttons labelled "Get Started", "Learn More" or "Click here".
**Why:** the label could sit on any product ever made.
**Fix:** name the action and payoff — "Download the report", "Start the
free trial".

### `generic-social-proof`
**What:** round-number claims like "Trusted by 10,000+ happy customers".
**Why:** invented-feeling round numbers are a generated-copy fingerprint.
**Fix:** a real, checkable number with named people — or drop the claim.

### `generic-alt-text`
**What:** `alt` text that is just "image", "img", "picture", "placeholder",
"photo" or "icon".
**Why:** it describes nothing to the people alt text exists for.
**Fix:** describe what the image shows, or `alt=""` for decoration.

### `emoji-in-ui`
**What:** emoji characters in UI markup or strings (✓/✔ are reported by
`checkmark-lists` instead).
**Why:** emoji render differently on every platform and substitute for an
icon system.
**Fix:** a real icon set, or none.

### `checkmark-lists`
**What:** ✓ / ✔ glyphs used as list bullets.
**Why:** the raw checkmark is the pricing-page tell of generated UI.
**Fix:** a designed list marker, or restructure the list.

### `em-dash-overuse`
**What:** 4+ em-dashes (—) in one UI file.
**Why:** one em-dash is style; a page full of them is a fingerprint.
**Fix:** vary punctuation — full stops, colons, commas.

### `eyebrow-label`
**What:** a Tailwind element combining `uppercase` with
`tracking-widest` (or ≥ 0.2em tracking).
**Why:** the tiny shouty label above every heading is a section-header
formula, not a design.
**Fix:** strengthen the heading; drop the label.

## Warn rules — layout & code hygiene

### `text-center-everywhere`
**What:** 5+ centred blocks (`text-center` / `text-align: center`) in one
file.
**Why:** generated layouts centre everything because they cannot commit to
a grid.
**Fix:** left-align content; centre only short hero statements.

### `div-soup`
**What:** 20+ `<div>` elements and no semantic landmarks at all
(header/main/section/nav/footer/article) in a markup file.
**Why:** landmark-free markup is harder for screen readers, SEO and humans
reading the code.
**Fix:** use the landmark elements.

### `animation-overuse`
**What:** `animate-bounce` / `animate-pulse` used 3+ times in one file.
**Why:** motion as decoration, not feedback — everything jiggles, nothing
communicates.
**Fix:** animate state changes and loading only.

### `transition-all`
**What:** `transition: all` or the `transition-all` class.
**Why:** the lazy default that animates properties never meant to move.
**Fix:** list the properties that actually change.

### `z-index-arms-race`
**What:** a `z-index` of 100 or more.
**Why:** stacking by escalation means there is no scale.
**Fix:** a small documented scale (1/10/20/30) and stick to it.

### `important-overuse`
**What:** 3+ uses of `!important` in one file.
**Why:** specificity by force is cascade debt.
**Fix:** fix the order or the selector.

### `focus-outline-removed`
**What:** `outline: none` / `outline: 0` / `outline-none` with no visible
replacement.
**Why:** keyboard users lose their place — a real harm hiding inside a
"clean look" preference.
**Fix:** style `:focus-visible` with a visible ring.

## 2026 defaults pack — the new default look

The loud early tells (purple gradient, Inter) were replaced by a quieter
kit, and the data moved with it: in a 3.2M-post study the loudest current
tells are the un-themed shadcn/Tailwind default kit, then AI purple, then
the cream + serif + sage combo. These 8 rules are all `warn`, and they are
combo-first by design — a cream background alone is a paper choice, a
serif alone is a type choice, and a scanner that convicts single signals
drowns in false positives. Pairs are templates.

### `cream-serif-default`
**What:** a cream / warm-white background (the `#faf6ef` family, named
cream/ivory/parchment tones, or `bg-amber-50`-style warm whites) actually
painted on the page, together with a serif display face (Instrument
Serif, Fraunces, Playfair Display, Cormorant, EB Garamond) in a font
stack or loaded from Google Fonts. Cream is only counted in background
declarations, inline styles and `bg-[#…]` classes — never in
custom-property definitions, because a palette token is a decision.
**Why:** this pairing is the 2026 AI default look — the combo that
quietly replaced the purple gradient.
**Fix:** break the combo decisively: keep the cream and set display type
in a grotesque with character, or keep the serif and give the page a real
colour story.

### `sage-green-accent`
**What:** a muted sage/olive green accent (green-dominant, greyed, mid
lightness — `#a3b18a`, `#588157`, `#5b7553`) appearing alongside a cream
background or serif display type. Vivid greens and dark grounds are
deliberately outside the family.
**Why:** sage is the third member of the 2026 default trio; on its own it
says nothing, next to cream or a display serif it completes the uniform.
**Fix:** take the accent from the brand or the subject — muted green over
cream is the template's signature.

### `replacement-default-font`
**What:** Space Grotesk, Geist or Instrument Serif as the first (main /
display) font of a stack.
**Why:** swapping Inter for one of these became so universal that the
swap itself is now the tell.
**Fix:** choose a face for what it says about the brand, not because it
is the current default alternative. (Inter itself is covered by
`inter-only-font`; this rule does not duplicate it.)

### `shadcn-fingerprint`
**What:** evidence of an un-themed shadcn/ui default kit, firing once
per file: 3 or more stock CSS variables at their default values
(`--background: 0 0% 100%`, `--foreground: 240 10% 3.9%`,
`--primary: 240 5.9% 10%`, `--radius: 0.5rem`, …), or the stock
zinc/slate palette as shipped hexes (4+ shades including the
foreground/primary anchor pair). When the CLI scans a project
directory, a `components.json` with a stock `baseColor` (slate, zinc,
neutral, gray, stone) adds the same finding.
**Why:** the un-themed kit is the single most common AI-default tell in
the data — the demo look, shipped.
**Fix:** theme the tokens (background, foreground, primary, radius) to
the brand's own values. shadcn is a starting point, not a theme.

### `hero-badge-pill`
**What:** a small pill/badge element (a `badge`/`pill`/`chip` class, or
a `rounded-full` element with short text) sitting above the first `<h1>`
— "✨ Introducing…", "New", "AI-powered". (No earlier rule covered this;
the eyebrow rule catches uppercase tracking labels, a different device.)
**Why:** it is decoration dressed as news — the template's favourite hat.
**Fix:** put real news in the headline or a dated changelog; let the
headline stand on its own.

### `left-border-accent-card`
**What:** two or more elements with a thick coloured left border
(`border-left` of 3px+ solid, `border-l-4`/`border-l-8`,
`border-l-[3px+]`). One bordered quote is a style; two or more is a
system. Does not fire in RTL files — there the accent-edge story
belongs to the RTL pack.
**Why:** the coloured-edge card is the new default card treatment.
**Fix:** a full hairline border, a top rule or a background tint — one
device per page.

### `hover-scale-boilerplate`
**What:** `hover:scale-105` / `hover:scale-110` (or the arbitrary-value
spellings) sprinkled on cards and buttons.
**Why:** a uniform 5% swell on everything is the template's reflex, not
a designed response.
**Fix:** give hover something to say — a colour shift, an underline, an
arrow that moves.

### `numbered-steps-row`
**What:** the "01 / 02 / 03" numbered-steps row (or "Step 1/2/3", or a
row of 3+ big-number stats) — but only when the same file already
carries other generic landing-page findings (`generic-cta`,
`ai-copy-words`, `eyebrow-label`, `generic-social-proof`,
`inter-only-font`). Swiss grids and workshop catalogues number things
honestly; the row is only a tell when it arrives with the rest of the
template.
**Why:** the row usually exists because the template had a slot for it.
**Fix:** real steps in real order, or true numbers — or cut the row.

## RTL pack — Urdu & Arabic (right-to-left)

Every other rule in this document was written by and for the LTR web. But
agents generate Urdu and Arabic pages with LTR habits baked in, and no
Western scanner flags any of it — the page just ships broken for the
people it was made for. These 9 rules close that blind spot.
`rtl-missing-dir` is a `fail`; the rest are `warn`.

### `rtl-missing-dir` (fail)
**What:** markup containing Arabic-script text or `lang="ur"`/`lang="ar"`,
with no `dir="rtl"` attribute and no `direction: rtl` anywhere.
**Why it reads as slop:** the generator wrote the words but never flipped
the page. Text order, alignment and layout all run left-to-right, so the
page is not merely unstylish — it is assembled backwards.
**Fix:** `dir="rtl"` on the `<html>` element (or on the container of the
RTL content).

### `rtl-font-missing`
**What:** Arabic-script text in a file that declares no `font-family`
at all.
**Why:** the text falls back to whatever the platform default happens to
be — and default fallbacks render Urdu's joined, stacked letterforms
especially badly.
**Fix:** declare a font with real Arabic support: Noto Nastaliq Urdu for
Urdu, Noto Naskh Arabic for Arabic.

### `rtl-latin-display-font`
**What:** a Latin-only display face (Inter, Poppins, Montserrat, Space
Grotesk, Playfair Display…) in a font stack, in a file containing
Arabic-script text, with no Arabic-capable font in the same stack.
**Why:** the Latin words get the chosen display face; the Urdu/Arabic
words silently fall back to a mismatched system font. Two typefaces, two
voices, neither chosen for the script that matters most on the page.
**Fix:** pair the Latin face with an Arabic-capable one in the same stack
(`'Poppins', 'Noto Nastaliq Urdu', sans-serif`), or style the Arabic
content in its own font.

### `urdu-naskh-for-nastaleeq`
**What:** Urdu content (from `lang="ur"` or Urdu-specific letters like
ٹ ڈ ڑ ھ ے) styled with a Naskh face (Noto Naskh Arabic, Amiri,
Scheherazade…) and no Nastaliq face anywhere in the file.
**Why:** Naskh is correct for Arabic, but Urdu readers expect the
sloping, stacked Nastaliq for display text — an Urdu page in pure Naskh
reads as Arabic wearing Urdu words.
**Fix:** add a Nastaliq face (Noto Nastaliq Urdu, Gulzar, Mehr Nastaliq)
for headings/display; Naskh can stay for dense body text if line height
is a concern.

### `rtl-text-align-left`
**What:** `text-align: left` (or Tailwind `text-left`) in a file with
Arabic-script / RTL-language content.
**Why:** body text gets pinned to the left edge — the wrong edge. It is
the single most visible "the generator forgot this page is RTL" tell.
**Fix:** `text-align: start` (or `text-start`), which follows the writing
direction. Reserve explicit `left` for genuine LTR islands like code
blocks.

### `rtl-physical-properties`
**What:** 2+ physical left/right properties in an RTL file —
`margin-left/right`, `padding-left/right`, `border-left/right`,
`inset-left/right`, `left:`/`right:` positioning, or the Tailwind
equivalents (`ml-*`, `pr-*`, `border-l`, `left-4`…). Reported once per
file, with the count.
**Why:** physical properties do not flip when direction flips, so the
layout quietly mirrors wrong: the "start" card keeps the margin meant
for the end.
**Fix:** logical properties — `margin-inline-start/end`,
`padding-inline`, `inset-inline`, `border-inline-start` — which follow
the writing direction automatically.

### `rtl-gradient-direction`
**What:** a gradient with a hard-coded physical direction —
`linear-gradient(to right, …)`, `to left`, or Tailwind
`bg-gradient-to-r/l` — in an RTL file.
**Why:** the highlight runs backwards against the reading direction: the
eye is pulled toward where the text has already been.
**Fix:** logical endpoints (`to inline-end` / `to inline-start`), or a
vertical or symmetric gradient with no reading direction.

### `rtl-icon-direction`
**What:** directional cues — `fa-arrow-right`-style icon classes, Material
icon names like `chevron_right`, or `translate-x-*` motion — in an RTL
file, with no mirroring anywhere (no `rtl:` variant, no `[dir="rtl"]`
flip rule, no `scaleX(-1)`).
**Why:** "next" arrows and chevrons keep pointing left-to-right, so the
interface's body language contradicts its text: forward points backwards.
**Fix:** mirror directional icons under RTL (a `scaleX(-1)` flip scoped
to `[dir="rtl"]`, or Tailwind's `rtl:-scale-x-100`). Media controls,
logos and clocks stay unflipped — they are not directional.

### `rtl-latin-digits-dates`
**What:** a hard-coded Latin-format date — `11/02/2026`,
`November 2, 2026` — written into a line of Arabic-script copy in markup.
**Why:** the format (and often Western digits) is baked into a sentence
whose reader writes dates the other way round; it is the RTL cousin of
shipping lorem ipsum — a placeholder habit left in production copy.
**Fix:** format dates at runtime with `Intl.DateTimeFormat('ur')` /
`('ar')` so order, month names and digits localise.
