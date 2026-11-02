#!/usr/bin/env node
/**
 * install-config.test.js — install command, config file, and inline
 * waiver assertions.
 *
 *   node tests/install-config.test.js
 *
 * Zero dependencies. Everything runs in temp directories (HOME is pointed
 * at a temp dir too, so the real user skill folder is never touched).
 * Asserts:
 *   1. `deslop install` writes project + user skill files; a re-run is
 *      idempotent ("up to date"); a tampered file is "updated";
 *   2. `install --dry-run` writes nothing;
 *   3. `install --cursor` also writes .cursor/rules/deslop.mdc with
 *      frontmatter;
 *   4. deslop.config.json: "ignore" suppresses rules, "ignoreFiles"
 *      skips files (basename + ** globs), "failOn: any" fails on
 *      warnings, unknown keys warn on stderr, invalid JSON exits 2;
 *   5. inline waivers: a waiver WITH a reason suppresses (same line and
 *      previous-line coverage, all comment syntaxes); a waiver WITHOUT a
 *      reason suppresses nothing and yields a deslop-waiver-no-reason
 *      warning; the footer counts waived findings.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const CLI = path.join(ROOT, "bin", "deslop.js");

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
/* 1–3: install                                                        */
/* ------------------------------------------------------------------ */

{
  const home = tmpdir("deslop-test-home-");
  const proj = tmpdir("deslop-test-proj-");
  const env = { HOME: home };

  const dry = run(["install", "--dry-run", "--cursor"], { cwd: proj, env });
  check("install --dry-run exits 0", dry.code === 0);
  check("install --dry-run announces itself", dry.stdout.includes("dry run"));
  check("install --dry-run writes nothing",
    !fs.existsSync(path.join(proj, ".claude")) && !fs.existsSync(path.join(home, ".claude")));

  const first = run(["install", "--cursor"], { cwd: proj, env });
  const skillProj = path.join(proj, ".claude", "skills", "deslop", "SKILL.md");
  const rulesProj = path.join(proj, ".claude", "skills", "deslop", "RULES.md");
  const skillUser = path.join(home, ".claude", "skills", "deslop", "SKILL.md");
  const mdc = path.join(proj, ".cursor", "rules", "deslop.mdc");
  check("install exits 0", first.code === 0);
  check("install writes project SKILL.md", fs.existsSync(skillProj));
  check("install writes project RULES.md reference", fs.existsSync(rulesProj));
  check("install writes user SKILL.md", fs.existsSync(skillUser));
  check("installed SKILL.md is byte-identical to the packaged one",
    fs.readFileSync(skillProj, "utf8") === fs.readFileSync(path.join(ROOT, "SKILL.md"), "utf8"));
  check("install reports creations", (first.stdout.match(/created/g) || []).length === 5);

  const mdcText = fs.readFileSync(mdc, "utf8");
  check("cursor rule file written", mdcText.startsWith("---\n"));
  check("cursor rule has description frontmatter", /^description: /m.test(mdcText));
  check("cursor rule has globs frontmatter", /^globs: /m.test(mdcText));
  check("cursor rule carries the skill body", mdcText.includes("no AI design slop"));

  const second = run(["install", "--cursor"], { cwd: proj, env });
  check("re-run is idempotent (all up to date)",
    (second.stdout.match(/up to date/g) || []).length === 5 && !second.stdout.includes("created"));

  fs.appendFileSync(skillProj, "\ntampered\n");
  const third = run(["install"], { cwd: proj, env });
  check("tampered file is updated in place",
    third.stdout.includes("updated") &&
    fs.readFileSync(skillProj, "utf8") === fs.readFileSync(path.join(ROOT, "SKILL.md"), "utf8"));
}

/* ------------------------------------------------------------------ */
/* 4: config                                                           */
/* ------------------------------------------------------------------ */

const PAGE = [
  "<!doctype html>",
  "<html><body>",
  "<p>Lorem ipsum dolor sit amet.</p>",
  '<h1 style="background-clip: text;">Hello</h1>',
  "</body></html>",
  "",
].join("\n");
const WARN_ONLY = '<!doctype html>\n<html><body><h1 style="background-clip: text;">Hello</h1></body></html>\n';

