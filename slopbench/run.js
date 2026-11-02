#!/usr/bin/env node
/**
 * SlopBench harness — run deslop over the labelled dataset and grade it.
 *
 * Reads slopbench/labels.json (the benchmark contract), scans every page in
 * slopbench/pages/ with the deslop engine (bin/deslop.js), computes each
 * page's Slop Score with the same formula as the web checker and the audit
 * report (fail = 12 points, warn = 4 points, capped at 100), then finds the
 * score threshold that best separates the 'ai' pages from the 'human' pages
 * and reports accuracy at that threshold — including the names and scores of
 * every false positive and false negative. Honesty is the product: the
 * failures are printed, not averaged away.
 *
 * Threshold selection: every threshold 0..101 is tried (a page is predicted
 * "AI-built" when score >= threshold). The threshold with the highest
 * accuracy wins; ties break toward the threshold closest to the midpoint of
 * the two class means, then the lowest threshold. The threshold is a
 * property of this 30-page dataset, not a constant of nature.
 *
 * Usage:
 *   node slopbench/run.js           # console table + regenerate RESULTS.md
 *   node slopbench/run.js --json    # machine-readable results to stdout
 *
 * Zero dependencies. Requires Node >= 18.
 */
"use strict";

const fs = require("fs");
const path = require("path");

const { scanContent } = require("../bin/deslop.js");

const BENCH_DIR = __dirname;
const PAGES_DIR = path.join(BENCH_DIR, "pages");
const LABELS_PATH = path.join(BENCH_DIR, "labels.json");
const RESULTS_PATH = path.join(BENCH_DIR, "RESULTS.md");

const FAIL_POINTS = 12; // same constants as bin/deslop-report.js
const WARN_POINTS = 4;

function slopScore(findings) {
  const fails = findings.filter((f) => f.severity === "fail").length;
  const warns = findings.length - fails;
  return {
    fails,
    warns,
    score: Math.min(100, fails * FAIL_POINTS + warns * WARN_POINTS),
  };
}

function evaluate(pages, threshold) {
  let tp = 0, tn = 0, fp = 0, fn = 0;
  for (const p of pages) {
    const predictedAi = p.score >= threshold;
    if (p.label === "ai" && predictedAi) tp += 1;
    else if (p.label === "ai") fn += 1;
    else if (predictedAi) fp += 1;
    else tn += 1;
  }
  return { tp, tn, fp, fn, accuracy: (tp + tn) / pages.length };
}

function bestThreshold(pages, meanAi, meanHuman) {
  const midpoint = (meanAi + meanHuman) / 2;
  let best = null;
  for (let t = 0; t <= 101; t += 1) {
    const ev = evaluate(pages, t);
    const dist = Math.abs(t - midpoint);
    if (
      !best ||
      ev.accuracy > best.ev.accuracy ||
      (ev.accuracy === best.ev.accuracy && dist < best.dist) ||
      (ev.accuracy === best.ev.accuracy && dist === best.dist && t < best.threshold)
    ) {
      best = { threshold: t, ev, dist };
    }
  }
  return best;
}

