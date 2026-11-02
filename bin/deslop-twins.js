#!/usr/bin/env node
/**
 * deslop-twins — Visual Twins: fingerprint a page's layout + style
 * signature and rank how similar it is to other pages.
 *
 *   node bin/deslop.js twins <url-or-path> [--corpus <dir>] [--json]
 *   node bin/deslop-twins.js <url-or-path> [same options]
 *
 * The fingerprint is computed from SOURCE (fetched HTML + same-origin CSS,
 * or a local HTML file + its local stylesheets) — no headless browser, no
 * screenshots, no ML. It captures five cheap, deterministic signals:
 *
 *   1. DOM skeleton   landmark tags (header/nav/main/section/article/
 *                     aside/footer) in document order, their counts, and a
 *                     nesting-depth histogram — hashed into a short id.
 *   2. Section pattern  the ordered list of recognised page blocks:
 *                     hero, logos, features-grid, testimonials, pricing,
 *                     faq, cta, footer (class/id/heading heuristics,
 *                     documented in detectSections below).
 *   3. Palette        the top 6 colours by frequency across CSS, inline
 *                     styles and colour utility classes, normalised hex.
 *   4. Fonts          the set of named font families actually referenced.
 *   5. Radius/shadow  the most common border-radius values, and whether
 *                     box shadows are used at all.
 *
 * Similarity is a weighted blend (documented in WEIGHTS below):
 * section pattern 40%, palette 25%, fonts 15%, structure 20% — where the
 * structure component is the DOM skeleton (70%) blended with the
 * radius/shadow signature (30%).
 *
 * Honest limits: this compares source signatures, not rendered pixels.
 * Two pages can share a fingerprint and still look different in detail,
 * and a page built entirely from a JS framework's runtime styles can
 * fingerprint "thinner" than it renders. Treat the score as "how much of
 * the same template DNA", not a visual diff.
 *
 * URL fetching reuses the web checker's approach (same code lineage as
 * bin/deslop-report.js): public http(s) only, private addresses refused,
 * every redirect hop re-validated, byte-capped responses.
 *
 * Requires Node >= 18. No npm packages.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");
const dns = require("dns").promises;

const MAX_HTML_BYTES = 512 * 1024;
const MAX_CSS_BYTES = 256 * 1024;
const MAX_CSS_FILES = 5;
const FETCH_TIMEOUT_MS = 10000;

const HELP = `Usage:
  node bin/deslop.js twins <url-or-path> [--corpus <dir>] [--json]
  node bin/deslop-twins.js <url-or-path> [same options]

Fingerprints the page (layout skeleton, section pattern, palette, fonts,
radius/shadows) and ranks its "layout twins" from the built-in archetype
corpus in twins-corpus/ plus, with --corpus, every fingerprint JSON in a
folder of your own. Exit code 0 on success, 2 on usage or fetch errors.`;

/* ------------------------------------------------------------------ */
/* Similarity weights (documented in README — keep the two in sync)    */
/* ------------------------------------------------------------------ */

const WEIGHTS = {
  sections: 0.4, // ordered section pattern
  palette: 0.25, // top-colour overlap
  fonts: 0.15, // font-family set overlap
  structure: 0.2, // skeleton (70%) + radius/shadow signature (30%)
};
const STRUCTURE_SKELETON_SHARE = 0.7;

/* ------------------------------------------------------------------ */
/* Tiny DOM — just enough tree for skeleton + section heuristics       */
/* ------------------------------------------------------------------ */

const VOID_TAGS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);

/**
 * Parse HTML into a minimal element tree. Deliberately forgiving: this is
 * a heuristic fingerprint, not a validator. Text is kept per-element so
 * section heuristics can look for prices, headings, etc.
 */
