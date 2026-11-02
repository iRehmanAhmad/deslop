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
 *   deslop [path] [--format text|json]
 *   deslop report <path-or-url> [--out file] [--client N] [--site N]
 *     (report mode lives in bin/deslop-report.js and writes a client-facing
 *      HTML audit report; see that file for details)
 *   deslop twins <url-or-path> [--corpus dir] [--json]
 *     (twins mode lives in bin/deslop-twins.js and fingerprints a page's
 *      layout + style signature, ranking its "layout twins"; see that file)
 *   deslop install [--claude] [--cursor] [--dry-run]
 *     (install mode lives in bin/deslop-install.js and copies SKILL.md into
 *      .claude/skills, ~/.claude/skills and optionally .cursor/rules)
 *   From source (this repo), run any of these as `node bin/deslop.js …`.
 *
 * A deslop.config.json in the scanned root (or the cwd) can ignore rules,
 * skip files, and change the exit-code policy — see "Config & waivers" in
 * README.md. Individual findings can be waived inline with a reason:
 *   deslop-ignore: <rule-id> — <why this one is deliberate>
 * (HTML/CSS/JS comment syntax all work; the waiver covers its own line and
 * the lines directly above and below it, so a standalone comment placed
 * above the block it waives works. A waiver without a reason suppresses
 * nothing and is itself reported as a `deslop-waiver-no-reason` warning.)
 *
 * - With options but no path, path defaults to ./src when it exists,
 *   otherwise the current directory. With no arguments at all, usage is
 *   printed instead of scanning.
 * - Exit code is 1 when any "fail" rule hits, 0 otherwise, 2 on usage
 *   errors (unknown option/command, missing path, nothing scanned).
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
    id: "hover-scale-boilerplate",
    severity: "warn",
    message: "hover:scale-105/110 — the stock micro-interaction sprinkled on every card and button",
    hint: "Hover feedback should say something (a colour shift, an underline, an arrow that moves). A uniform 5% swell on everything is the template's reflex, not a choice.",
    test: (line) => /\bhover:scale-(105|110)\b/.test(line) || /\bhover:scale-\[1\.(05|1)\]/.test(line),
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
    // The rule measures UI copy, not essays: em-dashes inside a long
    // prose block (a <p> or <article> carrying more than 40 words of
    // text) are excluded — a magazine article's punctuation is an
    // author's style, not a template tell.
    count: (lines, content) => {
      const total = (content.match(/—/g) || []).length;
      const blocks = [];
      const blockRe = /<(p|article)\b[^>]*>([\s\S]*?)<\/\1>/gi;
      let m;
      while ((m = blockRe.exec(content)) !== null) {
        const text = m[2].replace(/<[^>]+>/g, " ");
        const words = text.split(/\s+/).filter(Boolean).length;
        blocks.push({
          start: m.index, end: m.index + m[0].length, words,
          dashes: (m[2].match(/—/g) || []).length,
        });
      }
      // Outermost blocks first, so an <article> and the <p>s inside it
      // are never both subtracted.
      blocks.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
      let excluded = 0;
      let coveredUntil = -1;
      for (const b of blocks) {
        if (b.start < coveredUntil) continue;
        coveredUntil = b.end;
        if (b.words > 40) excluded += b.dashes;
      }
      return Math.max(0, total - excluded);
    },
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
/* 2026 defaults pack — the new default look                           */
/* ------------------------------------------------------------------ */

/**
 * The AI default look moved. The loud early tells (purple-to-blue
 * gradient, Inter) gave way to a quieter kit: a cream background under
 * a serif display face with a sage-green accent, an un-themed shadcn
 * token set shipped untouched, a badge pill floating over the hero,
 * cards edged with a thick coloured left border, hover:scale-105 on
 * every card, 01/02/03 step rows and big-stat rows — and Space
 * Grotesk, Geist or Instrument Serif standing exactly where Inter
 * stood. These rules are combo-first on purpose: cream alone is a
 * paper choice and a serif alone is a type choice; together they are
 * the 2026 template, and a scanner that convicts single signals
 * drowns in false positives. Everything in this pack is a warn.
 */

