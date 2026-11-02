# deslop rules

31 rules: 4 `fail` (block "done" until fixed) and 27 `warn` (fix, or justify
in one line against the project's design system). Each entry says why the
pattern reads as AI-generated and how to fix it.

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