function mean(xs) {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function mdEscape(s) {
  return String(s).replace(/\|/g, "\\|");
}

function main() {
  const jsonOnly = process.argv.slice(2).includes("--json");

  let labels;
  try {
    labels = JSON.parse(fs.readFileSync(LABELS_PATH, "utf8"));
  } catch (err) {
    console.error(`slopbench: cannot read labels.json: ${err.message}`);
    return 2;
  }

  const pages = [];
  for (const entry of labels.pages) {
    const filePath = path.join(PAGES_DIR, entry.file);
    let content;
    try {
      content = fs.readFileSync(filePath, "utf8");
    } catch (err) {
      console.error(`slopbench: cannot read ${entry.file}: ${err.message}`);
      return 2;
    }
    const findings = scanContent(content, ".html", entry.file);
    const { fails, warns, score } = slopScore(findings);
    const ruleCounts = {};
    for (const f of findings) ruleCounts[f.rule] = (ruleCounts[f.rule] || 0) + 1;
    const topRules = Object.entries(ruleCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([rule, n]) => (n > 1 ? `${rule} ×${n}` : rule));
    pages.push({ ...entry, fails, warns, score, topRules });
  }

  const aiPages = pages.filter((p) => p.label === "ai");
  const humanPages = pages.filter((p) => p.label === "human");
  const meanAi = mean(aiPages.map((p) => p.score));
  const meanHuman = mean(humanPages.map((p) => p.score));
  const { threshold, ev } = bestThreshold(pages, meanAi, meanHuman);

  const falsePositives = humanPages
    .filter((p) => p.score >= threshold)
    .sort((a, b) => b.score - a.score);
  const falseNegatives = aiPages
    .filter((p) => p.score < threshold)
    .sort((a, b) => b.score - a.score);

  const date = new Date().toISOString().slice(0, 10);
  const result = {
    tool: "slopbench",
    detector: "deslop (bin/deslop.js engine)",
    date,
    pages: pages.length,
    aiPages: aiPages.length,
    humanPages: humanPages.length,
    formula: `min(100, fails*${FAIL_POINTS} + warns*${WARN_POINTS})`,
    meanAi: Math.round(meanAi * 10) / 10,
    medianAi: median(aiPages.map((p) => p.score)),
    meanHuman: Math.round(meanHuman * 10) / 10,
    medianHuman: median(humanPages.map((p) => p.score)),
    threshold,
    accuracy: Math.round(ev.accuracy * 1000) / 10,
    confusion: { tp: ev.tp, tn: ev.tn, fp: ev.fp, fn: ev.fn },
    falsePositives: falsePositives.map((p) => ({ file: p.file, score: p.score })),
    falseNegatives: falseNegatives.map((p) => ({ file: p.file, score: p.score })),
    perPage: [...pages]
      .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
      .map((p) => ({
        file: p.file, label: p.label, score: p.score,
        fails: p.fails, warns: p.warns, topRules: p.topRules,
      })),
  };

  if (jsonOnly) {
    console.log(JSON.stringify(result, null, 2));
    return 0;
  }

  /* ---------------- console table ---------------- */
  console.log(`SlopBench — ${date} — deslop over ${pages.length} labelled pages`);
  console.log("");
  const sorted = result.perPage;
  const width = Math.max(...sorted.map((p) => p.file.length));
  for (const p of sorted) {
    const mark = p.label === "ai" ? "AI   " : "HUMAN";
    const flag =
      (p.label === "human" && p.score >= threshold) ? "  <-- FALSE POSITIVE" :
      (p.label === "ai" && p.score < threshold) ? "  <-- missed" : "";
    console.log(
      `${p.file.padEnd(width)}  ${mark}  score ${String(p.score).padStart(3)}  ` +
      `(${p.fails} fail, ${p.warns} warn)${flag}`
    );
  }
  console.log("");
  console.log(`mean score: AI ${result.meanAi} · human ${result.meanHuman} ` +
    `(median AI ${result.medianAi} · human ${result.medianHuman})`);
  console.log(`suggested threshold: ${threshold} (predicted AI when score >= threshold)`);
  console.log(`accuracy at threshold: ${result.accuracy}% ` +
    `(TP ${ev.tp}, TN ${ev.tn}, FP ${ev.fp}, FN ${ev.fn})`);
  console.log("");
  console.log(`wrote ${path.relative(process.cwd(), RESULTS_PATH)}`);
  /* ---------------- RESULTS.md ---------------- */

  const lines = [];
  lines.push("# SlopBench — results");
  lines.push("");
  lines.push(`Generated ${date} by \`node slopbench/run.js\` — do not edit by hand; ` +
    "re-run the harness instead.");
  lines.push("");
  lines.push("## Headline");
  lines.push("");
  lines.push(`- Detector under test: **deslop** (the rule engine in \`bin/deslop.js\`), ` +
    "scored with the same formula as the web checker and the audit report: " +
    `\`min(100, fails × ${FAIL_POINTS} + warns × ${WARN_POINTS})\`.`);
  lines.push(`- Dataset: **${pages.length} pages** — ${aiPages.length} labelled AI-built, ` +
    `${humanPages.length} labelled human-designed (see \`labels.json\` for provenance per page).`);
  lines.push(`- Mean Slop Score: **AI ${result.meanAi}** vs **human ${result.meanHuman}** ` +
    `(medians: AI ${result.medianAi}, human ${result.medianHuman}).`);
  lines.push(`- Best separating threshold on this dataset: **${threshold}** ` +
    `(a page scoring >= ${threshold} is predicted AI-built).`);
  lines.push(`- Accuracy at that threshold: **${result.accuracy}%** — ` +
    `${ev.tp} true positives, ${ev.tn} true negatives, ` +
    `${ev.fp} false positive(s), ${ev.fn} false negative(s).`);
  lines.push("");
  lines.push("## Method");
  lines.push("");
  lines.push("1. Every page in `slopbench/pages/` is a single self-contained HTML file " +
    "(inline CSS, no build step). `labels.json` is the ground truth and the contract: " +
    "file, label, provenance (`fixture`, `archetype` or `authored`), and a note on the " +
    "idiom the page represents.");
  lines.push("2. The harness scans each page once with `scanContent()` from `bin/deslop.js` " +
    "and applies the Slop Score formula above. No page is rescanned, tuned or excluded " +
    "after its score is known.");
  lines.push("3. The threshold is chosen by trying every value 0–101 and keeping the one " +
    "with the highest accuracy; ties break toward the midpoint of the two class means, " +
    "then the lowest threshold. It is fitted to these 30 pages and **will** move as the " +
    "dataset grows — treat it as indicative, not as a constant of the tool.");
  lines.push("");
  lines.push("## Per-page scores");
  lines.push("");
  lines.push("| Page | Label | Score | Fail | Warn | Top rules |");
  lines.push("|---|---|---:|---:|---:|---|");
  for (const p of sorted) {
    const full = pages.find((x) => x.file === p.file);
    lines.push(`| ${p.file} | ${p.label} | ${p.score} | ${p.fails} | ${p.warns} | ` +
      `${mdEscape(full.topRules.join(", ") || "—")} |`);
  }
  lines.push("");
  lines.push("## False positives — human pages deslop calls AI-built");
  lines.push("");
  if (falsePositives.length === 0) {
    lines.push(`None at threshold ${threshold}. (That will change as harder human ` +
      "pages are added; it is a property of this small dataset, not a promise.)");
  } else {
    lines.push("Honesty is the product, so they are named, with the rules that fired:");
    lines.push("");
    for (const p of falsePositives) {
      lines.push(`- **${p.file}** — score ${p.score} ` +
        `(${p.fails} fail, ${p.warns} warn). Fired: ${p.topRules.join(", ") || "—"}. ` +
        `Label note: ${p.note}`);
    }
  }
  lines.push("");
  lines.push("## False negatives — AI-idiom pages deslop lets through");
  lines.push("");
  if (falseNegatives.length === 0) {
    lines.push(`None at threshold ${threshold}.`);
  } else {
    for (const p of falseNegatives) {
      lines.push(`- **${p.file}** — score ${p.score} ` +
        `(${p.fails} fail, ${p.warns} warn). Label note: ${p.note}`);
    }
  }
  lines.push("");
  lines.push("## The dataset");
  lines.push("");
  lines.push("| Page | Label | Source | Idiom |");
  lines.push("|---|---|---|---|");
  for (const p of pages) {
    lines.push(`| ${p.file} | ${p.label} | ${p.source} | ${mdEscape(p.note)} |`);
  }
  lines.push("");
  lines.push("## Caveats — read these before quoting any number");
  lines.push("");
  lines.push("- **Authored dataset.** Every page was written or selected by the deslop " +
    "maintainer (`fixture`/`archetype` pages are copied verbatim from this repo's own " +
    "test material; `authored` pages were written for this benchmark). No page is a " +
    "capture of a real production site. Labels record the *design idiom a page " +
    "represents*, assigned by the author — exactly the kind of circularity a public " +
    "benchmark exists to outgrow. Week 1 is a starting line, not a verdict.");
  lines.push("- **Small n.** 30 pages. A single page moving across the threshold swings " +
    "accuracy by ~3 points. Do not compare detectors on this set to one decimal place.");
  lines.push("- **Single-file pages.** Inline CSS only: no external stylesheets, no JS " +
    "frameworks, no Tailwind CDN. Detectors that lean on rendered output or on class " +
    "names from a framework build will see less here than on a real site.");
  lines.push("- **The score measures template tells, not authorship.** A human can ship " +
    "every tell in the book; an AI can be art-directed past all of them. SlopBench grades " +
    "detectors of the *default look*, which is the claim deslop actually makes.");
  lines.push("- **Threshold is indicative.** It is fitted to this dataset (see Method). " +
    "Report it alongside n and the dataset version whenever you cite it.");
  lines.push("");
  lines.push("## Run another detector on SlopBench");
  lines.push("");
  lines.push("The folder is detector-agnostic. `labels.json` is the only contract:");
  lines.push("");
  lines.push("1. Read `labels.json`; for each entry, the page to test is " +
    "`slopbench/pages/<file>` and the ground truth is `<label>`. Do not read the notes " +
    "until after you have scored — they describe the idiom, not the answer key your " +
    "detector should use.");
  lines.push("2. Run your detector over each page file as-is (single HTML file, styles " +
    "inline). Record one row per page: file, your raw score or verdict, and (if your " +
    "tool has them) the rules/findings that fired.");
  lines.push("3. If your detector emits a numeric score, grade it exactly as above: try " +
    "every threshold, report the best accuracy **and** your false positives and false " +
    "negatives by name. If it emits only a verdict, report accuracy at that verdict.");
  lines.push("4. Publish your per-page rows alongside your headline number, and state the " +
    "dataset version (`labels.json` → `version` / `updated`). A benchmark whose failures " +
    "are visible is worth more than a leaderboard whose are not.");
  lines.push("");
  lines.push("Suggested row format for comparability:");
  lines.push("");
  lines.push("```");
  lines.push("file,label,your_score,your_verdict");
  lines.push("ai-01-sloppy-fixture.html,ai,,");
  lines.push("... (one row per page, all 30)");
  lines.push("```");
  lines.push("");

  fs.writeFileSync(RESULTS_PATH, lines.join("\n"), "utf8");
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, slopScore, evaluate, bestThreshold };