const DISPLAY_SERIFS_2026 = [
  "instrument serif", "fraunces", "playfair display", "cormorant", "eb garamond",
];
const REPLACEMENT_FONTS_2026 = {
  "space grotesk": "Space Grotesk",
  "geist": "Geist",
  "instrument serif": "Instrument Serif",
};

/**
 * Warm-white / cream hexes, matched on the first four hex digits so
 * the family (#faf6ef, #fdfaf3, #fff8e1…) is covered without
 * enumerating it. Cream is only counted where it is actually painted:
 * a background declaration, an inline style, or a bg-[#…] class —
 * never a custom-property definition, because a palette token is a
 * decision and this pack hunts the un-decided default. Pure white
 * (#ffffff) and the cool grays are not cream.
 */
const CREAM_PREFIXES = new Set([
  "fff8", "fff9", "fef9", "fefc", "fdf6", "fdf9", "fdfa",
  "faf5", "faf6", "faf7", "faf8", "faf9", "f7f2", "f7f3",
  "f6f1", "f8f4", "f8f5", "f9f5", "f9f6",
]);

function isCreamHex(hex) {
  return CREAM_PREFIXES.has(hex.toLowerCase().slice(1, 5));
}

/**
 * Muted green accent (the sage/olive family — #a3b18a, #588157,
 * #5b7553): green clearly dominant but greyed, at mid lightness.
 * Vivid greens (emerald, lime) and dark grounds (deep academia
 * green) are deliberately outside the family.
 */
function isSageHex(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (!(g > r && g >= b && g - Math.max(r, b) >= 8)) return false;
  const lightness = (max + min) / 2 / 255;
  const saturation = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
  return saturation <= 0.45 && lightness >= 0.25 && lightness <= 0.8;
}

