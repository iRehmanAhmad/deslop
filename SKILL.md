---
name: deslop
description: Detect and remove AI design slop from generated UI. Use whenever you create or edit UI code (CSS, HTML, JSX/TSX, Vue, Astro, Svelte) — run the deslop scanner before declaring UI work done, fix or justify every finding, and apply the anti-slop principles when writing new interface code.
---

# deslop — no AI design slop

AI-generated UI has a recognisable house style: Inter on everything, a
purple-to-blue gradient hero, pillowy 32px cards floating on giant soft
shadows, glassmorphism, emoji bullets, and copy that says "Supercharge your
workflow — seamlessly." Users can smell it instantly, and it makes every
product look like the same product. This skill is the checkpoint that stops
it shipping.

## The gate: scan before you say "done"

After creating or editing any UI file, and **before** telling the user the
work is complete, run the scanner over the changed area:

```bash
deslop ./src            # or the folder you touched
deslop ./src --format json
```

(If `deslop` is not installed: `npm install -g @irehmanahmad/deslop`.
Or clone https://github.com/iRehmanAhmad/deslop and run its
`bin/deslop.js` against the project path — same commands, with
`node bin/deslop.js` in place of `deslop`.)

Then:

1. **Fix every `FAIL` finding.** Fails are non-negotiable: Inter as the only
   font, purple-to-blue gradients (CSS or Tailwind), lorem ipsum left in the
   UI. The task is not done while a fail remains.
2. **Fix or justify every `warn` finding.** Fix it by default. A warning may
   stay only with a one-line justification tied to this project's design
   system (e.g. "rounded-full is the product's established pill button"),
   reported to the user with the final summary — never silently ignored.
3. **Report the result.** In your completion message, state the scan result:
   files scanned, fails fixed, warnings fixed or justified. "deslop: 0 fail"
   is the sentence the user wants to read.

## Writing new UI: the anti-slop principles

Do not wait for the scanner. When generating UI from scratch:

- **Typography is the identity.** Pick a typeface with a point of view and a
  deliberate pairing (display + text). Inter/Roboto/system-default as the
  only voice is a placeholder, not a choice.
- **Colour is a decision, not a default.** Build from the brand or the
  content. No purple-blue gradients, no gradient text, no blurred colour
  blobs, no framework-default blue buttons. Solid colours, real photography,
  and whitespace carry a design further than any gradient.
- **Depth has one story.** Either borders structure the page, or shadows do.
  Small radius scale (4/8/12px), small shadows, no glassmorphism, nothing
  pillowy unless it is literally a pill.
- **Copy is specific.** Name the thing and the number: "Exports a CSV in one
  click", not "Supercharge your workflow". No "Welcome to", no "Get
  Started", no "Trusted by 10,000+ happy customers", no emoji as icons, no
  checkmark-glyph feature lists, and ration the em-dashes.
- **Structure is semantic.** header/main/section/nav/footer/article exist —
  use them instead of 40 nested divs. Left-align content; centre only short
  hero statements.
- **Motion means something.** Animate state changes and loading. Nothing
  bounces or pulses for decoration, and never `transition: all`.
- **Accessibility is part of "done".** Never remove a focus outline without
  a visible :focus-visible replacement. Alt text describes the image or is
  empty for decoration — never "image".

## When the user has a design system

A project's own design tokens and documented conventions outrank generic
rules: if the brand genuinely is a violet gradient, the finding gets a
justification, not a redesign. The point of deslop is to catch *unchosen*
defaults — the patterns an agent reaches for when it is not thinking — not
to flatten deliberate design decisions.

The full rule list, with the reasoning and fix for each, lives in
`docs/RULES.md`.
