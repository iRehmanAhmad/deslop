#!/usr/bin/env node
/**
 * Slop Index — scan the newest Show HN launches and grade their slop.
 *
 * Takes the most recent ~20 Show HN stories that carry a URL (via the free
 * Hacker News API), fetches each launch site (page + same-origin
 * stylesheets, SSRF-guarded exactly like the rest of deslop), computes its
 * Slop Score with the deslop engine and its Visual Twins fingerprint, and
 * writes a dated snapshot:
 *
 *   slop-index/data/YYYY-MM-DD.json   machine-readable results
 *   slop-index/data/YYYY-MM-DD.md     ranked human-readable summary
 *
 * The snapshots are the dataset the weekly Slop Index page and trend chart
 * will be built from — and a corpus of real, in-the-wild fingerprints for
 * Visual Twins. Run it weekly; the value is in the series, not the snapshot.
 *
 * Usage:
 *   node slop-index/scan-launches.js [--limit 20]
 *
 * Requires Node >= 18. No dependencies. Exit code 0 when at least one site
 * was scored, 2 when nothing could be fetched (including HN itself).
 *
 * Implementation notes:
 * - The URL-safety + fetch block below is copied from bin/deslop-twins.js
 *   (which shares it with bin/deslop-report.js): validate-before-fetch,
 *   private-address refusal, redirect hops re-validated, byte caps. The
 *   twins module exports fingerprint/similarity/builtinCorpus but not its
 *   fetch helpers, so — following the repo's existing pattern — the block
 *   is duplicated here rather than exported and refactored under it.
 * - Slop Score formula and verdict bands are the ones from
 *   bin/deslop-report.js: min(100, fails*12 + warns*4);
 *   0 Clean, 1–45 Mild, 46+ Heavy Slop.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");
const dns = require("dns").promises;

const { scanContent } = require("../bin/deslop.js");
const { fingerprint, similarity, builtinCorpus } = require("../bin/deslop-twins.js");

const HN_API = "https://hacker-news.firebaseio.com/v0";
const MAX_HTML_BYTES = 512 * 1024;
const MAX_CSS_BYTES = 256 * 1024;
const MAX_CSS_FILES = 5;
const FETCH_TIMEOUT_MS = 10000;
const FAIL_POINTS = 12;
const WARN_POINTS = 4;

const DATA_DIR = path.join(__dirname, "data");

/* ------------------------------------------------------------------ */
/* URL safety + fetching (copied from bin/deslop-twins.js)             */
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
    return { error: "only http:// and https:// URLs can be scanned" };
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
        "user-agent": "deslop-index/1.5 (+https://github.com/iRehmanAhmad/deslop)",
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
      headers: { "user-agent": "deslop-index/1.5 (+https://github.com/iRehmanAhmad/deslop)" },
    });
    if (!resp.ok) return null;
    return await readCapped(resp, MAX_CSS_BYTES);
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Hacker News                                                         */
/* ------------------------------------------------------------------ */

async function fetchJson(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!resp.ok) throw new Error(`HN API answered HTTP ${resp.status}`);
  return resp.json();
}

/**
 * The newest `limit` Show HN stories that carry a URL. showstories is not
 * strictly time-ordered, so item details are fetched (in small parallel
 * batches) for the first chunk of ids and the survivors sorted by time.
 */
async function latestShowLaunches(limit) {
  const ids = await fetchJson(`${HN_API}/showstories.json`);
  const candidates = ids.slice(0, Math.max(limit * 5, 60));
  const items = [];
  const BATCH = 5;
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = await Promise.all(
      candidates.slice(i, i + BATCH).map((id) =>
        fetchJson(`${HN_API}/item/${id}.json`).catch(() => null)
      )
    );
    for (const item of batch) {
      if (!item || item.deleted || item.dead) continue;
      if (item.type && item.type !== "story") continue;
      if (!item.url || !item.title) continue;
      items.push(item);
    }
    if (items.length >= limit * 2) break;
  }
  items.sort((a, b) => (b.time || 0) - (a.time || 0));
  return items.slice(0, limit).map((item) => ({
    hnId: item.id,
    name: item.title.replace(/^show hn:\s*/i, "").trim(),
    url: item.url,
    hnTime: item.time ? new Date(item.time * 1000).toISOString() : null,
  }));
}

