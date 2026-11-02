#!/usr/bin/env node
/**
 * deslop-report — turn a deslop scan into a client-facing audit report.
 *
 *   node bin/deslop-report.js <path-or-url> [--out report.html]
 *                               [--client "Client Name"] [--site "Site Name"]
 *   node bin/deslop.js report <path-or-url> [same options]
 *
 * Scans a local file/folder (like the CLI) or fetches a live URL — the page
 * plus its same-origin stylesheets, with the same SSRF hygiene as the web
 * checker (public http(s) only, private addresses refused, every redirect
 * hop re-validated, byte-capped fetches) — and writes ONE self-contained
 * HTML report: cover header, Slop Score, executive summary, findings in
 * plain language grouped must-fix first, an RTL note when Urdu/Arabic
 * issues are present, and a "what good looks like" closing section.
 *
 * The plain-language wording comes from bin/report-copy.js, GENERATED from
 * web-checker/worker.js by web-checker/sync-copy.js — one source of truth,
 * so a rule reads identically in the browser checker and in this report.
 *
 * Requires Node >= 18. No npm packages.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const net = require("net");
const dns = require("dns").promises;

const { scanContent, collectFiles } = require("./deslop.js");
const { COPY, copyFor } = require("./report-copy.js");

/* Same scoring as the web checker (web-checker/worker.js). */
const FAIL_POINTS = 12;
const WARN_POINTS = 4;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_CSS_BYTES = 256 * 1024;
const MAX_CSS_FILES = 5;
const FETCH_TIMEOUT_MS = 10000;

const HELP = `Usage:
  node bin/deslop.js report <path-or-url> [--out report.html] [--client "Client Name"] [--site "Site Name"]
  node bin/deslop-report.js <path-or-url> [same options]

Writes a single self-contained HTML audit report (print/PDF friendly).
Exit code 0 when the report is written, 2 on usage or fetch errors.`;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function cap(s) {
  return s.replace(/^[a-z]/, (ch) => ch.toUpperCase());
}

/**
 * The checker's fix prompts are written to paste into an AI builder
 * ("In my website, remove the gradient…"). In a report the same text reads
 * as a recommendation once that framing is stripped.
 */
function asRecommendation(fixText) {
  let t = String(fixText).trim();
  const prefix = "In my website, ";
  if (t.startsWith(prefix)) t = t.slice(prefix.length);
  return cap(t);
}

function isRtlRule(rule) {
  return rule.startsWith("rtl-") || rule === "urdu-naskh-for-nastaleeq";
}

/* ------------------------------------------------------------------ */
/* URL safety — only public http(s) pages get fetched                  */
/* (Same checks as web-checker/worker.js: literal IPs and local        */
/* suffixes refused outright; hostnames refused when the public DNS    */
/* record — Cloudflare DoH, as in the worker — or the local resolver   */
/* points at a private address. One local refinement: some sandboxes   */
/* and proxies answer EVERY hostname with a synthetic address in       */
/* 198.18.0.0/15 (benchmarking space), so a local answer in that range */
/* is treated as "proxy says nothing" and the public record decides.   */
/* Literal 198.18.x.x hosts and public records in that range are       */
/* still refused, exactly as in the worker.)                           */
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
  if (n === null) return true; // unparseable -> treat as unsafe
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
  if (h.startsWith("fe8") || h.startsWith("fe9") || h.startsWith("fea") || h.startsWith("feb")) return true; // fe80::/10
  if (h.startsWith("fc") || h.startsWith("fd")) return true; // fc00::/7
  if (h.startsWith("ff")) return true; // multicast
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
  return ((n & 0xfffe0000) >>> 0) === 0xc6120000; // >>> 0: keep unsigned
}

/** Public A/AAAA answers via Cloudflare DoH (the web checker's method). */
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
    } catch {
      // DoH unreachable: fall through — the fetch itself fails if the host
      // does not resolve, and literals/local suffixes are already blocked.
    }
  }
  return ips;
}

