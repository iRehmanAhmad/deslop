/**
 * deslop-checker — a Cloudflare Worker that checks a live website for AI
 * design slop, for people who don't read code.
 *
 *   GET  /        the checker page (single-page UI, inline)
 *   POST /check   { "url": "https://example.com" } -> score + findings,
 *                 each with a plain-language explanation and a copy-paste
 *                 fix prompt for AI builders (Lovable / Bolt / v0 / ...).
 *
 * The rule engine lives in ./engine.js, GENERATED from bin/deslop.js by
 * sync-engine.js — bin/deslop.js is the one source of truth.
 *
 * Slop Score: slop = min(100, fails*12 + warns*4). Higher = more slop.
 * Verdicts: 0 Clean · 1-45 Mild · 46+ Heavy Slop.
 */
import { scanContent } from "./engine.js";

const FAIL_POINTS = 12;
const WARN_POINTS = 4;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_CSS_BYTES = 256 * 1024;
const MAX_CSS_FILES = 5;
const MAX_FINDINGS = 80;
const FETCH_TIMEOUT_MS = 10000;

/* ------------------------------------------------------------------ */
/* Plain-language copy: title / plain explanation / fix prompt         */
/* Written for site owners, not developers. The fix prompt is pasted   */
/* back into the AI builder that made the site.                        */
/* ------------------------------------------------------------------ */

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
  "cream-serif-default": {
    t: "The 2026 look: cream + fancy serif",
    p: "Your site pairs a warm cream background with an elegant serif headline font. That exact combo is this year's AI default — the quiet replacement for the purple gradient. Tasteful, but now so common that visitors read it as 'template' at a glance.",
    f: "In my website, break up the cream-background-plus-serif-headline combination: either keep the cream background and switch the headline font to a characterful sans-serif, or keep the serif headlines and change the background to a colour with a real point of view. Do not keep both halves of the combo.",
  },
  "sage-green-accent": {
    t: "Sage green — the new default accent",
    p: "Your site uses a muted sage green as its accent colour, together with a cream background or serif type. Sage-on-cream is the third piece of the current AI-template uniform.",
    f: "In my website, replace the sage/muted-green accent colour with an accent taken from my actual brand or subject — for example a rust, an ink blue, or a stronger green chosen on purpose — and apply it consistently to buttons, links and highlights.",
  },
  "replacement-default-font": {
    t: "The replacement default font",
    p: "Your site's main font is Space Grotesk, Geist or Instrument Serif — the fonts everyone switched to after Inter became the cliché. Making the same swap as everyone else is the new tell.",
    f: "In my website, change the main/display font to a typeface chosen for my brand's personality rather than the current fashionable default (not Inter, Space Grotesk, Geist or Instrument Serif), and apply it to the headings and logo.",
  },
  "shadcn-fingerprint": {
    t: "An untouched template kit (shadcn defaults)",
    p: "Under the surface, your site still uses the stock design settings of the shadcn/Tailwind starter kit — the default colours, spacing and corner radius exactly as they shipped. It is the single most common 'built by AI' fingerprint, even when the page looks calm.",
    f: "In my website, customise the design tokens of the UI kit instead of using the shipped defaults: change the background, text, primary/accent colours and corner radius values to my brand's own values, everywhere they are defined (for example the CSS variables like --background, --foreground, --primary and --radius).",
  },
  "hero-badge-pill": {
    t: "The little pill above your headline",
    p: "A small rounded badge ('New', 'Introducing…', 'AI-powered') floats above your main headline. It is the favourite decoration of AI site builders — it looks like news but says nothing.",
    f: "In my website, remove the small pill/badge above the main headline. If there is real news, work it into the headline itself or add a dated announcement; otherwise leave the headline standing on its own.",
  },
  "left-border-accent-card": {
    t: "Cards with a thick coloured left edge",
    p: "Your cards and callouts are styled with a thick coloured stripe down the left side. One is an accent; a whole page of them is the current template look.",
    f: "In my website, restyle the cards that have a thick coloured left border: use a thin full border, a top rule, or a soft background tint instead, and keep just one of those devices across the page.",
  },
  "hover-scale-boilerplate": {
    t: "Everything grows a little on hover",
    p: "Cards and buttons all swell by the same 5% when hovered (hover:scale-105). It is the stock animation the template adds to everything, so it feels like nothing was actually designed.",
    f: "In my website, remove the uniform hover grow effect (hover:scale-105 / hover:scale-110) from cards and buttons. Give important elements one deliberate hover response instead, like a colour change or an arrow that moves.",
  },
  "numbered-steps-row": {
    t: "The 01 – 02 – 03 row",
    p: "Your page has the standard numbered-steps row (01, 02, 03) or a row of big round stats. On template sites these rows exist because the layout had a slot for them — not because the steps or numbers say anything specific.",
    f: "In my website, make the numbered steps / big stats row earn its place: use my real process steps in their real order, or my true numbers. If the steps or stats are generic, remove the row and replace it with a short paragraph or a real example.",
  },
};

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

