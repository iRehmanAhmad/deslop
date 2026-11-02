#!/usr/bin/env node
/**
 * deslop — remove AI design slop from your projects.
 *
 * A zero-dependency scanner that flags the visual and copy patterns that make
 * agent-generated UI all look the same: Inter everywhere, purple-to-blue
 * gradients, giant radii, glassmorphism, emoji bullets, "Supercharge your
 * workflow" copy, and friends.
 *
 * Usage:
 *   node bin/deslop.js [path] [--format text|json]
 *
 * - path defaults to ./src when it exists, otherwise the current directory.
 * - Exit code is 1 when any "fail" rule hits, 0 otherwise.
 *
 * Requires Node >= 18. No npm packages.
 */
"use strict";

const fs = require("fs");
const path = require("path");

// === ENGINE BEGIN ===
// Pure scanning engine: no fs/path, no I/O. Everything between the ENGINE
// markers is shared verbatim with the web checker — web-checker/engine.js is
// GENERATED from this section by web-checker/sync-engine.js. Edit rules here,
// never in engine.js.
const EXTENSIONS = new Set([
  ".css", ".scss", ".html", ".jsx", ".tsx", ".vue", ".astro", ".svelte",
]);
const MARKUP_EXTENSIONS = new Set([".html", ".jsx", ".tsx", ".vue", ".astro", ".svelte"]);
const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".astro", "coverage", ".svelte-kit",
]);

/* ------------------------------------------------------------------ */
/* Rule definitions                                                    */
/* ------------------------------------------------------------------ */

const AI_COPY_WORDS = [
  "supercharge", "elevate your", "seamless", "seamlessly", "cutting-edge",
  "unlock the power", "delve", "revolutionize", "game-changer", "game changer",
  "next-level", "harness the power", "empower your", "streamline your",
  "effortlessly", "in today's fast-paced", "take your .{0,30} to the next level",
  "powered by ai", "world-class solution", "robust solution",
];

const VIOLET_TOKENS = [
  "#7c3aed", "#8b5cf6", "#a855f7", "#9333ea", "#6366f1", "#818cf8",
  "#d946ef", "#c026d3", "purple", "violet", "indigo", "fuchsia", "magenta",
];
const BLUE_TOKENS = [
  "#3b82f6", "#2563eb", "#1d4ed8", "#0ea5e9", "#38bdf8", "#06b6d4",
  "blue", "cyan", "sky",
];

function hasAny(haystack, needles) {
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n));
}

