#!/usr/bin/env node
/**
 * sync-copy.js — regenerate bin/report-copy.js from web-checker/worker.js.
 *
 * The plain-language COPY map (a friendly title, a plain explanation and a
 * copy-paste fix prompt for every rule) lives in worker.js, where the web
 * checker uses it. bin/deslop-report.js needs the same wording so a finding
 * reads identically in the browser checker and in a client audit report —
 * so the map is copied here mechanically, never retyped by hand.
 *
 *   node web-checker/sync-copy.js
 *
 * Never edit bin/report-copy.js by hand; edit COPY in worker.js instead.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "worker.js");
const OUT = path.join(__dirname, "..", "bin", "report-copy.js");

const src = fs.readFileSync(SRC, "utf8");
const marker = "const COPY = ";
const start = src.indexOf(marker);
if (start === -1) {
  console.error("sync-copy: COPY map not found in web-checker/worker.js");
  process.exit(1);
}

/* Find the closing brace of the COPY object literal, skipping strings. */
const braceStart = src.indexOf("{", start);
let depth = 0;
let inStr = null;
let escaped = false;
let end = -1;
for (let i = braceStart; i < src.length; i++) {
  const ch = src[i];
  if (inStr) {
    if (escaped) escaped = false;
    else if (ch === "\\") escaped = true;
    else if (ch === inStr) inStr = null;
    continue;
  }
  if (ch === '"' || ch === "'" || ch === "`") { inStr = ch; continue; }
  if (ch === "{") depth++;
  else if (ch === "}") {
    depth--;
    if (depth === 0) { end = i; break; }
  }
}
if (end === -1) {
  console.error("sync-copy: could not find the end of the COPY object in worker.js");
  process.exit(1);
}
const copyLiteral = src.slice(braceStart, end + 1);

/* Sanity check: the extracted literal must parse as an object. */
let parsed;
try {
  parsed = new Function(`return (${copyLiteral});`)();
} catch (err) {
  console.error(`sync-copy: extracted COPY does not parse: ${err.message}`);
  process.exit(1);
}
const ruleCount = Object.keys(parsed).length;
if (ruleCount < 10) {
  console.error(`sync-copy: extracted COPY has only ${ruleCount} entries — refusing to write`);
  process.exit(1);
}

const header = `/**
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

const COPY = ${copyLiteral};

/** Same fallback logic as the web checker in worker.js. */
function copyFor(finding) {
  const c = COPY[finding.rule];
  if (c) return c;
  // Generic fallback for any rule without hand-written copy yet.
  return {
    t: finding.rule.replace(/-/g, " ").replace(/\\brtl\\b/gi, "RTL"),
    p: finding.message,
    f: "In my website, please fix this design issue: " + finding.hint,
  };
}

module.exports = { COPY, copyFor };
`;

fs.writeFileSync(OUT, header);
console.log(`sync-copy: wrote ${OUT} (${ruleCount} rules of plain-language copy)`);
