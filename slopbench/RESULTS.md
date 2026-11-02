# SlopBench — results

Generated 2026-11-02 by `node slopbench/run.js` — do not edit by hand; re-run the harness instead.

## Headline

- Detector under test: **deslop** (the rule engine in `bin/deslop.js`), scored with the same formula as the web checker and the audit report: `min(100, fails × 12 + warns × 4)`.
- Dataset: **30 pages** — 15 labelled AI-built, 15 labelled human-designed (see `labels.json` for provenance per page).
- Mean Slop Score: **AI 36** vs **human 2.9** (medians: AI 28, human 0).
- Best separating threshold on this dataset: **8** (a page scoring >= 8 is predicted AI-built).
- Accuracy at that threshold: **83.3%** — 13 true positives, 12 true negatives, 3 false positive(s), 2 false negative(s).

## Method

1. Every page in `slopbench/pages/` is a single self-contained HTML file (inline CSS, no build step). `labels.json` is the ground truth and the contract: file, label, provenance (`fixture`, `archetype` or `authored`), and a note on the idiom the page represents.
2. The harness scans each page once with `scanContent()` from `bin/deslop.js` and applies the Slop Score formula above. No page is rescanned, tuned or excluded after its score is known.
3. The threshold is chosen by trying every value 0–101 and keeping the one with the highest accuracy; ties break toward the midpoint of the two class means, then the lowest threshold. It is fitted to these 30 pages and **will** move as the dataset grows — treat it as indicative, not as a constant of the tool.

## Per-page scores

| Page | Label | Score | Fail | Warn | Top rules |
|---|---|---:|---:|---:|---|
| ai-01-sloppy-fixture.html | ai | 100 | 5 | 34 | checkmark-lists ×3, generic-cta ×3, emoji-in-ui ×2 |
| ai-13-lovable-gradient-saas.html | ai | 100 | 2 | 48 | emoji-in-ui ×12, ai-copy-words ×11, giant-border-radius ×6 |
| ai-14-bolt-dark-dashboard.html | ai | 84 | 2 | 15 | ai-copy-words ×3, eyebrow-label ×2, generic-cta ×2 |
| ai-15-v0-minimal-default.html | ai | 64 | 1 | 13 | generic-cta ×5, emoji-in-ui ×4, giant-border-radius |
| ai-02-rtl-sloppy.html | ai | 40 | 1 | 7 | rtl-gradient-direction, rtl-icon-direction, rtl-latin-digits-dates |
| ai-03-saas-tailwind.html | ai | 36 | 1 | 6 | ai-copy-words ×2, generic-cta, generic-social-proof |
| ai-12-twins-demo-clone.html | ai | 32 | 1 | 5 | ai-copy-words, generic-cta, generic-social-proof |
| ai-04-shadcn-dashboard.html | ai | 28 | 1 | 4 | generic-cta, giant-border-radius, hero-badge-pill |
| ai-06-course-landing.html | ai | 16 | 1 | 1 | inter-only-font, shadcn-fingerprint |
| ai-07-coming-soon.html | ai | 12 | 0 | 3 | giant-border-radius ×2, shadcn-fingerprint |
| human-04-retro-90s.html | human | 12 | 0 | 3 | em-dash-overuse, no-design-tokens, welcome-hero |
| ai-05-cream-serif-agency.html | ai | 8 | 0 | 2 | cream-serif-default, sage-green-accent |
| ai-08-link-in-bio.html | ai | 8 | 0 | 2 | giant-border-radius ×2 |
| ai-09-ecommerce-product.html | ai | 8 | 0 | 2 | emoji-in-ui ×2 |
| human-11-art-deco.html | human | 8 | 0 | 2 | em-dash-overuse, emoji-in-ui |
| human-14-punk-flyer.html | human | 8 | 0 | 2 | em-dash-overuse, emoji-in-ui |
| ai-10-docs-site.html | ai | 4 | 0 | 1 | shadcn-fingerprint |
| human-02-brutalist-studio.html | human | 4 | 0 | 1 | emoji-in-ui |
| human-03-editorial-newspaper.html | human | 4 | 0 | 1 | em-dash-overuse |
| human-05-swiss-typographic.html | human | 4 | 0 | 1 | em-dash-overuse |
| human-08-memphis-postmodern.html | human | 4 | 0 | 1 | emoji-in-ui |
| ai-11-portfolio-minimal.html | ai | 0 | 0 | 0 | — |
| human-01-blog-magazine.html | human | 0 | 0 | 0 | — |
| human-06-dark-academia.html | human | 0 | 0 | 0 | — |
| human-07-japanese-minimal.html | human | 0 | 0 | 0 | — |
| human-09-zine-handmade.html | human | 0 | 0 | 0 | — |
| human-10-terminal-hacker.html | human | 0 | 0 | 0 | — |
| human-12-scandi-workshop.html | human | 0 | 0 | 0 | — |
| human-13-blueprint-technical.html | human | 0 | 0 | 0 | — |
| human-15-museum-exhibit.html | human | 0 | 0 | 0 | — |