/** Per-line rules: test(line, ctx) -> true when the pattern hits. */
const LINE_RULES = [
  {
    id: "lorem-ipsum",
    severity: "fail",
    message: "Lorem ipsum placeholder text left in the UI",
    hint: "Write real copy, or mark the block as a draft and finish it before shipping.",
    test: (line) => /lorem ipsum/i.test(line),
  },
  {
    id: "purple-blue-gradient",
    severity: "fail",
    message: "Purple/violet-to-blue linear gradient — the default AI hero look",
    hint: "Pick a colour story from the brand or the content; a solid colour or a duotone photo beats the default gradient.",
    test: (line) =>
      /linear-gradient\(/.test(line) &&
      hasAny(line, VIOLET_TOKENS) &&
      hasAny(line, BLUE_TOKENS),
  },
  {
    id: "tailwind-purple-gradient",
    severity: "fail",
    message: "Tailwind gradient from violet/indigo/purple/fuchsia — instant AI-template signal",
    hint: "Use a solid brand colour, a subtle same-hue tint, or a real image instead.",
    test: (line) =>
      /bg-(gradient|linear)-to-[a-z]+/.test(line) &&
      /(from|via)-(violet|indigo|purple|fuchsia)-/.test(line),
  },
  {
    id: "gradient-text",
    severity: "warn",
    message: "Gradient text (background-clip: text) — a signature AI landing-page move",
    hint: "Set the headline in one strong colour. Emphasis comes from weight and size, not a rainbow fill.",
    test: (line) =>
      /background-clip\s*:\s*text/.test(line) || /\bbg-clip-text\b/.test(line),
  },
  {
    id: "glassmorphism",
    severity: "warn",
    message: "Glassmorphism: backdrop blur over a translucent panel",
    hint: "Use an opaque surface with a real border or shadow hierarchy; save blur for genuine overlays.",
    test: (line) =>
      /backdrop-filter\s*:\s*blur/.test(line) || /\bbackdrop-blur/.test(line),
  },
  {
    id: "giant-border-radius",
    severity: "warn",
    message: "Border radius of 24px or more — everything-pillowy AI card look",
    hint: "Tie radius to a small scale (4/8/12px). Big radii are for avatars and pills, not every card.",
    test: (line) => {
      const decl = line.match(/border-radius\s*:\s*([^;}]+)/);
      if (decl) {
        const nums = [...decl[1].matchAll(/(\d+(?:\.\d+)?)(px|rem|em)/g)];
        if (nums.some((m) => parseFloat(m[1]) * (m[2] === "px" ? 1 : 16) >= 24)) return true;
      }
      if (/\brounded-3xl\b/.test(line)) return true;
      const arb = line.match(/\brounded-\[(\d+(?:\.\d+)?)(px|rem)\]/);
      if (arb && parseFloat(arb[1]) * (arb[2] === "px" ? 1 : 16) >= 24) return true;
      return false;
    },
  },
  {
    id: "giant-shadow",
    severity: "warn",
    message: "Huge soft shadow (blur >= 40px or shadow-2xl) — floating-everything look",
    hint: "Shadows should imply one light source and a small elevation scale; most cards need a 1px border, not a cloud.",
    test: (line) => {
      if (/\bshadow-2xl\b/.test(line)) return true;
      const decl = line.match(/box-shadow\s*:\s*([^;}]+)/);
      if (decl) {
        // Length tokens in order: offset-x, offset-y, blur, [spread].
        // ("0 25px 60px ..." — the first offset is often a bare 0 with no unit.)
        const lengths = decl[1]
          .split(/[\s,]+/)
          .filter((t) => /^-?\d+(?:\.\d+)?(px|rem|em)?$/.test(t))
          .map((t) => parseFloat(t));
        if (lengths.length >= 3 && lengths[2] >= 40) return true;
      }
      return false;
    },
  },
  {
    id: "emoji-in-ui",
    severity: "warn",
    message: "Emoji used as UI decoration/iconography",
    hint: "Use a real icon set (or none). Emoji render differently on every platform and read as filler.",
    test: (line) => {
      const stripped = line.replace(/[✓✔]/g, "");
      return /[\u{1F000}-\u{1FAFF}\u{2600}-\u{2612}\u{2615}-\u{2712}\u{2715}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(stripped);
    },
  },
  {
    id: "checkmark-lists",
    severity: "warn",
    message: "Checkmark characters as list bullets — the AI pricing/feature list tell",
    hint: "Use a designed list marker or restructure the list; a raw ✓ glyph is not an icon system.",
    test: (line) => /[✓✔]/.test(line),
  },
  {
    id: "ai-copy-words",
    severity: "warn",
    message: "AI-marketing copy in a UI string",
    hint: "Say the concrete thing the product does, with a number or a noun. 'Exports CSV in one click' beats 'Supercharge your workflow'.",
    test: (line) => AI_COPY_WORDS.some((w) => new RegExp(w, "i").test(line)),
  },
  {
    id: "welcome-hero",
    severity: "warn",
    message: "'Welcome to …' hero heading — the most generic headline an agent can write",
    hint: "Lead with what the visitor gets or does here, not a greeting.",
    test: (line) => /(<h1[^>]*>|>\s*)Welcome to\b/i.test(line),
  },
  {
    id: "generic-alt-text",
    severity: "warn",
    message: "Placeholder alt text that describes nothing",
    hint: "Describe what the image shows, or use alt=\"\" for purely decorative images.",
    test: (line) => /alt\s*=\s*["'](image|img|picture|placeholder|photo|icon)["']/i.test(line),
  },
  {
    id: "generic-cta",
    severity: "warn",
    message: "Generic call-to-action label ('Get Started' / 'Learn More' / 'Click here')",
    hint: "Name the action and its payoff: 'Download the report', 'Start the free trial'.",
    test: (line) => />\s*(Get Started|Learn More|Click here)\s*</i.test(line),
  },
  {
    id: "eyebrow-label",
    severity: "warn",
    message: "Uppercase letter-spaced 'eyebrow' label above a heading — AI section-header formula",
    hint: "If every section needs a tiny shouty label, the headings are not doing their job. Strengthen the heading instead.",
    test: (line) => /\buppercase\b/.test(line) && /tracking-(widest|\[0\.[2-9]em\])/.test(line),
  },
  {
    id: "gradient-blob",
    severity: "warn",
    message: "Blurred violet/fuchsia blob used as background decoration",
    hint: "Decorative blobs carry no information. Use whitespace, a grid, or real imagery.",
    test: (line) => /\bblur-3xl\b/.test(line) && /\bbg-(violet|fuchsia|purple|indigo)-/.test(line),
  },
  {
    id: "transition-all",
    severity: "warn",
    message: "'transition: all' — the lazy default that animates properties you never meant to move",
    hint: "List the properties that actually change (color, transform, opacity).",
    test: (line) => /transition\s*:\s*all\b/.test(line) || /\btransition-all\b/.test(line),
  },
  {
    id: "z-index-arms-race",
    severity: "warn",
    message: "z-index of 100 or more — stacking decided by escalation instead of a scale",
    hint: "Define a small z-index scale (e.g. 1/10/20/30 for dropdown/sticky/modal/toast) and stick to it.",
    test: (line) => {
      const decl = line.match(/z-index\s*:\s*(\d+)/);
      if (decl && parseInt(decl[1], 10) >= 100) return true;
      const arb = line.match(/\bz-\[(\d+)\]/);
      if (arb && parseInt(arb[1], 10) >= 100) return true;
      return false;
    },
  },
  {
    id: "focus-outline-removed",
    severity: "warn",
    message: "Focus outline removed without a replacement — keyboard users lose their place",
    hint: "Style :focus-visible with a visible ring instead of deleting the outline.",
    test: (line) => /outline\s*:\s*(none|0)\b/.test(line) || /\boutline-none\b/.test(line),
  },
  {
    id: "generic-social-proof",
    severity: "warn",
    message: "Round-number social proof ('Trusted by 10,000+ happy customers')",
    hint: "Use a real, checkable number and name who they are — or drop the claim.",
    test: (line) =>
      /(trusted by|join(ed)? by|join)\s+(over\s+)?[\d][\d,.]*\+?\s+(happy\s+)?(customers|users|teams|companies|businesses)/i.test(line),
  },
  {
    id: "rounded-full-misuse",
    severity: "warn",
    message: "rounded-full on a large non-avatar element",
    hint: "Full rounding is for avatars, dots and pills. Cards and media should use the radius scale.",
    test: (line) => {
      if (!/\brounded-full\b/.test(line)) return false;
      if (/<img/i.test(line) || /avatar/i.test(line)) return false;
      if (/\bw-full\b/.test(line)) return true;
      const big = line.match(/\b[wh]-(\d+)\b/g) || [];
      return big.some((c) => parseInt(c.split("-")[1], 10) >= 24);
    },
  },
  {
    id: "gradient-border",
    severity: "warn",
    message: "Gradient border (border-image) — decoration standing in for hierarchy",
    hint: "A plain 1px border in a considered colour almost always reads better.",
    test: (line) => /border-image[^;}]*gradient/.test(line),
  },
];