function parseHtml(html) {
  const src = String(html)
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript\s*>/gi, " ");
  // <style> contents are CSS, not text — lift them out for the CSS pass.
  const styleBlocks = [];
  const noStyles = src.replace(/<style\b[^>]*>([\s\S]*?)<\/style\s*>/gi, (_, css) => {
    styleBlocks.push(css);
    return " ";
  });

  const root = { tag: "#root", attrs: {}, children: [], text: "", depth: 0 };
  const stack = [root];
  const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|([^<]+)/g;
  let m;
  while ((m = tagRe.exec(noStyles)) !== null) {
    if (m[4] !== undefined) {
      const t = m[4].replace(/\s+/g, " ").trim();
      if (t) stack[stack.length - 1].text += (stack[stack.length - 1].text ? " " : "") + t;
      continue;
    }
    const tag = m[2].toLowerCase();
    if (m[1] === "/") {
      // Close: pop up to the matching open tag (forgiving of misnesting).
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) { stack.length = i; break; }
      }
      continue;
    }
    const attrs = {};
    const attrRe = /([a-zA-Z-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let a;
    while ((a = attrRe.exec(m[3] || "")) !== null) {
      attrs[a[1].toLowerCase()] = a[2] !== undefined ? a[2] : a[3];
    }
    const node = {
      tag, attrs, children: [], text: "",
      depth: stack[stack.length - 1].depth + 1,
    };
    stack[stack.length - 1].children.push(node);
    const selfClosing = /\/\s*$/.test(m[3] || "");
    if (!VOID_TAGS.has(tag) && !selfClosing) stack.push(node);
  }
  return { root, styleBlocks };
}

function walk(node, fn) {
  fn(node);
  for (const child of node.children) walk(child, fn);
}

function subtreeText(node) {
  let out = node.text || "";
  for (const child of node.children) out += " " + subtreeText(child);
  return out;
}

function countTag(node, tag) {
  let n = 0;
  walk(node, (el) => { if (el.tag === tag) n += 1; });
  return n;
}

/* ------------------------------------------------------------------ */
/* Fingerprint pieces                                                  */
/* ------------------------------------------------------------------ */

const LANDMARKS = ["header", "nav", "main", "section", "article", "aside", "footer"];

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Landmark sequence + counts + depth histogram, hashed to a short id. */
function skeletonOf(root) {
  const sequence = [];
  const counts = {};
  for (const t of LANDMARKS) counts[t] = 0;
  let divs = 0;
  let maxDepth = 0;
  const depthHist = {};
  walk(root, (n) => {
    if (n.tag === "#root") return;
    maxDepth = Math.max(maxDepth, n.depth);
    const d = Math.min(n.depth, 12);
    depthHist[d] = (depthHist[d] || 0) + 1;
    if (n.tag === "div") divs += 1;
    if (LANDMARKS.includes(n.tag)) {
      counts[n.tag] += 1;
      sequence.push(`${n.tag}@${n.depth}`);
    }
  });
  // Compact skeleton string: runs of the same landmark collapse to ×n.
  const compact = [];
  for (const item of sequence) {
    const last = compact[compact.length - 1];
    if (last && last.item === item) last.n += 1;
    else compact.push({ item, n: 1 });
  }
  const str = compact.map((c) => (c.n > 1 ? `${c.item}×${c.n}` : c.item)).join(" ");
  return {
    id: "skel:" + fnv1a(str + "|" + JSON.stringify(depthHist)),
    string: str,
    sequence: sequence.map((s) => s.split("@")[0]),
    counts, divs, maxDepth, depthHist,
  };
}

/*
 * Section detection heuristics — simple and deliberately transparent:
 * a "block" is an outermost section/header/footer container, or a
 * div/article that is not merely a page wrapper (a div wrapping 2+
 * structural children, or a lone <main>, is descended into instead;
 * semantic landmarks are always blocks and are never descended into).
 * Class/id hints are read from the block's OWN attributes (a "price"
 * paragraph inside a hero does not make it a pricing block); text signals
 * (price strings, <details>) use the whole subtree. Each block is
 * classified by the FIRST matching rule:
 *
 *   footer        <footer> tag, or class/id mentions "footer"
 *   logos         class/id mentions logo / brands / trusted / clients
 *   testimonials  class/id mentions testimonial / review / quote
 *   faq           class/id mentions faq / accordion, or has <details>
 *   pricing       class/id mentions pricing / price / plans, or the block
 *                 contains 2+ price strings ($…/mo, £…, €…)
 *   cta           class/id mentions cta / call-to-action / get-started /
 *                 signup / banner
 *   features-grid class/id mentions feature, or a heading plus 3+ card
 *                 children (cards = div/article children; a grid of pure
 *                 <article> children is an article index, not features)
 *   hero          the earliest still-unclassified block holding the
 *                 page's first <h1>
 */