/* ------------------------------------------------------------------ */
/* URL safety — only public http(s) pages get fetched                  */
/* ------------------------------------------------------------------ */

function ipv4ToInt(ip) {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = parseInt(p, 10);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function isPrivateIPv4(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return true; // unparseable -> treat as unsafe
  const inRange = (base, bits) => {
    const b = ipv4ToInt(base);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (b & mask);
  };
  return (
    inRange("0.0.0.0", 8) || inRange("10.0.0.0", 8) ||
    inRange("100.64.0.0", 10) || inRange("127.0.0.0", 8) ||
    inRange("169.254.0.0", 16) || inRange("172.16.0.0", 12) ||
    inRange("192.0.0.0", 24) || inRange("192.0.2.0", 24) ||
    inRange("192.168.0.0", 16) || inRange("198.18.0.0", 15) ||
    inRange("198.51.100.0", 24) || inRange("203.0.113.0", 24) ||
    inRange("224.0.0.0", 4) || inRange("240.0.0.0", 4)
  );
}

function isPrivateIPv6(ip) {
  const h = ip.toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return true; // fe80::/10
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7
  if (h.startsWith("ff")) return true; // multicast
  const mapped = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function isIPLiteral(host) {
  return ipv4ToInt(host) !== null || host.includes(":");
}

function ipIsPrivate(ip) {
  return ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

/** Resolve a hostname via Cloudflare DoH; returns true if ANY answer is private. */
async function resolvesToPrivate(host) {
  for (const type of ["A", "AAAA"]) {
    try {
      const resp = await fetch(
        "https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(host) + "&type=" + type,
        { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5000) }
      );
      if (!resp.ok) continue;
      const data = await resp.json();
      for (const ans of data.Answer || []) {
        if ((ans.type === 1 || ans.type === 28) && ipIsPrivate(ans.data)) return true;
      }
    } catch {
      // DoH unreachable: fall through — the fetch itself will fail if the
      // host does not resolve, and literal/private hostnames are already blocked.
    }
  }
  return false;
}

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".lan", ".home", ".corp", ".intranet"];

/** Returns { ok: true } or { ok: false, error }. */
async function validateTarget(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { ok: false, error: "That link doesn't look right. Check the address and try again." };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { ok: false, error: "We can only check normal website addresses (starting with http:// or https://)." };
  }
  const host = u.hostname.toLowerCase();
  if (!host || host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, error: "For safety, we only check public websites — that address points to a private or local network." };
  }
  if (isIPLiteral(host)) {
    if (ipIsPrivate(host)) {
      return { ok: false, error: "For safety, we only check public websites — that address points to a private or local network." };
    }
    return { ok: true, url: u };
  }
  if (await resolvesToPrivate(host)) {
    return { ok: false, error: "For safety, we only check public websites — that address points to a private or local network." };
  }
  return { ok: true, url: u };
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

async function readCapped(resp, cap) {
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > cap) {
      chunks.push(value.slice(0, value.length - (total - cap)));
      truncated = true;
      try { await reader.cancel(); } catch { /* already closed */ }
      break;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.length; }
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(buf), truncated };
}