/* ------------------------------------------------------------------ */
/* Scanning one launch                                                 */
/* ------------------------------------------------------------------ */

function verdictFor(score) {
  return score === 0 ? "Clean" : score <= 45 ? "Mild" : "Heavy Slop";
}

async function scanLaunch(launch, corpus) {
  const v = await validateTarget(launch.url);
  if (v.error) return { ...launch, error: v.error };
  let page;
  try {
    page = await fetchPage(v.url);
  } catch (err) {
    return { ...launch, error: `could not fetch the page: ${err.message}` };
  }
  if (page.error) return { ...launch, error: page.error };

  const pageLabel = page.finalUrl.host + page.finalUrl.pathname;
  const sources = [{ content: page.html, ext: ".html", label: pageLabel }];
  const cssTexts = [];
  for (const cssUrl of stylesheetUrls(page.html, page.finalUrl)) {
    const css = await fetchStylesheet(cssUrl);
    if (css) {
      cssTexts.push(css);
      const label = cssUrl.pathname.split("/").filter(Boolean).pop() || "stylesheet.css";
      sources.push({ content: css, ext: ".css", label });
    }
  }

  const findings = [];
  for (const s of sources) findings.push(...scanContent(s.content, s.ext, s.label));
  const fails = findings.filter((f) => f.severity === "fail").length;
  const warns = findings.length - fails;
  const score = Math.min(100, fails * FAIL_POINTS + warns * WARN_POINTS);

  const fp = fingerprint(page.html, cssTexts.join("\n"));
  const twins = corpus
    .map((c) => ({ name: c.name, score: similarity(fp, c.fingerprint).score }))
    .sort((a, b) => b.score - a.score);
  const topTwin = twins.length ? twins[0] : null;

  return {
    ...launch,
    finalUrl: page.finalUrl.toString(),
    stylesheetsScanned: cssTexts.length,
    fails,
    warns,
    score,
    verdict: verdictFor(score),
    topTwin,
    fingerprint: fp,
  };
}

/* ------------------------------------------------------------------ */
/* Output                                                              */
/* ------------------------------------------------------------------ */

function mdEscape(s) {
  return String(s).replace(/\|/g, "\\|");
}