const SECTION_RULES = [
  ["footer", (b) => b.tag === "footer" || /\bfooter\b/.test(b.hint)],
  ["logos", (b) => /(logo|brand|trusted|clients|partners)/.test(b.hint)],
  ["testimonials", (b) => /(testimonial|review|quote|wall-of-love)/.test(b.hint)],
  ["faq", (b) => /(faq|accordion|questions)/.test(b.hint) || b.details > 0],
  ["pricing", (b) => /(pricing|price|plans|tiers)/.test(b.hint) || b.prices >= 2],
  ["cta", (b) => /(cta|call-to-action|get-started|sign-up|signup|join-us|banner)/.test(b.hint)],
  ["features-grid", (b) =>
    /\bfeatures?\b/.test(b.hint) ||
    (b.hasHeading && b.cards >= 3 && !b.allArticleCards)],
];

function collectBlocks(root) {
  const CANDIDATE = new Set(["section", "header", "footer", "article", "div"]);
  const blocks = [];
  const visit = (node) => {
    for (const child of node.children) {
      // Semantic landmarks are always blocks — never descend into them,
      // or a header's inner divs would pollute the pattern.
      if (child.tag === "section" || child.tag === "header" || child.tag === "footer") {
        blocks.push(child);
        continue;
      }
      if (CANDIDATE.has(child.tag)) {
        // A div/article wrapping 2+ structural children (or a lone <main>)
        // is a page wrapper, not a block — descend into it.
        const structural = child.children.filter(
          (c) => CANDIDATE.has(c.tag) || c.tag === "main"
        ).length;
        const onlyMain = child.children.length > 0 &&
          child.children.every((c) => c.tag === "main" || !CANDIDATE.has(c.tag)) &&
          child.children.some((c) => c.tag === "main");
        if (structural >= 2 || onlyMain) { visit(child); continue; }
        blocks.push(child);
      } else {
        visit(child);
      }
    }
  };
  visit(root);
  return blocks;
}

function detectSections(root) {
  const raw = collectBlocks(root);
  const firstH1Block = raw.find((b) => countTag(b, "h1") > 0) || null;
  const out = [];
  for (const b of raw) {
    // Class hints come from the block's OWN class/id only: subtree classes
    // false-fire (a "price" paragraph inside a hero is not a pricing
    // block). Text-based signals (price strings, <details>) still use the
    // whole subtree.
    const hint = ((b.attrs.class || "") + " #" + (b.attrs.id || "")).toLowerCase();
    // Cards: the block's div/article children — or, when the grid sits in
    // one inner container div (the common template shape), that
    // container's div/article children, whichever count is larger.
    let cardSet = b.children.filter((c) => c.tag === "div" || c.tag === "article");
    for (const c of b.children) {
      if (c.tag !== "div") continue;
      const inner = c.children.filter((g) => g.tag === "div" || g.tag === "article");
      if (inner.length > cardSet.length) cardSet = inner;
    }
    const info = {
      tag: b.tag,
      hint,
      hasHeading: countTag(b, "h1") + countTag(b, "h2") > 0,
      cards: cardSet.length,
      allArticleCards: cardSet.length > 0 && cardSet.every((c) => c.tag === "article"),
      details: countTag(b, "details"),
      prices: (subtreeText(b).match(/[$£€]\s?\d/g) || []).length,
    };
    let type = null;
    for (const [name, test] of SECTION_RULES) {
      if (test(info)) { type = name; break; }
    }
    if (!type && b === firstH1Block) type = "hero";
    if (type && out[out.length - 1] !== type) out.push(type);
  }
  return out;
}

/* --- palette --- */

// A compact slice of the Tailwind colour scale — the utilities AI
// builders actually reach for — so class-based pages fingerprint too.
const TAILWIND_COLORS = {
  "violet-500": "#8b5cf6", "violet-600": "#7c3aed", "purple-500": "#a855f7",
  "purple-600": "#9333ea", "indigo-500": "#6366f1", "indigo-600": "#4f46e5",
  "fuchsia-500": "#d946ef", "blue-500": "#3b82f6", "blue-600": "#2563eb",
  "sky-500": "#0ea5e9", "cyan-500": "#06b6d4", "teal-500": "#14b8a6",
  "emerald-500": "#10b981", "green-500": "#22c55e", "amber-500": "#f59e0b",
  "orange-500": "#f97316", "red-500": "#ef4444", "rose-500": "#f43f5e",
  "pink-500": "#ec4899", "gray-50": "#f9fafb", "gray-100": "#f3f4f6",
  "gray-200": "#e5e7eb", "gray-500": "#6b7280", "gray-900": "#111827",
  "slate-50": "#f8fafc", "slate-100": "#f1f5f9", "slate-900": "#0f172a",
  "zinc-50": "#fafafa", "zinc-100": "#f4f4f5", "zinc-200": "#e4e4e7",
  "zinc-800": "#27272a", "zinc-900": "#18181b", "zinc-950": "#09090b",
  "neutral-100": "#f5f5f5", "neutral-900": "#171717",
  "black": "#000000", "white": "#ffffff",
};

