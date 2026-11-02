#!/usr/bin/env node
/**
 * build-corpus.js — regenerate the built-in Visual Twins corpus.
 *
 * Reads the hand-authored archetype pages in twins-corpus/fixtures/,
 * fingerprints each one with bin/deslop-twins.js itself, and writes the
 * fingerprint JSON files the twins command loads by default. Run after
 * editing a fixture or the fingerprint code:
 *
 *   node twins-corpus/build-corpus.js
 *
 * The archetypes are original, illustrative pages written for this repo
 * (a generic SaaS landing, a docs site, a link-in-bio page…) — never
 * scraped from real brand sites.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { fingerprint } = require("../bin/deslop-twins.js");

const ARCHETYPES = [
  { slug: "saas-tailwind", file: "saas-tailwind.html",
    name: "Generic SaaS landing (Tailwind default)",
    description: "The archetypal AI-generated SaaS page: gradient hero, logo strip, card features, pricing tiers, FAQ, CTA." },
  { slug: "shadcn-dashboard", file: "shadcn-dashboard.html",
    name: "shadcn-style dashboard landing",
    description: "Zinc neutrals, thin borders, small radius, Inter — the shadcn/ui landing-page look." },
  { slug: "cream-serif-agency", file: "cream-serif-agency.html",
    name: "Cream + serif agency",
    description: "Warm cream background, serif display type, earthy accent — the boutique agency template." },
  { slug: "docs-site", file: "docs-site.html",
    name: "Documentation site",
    description: "Sidebar navigation, dense sections, code blocks — a framework docs page." },
  { slug: "blog-magazine", file: "blog-magazine.html",
    name: "Blog / magazine",
    description: "Serif masthead, featured story, article index, newsletter block." },
  { slug: "portfolio-minimal", file: "portfolio-minimal.html",
    name: "Minimal portfolio",
    description: "Black on white, huge whitespace, a work grid and a short bio — the minimal creative portfolio." },
  { slug: "ecommerce-product", file: "ecommerce-product.html",
    name: "E-commerce product page",
    description: "Product hero with price, spec grid, reviews, FAQ — a single-product store page." },
  { slug: "link-in-bio", file: "link-in-bio.html",
    name: "Link-in-bio page",
    description: "Avatar, one-line bio and a stack of pill link buttons — the Linktree shape." },
  { slug: "coming-soon", file: "coming-soon.html",
    name: "Coming soon / waitlist",
    description: "One dark hero, one email field, nothing else — the pre-launch placeholder page." },
  { slug: "course-landing", file: "course-landing.html",
    name: "Online course landing",
    description: "Hero, employer logos, curriculum cards, student quotes, one-time pricing, FAQ, deadline CTA." },
];

function main() {
  const here = __dirname;
  for (const a of ARCHETYPES) {
    const html = fs.readFileSync(path.join(here, "fixtures", a.file), "utf8");
    const fp = fingerprint(html, "");
    const out = {
      name: a.name,
      description: a.description,
      source: `twins-corpus/fixtures/${a.file} (hand-authored archetype, fingerprinted by deslop-twins)`,
      fingerprint: fp,
    };
    const dest = path.join(here, `${a.slug}.json`);
    fs.writeFileSync(dest, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log(`wrote ${a.slug}.json — sections: ${fp.sections.join(" → ") || "(none)"} · palette: ${fp.palette.join(" ") || "(none)"} · fonts: ${fp.fonts.join(", ") || "(none)"}`);
  }
}

if (require.main === module) main();
