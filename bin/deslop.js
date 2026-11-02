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

function firstLineMatching(lines, re) {
  const idx = lines.findIndex((l) => re.test(l));
  return idx === -1 ? 1 : idx + 1;
}

function scanFile(file, rootLabel) {
  const content = fs.readFileSync(file, "utf8");
  const lines = content.split(/\r?\n/);
  const rel = rootLabel;
  const ext = path.extname(file);
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

if (require.main === module) {
  process.exit(main(process.argv));
}