/** Fetch a page, following redirects manually and re-validating each hop. */
async function fetchPage(startUrl) {
  let current = startUrl;
  for (let hop = 0; hop <= 4; hop++) {
    const resp = await fetch(current.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "user-agent": "deslop-checker/1.0 (+https://github.com/iRehmanAhmad/deslop)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const loc = resp.headers.get("location");
      if (!loc) return { error: "That site redirected us in a circle. Try the address you land on after it loads." };
      const next = new URL(loc, current);
      const v = await validateTarget(next.toString());
      if (!v.ok) return { error: v.error };
      current = v.url;
      continue;
    }
    if (!resp.ok) {
      return { error: "That site answered with an error (HTTP " + resp.status + "). If it's your site, check it's live, then try again." };
    }
    const body = await readCapped(resp, MAX_HTML_BYTES);
    const contentType = resp.headers.get("content-type") || "";
    const looksHtml = /^\s*(<!doctype|<html|<head|<body)/i.test(body.text);
    if (!contentType.includes("html") && !looksHtml) {
      return { error: "That address didn't return a web page we can read — it may be a file, or an app that needs you to log in first." };
    }
    return { html: body.text, finalUrl: current, truncated: body.truncated };
  }
  return { error: "That site redirected too many times. Try the final address you land on." };
}

function stylesheetUrls(html, baseUrl) {
  const out = [];
  const seen = new Set();
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    if (!/rel\s*=\s*["'][^"']*\bstylesheet\b/i.test(tag)) continue;
    const m = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!m) continue;
    let u;
    try { u = new URL(m[1], baseUrl); } catch { continue; }
    if (u.origin !== baseUrl.origin) continue; // same-origin only
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    if (seen.has(u.toString())) continue;
    seen.add(u.toString());
    out.push(u);
    if (out.length >= MAX_CSS_FILES) break;
  }
  return out;
}

async function fetchStylesheet(u) {
  try {
    const resp = await fetch(u.toString(), {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": "deslop-checker/1.0 (+https://github.com/iRehmanAhmad/deslop)" },
    });
    if (!resp.ok) return null;
    const body = await readCapped(resp, MAX_CSS_BYTES);
    const label = u.pathname.split("/").filter(Boolean).pop() || "stylesheet.css";
    return { css: body.text, label };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* /check                                                              */
/* ------------------------------------------------------------------ */

function jsonResponse(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
    },
  });
}

async function handleCheck(request) {
  let raw;
  try {
    const body = await request.json();
    raw = typeof body.url === "string" ? body.url.trim() : "";
  } catch {
    return jsonResponse({ ok: false, error: "Please paste a website address first." }, 400);
  }
  if (!raw) return jsonResponse({ ok: false, error: "Please paste a website address first." }, 400);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) {
    return jsonResponse({ ok: false, error: "We can only check normal website addresses (starting with http:// or https://)." }, 400);
  }
  if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;

  const v = await validateTarget(raw);
  if (!v.ok) return jsonResponse({ ok: false, error: v.error }, 400);

  let page;
  try {
    page = await fetchPage(v.url);
  } catch (err) {
    const timedOut = err && (err.name === "TimeoutError" || err.name === "AbortError");
    return jsonResponse({
      ok: false,
      error: timedOut
        ? "That site took too long to answer. Try again in a moment."
        : "We couldn't reach that site. Check the address — and that the site is public — then try again.",
    }, 502);
  }
  if (page.error) return jsonResponse({ ok: false, error: page.error }, 502);

  const sources = [{ content: page.html, ext: ".html", label: "your page" }];
  for (const cssUrl of stylesheetUrls(page.html, page.finalUrl)) {
    const sheet = await fetchStylesheet(cssUrl);
    if (sheet) sources.push({ content: sheet.css, ext: ".css", label: sheet.label });
  }

  const all = [];
  for (const s of sources) {
    for (const f of scanContent(s.content, s.ext, s.label)) {
      all.push({
        rule: f.rule,
        severity: f.severity,
        source: s.label,
        line: f.line,
        message: f.message,
        hint: f.hint,
      });
    }
  }
  all.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "fail" ? -1 : 1));

  const fails = all.filter((f) => f.severity === "fail").length;
  const warns = all.length - fails;
  const score = Math.min(100, fails * FAIL_POINTS + warns * WARN_POINTS);
  const verdict = score === 0 ? "Clean" : score <= 45 ? "Mild" : "Heavy Slop";

  return jsonResponse({
    ok: true,
    url: page.finalUrl.toString(),
    checked: sources.map((s) => s.label),
    score,
    verdict,
    counts: { fail: fails, warn: warns },
    formula: "Slop Score = fails x " + FAIL_POINTS + " + warnings x " + WARN_POINTS + " (max 100). Higher = more AI slop.",
    findings: all.slice(0, MAX_FINDINGS).map((f) => {
      const c = copyFor(f);
      return {
        rule: f.rule,
        severity: f.severity,
        title: c.t,
        plain: c.p,
        fixPrompt: c.f,
        source: f.source,
      };
    }),
  });
}