{
  const dir = tmpdir("deslop-test-cfg-");
  fs.writeFileSync(path.join(dir, "page.html"), PAGE);
  fs.writeFileSync(path.join(dir, "warn.html"), WARN_ONLY);
  fs.mkdirSync(path.join(dir, "drafts"));
  fs.writeFileSync(path.join(dir, "drafts", "deep.html"), PAGE);

  const plain = run(["page.html"], { cwd: dir });
  check("no config: lorem fail exits 1", plain.code === 1 && plain.stdout.includes("[FAIL] lorem-ipsum"));

  fs.writeFileSync(path.join(dir, "deslop.config.json"), JSON.stringify({ ignore: ["lorem-ipsum"] }));
  const ignored = run(["page.html"], { cwd: dir });
  check("config ignore suppresses the rule", !ignored.stdout.includes("lorem-ipsum") && ignored.code === 0);
  check("config ignore is reported", ignored.stdout.includes("1 finding(s) ignored by deslop.config.json"));

  fs.writeFileSync(path.join(dir, "deslop.config.json"), JSON.stringify({ failOn: "any" }));
  check("failOn any: warning-only file exits 1", run(["warn.html"], { cwd: dir }).code === 1);
  fs.rmSync(path.join(dir, "deslop.config.json"));
  check("default policy: warning-only file exits 0", run(["warn.html"], { cwd: dir }).code === 0);

  fs.writeFileSync(path.join(dir, "deslop.config.json"), JSON.stringify({ ignoreFiles: ["drafts/**", "page.html"] }));
  const skipped = run(["."], { cwd: dir });
  check("ignoreFiles skips ** glob + basename matches",
    skipped.stdout.includes("scanned 1 file(s)") && skipped.stdout.includes("2 file(s) skipped"));

  fs.writeFileSync(path.join(dir, "deslop.config.json"), "{oops");
  const broken = run(["page.html"], { cwd: dir });
  check("invalid config JSON exits 2 with a clear error",
    broken.code === 2 && broken.stderr.includes("invalid JSON"));

  fs.writeFileSync(path.join(dir, "deslop.config.json"), JSON.stringify({ bogusKey: true }));
  const unknown = run(["warn.html"], { cwd: dir });
  check("unknown config key warns on stderr but scan proceeds",
    unknown.stderr.includes('unknown config key "bogusKey"') && unknown.code === 0);
}

/* ------------------------------------------------------------------ */
/* 5: waivers                                                          */
/* ------------------------------------------------------------------ */

{
  const dir = tmpdir("deslop-test-waiver-");
  const waived = [
    "<!doctype html>",
    "<html><head><style>",
    ".hero { background: linear-gradient(90deg, #7c3aed, #2563eb); } /* deslop-ignore: purple-blue-gradient — brand gradient, chosen deliberately */",
    "</style></head>",
    "<body><p>Lorem ipsum dolor sit amet.</p>",
    "<!-- deslop-ignore: lorem-ipsum — placeholder copy kept for the client review draft -->",
    "</body></html>",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "waived.html"), waived);
  const w = run(["waived.html"], { cwd: dir });
  check("waivers with reasons suppress same-line + previous-line findings",
    w.code === 0 && !w.stdout.includes("[FAIL]") && !w.stdout.includes("lorem-ipsum —"));
  check("waived findings are counted in the footer",
    w.stdout.includes("2 finding(s) waived by inline waivers"));

  const noReason = [
    "<!doctype html>",
    "<html><body>",
    "<p>Lorem ipsum dolor sit amet.</p> <!-- deslop-ignore: lorem-ipsum -->",
    "</body></html>",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(dir, "noreason.html"), noReason);
  const nr = run(["noreason.html"], { cwd: dir });
  check("waiver without a reason does NOT suppress",
    nr.code === 1 && nr.stdout.includes("[FAIL] lorem-ipsum"));
  check("reasonless waiver yields a deslop-waiver-no-reason warning",
    nr.stdout.includes("[warn] deslop-waiver-no-reason"));
}

console.log(failures === 0 ? "\nall install/config/waiver tests passed" : `\n${failures} test(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);