/**
 * The Inter rule needs the whole font stack, so it runs as a dedicated pass
 * over declarations rather than a plain line test.
 */
function interFindings(lines, rel) {
  const out = [];
  const re = /(?:font-family|--[\w-]*font[\w-]*)\s*:\s*([^;}]+)/g;
  const generic = new Set([
    "sans-serif", "serif", "monospace", "system-ui", "-apple-system",
    "ui-sans-serif", "ui-serif", "inherit", "initial",
  ]);
  lines.forEach((line, i) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      const stack = m[1].split(",").map((s) => s.trim().replace(/["']/g, ""));
      const named = stack.filter((s) => s && !generic.has(s.toLowerCase()) && !s.startsWith("var("));
      if (named.length === 1 && named[0].toLowerCase() === "inter") {
        out.push({
          file: rel, line: i + 1, rule: "inter-only-font", severity: "fail",
          message: "Inter is the only named font in the stack — the default AI typeface",
          hint: "Choose a typeface with a point of view (a serif display, a grotesque with character) and pair it deliberately.",
        });
      }
    }
  });
  return out;
}

/* ------------------------------------------------------------------ */
/* RTL pack — Urdu / Arabic (and other right-to-left) UI               */
/* ------------------------------------------------------------------ */

/**
 * The Western anti-slop canon is blind in right-to-left: its rules assume
 * an LTR, Latin-script page. The RTL pack activates only on files that
 * show an RTL signal (Arabic-script text, lang="ur"/"ar", dir="rtl" or
 * direction: rtl), and flags the mistakes agents make when they generate
 * Urdu/Arabic UI with LTR habits: no dir attribute, Latin display fonts
 * sitting on Arabic script, physical left/right properties that do not
 * flip, hard-coded Latin dates inside Arabic copy, un-mirrored icons.
 */