## False positives — human pages deslop calls AI-built

Honesty is the product, so they are named, with the rules that fired:

- **human-04-retro-90s.html** — score 12 (0 fail, 3 warn). Fired: em-dash-overuse, no-design-tokens, welcome-hero. Label note: Authored for SlopBench: a 1997 personal homepage — table layout, navy sidebar, rainbow cell divider, visitor counter, webring, Comic Sans headline. Human, hand-coded, and proud of it.
- **human-11-art-deco.html** — score 8 (0 fail, 2 warn). Fired: em-dash-overuse, emoji-in-ui. Label note: Authored for SlopBench: a 1932 Miami hotel page — Cinzel capitals, gold on deep teal, a tariff table with letterspaced rules ('weekly residence: by letter').
- **human-14-punk-flyer.html** — score 8 (0 fail, 2 warn). Fired: em-dash-overuse, emoji-in-ui. Label note: Authored for SlopBench: a gig flyer — huge rotated Archivo Black, safety orange, ransom-note price stickers, star ornament, small print about the neighbours.

## False negatives — AI-idiom pages deslop lets through

- **ai-10-docs-site.html** — score 4 (0 fail, 1 warn). Label note: Twins corpus archetype: default documentation site — system-ui stack, slate sidebar, blue links, code blocks. The Mintlify/Docusaurus-default idiom that AI tools reproduce constantly.
- **ai-11-portfolio-minimal.html** — score 0 (0 fail, 0 warn). Label note: Twins corpus archetype: minimal black-and-white portfolio — Helvetica, hairline type, image grid. The v0/portfolio-template default genre: restrained, but a default.

## The dataset