function normalizeHex(raw) {
  let h = raw.toLowerCase();
  if (h.length === 4) h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  return h;
}

function paletteOf(cssText, htmlText) {
  const freq = new Map();
  const add = (hex, n) => freq.set(hex, (freq.get(hex) || 0) + n);
  const scan = (text) => {
    for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) add(normalizeHex(m[0]), 1);
    for (const m of text.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
      add("#" + [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, "0")).join(""), 1);
    }
  };
  scan(cssText);
  scan(htmlText.replace(/<style\b[\s\S]*?<\/style\s*>/gi, " ")); // inline styles + arbitrary classes
  for (const m of htmlText.matchAll(/\b(?:bg|text|border|from|via|to)-([a-z]+-\d+|black|white)\b/g)) {
    const hex = TAILWIND_COLORS[m[1]];
    if (hex) add(hex, 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 6)
    .map(([hex]) => hex);
}

/* --- fonts --- */

const GENERIC_FONTS = new Set([
  "sans-serif", "serif", "monospace", "cursive", "fantasy", "system-ui",
  "ui-sans-serif", "ui-serif", "ui-monospace", "-apple-system",
  "blinkmacsystemfont", "inherit", "initial", "emoji", "math",
]);

function fontsOf(cssText, htmlText) {
  const fonts = new Set();
  const addStack = (stack) => {
    for (const part of stack.split(",")) {
      const name = part.trim().replace(/["']/g, "").replace(/\s+/g, " ");
      if (!name || name.startsWith("var(")) continue;
      if (GENERIC_FONTS.has(name.toLowerCase())) continue;
      fonts.add(name);
    }
  };
  for (const m of cssText.matchAll(/font-family\s*:\s*([^;}]+)/g)) addStack(m[1]);
  for (const m of htmlText.matchAll(/font-family\s*:\s*([^;"'}]+)/g)) addStack(m[1]);
  // Google Fonts links carry the families even when CSS uses variables.
  for (const m of htmlText.matchAll(/fonts\.googleapis\.com\/css2?\?([^"'\s]+)/g)) {
    for (const fam of m[1].matchAll(/family=([^:&]+)/g)) {
      fonts.add(decodeURIComponent(fam[1]).replace(/\+/g, " "));
    }
  }
  return [...fonts].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

/* --- radius / shadow --- */

const TAILWIND_RADIUS = {
  "rounded-none": "0px", "rounded-sm": "2px", "rounded": "4px",
  "rounded-md": "6px", "rounded-lg": "8px", "rounded-xl": "12px",
  "rounded-2xl": "16px", "rounded-3xl": "24px", "rounded-full": "9999px",
};

function radiusShadowOf(cssText, htmlText) {
  const freq = new Map();
  const add = (v) => freq.set(v, (freq.get(v) || 0) + 1);
  for (const m of cssText.matchAll(/border-radius\s*:\s*([^;}]+)/g)) {
    add(m[1].trim().replace(/\s+/g, " ").toLowerCase());
  }
  for (const m of htmlText.matchAll(/\brounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?\b/g)) {
    add(TAILWIND_RADIUS[m[0]]);
  }
  for (const m of htmlText.matchAll(/\brounded-\[([^\]]+)\]/g)) add(m[1].toLowerCase());
  const radius = [...freq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 3)
    .map(([v]) => v);
  const shadows =
    /box-shadow\s*:\s*(?!none\b)/.test(cssText) ||
    /\bshadow-(?:sm|md|lg|xl|2xl|inner)\b/.test(htmlText) ||
    /\bshadow\b/.test(htmlText);
  return { radius, shadows };
}

/** Build the full fingerprint from an HTML document + its CSS text. */
function fingerprint(html, cssText) {
  const { root, styleBlocks } = parseHtml(html);
  const css = [cssText || "", ...styleBlocks].join("\n");
  const skeleton = skeletonOf(root);
  return {
    version: 1,
    skeleton: {
      id: skeleton.id,
      string: skeleton.string,
      sequence: skeleton.sequence,
      counts: skeleton.counts,
      divs: skeleton.divs,
      maxDepth: skeleton.maxDepth,
      depthHist: skeleton.depthHist,
    },
    sections: detectSections(root),
    palette: paletteOf(css, html),
    fonts: fontsOf(css, html),
    radius: radiusShadowOf(css, html).radius,
    shadows: radiusShadowOf(css, html).shadows,
  };
}

/* ------------------------------------------------------------------ */
/* Similarity                                                          */
/* ------------------------------------------------------------------ */

function lcsLength(a, b) {
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    }
    prev = cur;
  }
  return prev[b.length];
}

/** One longest common subsequence (for explaining section matches). */
function lcsSequence(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const out = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { out.unshift(a[i - 1]); i -= 1; j -= 1; }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i -= 1;
    else j -= 1;
  }
  return out;
}

function jaccard(a, b) {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  return inter / (A.size + B.size - inter);
}

function hexToRgb(hex) {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
}

/** 1 = exact, 0.5 = near (every channel within 24), 0 = different. */
function colorMatch(a, b) {
  if (a === b) return 1;
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return ca.every((v, i) => Math.abs(v - cb[i]) <= 24) ? 0.5 : 0;
}

function paletteSimilarity(pa, pb) {
  if (pa.length === 0 && pb.length === 0) return { score: 1, matches: 0, of: 0 };
  if (pa.length === 0 || pb.length === 0) return { score: 0, matches: 0, of: Math.max(pa.length, pb.length) };
  const bestAvg = (from, to) =>
    from.reduce((sum, c) => sum + Math.max(...to.map((o) => colorMatch(c, o))), 0) / from.length;
  const score = (bestAvg(pa, pb) + bestAvg(pb, pa)) / 2;
  const exact = pa.filter((c) => pb.includes(c)).length;
  const near = pa.filter((c) => !pb.includes(c) && pb.some((o) => colorMatch(c, o) === 0.5)).length;
  return { score, matches: exact + near, exact, near, of: Math.max(pa.length, pb.length) };
}

function sectionSimilarity(sa, sb) {
  if (sa.length === 0 && sb.length === 0) return { score: 1, lcs: 0, common: [] };
  if (sa.length === 0 || sb.length === 0) return { score: 0, lcs: 0, common: [] };
  const lcs = lcsLength(sa, sb);
  const orderSim = (2 * lcs) / (sa.length + sb.length);
  return { score: 0.6 * orderSim + 0.4 * jaccard(sa, sb), lcs, common: lcsSequence(sa, sb), orderSim };
}

function skeletonSimilarity(ka, kb) {
  const seqSim = ka.sequence.length === 0 && kb.sequence.length === 0
    ? 1
    : (2 * lcsLength(ka.sequence, kb.sequence)) / Math.max(1, ka.sequence.length + kb.sequence.length);
  const keys = [...LANDMARKS, "divs"];
  let countAcc = 0;
  for (const k of keys) {
    const a = k === "divs" ? Math.min(ka.divs, 100) : ka.counts[k] || 0;
    const b = k === "divs" ? Math.min(kb.divs, 100) : kb.counts[k] || 0;
    countAcc += 1 - Math.abs(a - b) / Math.max(1, Math.max(a, b));
  }
  const countSim = countAcc / keys.length;
  const depths = new Set([...Object.keys(ka.depthHist), ...Object.keys(kb.depthHist)]);
  let l1 = 0;
  let totalA = 0;
  let totalB = 0;
  for (const d of depths) {
    l1 += Math.abs((ka.depthHist[d] || 0) - (kb.depthHist[d] || 0));
    totalA += ka.depthHist[d] || 0;
    totalB += kb.depthHist[d] || 0;
  }
  const depthSim = 1 - l1 / Math.max(1, totalA + totalB);
  return 0.45 * seqSim + 0.35 * countSim + 0.2 * depthSim;
}

function radiusShadowSimilarity(fa, fb) {
  const r = jaccard(fa.radius, fb.radius);
  const s = fa.shadows === fb.shadows ? 1 : 0;
  return 0.7 * r + 0.3 * s;
}

/**
 * Compare two fingerprints. Returns the 0–100 score, the per-component
 * breakdown, and human-readable reasons for the match.
 */
function similarity(fa, fb) {
  const sec = sectionSimilarity(fa.sections, fb.sections);
  const pal = paletteSimilarity(fa.palette, fb.palette);
  const fontScore = jaccard(
    fa.fonts.map((f) => f.toLowerCase()),
    fb.fonts.map((f) => f.toLowerCase())
  );
  const skel = skeletonSimilarity(fa.skeleton, fb.skeleton);
  const rs = radiusShadowSimilarity(fa, fb);
  const structure = STRUCTURE_SKELETON_SHARE * skel + (1 - STRUCTURE_SKELETON_SHARE) * rs;

  const total =
    WEIGHTS.sections * sec.score +
    WEIGHTS.palette * pal.score +
    WEIGHTS.fonts * fontScore +
    WEIGHTS.structure * structure;

  const reasons = [];
  if (fa.sections.length && fb.sections.length) {
    if (fa.sections.join("→") === fb.sections.join("→")) {
      reasons.push(`identical section order (${fa.sections.join(" → ")})`);
    } else if (sec.lcs >= 2) {
      reasons.push(`${sec.lcs} page blocks in the same order (${sec.common.join(" → ")})`);
    }
  }
  if (pal.matches > 0) {
    reasons.push(`${pal.matches}/${pal.of} palette colours match` +
      (pal.exact < pal.matches ? ` (${pal.exact} exact, ${pal.matches - pal.exact} near)` : ""));
  }
  const sharedFonts = fa.fonts.filter((f) =>
    fb.fonts.some((g) => g.toLowerCase() === f.toLowerCase()));
  if (sharedFonts.length) reasons.push(`same font${sharedFonts.length > 1 ? "s" : ""} (${sharedFonts.join(", ")})`);
  if (skel >= 0.85) reasons.push("near-identical landmark structure");
  else if (skel >= 0.65) reasons.push("similar landmark structure");
  const sharedRadius = fa.radius.filter((r) => fb.radius.includes(r));
  if (sharedRadius.length) reasons.push(`same corner radius (${sharedRadius.join(", ")})`);
  if (fa.shadows && fb.shadows) reasons.push("both lean on box shadows");

  return {
    score: Math.round(100 * total),
    breakdown: {
      sections: Math.round(100 * sec.score),
      palette: Math.round(100 * pal.score),
      fonts: Math.round(100 * fontScore),
      structure: Math.round(100 * structure),
      skeleton: Math.round(100 * skel),
      radiusShadow: Math.round(100 * rs),
    },
    reasons,
  };
}

/* ------------------------------------------------------------------ */
/* URL safety + fetching (same approach as bin/deslop-report.js)       */
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
  if (n === null) return true;
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
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return true;
  if (h.startsWith("fc") || h.startsWith("fd")) return true;
  if (h.startsWith("ff")) return true;
  const mapped = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

function ipIsPrivate(ip) {
  return ip.includes(":") ? isPrivateIPv6(ip) : isPrivateIPv4(ip);
}

const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".lan", ".home", ".corp", ".intranet"];

/** 198.18.0.0/15 — benchmarking space; synthetic proxy answers live here. */
function isBenchmarkingIPv4(ip) {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  return ((n & 0xfffe0000) >>> 0) === 0xc6120000;
}

async function dohAnswers(host) {
  const ips = [];
  for (const type of ["A", "AAAA"]) {
    try {
      const resp = await fetch(
        "https://cloudflare-dns.com/dns-query?name=" + encodeURIComponent(host) + "&type=" + type,
        { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(5000) }
      );
      if (!resp.ok) continue;
      const data = await resp.json();
      for (const ans of data.Answer || []) {
        if (ans.type === 1 || ans.type === 28) ips.push(ans.data);
      }
    } catch { /* DoH unreachable — literals/suffixes already blocked */ }
  }
  return ips;
}

async function hostIsPrivate(hostname) {
  const host = hostname.toLowerCase();
  if (!host || host === "localhost" || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return true;
  }
  if (net.isIP(host)) return ipIsPrivate(host);
  try {
    const local = await dns.lookup(host, { all: true, verbatim: true });
    const localPrivate = local.some(
      (a) => ipIsPrivate(a.address) && !(a.family === 4 && isBenchmarkingIPv4(a.address))
    );
    if (localPrivate) return true;
  } catch { /* unresolvable locally — the public record decides */ }
  const remote = await dohAnswers(host);
  return remote.some((ip) => ipIsPrivate(ip));
}

async function validateTarget(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: `that URL does not parse: ${raw}` };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { error: "only http:// and https:// URLs can be fingerprinted" };
  }
  if (await hostIsPrivate(u.hostname)) {
    return { error: `refusing to fetch ${u.hostname} — it is, or resolves to, a private/local address` };
  }
  return { url: u };
}

async function readCapped(resp, capBytes) {
  const reader = resp.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > capBytes) {
      chunks.push(value.slice(0, value.length - (total - capBytes)));
      try { await reader.cancel(); } catch { /* already closed */ }
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8");
}

async function fetchPage(startUrl) {
  let current = startUrl;
  for (let hop = 0; hop <= 4; hop++) {
    const resp = await fetch(current.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "user-agent": "deslop-twins/1.4 (+https://github.com/iRehmanAhmad/deslop)",
        accept: "text/html,application/xhtml+xml",
      },
    });
    if ([301, 302, 303, 307, 308].includes(resp.status)) {
      const loc = resp.headers.get("location");
      if (!loc) return { error: "the site redirected without a destination" };
      const next = new URL(loc, current);
      const v = await validateTarget(next.toString());
      if (v.error) return { error: `redirect target refused: ${v.error}` };
      current = v.url;
      continue;
    }
    if (!resp.ok) return { error: `the site answered HTTP ${resp.status}` };
    const text = await readCapped(resp, MAX_HTML_BYTES);
    const contentType = resp.headers.get("content-type") || "";
    const looksHtml = /^\s*(<!doctype|<html|<head|<body)/i.test(text);
    if (!contentType.includes("html") && !looksHtml) {
      return { error: "that URL did not return a readable web page (not HTML)" };
    }
    return { html: text, finalUrl: current };
  }
  return { error: "the site redirected too many times" };
}

