#!/usr/bin/env node
/**
 * fixes-190.test.js — regression tests for the v1.9.0 review fixes.
 *
 *   node tests/fixes-190.test.js
 *
 * Zero dependencies. Covers:
 *   1. waiver coverage extends to the line BELOW the comment, so the
 *      README's documented pattern (standalone comment above the block)
 *      actually suppresses;
 *   2. a scan covering 0 files is an error (exit 2), never a false
 *      "no slop found";
 *   3. CLI arg hygiene: unknown options and mistyped subcommands exit 2
 *      with named errors; no arguments prints usage and exits 0;
 *   4. --help leads with the installed `deslop …` command form;
 *   5. cream-serif-default editorial exemption (magazine fixture does
 *      not fire; the SlopBench cream+serif page still does; a third
 *      default signal lifts the exemption) and the em-dash rule's
 *      long-prose exclusion;
 *   7/9. the audit report's verdict bands (a score above 0 is never
 *      "Clean") and its neutral-voice recommendations (no builder
 *      first person — "the brand", not "my brand").
 *   8. thin-fingerprint assessment for JS-shell pages.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const CLI = path.join(ROOT, "bin", "deslop.js");
const { scanContent } = require(path.join(ROOT, "bin", "deslop.js"));
const { fingerprint, thinAssessment } = require(path.join(ROOT, "bin", "deslop-twins.js"));
const { renderReport } = require(path.join(ROOT, "bin", "deslop-report.js"));

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "ok" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures += 1;
}

function tmpdir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function run(args, opts = {}) {
  const res = spawnSync(process.execPath, [CLI, ...args], {
    cwd: opts.cwd || ROOT,
    env: { ...process.env, ...(opts.env || {}) },
    encoding: "utf8",
  });
  return { code: res.status, stdout: res.stdout || "", stderr: res.stderr || "" };
}

/* ------------------------------------------------------------------ */
/* 1: waiver covers the line below (the README pattern, literally)     */
/* ------------------------------------------------------------------ */

{
  const dir = tmpdir("deslop-test-waiver-below-");
  const page = [
    "<!doctype html>",
    "<html><body>",
    "<!-- deslop-ignore: lorem-ipsum — placeholder copy kept for the client review draft -->",
    "<p>Lorem ipsum dolor sit amet.</p>",
    "</body></html>",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "page.html"), page);
  const r = run(["page.html"], { cwd: dir });
  check("waiver above the block suppresses the finding below it",
    r.code === 0 && !r.stdout.includes("[FAIL]"), `exit ${r.code}`);
  check("below-line waiver is counted in the footer",
    r.stdout.includes("1 finding(s) waived by inline waivers"));
}

/* ------------------------------------------------------------------ */
/* 2: false-clean guard                                                */
/* ------------------------------------------------------------------ */

{
  const dir = tmpdir("deslop-test-empty-");
  fs.writeFileSync(path.join(dir, "notes.md"), "# nothing scannable\n");
  const r = run(["."], { cwd: dir });
  check("0-file scan exits 2", r.code === 2, `exit ${r.code}`);
  check("0-file scan says nothing was scanned",
    r.stderr.includes("nothing was scanned"));
  check("0-file scan never claims a clean result",
    !r.stdout.includes("no AI design slop found"));
}

/* ------------------------------------------------------------------ */
/* 3 + 4: arg hygiene and help                                         */
/* ------------------------------------------------------------------ */

{
  const bogus = run(["--bogus"]);
  check("unknown option exits 2 and names the flag",
    bogus.code === 2 && bogus.stderr.includes('unknown option "--bogus"'));

  const bare = run([]);
  check("no arguments prints usage and exits 0",
    bare.code === 0 && bare.stdout.includes("Usage:"));

  const typo = run(["frobnicate"]);
  check("mistyped subcommand exits 2 as an unknown command",
    typo.code === 2 && typo.stderr.includes('unknown command "frobnicate"'));
  check("unknown command lists the real commands",
    typo.stderr.includes("deslop report") && typo.stderr.includes("deslop twins"));

  const missing = run(["./no-such-folder"]);
  check("a missing path is still a path error, not a command error",
    missing.code === 2 && missing.stderr.includes("path not found"));

  const help = run(["--help"]);
  check("--help leads with the installed command form",
    help.stdout.includes("deslop [path] [--format text|json]"));
  check("--help shows the from-source form exactly once",
    (help.stdout.match(/node bin\/deslop\.js/g) || []).length === 1);
}