| Page | Label | Source | Idiom |
|---|---|---|---|
| ai-01-sloppy-fixture.html | ai | fixture | The repo's kitchen-sink slop fixture (copied from fixtures/sloppy.html): Inter-only, purple-to-blue gradient hero, glass card, lorem ipsum, checkmark list, emoji. Deliberately maximal. |
| ai-02-rtl-sloppy.html | ai | fixture | Urdu page generated with LTR habits (copied from fixtures/rtl-sloppy.html): no dir=rtl, Latin display font on Arabic script, physical left/right properties, Latin-format dates in Arabic copy. |
| ai-03-saas-tailwind.html | ai | archetype | Twins corpus archetype: generic SaaS landing in the Tailwind default look — Inter, indigo-to-violet gradient hero, 'Supercharge your workflow, seamlessly', 'Trusted by 10,000+ happy customers'. |
| ai-04-shadcn-dashboard.html | ai | archetype | Twins corpus archetype: shadcn/ui default landing — Inter, zinc palette, pill badge, bordered cards, black primary button. The restrained end of the AI-default spectrum. |
| ai-05-cream-serif-agency.html | ai | archetype | Twins corpus archetype: the 2026 replacement default — cream background, Fraunces serif display, sage green accent, tasteful agency copy. Included because 'AI look' moved here; the hardest AI page in the set. |
| ai-06-course-landing.html | ai | archetype | Twins corpus archetype: online-course landing on Inter alone, with the standard logos-testimonials-pricing-FAQ skeleton. Inter is its only real tell. |
| ai-07-coming-soon.html | ai | archetype | Twins corpus archetype: dark waitlist/coming-soon page, Sora font, everything centred, pill input and pill button. A stock AI-builder one-pager genre. |
| ai-08-link-in-bio.html | ai | archetype | Twins corpus archetype: link-in-bio template page — Poppins, centred column, full-pill white buttons on a bright gradient-free sky background. |
| ai-09-ecommerce-product.html | ai | archetype | Twins corpus archetype: template product page — DM Sans, warm amber palette, spec cards, five-star review snippets, FAQ details. Written in the product-page template idiom. |
| ai-10-docs-site.html | ai | archetype | Twins corpus archetype: default documentation site — system-ui stack, slate sidebar, blue links, code blocks. The Mintlify/Docusaurus-default idiom that AI tools reproduce constantly. |
| ai-11-portfolio-minimal.html | ai | archetype | Twins corpus archetype: minimal black-and-white portfolio — Helvetica, hairline type, image grid. The v0/portfolio-template default genre: restrained, but a default. |
| ai-12-twins-demo-clone.html | ai | archetype | The Visual Twins demo clone (copied from examples/twins-demo-clone.html): a SaaS landing written deliberately as a twin of the generic SaaS archetype — same skeleton, palette and fonts. |
| ai-13-lovable-gradient-saas.html | ai | authored | Authored for SlopBench in the Lovable house style: violet-pink-blue gradient hero, gradient text, glassmorphic chips, emoji feature icons, gradient primary buttons, checkmark pricing, AI-marketing copy throughout. |
| ai-14-bolt-dark-dashboard.html | ai | authored | Authored for SlopBench in the Bolt dark-dashboard style: slate-950 background, grid-line backdrop, indigo accent, gradient headline text, glass stat cards, uppercase tracking-widest eyebrows, checkmark trust row. |
| ai-15-v0-minimal-default.html | ai | authored | Authored for SlopBench in the v0 minimal-default style: Inter, zinc borders, small radius, pill badge, muted grey copy, three-tier pricing. Deliberately the quietest AI page — near the detection floor. |
| human-01-blog-magazine.html | human | archetype | Twins corpus archetype filed here for its idiom, not its origin: an editorial magazine with a Playfair Display / Source Serif pairing, a double-rule masthead, a red accent and specific essay copy. Represents human editorial design. |
| human-02-brutalist-studio.html | human | authored | Authored for SlopBench: brutalist studio page — 4px black borders, hard offset shadows, yellow ground, a table of clients with honest prices, anti-template manifesto strip. |
| human-03-editorial-newspaper.html | human | authored | Authored for SlopBench: a local-newspaper front page — three justified columns with a drop cap, small-caps byline, double rules, and a specific council-meeting story (the goat is in the minutes). |
| human-04-retro-90s.html | human | authored | Authored for SlopBench: a 1997 personal homepage — table layout, navy sidebar, rainbow cell divider, visitor counter, webring, Comic Sans headline. Human, hand-coded, and proud of it. |
| human-05-swiss-typographic.html | human | authored | Authored for SlopBench: Swiss/International typographic style — Helvetica, one red, a strict numbered grid, no decoration at all. (Copy in German; deslop's rules are language-agnostic.) |
| human-06-dark-academia.html | human | authored | Authored for SlopBench: a rare-book dealer's catalogue — deep green ground, Cormorant/EB Garamond pairing, gold rules, shelfmarks and roman numerals, specific books with prices in pounds. |
| human-07-japanese-minimal.html | human | authored | Authored for SlopBench: a Kyoto tea house — Shippori Mincho, vertical text, vast negative space, seasonal menu, reservations by reply postcard only. (Copy in Japanese.) |
| human-08-memphis-postmodern.html | human | authored | Authored for SlopBench: Memphis-group postmodern studio page — clashing pastel/neon palette, rotated color blocks, squiggle strip, a four-point anti-grid manifesto. |
| human-09-zine-handmade.html | human | authored | Authored for SlopBench: a photocopied gig zine — typewriter and marker typefaces, taped labels, rotated sticker, two-column gig reviews with specific Bradford venues. |
| human-10-terminal-hacker.html | human | authored | Authored for SlopBench: a tilde-community personal page styled as a shell session — monospace only, ASCII banner, finger output, hand-written single-file HTML as a stated point of pride. |
| human-11-art-deco.html | human | authored | Authored for SlopBench: a 1932 Miami hotel page — Cinzel capitals, gold on deep teal, a tariff table with letterspaced rules ('weekly residence: by letter'). |
| human-12-scandi-workshop.html | human | authored | Authored for SlopBench: a Bergen furniture workshop — Spectral serif, numbered pieces with kroner prices, oak-peg joinery details, an honest note about the workshop dog. |
| human-13-blueprint-technical.html | human | authored | Authored for SlopBench: a bicycle frame geometry drawing as a web page — white line-work on blueprint blue, dimension tables, revision block, tolerances written like a person who has been burned before. |
| human-14-punk-flyer.html | human | authored | Authored for SlopBench: a gig flyer — huge rotated Archivo Black, safety orange, ransom-note price stickers, star ornament, small print about the neighbours. |
| human-15-museum-exhibit.html | human | authored | Authored for SlopBench: museum wall labels for a navigation-instruments gallery — Marcellus and Spectral, object numbers, medium lines, provenance, and one notebook shown open at the drawing of the cat. |

## Caveats — read these before quoting any number

- **Authored dataset.** Every page was written or selected by the deslop maintainer (`fixture`/`archetype` pages are copied verbatim from this repo's own test material; `authored` pages were written for this benchmark). No page is a capture of a real production site. Labels record the *design idiom a page represents*, assigned by the author — exactly the kind of circularity a public benchmark exists to outgrow. Week 1 is a starting line, not a verdict.
- **Small n.** 30 pages. A single page moving across the threshold swings accuracy by ~3 points. Do not compare detectors on this set to one decimal place.
- **Single-file pages.** Inline CSS only: no external stylesheets, no JS frameworks, no Tailwind CDN. Detectors that lean on rendered output or on class names from a framework build will see less here than on a real site.
- **The score measures template tells, not authorship.** A human can ship every tell in the book; an AI can be art-directed past all of them. SlopBench grades detectors of the *default look*, which is the claim deslop actually makes.
- **Threshold is indicative.** It is fitted to this dataset (see Method). Report it alongside n and the dataset version whenever you cite it.

## Run another detector on SlopBench

The folder is detector-agnostic. `labels.json` is the only contract:

1. Read `labels.json`; for each entry, the page to test is `slopbench/pages/<file>` and the ground truth is `<label>`. Do not read the notes until after you have scored — they describe the idiom, not the answer key your detector should use.
2. Run your detector over each page file as-is (single HTML file, styles inline). Record one row per page: file, your raw score or verdict, and (if your tool has them) the rules/findings that fired.
3. If your detector emits a numeric score, grade it exactly as above: try every threshold, report the best accuracy **and** your false positives and false negatives by name. If it emits only a verdict, report accuracy at that verdict.
4. Publish your per-page rows alongside your headline number, and state the dataset version (`labels.json` → `version` / `updated`). A benchmark whose failures are visible is worth more than a leaderboard whose are not.

Suggested row format for comparability:

```
file,label,your_score,your_verdict
ai-01-sloppy-fixture.html,ai,,
... (one row per page, all 30)
```
