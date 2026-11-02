/**
 * report-copy.js — GENERATED FILE. Do not edit.
 *
 * Source of truth: web-checker/worker.js (the COPY map — plain-language
 * titles, explanations and fix prompts, written for site owners).
 * Regenerate with:  node web-checker/sync-copy.js
 *
 * bin/deslop-report.js reads its client-facing wording from here so a
 * finding reads identically in the browser checker and in an audit report.
 */
"use strict";

const COPY = {
  "purple-blue-gradient": {
    t: "The purple-to-blue gradient",
    p: "Your site fades from purple to blue — the exact background almost every AI-built site uses. Visitors have seen it a thousand times, and it is the first thing that makes a site look auto-generated.",
    f: "In my website, remove the purple-to-blue gradient background. Use a solid background colour taken from my brand instead, and keep the headline text easy to read on it. Do not use any colour gradient as a background.",
  },
  "tailwind-purple-gradient": {
    t: "The purple gradient look",
    p: "Your site's background is a purple-family gradient — the default look of AI site builders. It is the single most recognised 'made by AI' signal on the web right now.",
    f: "In my website, replace the gradient background (bg-gradient-to-* using violet, indigo, purple or fuchsia) with a solid brand colour. Remove the gradient completely — do not swap it for a different gradient.",
  },
  "inter-only-font": {
    t: "One font for everything — Inter",
    p: "Your whole site is set in Inter, the font AI tools pick by default. It looks clean, but it also looks like everyone else's site, so nothing about your words feels like your brand.",
    f: "In my website, change the heading font to a distinctive display font with real character (for example a serif like Fraunces or Playfair Display, or a bold grotesque). Keep body text readable, and apply the new heading font to all headings and the logo.",
  },
  "lorem-ipsum": {
    t: "Fake placeholder text (Lorem ipsum)",
    p: "Part of your page still shows 'Lorem ipsum' — the dummy text builders use while designing. Real visitors can see it, and it makes the site look unfinished.",
    f: "In my website, find every piece of 'Lorem ipsum' placeholder text and replace it with real text describing my actual product or service. If the exact words are unknown, write a short, honest description of what I offer and who it is for.",
  },
  "rtl-missing-dir": {
    t: "Your Urdu/Arabic page runs the wrong way",
    p: "Your page has Urdu or Arabic text but never tells the browser to run right-to-left, so layout, alignment and punctuation land in the wrong places. To anyone who reads the language, it looks broken.",
    f: "In my website, set the direction for the Urdu/Arabic content: add dir=\"rtl\" to the html element, with lang=\"ur\" or lang=\"ar\" as appropriate, so all text and layout flow right-to-left correctly.",
  },
  "gradient-text": {
    t: "Rainbow headline text",
    p: "Your headline text is filled with a colour gradient. It is a signature move of AI landing pages — decoration where one strong colour and a bolder headline would say more.",
    f: "In my website, change the gradient headline text to one solid, strong colour. Make the headline bigger and bolder instead of filling it with a gradient.",
  },
  "glassmorphism": {
    t: "Frosted-glass panels",
    p: "Some panels use the frosted-glass look — blurry and see-through. It was trendy in AI designs for a while and now reads as a template effect rather than a choice.",
    f: "In my website, replace the frosted-glass (backdrop blur, translucent) panels with solid panels that have a clear border and a subtle shadow. Keep blur only for things that genuinely float above the page, like a pop-up.",
  },
  "giant-border-radius": {
    t: "Very puffy rounded corners",
    p: "Cards and boxes have very big rounded corners. When everything is soft and pillowy, the page looks like a default AI template instead of a designed site.",
    f: "In my website, reduce the corner rounding on cards and boxes to a small, consistent scale (for example 8 or 12 pixels). Keep fully rounded shapes only for round things like avatars and small pill labels.",
  },
  "giant-shadow": {
    t: "Huge, soft shadows",
    p: "Elements float on very large, soft shadows. A little shadow helps things stand out; clouds under everything is the AI-template look.",
    f: "In my website, make the shadows much smaller and tighter, as if one light shines from above. Most cards should use a thin border instead of a big shadow.",
  },
  "emoji-in-ui": {
    t: "Emoji used as icons",
    p: "Emoji are doing the job of icons or decoration. They render differently on every phone and computer, and visitors read them as filler rather than design.",
    f: "In my website, remove emoji used as icons or decoration and use one proper icon set (for example Lucide or Heroicons) in a single consistent style. Keep emoji only inside actual chat-style messages, if there are any.",
  },
  "checkmark-lists": {
    t: "Checkmark bullet lists",
    p: "Your feature list uses raw checkmark characters as bullets — the classic AI pricing-page look. It signals 'template' more than it signals 'included'.",
    f: "In my website, restyle the feature lists: remove the raw checkmark characters and use a designed list marker in my brand colour, or rewrite the list as short sentences with bold lead-ins.",
  },
  "ai-copy-words": {
    t: "AI-sounding marketing words",
    p: "Your text uses phrases like 'Supercharge', 'seamless' or 'cutting-edge' — the filler words AI writers reach for. They promise everything and describe nothing, so visitors stop believing them.",
    f: "In my website, rewrite the marketing copy to say concrete things: replace phrases like 'Supercharge your workflow' and 'seamless experience' with exactly what the product does, with a real detail or number, in the plain words a customer would use.",
  },
  "welcome-hero": {
    t: "'Welcome to…' headline",
    p: "Your main headline starts with 'Welcome to…' — the most generic opening an AI can write. It tells visitors nothing about what they get here.",
    f: "In my website, replace the 'Welcome to…' headline with one that says what the visitor gets or can do here — the main benefit of my product, in one short sentence.",
  },
  "generic-cta": {
    t: "Generic buttons ('Get Started')",
    p: "Buttons labelled 'Get Started' or 'Learn More' could belong to any site on Earth. Specific buttons get more clicks, because people know what happens next.",
    f: "In my website, rename the generic buttons so each one names its action and payoff — for example 'Download the free guide', 'See pricing' or 'Book a demo' — matching what actually happens when it is clicked.",
  },
  "generic-social-proof": {
    t: "'Trusted by 10,000+ customers'",
    p: "Your page claims a big, round number of happy customers. Round, unverifiable numbers are an AI-template staple, and visitors have learned to ignore them.",
    f: "In my website, replace the round-number claim ('Trusted by 10,000+ customers') with a true, specific one — a real count and who they are — or remove the claim until there is a real number to use.",
  },
  "generic-alt-text": {
    t: "Images with placeholder descriptions",
    p: "Some images have descriptions like 'image' or 'placeholder', which describe nothing. Screen readers read them aloud, and search engines learn nothing from them.",
    f: "In my website, rewrite the alt text of every image so it describes what the image actually shows, in a few words. For purely decorative images, use an empty alt (alt=\"\").",
  },
  "eyebrow-label": {
    t: "Tiny shouty labels above headings",
    p: "Sections open with a small, wide-spaced, all-caps label above the real heading. It is the AI section-header formula — when every section has one, the page feels assembled, not written.",
    f: "In my website, remove the small all-caps labels above section headings, and make the headings themselves stronger and more specific instead.",
  },
  "gradient-blob": {
    t: "Blurry colour blobs",
    p: "There are blurred violet blobs floating in the background as decoration. They carry no information and are one of the most recognisable AI-design decorations.",
    f: "In my website, remove the blurred colour blob decorations from the background. Use plain space, a subtle grid, or a real photo instead.",
  },
  "transition-all": {
    t: "'Animate everything' setting",
    p: "Some elements are set to animate every property at once — the lazy default. Things move that were never meant to, and the page feels jittery.",
    f: "In my website, change 'transition: all' so only the properties that actually change are animated (colour, transform, opacity). Nothing else should move.",
  },
  "z-index-arms-race": {
    t: "Sky-high layer numbers",
    p: "Something on the page has a stacking number (z-index) of 100 or more — a sign layers were piled up by escalation rather than planned. It is invisible until the day two pop-ups fight each other.",
    f: "In my website, put the layers on a small planned scale (for example: dropdown 10, sticky header 20, modal 30, toast 40) and change any z-index of 100 or more to fit that scale.",
  },
  "focus-outline-removed": {
    t: "Keyboard focus outline deleted",
    p: "The outline that shows keyboard users where they are has been switched off, with nothing in its place. Anyone navigating your site by keyboard is now lost.",
    f: "In my website, restore a visible keyboard focus style: instead of removing outlines, style :focus-visible with a clear ring in my brand colour, so keyboard users can always see where they are.",
  },
  "rounded-full-misuse": {
    t: "Fully-rounded big shapes",
    p: "A large element that is not a photo or avatar is completely round-ended. Full rounding everywhere is part of the soft AI-template look.",
    f: "In my website, change fully-rounded (rounded-full) styling on large cards and images back to the normal corner radius used by the rest of the site. Keep full rounding only for avatars, dots and small pills.",
  },
  "gradient-border": {
    t: "Gradient borders",
    p: "A box is outlined with a colour gradient. It is decoration doing the job of design — a plain, well-chosen border almost always looks more confident.",
    f: "In my website, replace gradient borders with a plain 1-pixel border in one considered colour from my palette.",
  },
  "em-dash-overuse": {
    t: "Em-dash overload",
    p: "Your copy uses the long dash (—) again and again. One is style; a page full of them is an AI-writing fingerprint that readers increasingly notice.",
    f: "In my website copy, reduce the em-dashes: rewrite most of them as full stops, commas or colons, so the dash appears only occasionally, where it really adds punch.",
  },
  "text-center-everywhere": {
    t: "Everything is centred",
    p: "Lots of blocks are centre-aligned. AI layouts centre everything because they cannot commit to a grid — real editorial design mostly aligns to an edge.",
    f: "In my website, left-align (start-align) the body text and section content. Keep centring only for the short main headline area, if anywhere.",
  },
  "flat-gray-backgrounds": {
    t: "Flat grey backgrounds everywhere",
    p: "Section after section sits on the same flat light grey. There is no colour story, so the whole page feels like a wireframe that shipped.",
    f: "In my website, build the section backgrounds from my brand palette — a warm or cool neutral family chosen on purpose, with one accent colour — instead of default light grey.",
  },
  "animation-overuse": {
    t: "Bouncing and pulsing everywhere",
    p: "Several elements bounce or pulse. Motion should signal something — a loading state, a change. Decorative bouncing just makes the page feel nervous.",
    f: "In my website, remove bounce and pulse animations except where something is genuinely loading or needs attention. One deliberate animation is better than five bouncing badges.",
  },
  "shadow-on-everything": {
    t: "A shadow on everything",
    p: "Almost every box has a big shadow, so nothing stands out — when everything floats, nothing does.",
    f: "In my website, pick one depth style: use borders to structure the page, and reserve shadows for the single most important floating element, like the main call-to-action card.",
  },
  "default-blue-buttons": {
    t: "Default framework-blue buttons",
    p: "Your main buttons use the framework's default blue — the colour a template ships before anyone chooses a brand colour.",
    f: "In my website, change the primary button colour from the default blue to my brand colour, and use it consistently for every main action.",
  },
  "important-overuse": {
    t: "Styles forced with overrides",
    p: "Some styles are being forced with a special override flag (!important). It is a sign the styling was patched rather than planned, and it makes the next change unpredictable.",
    f: "In my website's styles, remove the !important overrides by fixing the underlying style order or selector instead, so the design rules apply naturally.",
  },
  "no-design-tokens": {
    t: "Lots of one-off colours",
    p: "Your page uses many different hard-coded colours with no shared palette. It reads as improvised — every section picking its own colour.",
    f: "In my website, define a small colour palette (brand colour, neutrals, one accent) as reusable variables, and replace the one-off colour values with palette colours.",
  },
  "div-soup": {
    t: "No real page structure",
    p: "The page is built from generic boxes with no proper landmarks (header, main, footer, sections). Search engines and screen readers cannot tell what anything is — and it usually means the page was generated without a plan.",
    f: "In my website, rebuild the page structure with proper landmarks: a header, a main area, a section for each topic, and a footer, instead of nested generic div boxes.",
  },
  "rtl-font-missing": {
    t: "No font chosen for Urdu/Arabic",
    p: "Your Urdu/Arabic text has no proper font set, so every visitor's device guesses — and the guesses are usually ugly, especially for Urdu.",
    f: "In my website, set a font that truly supports the script: 'Noto Nastaliq Urdu' for Urdu text or 'Noto Naskh Arabic' for Arabic, applied to all Urdu/Arabic content.",
  },
  "rtl-latin-display-font": {
    t: "A Latin-only font on Urdu/Arabic text",
    p: "The font chosen for your headings cannot draw Urdu/Arabic letters at all, so that text silently falls back to a mismatched system font. The page looks like two different sites stitched together.",
    f: "In my website, wherever Urdu/Arabic text appears, use a font stack that includes an Arabic-capable font (for example 'Noto Nastaliq Urdu' for Urdu) alongside the Latin font, so both scripts look designed.",
  },
  "urdu-naskh-for-nastaleeq": {
    t: "Urdu written in an Arabic style",
    p: "Your Urdu is set in a Naskh typeface — the Arabic style. It is readable, but to Urdu readers it looks foreign. Urdu readers expect the flowing Nastaliq style.",
    f: "In my website, set Urdu headings and display text in a Nastaliq font such as 'Noto Nastaliq Urdu' or 'Gulzar'. Naskh may stay for small body text if needed, but the visible Urdu voice should be Nastaliq.",
  },
  "rtl-text-align-left": {
    t: "Urdu/Arabic text pinned to the left",
    p: "Your right-to-left text is forced to align left — the wrong edge. It looks broken to every Urdu/Arabic reader, even if they cannot say why.",
    f: "In my website, change the alignment of Urdu/Arabic text from left to 'start' (text-align: start), so it begins at the right edge as readers expect. Keep explicit left alignment only for English or code snippets.",
  },
  "rtl-physical-properties": {
    t: "Spacing that cannot flip",
    p: "Your layout uses fixed left/right spacing and positioning. When the page runs right-to-left those do not flip, so gaps and elements end up on the wrong side.",
    f: "In my website, replace physical left/right spacing and positioning with direction-aware (logical) properties — margin-inline-start, padding-inline, inset-inline — so the layout flips correctly in RTL.",
  },
  "rtl-gradient-direction": {
    t: "A gradient running backwards",
    p: "A gradient on your RTL page runs in a hard-coded left/right direction, so the highlight flows against the reading direction.",
    f: "In my website, change gradients in RTL content to run top-to-bottom, or use direction-aware endpoints (like 'to inline-end'), so they do not fight the reading direction.",
  },
  "rtl-icon-direction": {
    t: "Arrows pointing the wrong way",
    p: "Your page has arrows, chevrons or sliding animations that do not mirror in RTL — so 'next' points backwards for Urdu/Arabic readers.",
    f: "In my website, mirror directional icons (arrows, chevrons) when the page is in RTL mode — for example with a horizontal flip under dir=\"rtl\" — so forward always points the way the reader reads. Do not flip logos or media controls.",
  },
  "rtl-latin-digits-dates": {
    t: "Foreign-style dates in Urdu/Arabic text",
    p: "Dates inside your Urdu/Arabic text are written in the Latin format (like 11/02/2026 or 'November 2, 2026'). The order and the digits do not match how your readers write dates.",
    f: "In my website, format dates inside Urdu/Arabic text using the reader's locale (Intl.DateTimeFormat with 'ur' or 'ar'), so month names, order and digits localise automatically. Never hard-code a date format into the text.",
  },
};

/** Same fallback logic as the web checker in worker.js. */
function copyFor(finding) {
  const c = COPY[finding.rule];
  if (c) return c;
  // Generic fallback for any rule without hand-written copy yet.
  return {
    t: finding.rule.replace(/-/g, " ").replace(/\brtl\b/gi, "RTL"),
    p: finding.message,
    f: "In my website, please fix this design issue: " + finding.hint,
  };
}

module.exports = { COPY, copyFor };
