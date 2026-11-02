#!/usr/bin/env node
/**
 * twins.test.js — Visual Twins assertions + scanner regression guard.
 *
 *   node tests/twins.test.js
 *
 * Zero dependencies. Asserts:
 *   1. the demo clone is a close twin of the SaaS archetype (>= 80) and
 *      ranks it first;
 *   2. the demo "different" page (a plain CV) scores low against EVERY
 *      archetype (<= 40);
 *   3. every archetype's stored fingerprint matches a fresh fingerprint
 *      of its fixture (corpus is in sync with twins-corpus/fixtures/);
 *   4. scanner regression: the four fixtures keep their v1.3.0 results
 *      (sloppy 5 fail/34 warn, clean 0, rtl-sloppy 1 fail/7 warn,
 *      rtl-clean 0) — twins must not disturb the shared CLI.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const { fingerprint, similarity, builtinCorpus } = require(path.join(ROOT, "bin", "deslop-twins.js"));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "ok" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function fpOf(rel) {
  const html = fs.readFileSync(path.join(ROOT, rel), "utf8");
  return fingerprint(html, "");
}

/* 1 + 2: demo pages against the whole corpus */
const corpus = builtinCorpus();
check("built-in corpus loads 10 archetypes", corpus.length === 10, `got ${corpus.length}`);

const clone = fpOf("examples/twins-demo-clone.html");
const cloneScores = corpus
  .map((c) => ({ name: c.name, score: similarity(clone, c.fingerprint).score }))
  .sort((a, b) => b.score - a.score);
const saas = cloneScores.find((s) => s.name.startsWith("Generic SaaS"));
check("clone vs SaaS archetype >= 80", saas && saas.score >= 80, `score ${saas && saas.score}`);
check("clone ranks SaaS archetype first", cloneScores[0] === saas,
  `top is "${cloneScores[0].name}" at ${cloneScores[0].score}`);

const different = fpOf("examples/twins-demo-different.html");
const diffScores = corpus
  .map((c) => ({ name: c.name, score: similarity(different, c.fingerprint).score }))
  .sort((a, b) => b.score - a.score);
check("different page scores <= 40 against every archetype",
  diffScores.every((s) => s.score <= 40),
  `highest is "${diffScores[0].name}" at ${diffScores[0].score}`);

/* 3: stored corpus fingerprints match their fixtures */
const manifest = {
  "saas-tailwind": "Generic SaaS",
  "shadcn-dashboard": "shadcn-style",
  "cream-serif-agency": "Cream + serif",
  "docs-site": "Documentation",
  "blog-magazine": "Blog / magazine",
  "portfolio-minimal": "Minimal portfolio",
  "ecommerce-product": "E-commerce",
  "link-in-bio": "Link-in-bio",
  "coming-soon": "Coming soon",
  "course-landing": "Online course",
};
for (const [slug, prefix] of Object.entries(manifest)) {
  const stored = corpus.find((c) => c.name.startsWith(prefix));
  const fresh = fpOf(`twins-corpus/fixtures/${slug}.html`);
  check(`corpus in sync: ${slug}`,
    stored && JSON.stringify(stored.fingerprint) === JSON.stringify(fresh));
}

/* 4: scanner regression via the real CLI */
const expected = {
  "fixtures/sloppy.html": "5 fail, 34 warning",
  "fixtures/clean.html": "0 fail, 0 warning",
  "fixtures/rtl-sloppy.html": "1 fail, 7 warning",
  "fixtures/rtl-clean.html": "0 fail, 0 warning",
};
for (const [rel, needle] of Object.entries(expected)) {
  let out = "";
  try {
    out = execFileSync("node", [path.join(ROOT, "bin", "deslop.js"), rel], { cwd: ROOT, encoding: "utf8" });
  } catch (err) {
    out = String(err.stdout || "");
  }
  check(`scanner regression: ${rel}`, out.includes(needle), `expected "${needle}"`);
}

console.log(failures === 0 ? "\nAll twins tests passed." : `\n${failures} test(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
