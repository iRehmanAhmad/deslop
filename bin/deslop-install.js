#!/usr/bin/env node
/**
 * deslop install — put the deslop agent skill where agents look for it.
 *
 * Invoked as `deslop install [--claude] [--cursor] [--dry-run]` from
 * bin/deslop.js. It copies this package's SKILL.md (plus docs/RULES.md as
 * the rule reference) into:
 *
 *   Claude Code (default, or --claude):
 *     <project>/.claude/skills/deslop/SKILL.md  + RULES.md
 *     <user home>/.claude/skills/deslop/SKILL.md + RULES.md
 *
 *   Cursor (--cursor, in addition to the Claude targets):
 *     <project>/.cursor/rules/deslop.mdc
 *     (generated from SKILL.md: Cursor frontmatter + the skill body)
 *
 * Idempotent: re-running overwrites in place and reports per file whether
 * it was created, updated, or already up to date. --dry-run prints the plan
 * and writes nothing.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const PACKAGE_ROOT = path.join(__dirname, "..");
const SKILL_SRC = path.join(PACKAGE_ROOT, "SKILL.md");
const RULES_SRC = path.join(PACKAGE_ROOT, "docs", "RULES.md");

/** Split SKILL.md into { description, body } using its YAML frontmatter. */
function parseSkill(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!m) return { description: "", body: raw };
  const desc = m[1].match(/^description:\s*(.+)$/m);
  return {
    description: desc ? desc[1].trim() : "",
    body: raw.slice(m[0].length),
  };
}

/** Build the Cursor rules file (.mdc) from the skill's parts. */
function cursorRulesFile(description, body) {
  const frontmatter = [
    "---",
    `description: ${JSON.stringify(
      description || "Detect and remove AI design slop from generated UI."
    )}`,
    'globs: "**/*.{css,scss,html,jsx,tsx,vue,astro,svelte}"',
    "alwaysApply: false",
    "---",
    "",
  ].join("\n");
  return frontmatter + body;
}

/**
 * Write one file (or describe the write in dry-run mode).
 * Returns "created" | "updated" | "up to date".
 */
function place(dest, content, dryRun, lines, verb) {
  let action = "created";
  if (fs.existsSync(dest)) {
    action = fs.readFileSync(dest, "utf8") === content ? "up to date" : "updated";
  }
  if (!dryRun && action !== "up to date") {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, content);
  }
  const label = dryRun && action !== "up to date" ? `would ${verb(action)}` : action;
  lines.push(`  ${label.padEnd(14)} ${dest}`);
  return action;
}

function verb(action) {
  return action === "created" ? "create" : "update";
}

function run(args) {
  let wantClaude = false;
  let wantCursor = false;
  let dryRun = false;

  for (const arg of args) {
    if (arg === "--claude") wantClaude = true;
    else if (arg === "--cursor") wantCursor = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--help" || arg === "-h") {
      console.log("Usage:");
      console.log("  deslop install [--claude] [--cursor] [--dry-run]");
      console.log("  (from source: node bin/deslop.js install [same options])");
      console.log("");
      console.log("  (no flags)  install for Claude Code: project .claude/skills + user ~/.claude/skills");
      console.log("  --cursor    also write the project Cursor rule (.cursor/rules/deslop.mdc)");
      console.log("  --dry-run   print what would be written, write nothing");
      return 0;
    } else {
      console.error(`deslop install: unknown option "${arg}"`);
      return 2;
    }
  }
  // Claude Code targets are the default; --cursor adds to them.
  if (!wantClaude && !wantCursor) wantClaude = true;
  if (wantCursor) wantClaude = true;

  let skillRaw;
  let rulesRaw;
  try {
    skillRaw = fs.readFileSync(SKILL_SRC, "utf8");
    rulesRaw = fs.readFileSync(RULES_SRC, "utf8");
  } catch (err) {
    console.error(`deslop install: cannot read the packaged skill files: ${err.message}`);
    return 2;
  }
  const { description, body } = parseSkill(skillRaw);

  const cwd = process.cwd();
  const home = os.homedir();
  const lines = [];
  lines.push(dryRun ? "deslop install — dry run (nothing will be written)" : "deslop install");
  lines.push("");

  if (wantClaude) {
    const targets = [
      ["Claude Code — project", path.join(cwd, ".claude", "skills", "deslop")],
      ["Claude Code — user", path.join(home, ".claude", "skills", "deslop")],
    ];
    for (const [label, dir] of targets) {
      lines.push(`${label}:`);
      place(path.join(dir, "SKILL.md"), skillRaw, dryRun, lines, verb);
      place(path.join(dir, "RULES.md"), rulesRaw, dryRun, lines, verb);
    }
  }

  if (wantCursor) {
    lines.push("Cursor — project:");
    place(
      path.join(cwd, ".cursor", "rules", "deslop.mdc"),
      cursorRulesFile(description, body),
      dryRun,
      lines,
      verb
    );
  }

  lines.push("");
  lines.push(
    dryRun
      ? "Dry run only — re-run without --dry-run to write these files."
      : "Done. Agents in this project will now find the deslop skill."
  );
  console.log(lines.join("\n"));
  return 0;
}

module.exports = { run, parseSkill, cursorRulesFile };