/** True when the hostname is, or resolves to, a private/local address. */
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
  } catch {
    // Unresolvable locally: the public record decides.
  }
  const remote = await dohAnswers(host);
  return remote.some((ip) => ipIsPrivate(ip));
}

/** Returns { url } or { error }. */
async function validateTarget(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return { error: `that URL does not parse: ${raw}` };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { error: "only http:// and https:// URLs can be audited" };
  }
  if (await hostIsPrivate(u.hostname)) {
    return { error: `refusing to fetch ${u.hostname} — it is, or resolves to, a private/local address` };
  }
  return { url: u };
}

/* ------------------------------------------------------------------ */
/* Fetching (mirrors web-checker/worker.js)                            */
/* ------------------------------------------------------------------ */

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
  const buf = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  return buf.toString("utf8");
}

/** Fetch a page, following redirects manually and re-validating each hop. */
async function fetchPage(startUrl) {
  let current = startUrl;
  for (let hop = 0; hop <= 4; hop++) {
    const resp = await fetch(current.toString(), {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: {
        "user-agent": "deslop-report/1.3 (+https://github.com/iRehmanAhmad/deslop)",
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
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    if (!/rel\s*=\s*["'][^"']*\bstylesheet\b/i.test(tag)) continue;
    const m = tag.match(/href\s*=\s*["']([^"']+)["']/i);
    if (!m) continue;
    let u;
    try { u = new URL(m[1], baseUrl); } catch { continue; }
    if (u.origin !== baseUrl.origin) continue; // same-origin only
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
      headers: { "user-agent": "deslop-report/1.3 (+https://github.com/iRehmanAhmad/deslop)" },
    });
    if (!resp.ok) return null;
    const css = await readCapped(resp, MAX_CSS_BYTES);
    const label = u.pathname.split("/").filter(Boolean).pop() || "stylesheet.css";
    return { css, label };
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Scanning a target                                                   */
/* ------------------------------------------------------------------ */

async function scanUrlTarget(raw) {
  const v = await validateTarget(raw);
  if (v.error) return { error: v.error };
  let page;
  try {
    page = await fetchPage(v.url);
  } catch (err) {
    return { error: `could not fetch the page: ${err.message}` };
  }
  if (page.error) return { error: page.error };

  const pageLabel = page.finalUrl.host + page.finalUrl.pathname;
  const sources = [{ content: page.html, ext: ".html", label: pageLabel }];
  for (const cssUrl of stylesheetUrls(page.html, page.finalUrl)) {
    const sheet = await fetchStylesheet(cssUrl);
    if (sheet) sources.push({ content: sheet.css, ext: ".css", label: sheet.label });
  }
  const findings = [];
  for (const s of sources) findings.push(...scanContent(s.content, s.ext, s.label));
  return {
    findings,
    sources: sources.map((s) => s.label),
    defaultSite: page.finalUrl.host,
    scope: `${page.finalUrl.toString()} — page + ${sources.length - 1} stylesheet(s)`,
  };
}

function scanPathTarget(target) {
  const resolved = path.resolve(target);
  if (!fs.existsSync(resolved)) return { error: `path not found: ${target}` };
  const files = collectFiles(resolved);
  if (files.length === 0) {
    return { error: `no scannable files under ${target} (deslop reads .css/.scss/.html/.jsx/.tsx/.vue/.astro/.svelte)` };
  }
  const findings = [];
  for (const file of files) {
    const label = fs.statSync(resolved).isFile()
      ? path.basename(file)
      : path.relative(process.cwd(), file) || file;
    let content;
    try {
      content = fs.readFileSync(file, "utf8");
    } catch (err) {
      return { error: `could not read ${file}: ${err.message}` };
    }
    findings.push(...scanContent(content, path.extname(file), label));
  }
  return {
    findings,
    sources: files.map((f) => path.basename(f)),
    defaultSite: path.basename(resolved),
    scope: `${target} — ${files.length} file(s) scanned`,
  };
}

/* ------------------------------------------------------------------ */
/* Report copy                                                         */
/* ------------------------------------------------------------------ */

const SUMMARY = {
  clean:
    "This site is in good shape. The scan found little or nothing that reads as an AI-template default, so visitors meet the business, not the tool that built the site. Anything listed below is minor polish rather than a problem, and none of it needs urgent attention.",
  mild:
    "This site works, but it carries some of the tells visitors now associate with AI-built pages. No single item here breaks anything; together they make the site feel like a template rather than a business with its own character. Working through the list below, starting with the must-fix group, will make a visible difference.",
  heavy:
    "This site carries many of the patterns visitors have learned to recognise as generated by an AI builder: the default fonts, gradients, layouts and phrases shared by thousands of other sites. That sameness costs trust, because visitors judge a business by how considered its site feels. The good news: every item below is a known, fixable pattern, and none of them requires a rebuild to address.",
  spotless:
    "No significant tells found. The scan ran the full deslop rule set over the sources listed below and none of the patterns people now recognise as AI-template defaults are present in them. The design reads as chosen by a person, which is exactly what a client site should do.",
};

const GOOD_LOOKS_LIKE = [
  "A typeface with a point of view: headings set in a font chosen for this brand, not the builder's default, paired deliberately with the body text.",
  "A colour story: surfaces, buttons and accents drawn from a small palette that belongs to the business, defined once and used consistently.",
  "One depth system: borders for structure, and shadow reserved for the single element that genuinely floats.",
  "Copy that says the concrete thing: what the product does, who it is for, with a real detail or number instead of a promise.",
  "Structure a screen reader and a search engine can follow: real headings and landmarks, and a keyboard focus a visitor can always see.",
];

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

const REPORT_CSS = `
  :root {
    --paper: #FAF5EC;
    --card: #FFFDF8;
    --ink: #221709;
    --ink-soft: #5C4F43;
    --line: #E3D7C3;
    --brick: #B23A17;
    --brick-tint: #F9E4DA;
    --amber: #96660A;
    --amber-tint: #F7ECD2;
    --green: #1E6B4F;
    --green-tint: #DDEEE6;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    background: var(--paper);
    color: var(--ink);
    font-family: "Karla", "Segoe UI", "Helvetica Neue", Verdana, sans-serif;
    font-size: 17px;
    line-height: 1.6;
  }
  .page { max-width: 840px; margin: 0 auto; padding: 56px 28px 40px; }
  .cover { border-top: 10px solid var(--brick); padding-top: 30px; }
  .kicker {
    font-size: 13px; font-weight: 800; letter-spacing: 1.6px;
    text-transform: uppercase; color: var(--brick);
  }
  h1 {
    font-family: "Fraunces", Georgia, "Times New Roman", serif;
    font-weight: 900; font-size: 46px; line-height: 1.08;
    letter-spacing: -0.5px; margin: 10px 0 6px;
  }
  .cover-site {
    font-family: "Fraunces", Georgia, "Times New Roman", serif;
    font-weight: 600; font-size: 26px; color: var(--ink-soft); margin: 0 0 24px;
  }
  .meta {
    display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 14px 28px; border-top: 1px solid var(--line);
    border-bottom: 1px solid var(--line); padding: 16px 0; margin-bottom: 8px;
  }
  .meta .label {
    font-size: 12px; font-weight: 800; letter-spacing: 1.2px;
    text-transform: uppercase; color: var(--ink-soft);
  }
  .meta .value { font-weight: 700; margin-top: 2px; }
  h2 {
    font-family: "Fraunces", Georgia, "Times New Roman", serif;
    font-weight: 900; font-size: 30px; line-height: 1.15;
    margin: 44px 0 6px; padding-top: 22px; border-top: 2px solid var(--ink);
  }
  h2 .sub { display: block; font-family: "Karla", "Segoe UI", sans-serif;
    font-weight: 400; font-size: 16px; color: var(--ink-soft); margin-top: 6px; }
  .score-block {
    display: flex; align-items: center; gap: 30px; flex-wrap: wrap;
    background: var(--card); border: 1px solid var(--line);
    border-radius: 12px; padding: 26px 28px; margin-top: 20px;
  }
  .score-num {
    font-family: "Fraunces", Georgia, "Times New Roman", serif;
    font-weight: 900; font-size: 92px; line-height: 1;
  }
  .score-num small { font-size: 28px; color: var(--ink-soft); }
  .score-clean { color: var(--green); }
  .score-mild { color: var(--amber); }
  .score-heavy { color: var(--brick); }
  .verdict {
    font-family: "Fraunces", Georgia, "Times New Roman", serif;
    font-weight: 600; font-size: 30px; line-height: 1.15;
  }
  .score-counts { color: var(--ink-soft); margin-top: 6px; }
  .scorebar {
    height: 14px; background: var(--line); border-radius: 7px;
    margin-top: 20px; overflow: hidden;
  }
  .scorebar-fill { height: 100%; border-radius: 7px; }
  .fill-clean { background: var(--green); }
  .fill-mild { background: var(--amber); }
  .fill-heavy { background: var(--brick); }
  .scorebar-note { font-size: 14px; color: var(--ink-soft); margin-top: 8px; }
  .summary-text { font-size: 18px; margin-top: 20px; }
  .callout {
    border: 1px solid var(--amber); background: var(--amber-tint);
    border-radius: 12px; padding: 20px 24px; margin-top: 28px;
  }
  .callout h2 { border-top: none; padding-top: 0; margin-top: 0; font-size: 26px; }
  .finding {
    background: var(--card); border: 1px solid var(--line);
    border-radius: 12px; padding: 20px 24px; margin-top: 16px;
  }
  .finding-head { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
  .chip {
    font-size: 12px; font-weight: 800; letter-spacing: 0.8px;
    text-transform: uppercase; padding: 4px 10px; border-radius: 999px;
  }
  .chip-fail { background: var(--brick-tint); color: var(--brick); }
  .chip-warn { background: var(--amber-tint); color: var(--amber); }
  .finding h3 {
    font-family: "Fraunces", Georgia, "Times New Roman", serif;
    font-size: 23px; margin: 0; line-height: 1.2;
  }
  .rule { font-family: ui-monospace, "SF Mono", Consolas, monospace;
    font-size: 13px; color: var(--ink-soft); }
  .meaning { margin: 10px 0 0; }
  .found { font-size: 14px; color: var(--ink-soft); margin: 10px 0 0; }
  .found code { font-family: ui-monospace, "SF Mono", Consolas, monospace; }
  .fix {
    margin-top: 14px; background: var(--paper);
    border: 1px solid var(--line); border-radius: 10px; padding: 12px 16px;
  }
  .fix-label {
    font-size: 12px; font-weight: 800; letter-spacing: 0.8px;
    text-transform: uppercase; color: var(--brick);
  }
  .fix p { margin: 6px 0 0; }
  .clean-box {
    background: var(--green-tint); border: 1px solid var(--green);
    border-radius: 12px; padding: 22px 26px; margin-top: 20px; font-size: 18px;
  }
  .good-list { margin: 14px 0 0; padding-left: 22px; }
  .good-list li { margin-top: 8px; }
  .cta {
    margin-top: 30px; background: var(--card); border: 1px solid var(--line);
    border-left: 6px solid var(--brick); border-radius: 10px; padding: 18px 22px;
  }
  .cta p { margin: 0; }
  footer {
    margin-top: 52px; border-top: 2px solid var(--ink); padding-top: 16px;
    font-size: 14px; color: var(--ink-soft);
  }
  footer a { color: var(--brick); font-weight: 700; }
  @media (max-width: 560px) {
    h1 { font-size: 36px; }
    .score-num { font-size: 68px; }
  }
  @media print {
    body { background: #fff; }
    .page { padding: 0; max-width: none; }
    .finding, .score-block, .callout, .clean-box, .cta { break-inside: avoid; }
    .score-num, .scorebar-fill, .chip, .verdict {
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    @page { margin: 16mm; }
  }
`;

function findingCard(f) {
  const c = copyFor(f);
  const hasCopy = Object.prototype.hasOwnProperty.call(COPY, f.rule);
  const recommendation = hasCopy ? asRecommendation(c.f) : f.hint;
  return `  <article class="finding">
    <div class="finding-head">
      <span class="chip ${f.severity === "fail" ? "chip-fail" : "chip-warn"}">${f.severity === "fail" ? "Must fix" : "Worth fixing"}</span>
      <h3>${esc(cap(c.t))}</h3>
      <span class="rule">${esc(f.rule)}</span>
    </div>
    <p class="meaning">${esc(c.p)}</p>
    <p class="found">Found in <code>${esc(f.file)}:${f.line}</code></p>
    <div class="fix"><span class="fix-label">Recommended fix</span><p>${esc(recommendation)}</p></div>
  </article>`;
}

function renderReport({ siteName, clientName, dateStr, scope, findings }) {
  const fails = findings.filter((f) => f.severity === "fail");
  const warns = findings.filter((f) => f.severity !== "fail");
  const score = Math.min(100, fails.length * FAIL_POINTS + warns.length * WARN_POINTS);
  const verdictKey = score <= 15 ? "clean" : score <= 45 ? "mild" : "heavy";
  const verdict = verdictKey === "clean" ? "Clean" : verdictKey === "mild" ? "Mild" : "Heavy Slop";
  const rtl = findings.filter((f) => isRtlRule(f.rule));
  const summary = findings.length === 0 ? SUMMARY.spotless : SUMMARY[verdictKey];

  const parts = [];
  parts.push(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI Design-Slop Audit — ${esc(siteName)}</title>
<style>${REPORT_CSS}</style>
</head>
<body>
<div class="page">
  <header class="cover">
    <div class="kicker">Audit report</div>
    <h1>AI Design-Slop Audit</h1>
    <p class="cover-site">${esc(siteName)}</p>
    <div class="meta">
      ${clientName ? `<div><div class="label">Prepared for</div><div class="value">${esc(clientName)}</div></div>` : ""}
      <div><div class="label">Date</div><div class="value">${esc(dateStr)}</div></div>
      <div><div class="label">Audited by</div><div class="value">Rahman Ahmad — rehmanahmad.com</div></div>
      <div><div class="label">Scope</div><div class="value">${esc(scope)}</div></div>
    </div>
  </header>

  <section>
    <h2>Executive summary</h2>
    <div class="score-block">
      <div class="score-num score-${verdictKey}">${score}<small> / 100</small></div>
      <div>
        <div class="verdict">${verdict}</div>
        <div class="score-counts">${fails.length} must-fix finding(s) · ${warns.length} worth-fixing finding(s)</div>
      </div>
    </div>
    <div class="scorebar"><div class="scorebar-fill fill-${verdictKey}" style="width: ${score}%"></div></div>
    <p class="scorebar-note">Slop Score = must-fix findings × ${FAIL_POINTS} + other findings × ${WARN_POINTS}, capped at 100. Higher means more AI-template tells. 0–15 Clean · 16–45 Mild · 46+ Heavy Slop.</p>
    <p class="summary-text">${esc(summary)}</p>
  </section>`);

  if (rtl.length > 0) {
    parts.push(`
  <section class="callout">
    <h2>A note on the Urdu/Arabic pages</h2>
    <p>${rtl.length} of the findings in this report concern right-to-left (RTL) content. This site speaks to Urdu/Arabic readers, and for them these are not cosmetic details: text laid out the wrong way, fonts that cannot draw the script properly, spacing that does not flip and arrows that point backwards are the first things a native reader notices. They are also the issues generic design checkers cannot see at all, because their rules assume a left-to-right, Latin-script page. Each one is listed in the findings below with its fix.</p>
  </section>`);
  }

  if (findings.length === 0) {
    parts.push(`
  <section>
    <h2>Findings</h2>
    <div class="clean-box"><strong>No findings to report.</strong> The full deslop rule set (40 rules, including the RTL pack) ran over the scanned sources and nothing fired. Keep doing whatever produced this.</div>
  </section>`);
  } else {
    if (fails.length > 0) {
      parts.push(`
  <section>
    <h2>Must fix <span class="sub">The obvious tells — the patterns visitors recognise first, and the ones worth addressing before anything else.</span></h2>
${fails.map(findingCard).join("\n")}
  </section>`);
    }
    if (warns.length > 0) {
      parts.push(`
  <section>
    <h2>Worth fixing <span class="sub">The quiet tells — individually small, but together they are what makes a site feel generated rather than designed.</span></h2>
${warns.map(findingCard).join("\n")}
  </section>`);
    }
  }

  parts.push(`
  <section>
    <h2>What good looks like</h2>
    <p>Whether the fixes above are applied by your own team, your AI builder, or an auditor, this is the standard they should land on:</p>
    <ul class="good-list">
${GOOD_LOOKS_LIKE.map((g) => `      <li>${esc(g)}</li>`).join("\n")}
    </ul>
    <div class="cta">
      <p>Prefer to have this done for you? Rahman Ahmad offers an audit-and-fix service for AI-built sites — the findings above, fixed properly, without a rebuild. Get in touch via <a href="https://rehmanahmad.com">rehmanahmad.com</a>.</p>
    </div>
  </section>

  <footer>
    <p>Generated with <a href="https://github.com/iRehmanAhmad/deslop">deslop</a>, the anti-slop scanner that can also read RTL (Urdu and Arabic included) · Audit by Rahman Ahmad, <a href="https://rehmanahmad.com">rehmanahmad.com</a></p>
    <p>Developer advocacy: I post daily videos spotlighting free tools &amp; open-source projects for developers, teachers and students.</p>
  </footer>
</div>
</body>
</html>
`);
  return { html: parts.join("\n"), score, verdict, fails: fails.length, warns: warns.length };
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */

async function run(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let out = "deslop-audit-report.html";
  let client = null;
  let site = null;
  let target = null;

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--help" || a === "-h") {
      console.log(HELP);
      return 0;
    } else if (a === "--out" || a === "--client" || a === "--site") {
      const value = args[++i];
      if (value === undefined) {
        console.error(`deslop report: ${a} needs a value`);
        return 2;
      }
      if (a === "--out") out = value;
      else if (a === "--client") client = value;
      else site = value;
    } else if (a.startsWith("--")) {
      console.error(`deslop report: unknown option "${a}"`);
      return 2;
    } else if (!target) {
      target = a;
    } else {
      console.error(`deslop report: one target at a time (got "${target}" and "${a}")`);
      return 2;
    }
  }

  if (!target) {
    console.error("deslop report: missing target — give a local path or a URL\n\n" + HELP);
    return 2;
  }

  const isUrl = /^https?:\/\//i.test(target);
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target) && !isUrl) {
    console.error("deslop report: only http:// and https:// URLs can be audited");
    return 2;
  }

  let scanned;
  try {
    scanned = isUrl ? await scanUrlTarget(target) : scanPathTarget(target);
  } catch (err) {
    console.error(`deslop report: ${err.message}`);
    return 2;
  }
  if (scanned.error) {
    console.error(`deslop report: ${scanned.error}`);
    return 2;
  }

  const dateStr = new Date().toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });
  const { html, score, verdict, fails, warns } = renderReport({
    siteName: site || scanned.defaultSite,
    clientName: client,
    dateStr,
    scope: scanned.scope,
    findings: scanned.findings,
  });

  fs.writeFileSync(out, html, "utf8");
  console.log(`deslop report: wrote ${path.resolve(out)}`);
  console.log(`  target: ${target} (${scanned.sources.length} source(s))`);
  console.log(`  Slop Score: ${score}/100 (${verdict}) — ${fails} must-fix, ${warns} worth-fixing`);
  return 0;
}

module.exports = { run, renderReport };

if (require.main === module) {
  run(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => { console.error(`deslop report: ${err.message}`); process.exit(2); }
  );
}
