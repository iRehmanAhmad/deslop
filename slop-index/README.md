# Slop Index — grading each week's launches

The **Slop Index** asks a simple question on a schedule: *of the sites that
launched this week, how many wear the AI-template default — and is the share
going up or down?*

Each run takes the newest ~20 **Show HN** launches that carry a URL (via the
free [Hacker News API](https://github.com/HackerNews/API)), fetches every
site, and grades it with the same machinery as the rest of deslop:

- **Slop Score** — the launch page plus its same-origin stylesheets, scanned
  by the deslop rule engine: `min(100, fails × 12 + warns × 4)`, verdicts
  0–15 Clean, 16–45 Mild, 46+ Heavy Slop.
- **Top layout twin** — the site's Visual Twins fingerprint compared against
  the built-in 10-archetype corpus, with the best match and its similarity.

## Run it

```bash
node slop-index/scan-launches.js            # newest 20 Show HN launches
node slop-index/scan-launches.js --limit 30
```

Fetching is SSRF-guarded exactly like `deslop report` and `deslop twins`
(validate first, refuse private/local targets, re-validate every redirect
hop, byte caps). Sites are fetched one at a time, politely, under a
`deslop-index` user agent. A site that refuses, times out or returns
non-HTML is recorded as a failure in the snapshot — never silently dropped
and never retried into a different answer.

## Output

One snapshot per run, in `slop-index/data/`:

- `YYYY-MM-DD.json` — the full record: every launch, its score, verdict,
  fail/warn counts, stylesheets scanned, top twin, **and its complete Visual
  Twins fingerprint**, plus the failures with their errors.
- `YYYY-MM-DD.md` — the human version: ranked table, sloppiest first.

First snapshot: [`data/2026-11-02.md`](data/2026-11-02.md) — 20 launches
found, 19 scored, average score 31.6.

## Read the numbers honestly

- Scores grade a page's **source**, not a screenshot, and they measure
  template tells, not whether AI was actually used.
- When a launch URL is a page on a big platform (a GitHub repository page is
  the common case), the grade describes the **platform's** page furniture,
  not the maker's design. Those rows are platform scores.
- Heavy scores can be warn-driven: the formula counts many small tells, not
  just the five `fail` rules. The fail/warn split is in the JSON for anyone
  who wants to re-weight it.

## Where this goes (v1 is a starter, on purpose)

1. **Weekly page.** A run every week turns the snapshots into the actual
   Index: a small public page with the current week's table and the running
   average. One snapshot is a measurement; the series is the story.
2. **Trend chart.** With four or more snapshots, chart the weekly average
   and the Heavy-Slop share over time — is the launch slop rising, falling,
   or just moving to a new default (the way it moved to cream + serif)?
3. **Corpus growth.** Every snapshot's fingerprints are real, in-the-wild
   Visual Twins corpus entries. Fed into `deslop twins --corpus`, they let
   the tool answer "your layout's closest twin is a site that launched
   three Tuesdays ago" instead of only naming an archetype.