const ARABIC_SCRIPT_RE = /[\u0600-\u06FF]/;
/** Characters that mark the text as Urdu specifically (ٹ ڈ ڑ ں ھ ے). */
const URDU_CHARS_RE = /[\u0679\u0688\u0691\u06BA\u06BE\u06D2]/;
const RTL_LANG_RE = /\blang\s*=\s*["'](ur|ar)\b/i;

/** Latin display faces with no Arabic glyphs — the LTR default wardrobe. */
const LATIN_DISPLAY_FONTS = [
  "inter", "roboto", "poppins", "montserrat", "space grotesk", "open sans",
  "lato", "raleway", "oswald", "nunito", "work sans", "dm sans", "manrope",
  "sora", "geist", "plus jakarta sans", "source sans", "quicksand",
  "playfair display", "fraunces", "instrument serif", "bebas neue",
];
/** Typefaces that actually carry Arabic script. */
const ARABIC_CAPABLE_FONTS = [
  "noto nastaliq", "noto naskh", "noto sans arabic", "noto urdu", "nastaliq",
  "amiri", "scheherazade", "vazirmatn", "gulzar", "mehr nastaliq",
  "alvi nastaleeq", "nafees", "urdu typesetting", "ibm plex sans arabic",
  "tajawal", "cairo", "lateef", "harmattan", "mirza", "aref ruqaa",
  "reem kufi", "markazi text",
];
/** Nastaliq faces — what Urdu readers expect for display text. */
const NASTALIQ_FONTS = [
  "noto nastaliq", "gulzar", "mehr nastaliq", "alvi nastaleeq",
  "nafees nastaleeq", "urdu typesetting", "nastaliq",
];
/** Naskh faces — correct for Arabic, the wrong default for Urdu display. */
const NASKH_FONTS = [
  "noto naskh arabic", "amiri", "scheherazade", "noto sans arabic",
  "traditional arabic", "sakkal majalla",
];

function fontStacks(lines) {
  const re = /(?:font-family|--[\w-]*font[\w-]*)\s*:\s*([^;}]+)/g;
  const stacks = [];
  lines.forEach((line, i) => {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(line)) !== null) {
      if (m[1].includes("var(")) continue; // unresolved token reference
      const named = m[1]
        .split(",")
        .map((s) => s.trim().replace(/["']/g, "").toLowerCase())
        .filter(Boolean);
      stacks.push({ line: i + 1, named });
    }
  });
  return stacks;
}

function stackHas(stack, fonts) {
  return stack.named.some((name) => fonts.some((f) => name.includes(f)));
}

function rtlFindings(lines, content, rel, ext) {
  const out = [];
  const hasArabicScript = ARABIC_SCRIPT_RE.test(content);
  const langMatch = content.match(RTL_LANG_RE);
  const hasRtlDir =
    /\bdir\s*=\s*["']rtl["']/i.test(content) || /\bdir=\{\s*["']rtl["']\s*\}/.test(content);
  const hasCssRtl = /direction\s*:\s*rtl\b/.test(content);
  const isRTL = hasArabicScript || !!langMatch || hasRtlDir || hasCssRtl;
  if (!isRTL) return out;

  const isUrdu = (langMatch && langMatch[1].toLowerCase() === "ur") || URDU_CHARS_RE.test(content);
  const stacks = fontStacks(lines);
  const push = (line, rule, severity, message, hint) =>
    out.push({ file: rel, line, rule, severity, message, hint });

  /* rtl-missing-dir (fail) — markup with RTL content but nothing flips it. */
  if (MARKUP_EXTENSIONS.has(ext) && (hasArabicScript || langMatch) && !hasRtlDir && !hasCssRtl) {
    const anchor = langMatch
      ? firstLineMatching(lines, RTL_LANG_RE)
      : firstLineMatching(lines, ARABIC_SCRIPT_RE);
    push(anchor, "rtl-missing-dir", "fail",
      "Arabic-script / RTL-language content with no dir=\"rtl\" — the browser will lay it out left-to-right",
      "Add dir=\"rtl\" to the <html> element (or the container of the RTL content). Without it, text order, alignment and layout all run the wrong way.");
  }

  /* Font rules — only meaningful once the file carries Arabic script. */
  if (hasArabicScript) {
    if (stacks.length === 0) {
      push(firstLineMatching(lines, ARABIC_SCRIPT_RE), "rtl-font-missing", "warn",
        "Arabic-script text with no font-family declared anywhere — it falls back to whatever the platform default happens to be",
        "Declare a font with real Arabic support (Noto Nastaliq Urdu for Urdu display text, Noto Naskh Arabic for Arabic). Platform fallbacks render Urdu especially badly.");
    }
    for (const stack of stacks) {
      if (stackHas(stack, LATIN_DISPLAY_FONTS) && !stackHas(stack, ARABIC_CAPABLE_FONTS)) {
        push(stack.line, "rtl-latin-display-font", "warn",
          "Latin-only display font set on content that includes Arabic script — the Arabic text falls back to a mismatched system font",
          "Pair the Latin face with an Arabic-capable one in the same stack (e.g. 'Poppins', 'Noto Nastaliq Urdu', sans-serif), or set the Arabic content in its own font.");
      }
    }
    if (isUrdu && !stacks.some((s) => stackHas(s, NASTALIQ_FONTS))) {
      const naskh = stacks.find((s) => stackHas(s, NASKH_FONTS));
      if (naskh) {
        push(naskh.line, "urdu-naskh-for-nastaleeq", "warn",
          "Urdu text set in a Naskh typeface with no Nastaliq option — readable, but it reads as Arabic, not Urdu",
          "Urdu readers expect Nastaliq for display text: add 'Noto Nastaliq Urdu' (or Gulzar / Mehr Nastaliq) for headings and keep Naskh, if you like, for dense body text.");
      }
    }
  }

  /* rtl-text-align-left — forced left alignment on RTL body text. */
  if (hasArabicScript || langMatch) {
    const alignLines = lines.filter(
      (l) => /text-align\s*:\s*left\b/.test(l) || /\btext-left\b/.test(l)
    );
    if (alignLines.length > 0) {
      push(firstLineMatching(lines, /text-align\s*:\s*left\b|\btext-left\b/),
        "rtl-text-align-left", "warn",
        `text-align: left forced ${alignLines.length} time(s) in an RTL file — Urdu/Arabic body text gets pinned to the wrong edge`,
        "Use text-align: start (or text-start / [dir]-aware alignment) so text begins at the inline start — the right edge in RTL. Reserve explicit left for genuine LTR islands like code.");
    }
  }

  /* rtl-physical-properties — one aggregated finding per file. */
  {
    const cssRe = /(?:margin|padding|border|inset)-(?:left|right)\b|(?:^|[;{])\s*(?:left|right)\s*:/;
    const twRe = /\b(?:m[lr]|p[lr])-(?:auto|\d+|\[)|\b(?:left|right)-(?:\d+|\[|auto|full)|\bborder-[lr](?:-\d+)?\b/;
    let count = 0;
    let anchor = 1;
    lines.forEach((line, i) => {
      const n = (line.match(new RegExp(cssRe.source, "g")) || []).length +
        (line.match(new RegExp(twRe.source, "g")) || []).length;
      if (n > 0) {
        if (count === 0) anchor = i + 1;
        count += n;
      }
    });
    if (count >= 2) {
      push(anchor, "rtl-physical-properties", "warn",
        `${count} physical left/right properties in an RTL file — margins, padding and positions that do not flip when direction flips`,
        "Use logical properties: margin-inline-start/end, padding-inline, inset-inline, border-inline-start. They follow the writing direction automatically.");
    }
  }

  /* rtl-gradient-direction — hard-coded physical gradient direction. */
  lines.forEach((line, i) => {
    if (/(?:linear|radial)-gradient\(\s*(?:to\s+(?:top\s+|bottom\s+)?(?:right|left))\b/.test(line) ||
        /\bbg-(?:gradient|linear)-to-[lr]\b/.test(line)) {
      push(i + 1, "rtl-gradient-direction", "warn",
        "Gradient with a hard-coded physical direction (to right / to left) in an RTL file — the highlight runs backwards against the reading direction",
        "Use logical endpoints (to inline-end / to inline-start), or a vertical/symmetric gradient that has no reading direction.");
    }
  });

  /* rtl-icon-direction — directional icons with no mirroring anywhere. */
  {
    const iconRe = /\bfa-(?:arrow|chevron|angle|caret)-(?:left|right)\b|\b(?:arrow_forward|arrow_back|arrow_forward_ios|arrow_back_ios|chevron_left|chevron_right|keyboard_arrow_left|keyboard_arrow_right)\b|\b-?translate-x-\d+\b/;
    let count = 0;
    let anchor = 1;
    lines.forEach((line, i) => {
      if (iconRe.test(line)) {
        if (count === 0) anchor = i + 1;
        count += 1;
      }
    });
    const mirrored =
      /\brtl:/.test(content) || /\[dir\s*=\s*["']?rtl/.test(content) ||
      /scaleX\(\s*-1\s*\)/.test(content) || /-scale-x-\d+/.test(content) ||
      /scale-x-\[-1\]/.test(content);
    if (count > 0 && !mirrored) {
      push(anchor, "rtl-icon-direction", "warn",
        `${count} directional icon/animation cue(s) (arrows, chevrons, translate-x) in an RTL file, with no mirroring anywhere — 'next' will point backwards`,
        "Mirror directional icons in RTL: a scaleX(-1) flip under [dir=\"rtl\"], Tailwind's rtl: variant (-scale-x-100), or a direction-aware icon choice. Media controls and logos stay unflipped.");
    }
  }

  /* rtl-latin-digits-dates — Latin-format dates written into Arabic copy. */
  if (MARKUP_EXTENSIONS.has(ext)) {
    const dateRe = /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}\b/;
    let count = 0;
    let anchor = 1;
    lines.forEach((line, i) => {
      if (ARABIC_SCRIPT_RE.test(line) && dateRe.test(line)) {
        if (count === 0) anchor = i + 1;
        count += 1;
      }
    });
    if (count > 0) {
      push(anchor, "rtl-latin-digits-dates", "warn",
        `${count} line(s) mix a hard-coded Latin-format date into Arabic-script copy — the format (and often the digits) will not match how the reader writes dates`,
        "Format dates at runtime with Intl.DateTimeFormat('ur' / 'ar') so order, month names and digits localise; never bake 'MM/DD/YYYY' or 'November 2, 2026' into RTL UI strings.");
    }
  }

  return out;
}

/** File-level rules: aggregate counts over the whole file. */
const FILE_RULES = [
  {
    id: "em-dash-overuse",
    severity: "warn",
    threshold: 4,
    message: (n) => `Em-dash used ${n} times in UI copy — the punctuation equivalent of the purple gradient`,
    hint: "Vary the punctuation: full stops, colons, commas. One em-dash is style; ten is a fingerprint.",
    count: (lines) => lines.reduce((acc, l) => acc + (l.match(/—/g) || []).length, 0),
  },
  {
    id: "text-center-everywhere",
    severity: "warn",
    threshold: 5,
    message: (n) => `${n} centred blocks — AI layouts centre everything because they cannot commit to a grid`,
    hint: "Left-align body content; reserve centring for short hero statements.",
    count: (lines) => lines.filter((l) => /\btext-center\b/.test(l) || /text-align\s*:\s*center/.test(l)).length,
  },
  {
    id: "flat-gray-backgrounds",
    severity: "warn",
    threshold: 3,
    message: (n) => `${n} flat light-gray backgrounds (gray/slate/zinc 50–100) — no colour story`,
    hint: "Build surfaces from the brand palette and a warm/cool neutral ramp chosen on purpose.",
    count: (lines) => lines.filter((l) => /\bbg-(gray|slate|zinc|neutral)-(50|100)\b/.test(l)).length,
  },
  {
    id: "animation-overuse",
    severity: "warn",
    threshold: 3,
    message: (n) => `animate-bounce/animate-pulse used ${n} times — motion as decoration, not feedback`,
    hint: "Animate state changes and loading only; one deliberate motion beats five bouncing badges.",
    count: (lines) => lines.filter((l) => /\banimate-(bounce|pulse)\b/.test(l)).length,
  },
  {
    id: "shadow-on-everything",
    severity: "warn",
    threshold: 5,
    message: (n) => `${n} large shadows (shadow-lg/xl/2xl) in one file — every element shouting for depth`,
    hint: "Pick one elevation story: borders for structure, shadow for the one thing that truly floats.",
    count: (lines) => lines.filter((l) => /\bshadow-(lg|xl|2xl)\b/.test(l)).length,
  },
  {
    id: "default-blue-buttons",
    severity: "warn",
    threshold: 3,
    message: (n) => `Default Tailwind blue (bg-blue-500/600/700) used ${n} times — the un-themed primary colour`,
    hint: "Define the primary colour from the brand and use it consistently; framework blue is a placeholder.",
    count: (lines) => lines.filter((l) => /\bbg-blue-(500|600|700)\b/.test(l)).length,
  },
  {
    id: "important-overuse",
    severity: "warn",
    threshold: 3,
    message: (n) => `${n} uses of !important — specificity decided by force, not structure`,
    hint: "Fix the cascade order or the selector; !important is a debt marker, not a tool.",
    count: (lines) => lines.filter((l) => /!important/.test(l)).length,
  },
  {
    id: "no-design-tokens",
    severity: "warn",
    threshold: 8,
    message: (n) => `${n} different hard-coded hex colours in one file — no palette, just vibes`,
    hint: "Define colour tokens (CSS variables or a theme) and reference them; a palette is a decision, made once.",
    count: (lines, content) => new Set((content.match(/#[0-9a-fA-F]{6}\b/g) || []).map((h) => h.toLowerCase())).size,
  },
  {
    id: "div-soup",
    severity: "warn",
    threshold: 20,
    message: (n) => `${n} <div> elements and no semantic landmarks (header/main/section/nav/footer/article)`,
    hint: "Use the landmark elements — they help screen readers, SEO, and anyone reading the markup.",
    markupOnly: true,
    count: (lines, content) => {
      const divs = (content.match(/<div[\s>]/g) || []).length;
      const landmarks = (content.match(/<(header|main|section|nav|footer|article)[\s>]/g) || []).length;
      return landmarks === 0 ? divs : 0;
    },
  },
];

/* ------------------------------------------------------------------ */
/* Scanning                                                            */
/* ------------------------------------------------------------------ */

function firstLineMatching(lines, re) {
  const idx = lines.findIndex((l) => re.test(l));
  return idx === -1 ? 1 : idx + 1;
}

/**
 * Scan one file's content. Pure: no I/O.
 * @param {string} content  file text
 * @param {string} ext      extension including the dot, e.g. ".html"
 * @param {string} rel      label reported as `file` in each finding
 * @returns {Array} findings: {file, line, rule, severity, message, hint}
 */
function scanContent(content, ext, rel) {
  const lines = content.split(/\r?\n/);
  const findings = [];

  lines.forEach((line, i) => {
    for (const rule of LINE_RULES) {
      let hit = false;
      try { hit = rule.test(line); } catch { hit = false; }
      if (hit) {
        findings.push({
          file: rel, line: i + 1, rule: rule.id, severity: rule.severity,
          message: rule.message, hint: rule.hint,
        });
      }
    }
  });

  findings.push(...interFindings(lines, rel));

  findings.push(...rtlFindings(lines, content, rel, ext));

  for (const rule of FILE_RULES) {
    if (rule.markupOnly && !MARKUP_EXTENSIONS.has(ext)) continue;
    let n = 0;
    try { n = rule.count(lines, content); } catch { n = 0; }
    if (n >= rule.threshold) {
      const anchorRes = {
        "em-dash-overuse": /—/,
        "text-center-everywhere": /text-center|text-align\s*:\s*center/,
        "flat-gray-backgrounds": /bg-(gray|slate|zinc|neutral)-(50|100)/,
        "animation-overuse": /animate-(bounce|pulse)/,
        "shadow-on-everything": /shadow-(lg|xl|2xl)/,
        "default-blue-buttons": /bg-blue-(500|600|700)/,
        "important-overuse": /!important/,
        "no-design-tokens": /#[0-9a-fA-F]{6}\b/,
        "div-soup": /<div[\s>]/,
      };
      findings.push({
        file: rel,
        line: firstLineMatching(lines, anchorRes[rule.id] || /$^/),
        rule: rule.id, severity: rule.severity,
        message: rule.message(n), hint: rule.hint,
      });
    }
  }

  findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
  return findings;
}

// === ENGINE END ===

/* ------------------------------------------------------------------ */
/* Filesystem + CLI (not part of the shared engine)                    */
/* ------------------------------------------------------------------ */

function collectFiles(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) {
    return EXTENSIONS.has(path.extname(target)) ? [target] : [];
  }
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (EXTENSIONS.has(path.extname(entry.name))) {
        out.push(path.join(dir, entry.name));
      }
    }
  };
  walk(target);
  return out.sort();
}

function scanFile(file, rootLabel) {
  const content = fs.readFileSync(file, "utf8");
  return scanContent(content, path.extname(file), rootLabel);
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function main(argv) {
  const args = argv.slice(2);
  let format = "text";
  let target = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--format") {
      format = args[++i];
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log("Usage: node bin/deslop.js [path] [--format text|json]");
      return 0;
    } else if (!args[i].startsWith("--")) {
      target = args[i];
    }
  }

  if (format !== "text" && format !== "json") {
    console.error(`deslop: unknown format "${format}" (use text or json)`);
    return 2;
  }

  if (!target) {
    const srcDir = path.join(process.cwd(), "src");
    target = fs.existsSync(srcDir) ? srcDir : process.cwd();
  }
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) {
    console.error(`deslop: path not found: ${target}`);
    return 2;
  }

  const files = collectFiles(resolved);
  const allFindings = [];
  for (const file of files) {
    const label = fs.statSync(resolved).isFile()
      ? path.basename(file)
      : path.relative(process.cwd(), file) || file;
    try {
      allFindings.push(...scanFile(file, label));
    } catch (err) {
      console.error(`deslop: could not read ${file}: ${err.message}`);
    }
  }

  const fails = allFindings.filter((f) => f.severity === "fail").length;
  const warns = allFindings.length - fails;

  if (format === "json") {
    console.log(JSON.stringify({
      tool: "deslop",
      filesScanned: files.length,
      findings: allFindings,
      summary: { fail: fails, warn: warns, total: allFindings.length },
    }, null, 2));
  } else {
    for (const f of allFindings) {
      const tag = f.severity === "fail" ? "FAIL" : "warn";
      console.log(`${f.file}:${f.line}  [${tag}] ${f.rule} — ${f.message}`);
      console.log(`    fix: ${f.hint}`);
    }
    console.log("");
    console.log(`deslop: scanned ${files.length} file(s) — ${fails} fail, ${warns} warning(s)`);
    if (allFindings.length === 0) {
      console.log("deslop: no AI design slop found. Nice work.");
    }
  }

  return fails > 0 ? 1 : 0;
}

module.exports = { scanContent, scanFile, LINE_RULES, FILE_RULES };

if (require.main === module) {
  process.exit(main(process.argv));
}