/* ------------------------------------------------------------------ */
/* 5: editorial exemption + em-dash prose exclusion                    */
/* ------------------------------------------------------------------ */

{
  const mag = fs.readFileSync(path.join(ROOT, "fixtures", "editorial-magazine.html"), "utf8");
  const magRules = scanContent(mag, ".html", "mag").map((f) => f.rule);
  check("cream + serif magazine does NOT fire cream-serif-default",
    !magRules.includes("cream-serif-default"), magRules.join(",") || "no findings");

  const ai05 = fs.readFileSync(path.join(ROOT, "slopbench", "pages", "ai-05-cream-serif-agency.html"), "utf8");
  const ai05Rules = scanContent(ai05, ".html", "ai-05").map((f) => f.rule);
  check("SlopBench cream+serif page still fires cream-serif-default",
    ai05Rules.includes("cream-serif-default"));

  const magSage = mag.replace("</style>",
    "  .accent { color: #588157; border-color: #a3b18a; }\n</style>");
  const magSageRules = scanContent(magSage, ".html", "mag-sage").map((f) => f.rule);
  check("a third default signal (sage) lifts the editorial exemption",
    magSageRules.includes("cream-serif-default"));

  const longProse = "<!doctype html><html><body><p>" +
    "word ".repeat(10) + "alpha — beta — gamma — delta — epsilon — zeta — " +
    "word ".repeat(45) + "</p></body></html>";
  check("em-dashes inside a >40-word prose paragraph are excluded",
    !scanContent(longProse, ".html", "prose").some((f) => f.rule === "em-dash-overuse"));

  const uiCopy = "<!doctype html><html><body>" +
    "<p>Fast — simple — honest — ready — yours — today</p></body></html>";
  check("em-dashes in short UI copy still fire",
    scanContent(uiCopy, ".html", "ui").some((f) => f.rule === "em-dash-overuse"));
}

/* ------------------------------------------------------------------ */
/* 7 + 9b: report verdict bands + neutral recommendations              */
/* ------------------------------------------------------------------ */

{
  const oneWarn = [{
    file: "page.html", line: 3, rule: "glassmorphism", severity: "warn",
    message: "Glassmorphism", hint: "Use an opaque surface.",
  }];
  const mild = renderReport({
    siteName: "example.com", clientName: null, dateStr: "2 November 2026",
    scope: "example.com (local file)", findings: oneWarn,
  });
  check("a report with findings is never labelled Clean",
    mild.verdict === "Mild" && mild.score === 4, `verdict ${mild.verdict}, score ${mild.score}`);
  check("report prints the shared bands (0 Clean · 1–45 Mild · 46+ Heavy)",
    mild.html.includes("0 Clean · 1–45 Mild · 46+ Heavy Slop"));

  const gradient = [{
    file: "page.html", line: 8, rule: "purple-blue-gradient", severity: "fail",
    message: "Purple gradient", hint: "Use a solid colour.",
  }];
  const rec = renderReport({
    siteName: "example.com", clientName: null, dateStr: "2 November 2026",
    scope: "example.com (local file)", findings: gradient,
  });
  check("report recommendations speak of 'the brand', not 'my brand'",
    rec.html.includes("taken from the brand") && !rec.html.includes("my brand"));

  const lorem = [{
    file: "page.html", line: 9, rule: "lorem-ipsum", severity: "fail",
    message: "Lorem ipsum", hint: "Write real copy.",
  }];
  const rec2 = renderReport({
    siteName: "example.com", clientName: null, dateStr: "2 November 2026",
    scope: "example.com (local file)", findings: lorem,
  });
  check("report recommendations carry no builder first person at all",
    !/\bmy\b/.test(rec2.html.split("Recommended fix")[1] || "") &&
    !rec2.html.includes("what I offer"));
}

/* ------------------------------------------------------------------ */
/* 8b: thin fingerprint                                                */
/* ------------------------------------------------------------------ */

{
  const shell = "<!doctype html><html><head><title>app</title></head>" +
    '<body><div id="root"></div></body></html>';
  const thin = thinAssessment(fingerprint(shell, ""));
  check("a JS-shell page is assessed thin, with all three reasons",
    thin.thin === true && thin.reasons.length === 3, thin.reasons.join(" · "));

  const clone = fs.readFileSync(path.join(ROOT, "examples", "twins-demo-clone.html"), "utf8");
  check("a real page is not thin",
    thinAssessment(fingerprint(clone, "")).thin === false);
}

console.log(failures === 0 ? "\nall v1.9.0 fix tests passed" : `\n${failures} test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