/* ------------------------------------------------------------------ */
/* The checker page.                                                   */
/* NOTE: this is a template literal — the embedded page must contain   */
/* no backticks, no dollar-brace sequences and no backslash escapes.   */
/* The page's own JS uses DOM APIs and string concatenation only.      */
/* ------------------------------------------------------------------ */

const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>deslop checker — is your site AI slop?</title>
<meta name="description" content="Paste your published site's link. Get a plain-language Slop Score, the exact AI-design tells on your page, and a copy-paste prompt to fix each one in Lovable, Bolt or v0.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600;9..144,900&family=Karla:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  :root {
    --paper: #FAF5EC;
    --card: #FFFDF8;
    --ink: #221709;
    --ink-soft: #5C4F43;
    --line: #E3D7C3;
    --brick: #B23A17;
    --brick-tint: #F9E4DA;
    --amber: #96660A;
    --amber-tint: #F7ECD2;
    --green: #1E6B4F;
    --green-tint: #DDEEE6;
    --prompt-bg: #F1EAD9;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: "Karla", "Segoe UI", Verdana, sans-serif;
    font-size: 18px;
    line-height: 1.55;
  }
  .wrap { max-width: 760px; margin: 0 auto; padding: 48px 20px 64px; }
  .brand {
    font-family: "Fraunces", Georgia, serif;
    font-weight: 900;
    font-size: 30px;
    letter-spacing: -0.5px;
  }
  .brand span { color: var(--brick); }
  h1 {
    font-family: "Fraunces", Georgia, serif;
    font-weight: 900;
    font-size: 52px;
    line-height: 1.05;
    letter-spacing: -1px;
    margin: 28px 0 14px;
  }
  .lede { font-size: 20px; color: var(--ink-soft); margin: 0 0 30px; max-width: 620px; }
  form { display: flex; gap: 10px; flex-wrap: wrap; }
  input[type="text"] {
    flex: 1 1 320px;
    font: inherit;
    font-size: 19px;
    padding: 15px 18px;
    border: 2px solid var(--ink);
    border-radius: 10px;
    background: var(--card);
    color: var(--ink);
  }
  input[type="text"]:focus-visible { outline: 3px solid var(--brick); outline-offset: 2px; }
  button {
    font: inherit;
    font-weight: 800;
    font-size: 19px;
    padding: 15px 26px;
    border: 2px solid var(--ink);
    border-radius: 10px;
    background: var(--ink);
    color: var(--paper);
    cursor: pointer;
  }
  button:hover { background: var(--brick); border-color: var(--brick); }
  button:disabled { opacity: 0.55; cursor: wait; }
  button:focus-visible { outline: 3px solid var(--brick); outline-offset: 2px; }
  .how { margin-top: 16px; font-size: 16px; color: var(--ink-soft); max-width: 640px; }
  #status { margin-top: 22px; font-weight: 600; min-height: 28px; }
  .error-box {
    margin-top: 22px;
    background: var(--brick-tint);
    border: 1px solid var(--brick);
    border-radius: 10px;
    padding: 16px 18px;
    font-weight: 600;
  }
  .score-block {
    margin-top: 28px;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 26px 28px;
    display: flex;
    align-items: center;
    gap: 28px;
    flex-wrap: wrap;
  }
  .score-num {
    font-family: "Fraunces", Georgia, serif;
    font-weight: 900;
    font-size: 96px;
    line-height: 1;
  }
  .score-num small { font-size: 30px; color: var(--ink-soft); }
  .score-clean { color: var(--green); }
  .score-mild { color: var(--amber); }
  .score-heavy { color: var(--brick); }
  .verdict { font-family: "Fraunces", Georgia, serif; font-weight: 600; font-size: 32px; line-height: 1.15; }
  .score-meta { color: var(--ink-soft); margin-top: 6px; font-size: 16px; }
  .next-step {
    margin-top: 18px;
    background: var(--green-tint);
    border: 1px solid var(--green);
    border-radius: 10px;
    padding: 14px 18px;
    font-size: 17px;
  }
  .finding {
    margin-top: 16px;
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 12px;
    padding: 20px 22px;
  }
  .finding-top { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .chip {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    padding: 4px 10px;
    border-radius: 999px;
  }
  .chip-fail { background: var(--brick-tint); color: var(--brick); }
  .chip-warn { background: var(--amber-tint); color: var(--amber); }
  .finding h2 { font-family: "Fraunces", Georgia, serif; font-size: 24px; margin: 0; line-height: 1.2; }
  .finding p { margin: 10px 0 0; color: var(--ink-soft); }
  .found-in { font-size: 14px; color: var(--ink-soft); margin-top: 8px; }
  .prompt-box {
    margin-top: 14px;
    background: var(--prompt-bg);
    border: 1px solid var(--line);
    border-radius: 10px;
    padding: 14px 16px;
  }
  .prompt-label { font-size: 13px; font-weight: 800; letter-spacing: 0.6px; text-transform: uppercase; color: var(--ink-soft); }
  .prompt-text { font-family: ui-monospace, "SF Mono", Consolas, monospace; font-size: 15.5px; margin-top: 6px; white-space: pre-wrap; }
  .copy-btn {
    margin-top: 12px;
    font-size: 16px;
    padding: 10px 18px;
    background: var(--card);
    color: var(--ink);
  }
  .copy-btn:hover { background: var(--ink); color: var(--paper); border-color: var(--ink); }
  .all-clean {
    margin-top: 24px;
    background: var(--green-tint);
    border: 1px solid var(--green);
    border-radius: 12px;
    padding: 22px 24px;
    font-size: 19px;
  }
  footer {
    margin-top: 56px;
    border-top: 2px solid var(--ink);
    padding-top: 18px;
    font-size: 16px;
    color: var(--ink-soft);
  }
  footer a { color: var(--brick); font-weight: 700; }
  @media (max-width: 560px) {
    h1 { font-size: 40px; }
    .score-num { font-size: 72px; }
  }
</style>
</head>
<body>
<div class="wrap">
  <div class="brand">deslop<span>.</span>checker</div>
  <h1>Does your site look AI-made?</h1>
  <p class="lede">Paste the link to your published site. We will read its design the way a visitor does, tell you — in plain words — exactly what makes it look AI-generated, and give you a ready-made instruction to paste back into Lovable, Bolt or v0 to fix each one.</p>
  <form id="check-form">
    <input type="text" id="url-input" placeholder="your-site.lovable.app" autocomplete="off" spellcheck="false" aria-label="Your website address">
    <button type="submit" id="check-btn">Check my site</button>
  </form>
  <p class="how"><strong>How the Slop Score works:</strong> 0 means clean and human-looking, 100 means every AI cliché in the book. Each big problem adds 12 points, each smaller one adds 4. No sign-up, and we do not store your site.</p>
  <div id="status" role="status"></div>
  <div id="results"></div>
  <footer>
    Powered by <a href="https://github.com/iRehmanAhmad/deslop">deslop</a> — the anti-slop scanner that can also read RTL (Urdu and Arabic included). Built by <a href="https://rehmanahmad.com">Rahman Ahmad</a>.
  </footer>
</div>
<script>
var form = document.getElementById("check-form");
var input = document.getElementById("url-input");
var btn = document.getElementById("check-btn");
var statusBox = document.getElementById("status");
var results = document.getElementById("results");

function el(tag, cls, text) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== null && text !== undefined) e.textContent = text;
  return e;
}