function stylesheetUrls(html, baseUrl) {
  const out = [];
  const seen = new Set();
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (!/rel\s*=\s*["'][^"']*\bstylesheet\b/i.test(tag)) continue;
    const m = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!m) continue;
    let u;
    try { u = new URL(m[1], baseUrl); } catch { continue; }
    if (u.origin !== baseUrl.origin) continue;
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
      headers: { "user-agent": "deslop-twins/1.4 (+https://github.com/iRehmanAhmad/deslop)" },
    });
    if (!resp.ok) return null;
    return await readCapped(resp, MAX_CSS_BYTES);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Targets                                                             */
/* ------------------------------------------------------------------ */

async function fingerprintUrl(raw) {
  const v = await validateTarget(raw);
  if (v.error) return { error: v.error };
  let page;
  try {
    page = await fetchPage(v.url);
  } catch (err) {
    return { error: `could not fetch the page: ${err.message}` };
  }
  if (page.error) return { error: page.error };
  const sheets = [];
  for (const u of stylesheetUrls(page.html, page.finalUrl)) {
    const css = await fetchStylesheet(u);
    if (css) sheets.push(css);
  }
  return {
    fingerprint: fingerprint(page.html, sheets.join("\n")),
    label: page.finalUrl.toString(),
  };
}