async function main(argv) {
  let limit = 20;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--limit") limit = parseInt(argv[++i], 10) || 20;
    else if (argv[i] === "--help" || argv[i] === "-h") {
      console.log("Usage: node slop-index/scan-launches.js [--limit 20]");
      return 0;
    }
  }

  let launches;
  try {
    launches = await latestShowLaunches(limit);
  } catch (err) {
    console.error(`deslop-index: Hacker News unreachable: ${err.message}`);
    return 2;
  }
  if (launches.length === 0) {
    console.error("deslop-index: no Show HN stories with URLs found");
    return 2;
  }
  console.log(`deslop-index: ${launches.length} recent Show HN launches to scan`);

  const corpus = builtinCorpus();
  const results = [];
  const failures = [];
  for (const launch of launches) {
    process.stdout.write(`  scanning ${launch.url} ... `);
    const r = await scanLaunch(launch, corpus);
    if (r.error) {
      console.log(`FAILED (${r.error})`);
      failures.push({ name: r.name, url: r.url, hnId: r.hnId, error: r.error });
    } else {
      console.log(`score ${r.score} (${r.verdict})`);
      results.push(r);
    }
  }

  if (results.length === 0) {
    console.error("deslop-index: every launch fetch failed; no snapshot written");
    return 2;
  }

  results.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const average = results.reduce((a, r) => a + r.score, 0) / results.length;
  const date = new Date().toISOString().slice(0, 10);

  const snapshot = {
    tool: "deslop-slop-index",
    version: 1,
    date,
    generatedAt: new Date().toISOString(),
    source: "Hacker News API — /v0/showstories.json (https://hacker-news.firebaseio.com)",
    method:
      "Each launch site (page + up to 5 same-origin stylesheets) is scanned with the " +
      "deslop engine; Slop Score = min(100, fails*12 + warns*4); verdicts 0 Clean, " +
      "1–45 Mild, 46+ Heavy Slop; top twin = highest Visual Twins similarity against " +
      "the built-in 10-archetype corpus.",
    requested: limit,
    launchesFound: launches.length,
    scored: results.length,
    failed: failures.length,
    averageScore: Math.round(average * 10) / 10,
    results: results.map((r) => ({
      name: r.name,
      url: r.url,
      finalUrl: r.finalUrl,
      hnId: r.hnId,
      hnTime: r.hnTime,
      score: r.score,
      verdict: r.verdict,
      fails: r.fails,
      warns: r.warns,
      stylesheetsScanned: r.stylesheetsScanned,
      topTwin: r.topTwin,
      fingerprint: r.fingerprint,
    })),
    failures,
  };

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const jsonPath = path.join(DATA_DIR, `${date}.json`);
  const mdPath = path.join(DATA_DIR, `${date}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");

  const lines = [];
  lines.push(`# Slop Index — ${date}`);
  lines.push("");
  lines.push(`The newest **${launches.length} Show HN launches** with URLs, fetched from the ` +
    `Hacker News API on ${date} and graded by [deslop](https://github.com/iRehmanAhmad/deslop). ` +
    `${results.length} could be scanned; ${failures.length} could not.`);
  lines.push("");
  lines.push(`**Average Slop Score: ${snapshot.averageScore}/100** across the ` +
    `${results.length} scanned launches (0 = no AI-template tells found, 100 = saturated). ` +
    `Sloppiest: **${mdEscape(results[0].name)}** at ${results[0].score}. ` +
    `Cleanest: **${mdEscape(results[results.length - 1].name)}** at ` +
    `${results[results.length - 1].score}.`);
  lines.push("");
  lines.push("## Ranked — sloppiest first");
  lines.push("");
  lines.push("| # | Launch | Score | Verdict | Top layout twin | Twin similarity |");
  lines.push("|---:|---|---:|---|---|---:|");
  results.forEach((r, i) => {
    lines.push(`| ${i + 1} | [${mdEscape(r.name)}](${r.url}) | ${r.score} | ${r.verdict} | ` +
      `${r.topTwin ? mdEscape(r.topTwin.name) : "—"} | ${r.topTwin ? r.topTwin.score + "%" : "—"} |`);
  });
  lines.push("");
  if (failures.length) {
    lines.push("## Could not be scanned");
    lines.push("");
    for (const f of failures) {
      lines.push(`- [${mdEscape(f.name)}](${f.url}) — ${f.error}`);
    }
    lines.push("");
  }
  lines.push("## Method");
  lines.push("");
  lines.push(snapshot.method);
  lines.push("");
  lines.push("Scores grade the page's *source* (HTML + same-origin CSS), not a screenshot, " +
    "and they measure template tells, not whether AI was actually used. A launch built " +
    "by hand in the default style will score like one built by a bot, and vice versa. " +
    "Full per-launch data, including the Visual Twins fingerprints: " +
    `\`${date}.json\` next to this file.`);
  lines.push("");
  lines.push("One more reading note: when a launch's URL is a page on a big platform — a " +
    "GitHub repository page is the common case — the grade describes that platform's page " +
    "furniture, not the maker's own design. Read those rows as platform scores.");
  lines.push("");
  fs.writeFileSync(mdPath, lines.join("\n"), "utf8");

  console.log("");
  console.log(`deslop-index: scored ${results.length}/${launches.length} launches, ` +
    `average score ${snapshot.averageScore}`);
  console.log(`deslop-index: wrote ${path.relative(process.cwd(), jsonPath)} and ` +
    `${path.relative(process.cwd(), mdPath)}`);
  return 0;
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => { console.error(`deslop-index: ${err.message}`); process.exit(2); }
  );
}

module.exports = { main, verdictFor, latestShowLaunches, scanLaunch };