function defaults2026Findings(lines, content, rel, ext, prior) {
  const out = [];
  const push = (line, rule, message, hint) =>
    out.push({ file: rel, line, rule, severity: "warn", message, hint });
  const stacks = fontStacks(lines);

  /* --- signals ------------------------------------------------------ */

  // Cream background, actually painted on something.
  let creamLine = 0;
  const bgRe = /(?:^|[;{"'])\s*background(?:-color)?\s*:\s*([^;}]+)/g;
  lines.forEach((line, i) => {
    if (creamLine) return;
    let m;
    bgRe.lastIndex = 0;
    while ((m = bgRe.exec(line)) !== null) {
      const hex = (m[1].match(/#[0-9a-fA-F]{6}\b/) || [])[0];
      if ((hex && isCreamHex(hex)) || /\b(cream|ivory|parchment|ecru)\b/i.test(m[1])) {
        creamLine = i + 1;
        break;
      }
    }
    if (!creamLine) {
      const arb = line.match(/\bbg-\[#([0-9a-fA-F]{6})\]/);
      if ((arb && isCreamHex("#" + arb[1])) || /\bbg-(amber|orange|yellow)-50\b/.test(line)) {
        creamLine = i + 1;
      }
    }
  });

  // Serif display face — in a font stack, or loaded via Google Fonts
  // even when the stack itself is a utility class we cannot resolve.
  let serifLine = 0;
  for (const s of stacks) {
    if (stackHas(s, DISPLAY_SERIFS_2026)) { serifLine = s.line; break; }
  }
  if (!serifLine) {
    const idx = lines.findIndex((l) =>
      /fonts\.googleapis\.com/.test(l) &&
      DISPLAY_SERIFS_2026.some((f) => l.toLowerCase().replace(/\+/g, " ").includes(f)));
    if (idx !== -1) serifLine = idx + 1;
  }

  // Sage-green accents among the file's colour values.
  let sageLine = 0;
  let sageSample = "";
  lines.forEach((line, i) => {
    for (const hex of line.match(/#[0-9a-fA-F]{6}\b/g) || []) {
      if (isSageHex(hex)) {
        if (!sageLine) { sageLine = i + 1; sageSample = hex.toLowerCase(); }
      }
    }
  });

  // Badge pill above the hero headline — computed here because it is
  // also the "third signal" that can complete the 2026 combo below.
  let badgeHit = null;
  if (MARKUP_EXTENSIONS.has(ext)) {
    const h1 = content.search(/<h1[\s>]/i);
    if (h1 > 0) {
      const before = content.slice(0, h1);
      const elRe = /<(span|div|a|p|small)\b[^>]*?class\s*=\s*["']([^"']*)["'][^>]*>([^<]{1,60})<\//gi;
      let m;
      while ((m = elRe.exec(before)) !== null) {
        const text = m[3].trim();
        if (!text) continue;
        const tokens = m[2].toLowerCase().split(/\s+/);
        const named = tokens.some((t) => /^(badge|pill|chip)(-|$)/.test(t));
        const round = tokens.includes("rounded-full") && text.length <= 40;
        if (named || round) {
          badgeHit = {
            line: before.slice(0, m.index).split("\n").length,
            text,
          };
          break;
        }
      }
    }
  }

  // Editorial exemption: cream + a serif display face is ALSO what a
  // real magazine looks like, and the combo alone cannot tell a
  // literary page from the template. A page carrying strong long-form
  // markers — substantial prose in <p>/<article> blocks (300+ words),
  // or byline / date / drop-cap furniture — is read as editorial, and
  // the combo by itself does not fire there. A third default signal
  // (a sage accent, or the badge pill over the hero) completes the
  // template anyway and lifts the exemption.
  let editorial = false;
  if (MARKUP_EXTENSIONS.has(ext)) {
    let proseWords = 0;
    const pRe = /<(?:p|article)\b[^>]*>([\s\S]*?)<\/(?:p|article)>/gi;
    let pm;
    while ((pm = pRe.exec(content)) !== null) {
      proseWords += pm[1].replace(/<[^>]+>/g, " ").split(/\s+/).filter(Boolean).length;
    }
    const markers =
      /\bbyline\b/i.test(content) ||
      /<time\b[^>]*\bdatetime\s*=/i.test(content) ||
      /\bdrop-?cap\b/i.test(content) ||
      /\bdateline\b/i.test(content);
    editorial = proseWords > 300 || markers;
  }

  /* --- cream-serif-default: the combo is the tell -------------------- */
  if (creamLine && serifLine && (!editorial || sageLine || badgeHit)) {
    push(creamLine, "cream-serif-default",
      "Cream background + serif display type — the 2026 AI default look, the combo that quietly replaced the purple gradient",
      "Break the combo decisively: keep the cream and set the display type in a grotesque with character, or keep the serif and give the page a real colour story. Changing neither is the template.");
  }

  /* --- sage-green-accent: the third member of the trio --------------- */
  if (sageLine && (creamLine || serifLine)) {
    push(sageLine, "sage-green-accent",
      `Sage-green accent (${sageSample}) alongside ${creamLine ? "a cream background" : "serif display type"} — the third member of the 2026 default trio`,
      "Sage is the new default accent. Take the accent from the brand or the subject — a rust, an ink blue, a green chosen on purpose. Muted green over cream is the template's signature.");
  }

  /* --- replacement-default-font -------------------------------------- */
  for (const s of stacks) {
    const first = s.named[0] || "";
    const hit = Object.keys(REPLACEMENT_FONTS_2026)
      .find((f) => first === f || first.startsWith(f + " "));
    if (hit) {
      push(s.line, "replacement-default-font",
        `${REPLACEMENT_FONTS_2026[hit]} as the main/display font — the post-Inter replacement default`,
        "Swapping Inter for Space Grotesk, Geist or Instrument Serif is the new tell — everyone made the same swap. Pick a face for what it says about this brand, not because it is the current default alternative.");
      break;
    }
  }

  /* --- shadcn-fingerprint -------------------------------------------- */
  {
    const tokenRes = [
      /--background\s*:\s*0\s+0%\s+100%/,
      /--foreground\s*:\s*(?:222\.2\s+84%\s+4\.9%|240\s+10%\s+3\.9%)/,
      /--primary\s*:\s*(?:222\.2\s+47\.4%\s+11\.2%|240\s+5\.9%\s+10%)/,
      /--muted\s*:\s*(?:210\s+40%\s+96\.1%|240\s+4\.8%\s+95\.9%)/,
      /--border\s*:\s*(?:214\.3\s+31\.8%\s+91\.4%|240\s+5\.9%\s+90%)/,
      /--ring\s*:\s*(?:222\.2\s+84%\s+4\.9%|240\s+5%\s+64\.9%)/,
      /--card\s*:\s*0\s+0%\s+100%/,
      /--radius\s*:\s*0\.5rem\b/,
    ];
    let tokenCount = 0;
    let tokenLine = 0;
    for (const re of tokenRes) {
      const idx = lines.findIndex((l) => re.test(l));
      if (idx !== -1) { tokenCount += 1; if (!tokenLine) tokenLine = idx + 1; }
    }
    // The stock neutral ramps as shipped hexes. A fingerprint needs the
    // ramp AND its anchor pair (foreground/primary) — four loose zinc
    // shades on their own are just grayscale.
    const ZINC = ["#fafafa", "#f4f4f5", "#e4e4e7", "#d4d4d8", "#a1a1aa",
      "#71717a", "#52525b", "#3f3f46", "#27272a", "#18181b", "#09090b"];
    const SLATE = ["#f8fafc", "#f1f5f9", "#e2e8f0", "#cbd5e1", "#94a3b8",
      "#64748b", "#475569", "#334155", "#1e293b", "#0f172a", "#020817"];
    const lower = content.toLowerCase();
    const zincCount = ZINC.filter((h) => lower.includes(h)).length;
    const slateCount = SLATE.filter((h) => lower.includes(h)).length;
    const hexHit =
      (zincCount >= 4 && (lower.includes("#09090b") || lower.includes("#18181b"))) ||
      (slateCount >= 4 && (lower.includes("#020817") || lower.includes("#0f172a")));
    if (tokenCount >= 3 || hexHit) {
      const evidence = tokenCount >= 3
        ? `${tokenCount} stock shadcn CSS variables still at their default values`
        : `the stock ${zincCount >= slateCount ? "zinc" : "slate"} palette (${Math.max(zincCount, slateCount)} shades, including the default foreground/primary pair)`;
      push(tokenLine || firstLineMatching(lines, /#[0-9a-fA-F]{6}\b/), "shadcn-fingerprint",
        `Un-themed shadcn/Tailwind default kit — ${evidence}`,
        "shadcn/ui is a starting point, not a theme. Change the tokens (background, foreground, primary, radius) to the brand's own values — an untouched token set is the most common AI-default tell there is.");
    }
  }

  /* --- hero-badge-pill ------------------------------------------------ */
  if (badgeHit) {
    push(badgeHit.line, "hero-badge-pill",
      `Badge pill floating above the hero headline ("${badgeHit.text}") — the "✦ Introducing…" default`,
      "If the news is real, put it in the headline or a dated changelog entry. A pill above the H1 that says 'New' or 'AI-powered' is decoration dressed as news.");
  }

  /* --- left-border-accent-card ---------------------------------------- */
  {
    // In RTL files the accent-edge story belongs to the RTL pack (the
    // inline-start edge is the honest one there); this rule is LTR-only.
    const isRTL = ARABIC_SCRIPT_RE.test(content) || RTL_LANG_RE.test(content) ||
      /\bdir\s*=\s*["']rtl["']/i.test(content);
    if (!isRTL) {
      let count = 0;
      let anchor = 0;
      lines.forEach((line, i) => {
        const css = line.match(/border-left\s*:\s*(\d+(?:\.\d+)?)px\s+solid/i);
        const tw = /\bborder-l-(?:4|8)\b/.test(line) ||
          /\bborder-l-\[(?:[3-9]|\d{2,})px\]/.test(line);
        if ((css && parseFloat(css[1]) >= 3) || tw) {
          count += 1;
          if (!anchor) anchor = i + 1;
        }
      });
      // One bordered quote is a style; two or more is a system.
      if (count >= 2) {
        push(anchor, "left-border-accent-card",
          `${count} elements with a thick coloured left border — the coloured-edge card default`,
          "A coloured left edge on every card is a system, not an accent. Use a full hairline border, a top rule or a background tint instead — and keep one device per page.");
      }
    }
  }

  /* --- numbered-steps-row ---------------------------------------------- */
  {
    // Swiss grids and workshop catalogues number things honestly, so
    // this only fires alongside other generic landing-page findings:
    // the row has to arrive with the rest of the template.
    const gate = prior.some((f) =>
      ["generic-cta", "ai-copy-words", "eyebrow-label", "generic-social-proof", "inter-only-font"]
        .includes(f.rule));
    if (gate && MARKUP_EXTENSIONS.has(ext)) {
      const body = content
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<script[\s\S]*?<\/script>/gi, "");
      const numerals = [...body.matchAll(/>\s*(0[1-4])\s*</g)].map((x) => x[1]);
      const seq = ["01", "02", "03"].every((n) => numerals.includes(n));
      const stepWords = (body.match(/\b(?:step|phase)\s*[1-4]\b/gi) || []).length;
      const stats = (body.match(/\b\d[\d,.]*\s*(?:%|\+|k\+|m\+|x\b)/gi) || []).length;
      if (seq || stepWords >= 3 || stats >= 3) {
        const what = seq || stepWords >= 3
          ? "01 / 02 / 03 numbered-steps"
          : `${stats}-big-number stat`;
        const anchorLine = seq
          ? firstLineMatching(lines, />\s*0[1-4]\s*</)
          : stepWords >= 3
            ? firstLineMatching(lines, /\b(?:step|phase)\s*[1-4]\b/i)
            : firstLineMatching(lines, /\d[\d,.]*\s*(?:%|\+)/);
        push(anchorLine, "numbered-steps-row",
          `The ${what} row — stock section furniture of the template landing page`,
          "Numbers earn their place when they are real: steps that actually happen, in order, or stats that are actually true. If the row exists because the template had one, cut it or fill it with specifics.");
      }
    }
  }

  return out;
}

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

  findings.push(...defaults2026Findings(lines, content, rel, ext, findings));

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
/* Config file (deslop.config.json) + inline waivers                   */
/* ------------------------------------------------------------------ */

const CONFIG_NAME = "deslop.config.json";
const KNOWN_CONFIG_KEYS = new Set(["ignore", "ignoreFiles", "failOn"]);

/**
 * Find deslop.config.json: the scanned root first (the target directory,
 * or the target file's directory), then the current directory.
 * Returns { config, error } — config is null when no file exists;
 * error is a message string when a found file is unusable (exit 2).
 */
function loadConfig(resolved, isDir) {
  const rootDir = isDir ? resolved : path.dirname(resolved);
  const candidates = [path.join(rootDir, CONFIG_NAME)];
  const cwdCfg = path.join(process.cwd(), CONFIG_NAME);
  if (cwdCfg !== candidates[0]) candidates.push(cwdCfg);
  const cfgPath = candidates.find((c) => fs.existsSync(c));
  if (!cfgPath) return { config: null, error: null };

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
  } catch (err) {
    return { config: null, error: `deslop: invalid JSON in ${cfgPath}: ${err.message}` };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { config: null, error: `deslop: ${cfgPath} must contain a JSON object` };
  }

  for (const key of Object.keys(parsed)) {
    if (!KNOWN_CONFIG_KEYS.has(key)) {
      console.error(`deslop: warning: unknown config key "${key}" in ${cfgPath} (ignored)`);
    }
  }
  const config = { ignore: [], ignoreFiles: [], failOn: "fail", path: cfgPath };
  for (const key of ["ignore", "ignoreFiles"]) {
    if (parsed[key] === undefined) continue;
    if (Array.isArray(parsed[key]) && parsed[key].every((x) => typeof x === "string")) {
      config[key] = parsed[key];
    } else {
      console.error(`deslop: warning: "${key}" in ${cfgPath} must be an array of strings (ignored)`);
    }
  }
  if (parsed.failOn !== undefined) {
    if (parsed.failOn === "fail" || parsed.failOn === "any") {
      config.failOn = parsed.failOn;
    } else {
      console.error(`deslop: warning: "failOn" in ${cfgPath} must be "fail" or "any" (using "fail")`);
    }
  }
  return { config, error: null };
}

/** Convert a glob to a RegExp. Supports **, * and ?. */
function globToRegExp(glob) {
  const g = glob.replace(/\\/g, "/");
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        if (g[i + 2] === "/") { re += "(?:.*/)?"; i += 2; }
        else { re += ".*"; i += 1; }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`);
}

/**
 * Does `file` match any ignoreFiles glob? Patterns without a slash match
 * the basename anywhere; patterns with a slash match the path relative to
 * the scanned root (or to the cwd), forward-slash normalised.
 */
function fileIgnoredByGlobs(file, globs, rootDir) {
  const candidates = new Set([path.basename(file)]);
  for (const base of [rootDir, process.cwd()]) {
    const rel = path.relative(base, file).replace(/\\/g, "/");
    if (rel && !rel.startsWith("..")) candidates.add(rel);
  }
  return globs.some((glob) => {
    const re = globToRegExp(glob);
    if (!glob.includes("/")) return re.test(path.basename(file));
    return [...candidates].some((c) => re.test(c));
  });
}

/**
 * Parse inline waivers from a file's lines.
 *
 *   deslop-ignore: <rule-id>[, <rule-id>] — <reason>
 *
 * works inside any comment syntax (<!-- -->, /* *\/, //) because the token
 * is matched in the raw line text. A waiver covers findings on its OWN
 * line, the line ABOVE it and the line BELOW it — so it can sit trailing
 * on the offending line itself, on the line after a declaration block,
 * or as a standalone comment directly above the block it waives (the
 * pattern the README documents).
 * The reason is REQUIRED: the rule list must be followed by a spaced
 * em dash (—), en dash (–) or hyphen (-) and non-empty text. A waiver
 * without a reason suppresses nothing and is returned as a problem.
 *
 * Returns { covered: Map<lineNo, Set<ruleId>>, problems: [{line, rules}] }.
 */
function parseWaivers(content) {
  const lines = content.split(/\r?\n/);
  const covered = new Map();
  const problems = [];
  lines.forEach((line, idx) => {
    const m = line.match(/deslop-ignore:\s*(.+)$/);
    if (!m) return;
    let rest = m[1].trim().replace(/(\*\/|-->)\s*$/, "").trim();
    const sep = rest.match(/^(.*?)\s+(?:—|–|-)\s+(\S.*)$/);
    let rulesPart = rest;
    let reason = "";
    if (sep) {
      rulesPart = sep[1];
      reason = sep[2].trim();
    }
    const rules = rulesPart.split(",").map((s) => s.trim()).filter(Boolean);
    const lineNo = idx + 1;
    if (!reason || rules.length === 0) {
      problems.push({ line: lineNo, rules });
      return;
    }
    for (const ln of [lineNo, lineNo - 1, lineNo + 1]) {
      if (ln < 1) continue;
      if (!covered.has(ln)) covered.set(ln, new Set());
      for (const r of rules) covered.get(ln).add(r);
    }
  });
  return { covered, problems };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

function printHelp() {
  console.log("Usage:");
  console.log("  deslop [path] [--format text|json]");
  console.log("  deslop report <path-or-url> [--out report.html] [--client \"Name\"] [--site \"Name\"]");
  console.log("    report writes a client-facing HTML audit report (see bin/deslop-report.js)");
  console.log("  deslop twins <url-or-path> [--corpus <dir>] [--json]");
  console.log("    twins fingerprints a page's layout + style and ranks its layout twins (see bin/deslop-twins.js)");
  console.log("  deslop install [--claude] [--cursor] [--dry-run]");
  console.log("    install copies the deslop agent skill into .claude/skills, ~/.claude/skills (and .cursor/rules with --cursor)");
  console.log("");
  console.log("With options but no path, the scan path defaults to ./src when it");
  console.log("exists, otherwise the current directory. With no arguments at all,");
  console.log("this usage text is printed instead of scanning.");
  console.log("");
  console.log("Config: a deslop.config.json in the scanned root or cwd supports");
  console.log('  { "ignore": ["rule-id"], "ignoreFiles": ["glob"], "failOn": "fail" | "any" }');
  console.log("Inline waiver: deslop-ignore: <rule-id> — <reason>");
  console.log("  (covers the waiver's own line and the lines directly above and below it).");
  console.log("");
  console.log("From source (this repo), run any command as `node bin/deslop.js …`.");
}

function main(argv) {
  const args = argv.slice(2);

  // `deslop report <path-or-url> ...` hands off to the audit-report
  // generator. A folder literally named "report" can still be scanned via
  // an explicit path such as ./report.
  if (args[0] === "report") {
    return require("./deslop-report.js").run(args.slice(1));
  }

  // `deslop twins <url-or-path> ...` hands off to Visual Twins
  // (bin/deslop-twins.js). A folder literally named "twins" can still be
  // scanned via an explicit path such as ./twins.
  if (args[0] === "twins") {
    return require("./deslop-twins.js").run(args.slice(1));
  }

  // `deslop install ...` copies the agent skill into .claude/skills,
  // ~/.claude/skills and (with --cursor) .cursor/rules. A folder literally
  // named "install" can still be scanned via ./install.
  if (args[0] === "install") {
    return require("./deslop-install.js").run(args.slice(1));
  }

  // No arguments at all: print usage. Silently scanning the cwd made a
  // bare `deslop` in the wrong folder look like a clean bill of health.
  if (args.length === 0) {
    printHelp();
    return 0;
  }

  let format = "text";
  let target = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--format") {
      const value = args[++i];
      if (value === undefined) {
        console.error("deslop: --format needs a value (text or json)");
        return 2;
      }
      format = value;
    } else if (a === "--help" || a === "-h") {
      printHelp();
      return 0;
    } else if (a.startsWith("--")) {
      // An unknown flag must never be silently ignored: in CI a typo'd
      // flag would otherwise scan the wrong thing and pass.
      console.error(`deslop: unknown option "${a}" (run "deslop --help" for usage)`);
      return 2;
    } else if (target === null) {
      target = a;
    } else {
      console.error(`deslop: one path at a time (got "${target}" and "${a}")`);
      return 2;
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
    // A bare word with no path separators and no extension is almost
    // certainly a mistyped subcommand, not a folder — say which
    // commands exist instead of blaming a path.
    if (!target.includes("/") && !target.includes("\\") && !target.includes(".")) {
      console.error(`deslop: unknown command "${target}"`);
      console.error("commands: deslop [path] (scan) · deslop report <path-or-url> · deslop twins <url-or-path> · deslop install — or give a path to scan (run \"deslop --help\")");
    } else {
      console.error(`deslop: path not found: ${target}`);
    }
    return 2;
  }

  const isDirTarget = fs.statSync(resolved).isDirectory();

  // deslop.config.json (scanned root, else cwd) — a malformed config is a
  // hard error: silently ignoring it would hide the user's intent.
  const { config, error: configError } = loadConfig(resolved, isDirTarget);
  if (configError) {
    console.error(configError);
    return 2;
  }

  let files = collectFiles(resolved);
  let filesSkipped = 0;
  if (config && config.ignoreFiles.length > 0) {
    const rootDir = isDirTarget ? resolved : path.dirname(resolved);
    const kept = files.filter((f) => !fileIgnoredByGlobs(f, config.ignoreFiles, rootDir));
    filesSkipped = files.length - kept.length;
    files = kept;
  }

  // False-clean guard: a scan that covered nothing must never report
  // "no AI design slop found" — in the wrong folder that sentence reads
  // as a clean bill of health for files that were never looked at.
  if (files.length === 0) {
    console.error(
      `deslop: nothing was scanned — 0 files matched under ${target} ` +
      "(deslop reads .css/.scss/.html/.jsx/.tsx/.vue/.astro/.svelte" +
      (filesSkipped > 0
        ? `; ${filesSkipped} file(s) were skipped by ignoreFiles in deslop.config.json`
        : "") +
      "). A 'no findings' result here would mean nothing — point deslop at your UI source files."
    );
    return 2;
  }

  const allFindings = [];
  let waivedCount = 0;
  for (const file of files) {
    const label = !isDirTarget
      ? path.basename(file)
      : path.relative(process.cwd(), file) || file;
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch (err) {
      console.error(`deslop: could not read ${file}: ${err.message}`);
      continue;
    }
    const findings = scanContent(content, path.extname(file), label);
    const { covered, problems } = parseWaivers(content);
    for (const p of problems) {
      findings.push({
        file: label,
        line: p.line,
        rule: "deslop-waiver-no-reason",
        severity: "warn",
        message: `deslop-ignore waiver${p.rules.length ? ` for ${p.rules.join(", ")}` : ""} has no reason — a waiver without a reason suppresses nothing`,
        hint: "Waivers must say why: deslop-ignore: <rule-id> — <reason>. If the pattern is deliberate design, one line saying so is enough.",
      });
    }
    findings.sort((a, b) => a.line - b.line || a.rule.localeCompare(b.rule));
    for (const f of findings) {
      const waivedBy = covered.get(f.line);
      if (waivedBy && waivedBy.has(f.rule)) {
        waivedCount++;
      } else {
        allFindings.push(f);
      }
    }
  }

  // An un-themed shadcn kit also leaves components.json at the project
  // root — not a file the scanner reads as source. When scanning a
  // directory, a stock baseColor there is the same fingerprint the
  // engine hunts in the token values themselves.
  if (fs.statSync(resolved).isDirectory()) {
    const cjPath = path.join(resolved, "components.json");
    if (fs.existsSync(cjPath)) {
      try {
        const raw = fs.readFileSync(cjPath, "utf8");
        const cj = JSON.parse(raw);
        const base = String((cj.tailwind && cj.tailwind.baseColor) || "").toLowerCase();
        if (["slate", "zinc", "neutral", "gray", "stone"].includes(base)) {
          const ln = raw.split(/\r?\n/).findIndex((l) => l.includes("baseColor"));
          allFindings.push({
            file: "components.json",
            line: ln === -1 ? 1 : ln + 1,
            rule: "shadcn-fingerprint",
            severity: "warn",
            message: `components.json carries the stock baseColor '${base}' — an un-themed shadcn/ui kit lives here; check whether its design tokens were ever themed`,
            hint: "shadcn/ui is a starting point, not a theme. Change the tokens (background, foreground, primary, radius) to the brand's own values — an untouched token set is the most common AI-default tell there is.",
          });
        }
      } catch { /* an unreadable components.json is evidence of nothing */ }
    }
  }

  // Config "ignore" drops whole rules, across every file, after waivers.
  let configIgnoredCount = 0;
  let finalFindings = allFindings;
  if (config && config.ignore.length > 0) {
    const ignoreSet = new Set(config.ignore);
    finalFindings = allFindings.filter((f) => !ignoreSet.has(f.rule));
    configIgnoredCount = allFindings.length - finalFindings.length;
  }

  const fails = finalFindings.filter((f) => f.severity === "fail").length;
  const warns = finalFindings.length - fails;

  if (format === "json") {
    const summary = { fail: fails, warn: warns, total: finalFindings.length };
    if (waivedCount > 0) summary.waived = waivedCount;
    if (configIgnoredCount > 0) summary.ignoredByConfig = configIgnoredCount;
    console.log(JSON.stringify({
      tool: "deslop",
      filesScanned: files.length,
      findings: finalFindings,
      summary,
    }, null, 2));
  } else {
    for (const f of finalFindings) {
      const tag = f.severity === "fail" ? "FAIL" : "warn";
      console.log(`${f.file}:${f.line}  [${tag}] ${f.rule} — ${f.message}`);
      console.log(`    fix: ${f.hint}`);
    }
    console.log("");
    console.log(`deslop: scanned ${files.length} file(s) — ${fails} fail, ${warns} warning(s)`);
    if (waivedCount > 0) {
      console.log(`deslop: ${waivedCount} finding(s) waived by inline waivers`);
    }
    if (configIgnoredCount > 0) {
      console.log(`deslop: ${configIgnoredCount} finding(s) ignored by deslop.config.json`);
    }
    if (filesSkipped > 0) {
      console.log(`deslop: ${filesSkipped} file(s) skipped by ignoreFiles in deslop.config.json`);
    }
    if (finalFindings.length === 0) {
      console.log("deslop: no AI design slop found. Nice work.");
    }
  }

  // Exit policy: failOn "fail" (default) fails on FAIL findings only;
  // failOn "any" fails on any remaining finding, warnings included.
  if (config && config.failOn === "any") {
    return finalFindings.length > 0 ? 1 : 0;
  }
  return fails > 0 ? 1 : 0;
}

module.exports = {
  scanContent, scanFile, collectFiles, LINE_RULES, FILE_RULES,
  loadConfig, parseWaivers, globToRegExp, fileIgnoredByGlobs,
};

if (require.main === module) {
  const result = main(process.argv);
  // Report mode is async (it may fetch a URL); the scanner path is not.
  if (result && typeof result.then === "function") {
    result.then(
      (code) => process.exit(code),
      (err) => { console.error(`deslop: ${err.message}`); process.exit(2); }
    );
  } else {
    process.exit(result);
  }
}
