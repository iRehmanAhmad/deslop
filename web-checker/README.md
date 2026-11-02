# deslop-checker — the live site checker

A Cloudflare Worker for people who **don't read code**: paste a published
site's URL and get a Slop Score, the AI-design tells on the page explained in
plain language, and — for every finding — a **copy-paste fix prompt** to hand
back to the AI builder that made the site (Lovable, Bolt, v0, …).

Live: https://deslop-checker.rehmanahmad.com

## How it works

- `GET /` — a single-page UI, inline in `worker.js`.
- `POST /check` with `{ "url": "https://…" }`:
  - validates the target is a public http(s) URL (scheme allowlist, private /
    reserved IP-literal block, blocked local suffixes, DNS-over-HTTPS check
    that the hostname doesn't resolve to a private address; every redirect
    hop is re-validated),
  - fetches the page (10s timeout, 512 KB cap) plus up to 5 **same-origin**
    stylesheets (256 KB each),
  - runs the deslop engine over the HTML and CSS,
  - returns JSON: score, verdict, and findings with plain-language copy and
    fix prompts (hand-written for all 40 rules in `worker.js`'s COPY map;
    a generic fallback covers any future rule).
- **Slop Score** = `min(100, fails × 12 + warns × 4)`. Higher = more slop.
  Verdicts: 0–15 **Clean** · 16–45 **Mild** · 46+ **Heavy Slop**.

## Files

| File | What |
|---|---|
| `worker.js` | The Worker: router, fetcher, SSRF guards, page UI, plain-language copy. |
| `engine.js` | **Generated** — the pure rule engine, sliced out of `../bin/deslop.js`. Never edit by hand. |
| `sync-engine.js` | Regenerates `engine.js` from `bin/deslop.js`. Run after any rule change: `node web-checker/sync-engine.js` |
| `deploy_cf.py` | Deploys the Worker via the Cloudflare API (multipart module upload), then attaches the custom domain (falls back to workers.dev). |
| `wrangler.toml` | Optional config for `npx wrangler deploy` instead. |

## One source of truth

Rules live **only** in `bin/deslop.js`, between the `ENGINE BEGIN` / `ENGINE
END` markers. The CLI scans local files with them; this Worker scans fetched
pages with the same code via the generated `engine.js`. Edit a rule → run
`sync-engine.js` → redeploy.

## Deploy

```bash
python3 web-checker/deploy_cf.py
```

Uses the `custom.cloudflare` connector credential (surrogate), account
`3c1481e4bc4e8ed685b35584b5e074c5`, Worker name `deslop-checker` — it does
not touch any other Worker or route.
