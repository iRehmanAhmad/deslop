#!/usr/bin/env node
/* Self-test for the Spot the Slop quiz (classroom-kit/quiz/index.html).
 *
 * No browser needed. It checks:
 *  1. both <script> blocks parse (syntax),
 *  2. the ROUNDS data is well-formed — 10 rounds, 6 slop / 4 human,
 *     every slop round names its tell, every sketch is self-contained,
 *  3. the page is fully offline — no external URLs, no src=, no <link>,
 *  4. the HTML tags balance (script/style treated as raw text),
 *  5. a stub-DOM playthrough: answer every round correctly via the real
 *     click handlers, check the score, the final screen and replay.
 *
 * Run: node classroom-kit/quiz/selftest.js   (exit 0 = all green)
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
let failures = 0;
function check(name, ok, extra) {
  console.log((ok ? '  ok  ' : 'FAIL  ') + name + (extra ? ' — ' + extra : ''));
  if (!ok) failures++;
}

/* ---- 1+2: scripts & data ---- */
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
check('exactly 2 script blocks', scripts.length === 2, 'found ' + scripts.length);
for (let i = 0; i < scripts.length; i++) {
  try { new vm.Script(scripts[i]); check('script block ' + (i + 1) + ' parses', true); }
  catch (e) { check('script block ' + (i + 1) + ' parses', false, e.message); }
}

const dataCtx = {};
vm.createContext(dataCtx);
vm.runInContext(scripts[0] + '\n;this.ROUNDS = ROUNDS;', dataCtx);
const ROUNDS = dataCtx.ROUNDS;
check('ROUNDS is an array of 10', Array.isArray(ROUNDS) && ROUNDS.length === 10);
const slop = ROUNDS.filter(r => r.slop), human = ROUNDS.filter(r => !r.slop);
check('mix is 6 slop / 4 human', slop.length === 6 && human.length === 4,
      slop.length + ' slop, ' + human.length + ' human');
let dataOk = true, why = '';
for (const r of ROUNDS) {
  if (!r.name || !r.url || !r.sketch || !r.why) { dataOk = false; why = 'missing field in ' + (r.name || '?'); break; }
  if (r.slop && !r.tell) { dataOk = false; why = 'slop round without a tell: ' + r.name; break; }
  if (!/class="q-[a-z]+"/.test(r.sketch)) { dataOk = false; why = 'sketch has no q-* scene class: ' + r.name; break; }
  if (/https?:|src=|url\(|@import/.test(r.sketch)) { dataOk = false; why = 'sketch pulls an external resource: ' + r.name; break; }
}
check('every round fully specified, sketches self-contained', dataOk, why);

/* ---- 3: offline ---- */
check('no external URLs anywhere', !/https?:\/\//.test(html));
check('no <link> or src= attributes', !/<link/i.test(html) && !/\ssrc\s*=/.test(html));

/* ---- 4: tag balance ---- */
const VOID = new Set(['meta', 'br', 'img', 'link', 'hr', 'input', 'source']);
const noRaw = html
  .replace(/<script>[\s\S]*?<\/script>/g, '<script></script>')
  .replace(/<style>[\s\S]*?<\/style>/g, '<style></style>')
  .replace(/<!--[\s\S]*?-->/g, '')
  .replace(/<!DOCTYPE[^>]*>/i, '');
const stack = [];
let balOk = true, balWhy = '';
for (const m of noRaw.matchAll(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)[^>]*?(\/?)>/g)) {
  const [, closing, tagRaw, selfClose] = m;
  const tag = tagRaw.toLowerCase();
  if (VOID.has(tag) || selfClose) continue;
  if (!closing) stack.push(tag);
  else if (stack.pop() !== tag) { balOk = false; balWhy = 'mismatched </' + tag + '>'; break; }
}
if (balOk && stack.length) { balOk = false; balWhy = 'unclosed: ' + stack.join(','); }
check('HTML tags balance', balOk, balWhy);

/* ---- 5: stub-DOM playthrough ---- */
function makeEl(id) {
  return {
    id, innerHTML: '', textContent: '', className: '', disabled: false,
    style: {}, listeners: {},
    addEventListener(ev, fn) { this.listeners[ev] = fn; },
    click() { if (this.listeners.click) this.listeners.click(); }
  };
}
const els = {};
const documentStub = {
  getElementById(id) { return els[id] || (els[id] = makeEl(id)); }
};
const gameCtx = { document: documentStub, console };
vm.createContext(gameCtx);
vm.runInContext(scripts[0] + '\n' + scripts[1], gameCtx);

let playOk = true, playWhy = '';
try {
  if (!/Round 1 of 10/.test(els.roundLabel.textContent)) throw new Error('round 1 not rendered');
  for (let i = 0; i < ROUNDS.length; i++) {
    const correctBtn = ROUNDS[i].slop ? els.btnSlop : els.btnHuman;
    const before = els.scoreLabel.textContent;
    correctBtn.click();
    correctBtn.click(); // double-click must not double-count
    const expected = 'Score: ' + (i + 1);
    if (els.scoreLabel.textContent !== expected)
      throw new Error('round ' + (i + 1) + ': score "' + els.scoreLabel.textContent + '" != "' + expected + '" (was "' + before + '")');
    if (!/Correct/.test(els.feedback.innerHTML)) throw new Error('round ' + (i + 1) + ': no Correct feedback');
    if (ROUNDS[i].slop && !els.feedback.innerHTML.includes(ROUNDS[i].tell))
      throw new Error('round ' + (i + 1) + ': feedback does not name the tell');
    els.btnNext.click();
  }
  if (els.game.style.display !== 'none') throw new Error('game not hidden at end');
  if (!/show/.test(els.final.className)) throw new Error('final screen not shown');
  if (els.finalScore.textContent !== '10/10') throw new Error('final score is "' + els.finalScore.textContent + '", not 10/10');
  // replay resets
  els.btnAgain.click();
  if (!/Round 1 of 10/.test(els.roundLabel.textContent)) throw new Error('replay does not reset to round 1');
  // a wrong answer scores nothing and says "Not quite"
  els.btnSlop.click(); // round 1 IS slop... pick the wrong one for round 2 instead
  els.btnNext.click();
  els.btnSlop.click(); // round 2 (bakery) is human — wrong
  if (!/Not quite/.test(els.feedback.innerHTML)) throw new Error('wrong answer not flagged');
  if (els.scoreLabel.textContent !== 'Score: 1') throw new Error('wrong answer changed the score');
} catch (e) { playOk = false; playWhy = e.message; }
check('stub-DOM playthrough (10/10, feedback, replay, wrong-answer)', playOk, playWhy);

console.log(failures === 0 ? '\nALL CHECKS PASSED' : '\n' + failures + ' CHECK(S) FAILED');
process.exit(failures === 0 ? 0 : 1);