function showError(msg) {
  statusBox.textContent = "";
  results.innerHTML = "";
  var d = el("div", "error-box", msg);
  results.appendChild(d);
}

function fallbackCopy(text) {
  var ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); } catch (err) { /* clipboard unavailable */ }
  document.body.removeChild(ta);
}

function copyPrompt(text, button) {
  function done() {
    button.textContent = "Copied — now paste it into your AI builder";
    setTimeout(function () { button.textContent = "Copy fix prompt"; }, 2800);
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
  } else {
    fallbackCopy(text);
    done();
  }
}

function renderResults(data) {
  results.innerHTML = "";
  var block = el("div", "score-block");
  var cls = data.score === 0 ? "score-clean" : (data.score <= 45 ? "score-mild" : "score-heavy");
  var num = el("div", "score-num " + cls, String(data.score));
  var small = el("small", null, " / 100");
  num.appendChild(small);
  block.appendChild(num);
  var right = el("div", null);
  right.appendChild(el("div", "verdict", data.verdict === "Clean" ? "Clean — nicely done" : (data.verdict === "Mild" ? "Mild slop" : "Heavy slop")));
  right.appendChild(el("div", "score-meta", "Checked: " + data.url));
  right.appendChild(el("div", "score-meta", data.counts.fail + " big problem(s) and " + data.counts.warn + " smaller one(s) found in " + data.checked.join(" + ") + "."));
  block.appendChild(right);
  results.appendChild(block);

  if (data.findings.length === 0) {
    results.appendChild(el("div", "all-clean", "No AI design tells found on this page. Your site reads as designed by a human with opinions — keep it that way."));
    return;
  }

  var next = el("div", "next-step", "What to do: for each problem below, copy its fix prompt and paste it into the AI builder that made your site (Lovable, Bolt, v0, or any other). The builder will fix it for you — then check again.");
  results.appendChild(next);

  data.findings.forEach(function (f) {
    var card = el("div", "finding");
    var top = el("div", "finding-top");
    top.appendChild(el("span", "chip " + (f.severity === "fail" ? "chip-fail" : "chip-warn"), f.severity === "fail" ? "Big one" : "Worth fixing"));
    top.appendChild(el("h2", null, f.title));
    card.appendChild(top);
    card.appendChild(el("p", null, f.plain));
    card.appendChild(el("div", "found-in", "Found in: " + f.source));
    var pb = el("div", "prompt-box");
    pb.appendChild(el("div", "prompt-label", "Fix prompt — paste this into your AI builder"));
    pb.appendChild(el("div", "prompt-text", f.fixPrompt));
    var b = el("button", "copy-btn", "Copy fix prompt");
    b.type = "button";
    b.addEventListener("click", function () { copyPrompt(f.fixPrompt, b); });
    pb.appendChild(b);
    card.appendChild(pb);
    results.appendChild(card);
  });
}

form.addEventListener("submit", function (ev) {
  ev.preventDefault();
  var url = input.value.trim();
  if (!url) { showError("Paste your website address first."); return; }
  btn.disabled = true;
  btn.textContent = "Checking…";
  statusBox.textContent = "Fetching your page and reading its design — this can take a few seconds.";
  results.innerHTML = "";
  fetch("/check", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url })
  }).then(function (r) { return r.json(); }).then(function (data) {
    btn.disabled = false;
    btn.textContent = "Check my site";
    if (!data.ok) { showError(data.error || "Something went wrong. Please try again."); return; }
    statusBox.textContent = "";
    renderResults(data);
  }).catch(function () {
    btn.disabled = false;
    btn.textContent = "Check my site";
    showError("Something went wrong while checking. Please try again.");
  });
});
</script>
</body>
</html>
`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(PAGE, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (url.pathname === "/check") {
      if (request.method !== "POST") {
        return jsonResponse({ ok: false, error: "Use POST with a JSON body: { \"url\": \"https://example.com\" }" }, 405);
      }
      return handleCheck(request);
    }
    if (url.pathname === "/health") {
      return jsonResponse({ ok: true, tool: "deslop-checker" });
    }
    return new Response("Not found", { status: 404 });
  },
};