function fingerprintPath(target) {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) return { error: `path not found: ${target}` };
  if (!fs.statSync(resolved).isFile()) {
    return { error: `twins needs a single HTML file (got a directory: ${target})` };
  }
  let html;
  try {
    html = fs.readFileSync(resolved, "utf8");
  } catch (err) {
    return { error: `could not read ${target}: ${err.message}` };
  }
  // Local sibling stylesheets referenced by the page, when present.
  const sheets = [];
  const dir = path.dirname(resolved);
  for (const tag of html.match(/<link\b[^>]*>/gi) || []) {
    if (!/rel\s*=\s*["'][^"']*\bstylesheet\b/i.test(tag)) continue;
    const m = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!m || /^https?:\/\//i.test(m[1]) || m[1].startsWith("//")) continue;
    const cssPath = path.resolve(dir, m[1].split(/[?#]/)[0]);
    try {
      if (fs.existsSync(cssPath) && fs.statSync(cssPath).isFile()) {
        sheets.push(fs.readFileSync(cssPath, "utf8").slice(0, MAX_CSS_BYTES));
      }
    } catch { /* unreadable sibling CSS — fingerprint the HTML alone */ }
    if (sheets.length >= MAX_CSS_FILES) break;
  }
  return { fingerprint: fingerprint(html, sheets.join("\n")), label: target };
}

/* ------------------------------------------------------------------ */
/* Corpus                                                              */
/* ------------------------------------------------------------------ */

function loadCorpusDir(dir, source) {
  const out = [];
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names.sort()) {
    if (!name.endsWith(".json")) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
      const fp = data.fingerprint || data;
      if (!fp || !fp.skeleton || !Array.isArray(fp.sections)) continue;
      out.push({
        name: data.name || name.replace(/\.json$/, ""),
        description: data.description || "",
        fingerprint: fp,
        source,
      });
    } catch { /* skip unreadable corpus entries */ }
  }
  return out;
}

function builtinCorpus() {
  return loadCorpusDir(path.join(__dirname, "..", "twins-corpus"), "built-in");
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

function printResult(target, fp, twins) {
  console.log(`deslop twins: fingerprint for ${target}`);
  console.log(`  skeleton: ${fp.skeleton.id} — ${fp.skeleton.string || "(no landmarks)"}` +
    ` · ${fp.skeleton.divs} divs · max depth ${fp.skeleton.maxDepth}`);
  console.log(`  sections: ${fp.sections.length ? fp.sections.join(" → ") : "(none recognised)"}`);
  console.log(`  palette:  ${fp.palette.length ? fp.palette.join(" ") : "(no colours found)"}`);
  console.log(`  fonts:    ${fp.fonts.length ? fp.fonts.join(", ") : "(none declared)"}`);
  console.log(`  radius:   ${fp.radius.length ? fp.radius.join(", ") : "(none)"} · shadows: ${fp.shadows ? "yes" : "no"}`);
  console.log("");
  if (twins.length === 0) {
    console.log("No corpus entries to compare against.");
    return;
  }
  console.log("Layout twins (most similar first):");
  for (const t of twins) {
    console.log(`  ${String(t.score).padStart(3)}%  ${t.name}${t.source === "user corpus" ? "  [your corpus]" : ""}`);
    if (t.description) console.log(`       ${t.description}`);
    for (const r of t.reasons) console.log(`       — ${r}`);
    console.log(`       breakdown: sections ${t.breakdown.sections} · palette ${t.breakdown.palette}` +
      ` · fonts ${t.breakdown.fonts} · structure ${t.breakdown.structure}`);
  }
  const top = twins[0];
  if (top && top.score >= 70) {
    console.log("");
    console.log(`Verdict: this page is a close layout twin of "${top.name}" (${top.score}%).` +
      " Same template DNA — visitors who have seen one have effectively seen the other.");
  }
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function run(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let target = null;
  let corpusDir = null;
  let json = false;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      console.log(HELP);
      return 0;
    } else if (a === "--json") {
      json = true;
    } else if (a === "--corpus") {
      corpusDir = args[++i];
      if (corpusDir === undefined) {
        console.error("deslop twins: --corpus needs a folder path");
        return 2;
      }
    } else if (a.startsWith("--")) {
      console.error(`deslop twins: unknown option "${a}"`);
      return 2;
    } else if (!target) {
      target = a;
    } else {
      console.error(`deslop twins: one target at a time (got "${target}" and "${a}")`);
      return 2;
    }
  }

  if (!target) {
    console.error("deslop twins: missing target — give a local HTML file or a URL\n\n" + HELP);
    return 2;
  }

  const isUrl = /^https?:\/\//i.test(target);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target) && !isUrl) {
    console.error("deslop twins: only http:// and https:// URLs can be fingerprinted");
    return 2;
  }

  let got;
  try {
    got = isUrl ? await fingerprintUrl(target) : fingerprintPath(target);
  } catch (err) {
    console.error(`deslop twins: ${err.message}`);
    return 2;
  }
  if (got.error) {
    console.error(`deslop twins: ${got.error}`);
    return 2;
  }

  const corpus = builtinCorpus();
  if (corpusDir) {
    corpus.push(...loadCorpusDir(path.resolve(corpusDir), "user corpus"));
  }

  const selfName = path.basename(target).replace(/\.html?$/i, "");
  const twins = corpus
    .filter((c) => c.name !== selfName) // never twin a page against itself
    .map((c) => ({ name: c.name, description: c.description, source: c.source, ...similarity(got.fingerprint, c.fingerprint) }))
    .sort((a, b) => b.score - a.score);

  if (json) {
    console.log(JSON.stringify({
      tool: "deslop-twins",
      target: got.label,
      fingerprint: got.fingerprint,
      weights: WEIGHTS,
      twins,
    }, null, 2));
  } else {
    printResult(got.label, got.fingerprint, twins);
  }
  return 0;
}

module.exports = { run, fingerprint, similarity, loadCorpusDir, builtinCorpus };

if (require.main === module) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => { console.error(`deslop twins: ${err.message}`); process.exit(2); }
  );
}
