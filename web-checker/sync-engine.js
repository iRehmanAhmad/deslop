#!/usr/bin/env node
/**
 * sync-engine.js — regenerate web-checker/engine.js from bin/deslop.js.
 *
 * bin/deslop.js is the ONE source of truth for the rule engine. The section
 * between the "// === ENGINE BEGIN ===" and "// === ENGINE END ===" markers
 * is pure (no fs/path, no I/O) and is copied verbatim into engine.js, which
 * the Cloudflare Worker imports. Run this after editing any rule:
 *
 *   node web-checker/sync-engine.js
 *
 * Never edit engine.js by hand.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "bin", "deslop.js");
const OUT = path.join(__dirname, "engine.js");
const BEGIN = "// === ENGINE BEGIN ===";
const END = "// === ENGINE END ===";

const src = fs.readFileSync(SRC, "utf8");
const begin = src.indexOf(BEGIN);
const end = src.indexOf(END);
if (begin === -1 || end === -1 || end <= begin) {
  console.error("sync-engine: ENGINE markers not found in bin/deslop.js");
  process.exit(1);
}
const body = src.slice(begin + BEGIN.length, end).replace(/^\n+/, "");

const header = `/**
 * engine.js — GENERATED FILE. Do not edit.
 *
 * Source of truth: bin/deslop.js (the section between the ENGINE markers).
 * Regenerate with:  node web-checker/sync-engine.js
 *
 * This is the pure deslop scanning engine (no I/O), shared by the CLI and
 * the deslop-checker Cloudflare Worker.
 */
`;

const footer = `
export { scanContent, LINE_RULES, FILE_RULES, interFindings, rtlFindings, firstLineMatching };
`;

fs.writeFileSync(OUT, header + body + footer);
console.log(`sync-engine: wrote ${OUT} (${body.split("\n").length} engine lines)`);
