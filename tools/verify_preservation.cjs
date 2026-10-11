#!/usr/bin/env node
/**
 * verify_preservation.cjs — proves the redesign did not change any course content.
 *
 * It loads the ORIGINAL single-page site (from a git revision) and the CURRENT multi-page site in a
 * real browser (Playwright/Chromium) and compares, section by section:
 *
 *   1. TEXT   every text node of each section, in order, whitespace-normalised
 *             (new UI added by scripts is tagged data-ui and is excluded from the comparison)
 *   2. LINKS  every <a href> with its visible text, in order (exact URL match)
 *   3. CODE   the `cf` object of C++ files, byte for byte (SHA-256 per file)
 *   4. SHELL  masthead text, navigation labels, footer text, decorative symbols
 *
 * Usage:
 *   npm install            # once: installs Playwright (dev dependency)
 *   node tools/verify_preservation.cjs [--rev 9e0769a] [--report docs/PRESERVATION-REPORT.md]
 *
 * Environment: CHROME=/path/to/chrome   use an existing Chromium instead of Playwright's own.
 * Exit code 0 = zero differences; 1 = at least one difference (listed in the output).
 */
const { chromium } = require('playwright');
const { execSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : def; };
const REV = arg('--rev', '9e0769a');        // last commit of the original single-page site
const REPORT = arg('--report', null);

/** original page id -> new file */
const PAGES = {
  home: 'index.html', cpp: 'cpp-basics.html', classes: 'class-basics.html', const: 'const-static.html',
  composition: 'composition.html', labs: 'labs.html', code: 'code-files.html',
  quizzes: 'examination-hall.html', links: 'all-links.html'
};

/** Runs inside the browser: text nodes + links of a root, ignoring injected UI. */
function extract(rootSelector) {
  const root = document.querySelector(rootSelector);
  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const skip = (n) => { const p = n.parentElement; return !p || p.closest('[data-ui], script, style, svg, noscript, template'); };
  const texts = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { if (!skip(n)) { const t = norm(n.nodeValue); if (t) texts.push(t); } }
  const links = Array.from(root.querySelectorAll('a[href]')).filter((a) => !a.closest('[data-ui]'))
    .map((a) => ({ text: norm(a.textContent), href: a.getAttribute('href') }));
  return { texts, links };
}

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oop-orig-'));
  const origFile = path.join(tmp, 'original.html');
  fs.writeFileSync(origFile, execSync(`git show ${REV}:index.html`, { cwd: ROOT, maxBuffer: 1 << 26 }));

  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();

  const problems = [];
  const lines = [];
  const note = (s) => { lines.push(s); console.log(s); };
  const fail = (s) => { problems.push(s); note('  ✗ ' + s); };

  /* ── original ── */
  await page.goto('file://' + origFile);
  const orig = {};
  for (const id of Object.keys(PAGES)) orig[id] = await page.evaluate(extract, '#page-' + id);
  orig.shell = await page.evaluate(() => {
    const n = (s) => s.replace(/\s+/g, ' ').trim();
    const t = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => n(e.textContent));
    return {
      kicker: t('.masthead-kicker'), issue: t('.masthead-issue'), h1: t('.masthead-title h1'), subtitle: t('.subtitle'),
      nav: t('.nav-btn'), footer: t('footer span'), symbols: t('.bg-sym'), footerLinks: Array.from(document.querySelectorAll('footer a')).map((a) => a.getAttribute('href')),
      themeLabel: t('#themeLabel')
    };
  });
  const origCf = await page.evaluate(() => JSON.stringify(cf));

  /* ── current ── */
  const cur = {}; let curShell = null; let curCf = null;
  for (const [id, file] of Object.entries(PAGES)) {
    await page.goto('file://' + path.join(ROOT, file));
    await page.waitForSelector('.shell main');
    cur[id] = await page.evaluate(extract, 'main');
    if (id === 'home') {
      curShell = await page.evaluate(() => {
        const n = (s) => s.replace(/\s+/g, ' ').trim();
        const t = (sel) => Array.from(document.querySelectorAll(sel)).map((e) => n(e.textContent));
        return {
          kicker: t('.masthead-kicker'), issue: t('.masthead-issue'), h1: t('.masthead-title h1'), subtitle: t('.subtitle'),
          nav: t('.nav-btn span:not(.sr-only)'), footer: t('.site-footer > span'), symbols: t('.bg-sym'),
          footerLinks: Array.from(document.querySelectorAll('.site-footer a')).map((a) => a.getAttribute('href')),
          themeLabel: t('#themeLabel')
        };
      });
    }
    if (id === 'code') curCf = await page.evaluate(() => JSON.stringify(cf));
  }

  /* ── compare ── */
  note('# Content preservation report\n');
  note(`Original: git revision \`${REV}\` (single-page site) · Current: working tree · ${new Date().toISOString().slice(0, 10)}\n`);
  note('## 1. Text and links per section\n');
  note('| Section | Text nodes (orig → new) | Links (orig → new) | Result |');
  note('|---|---|---|---|');
  for (const id of Object.keys(PAGES)) {
    const a = orig[id], b = cur[id];
    const before = problems.length;
    const textOk = JSON.stringify(a.texts) === JSON.stringify(b.texts);
    if (!textOk) {
      const i = a.texts.findIndex((t, k) => t !== b.texts[k]);
      fail(`${id}: text differs at node ${i}: ORIGINAL «${a.texts[i]}» vs NEW «${b.texts[i]}»`);
    }
    // external links must match exactly; internal navigation links are listed separately
    const ext = (l) => l.filter((x) => /^https?:/.test(x.href));
    const linkOk = JSON.stringify(ext(a.links)) === JSON.stringify(ext(b.links));
    if (!linkOk) {
      const ea = ext(a.links), eb = ext(b.links);
      const i = ea.findIndex((l, k) => !eb[k] || l.href !== eb[k].href || l.text !== eb[k].text);
      fail(`${id}: external link differs at #${i}: ORIGINAL ${JSON.stringify(ea[i])} vs NEW ${JSON.stringify(eb[i])}`);
    }
    note(`| ${id} → ${PAGES[id]} | ${a.texts.length} → ${b.texts.length} | ${ext(a.links).length} → ${ext(b.links).length} external | ${problems.length === before ? '✅ identical' : '❌ differs'} |`);
  }

  note('\n## 2. C++ code files (byte-for-byte)\n');
  note('| File id | Name | SHA-256 (first 12) | Result |');
  note('|---|---|---|---|');
  const A = JSON.parse(origCf), B = JSON.parse(curCf);
  const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
  for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
    const same = A[k] && B[k] && A[k].code === B[k].code && A[k].name === B[k].name;
    if (!same) fail(`code file "${k}" differs or is missing`);
    note(`| ${k} | ${(A[k] || B[k]).name} | ${sha((A[k] || { code: '' }).code).slice(0, 12)} | ${same ? '✅ identical' : '❌ differs'} |`);
  }

  note('\n## 3. Masthead, navigation labels and footer\n');
  for (const key of Object.keys(orig.shell)) {
    const same = JSON.stringify(orig.shell[key]) === JSON.stringify(curShell[key]);
    if (!same) fail(`shell "${key}" differs: ${JSON.stringify(orig.shell[key])} vs ${JSON.stringify(curShell[key])}`);
    note(`- ${key}: ${same ? '✅ identical' : '❌ differs'}`);
  }

  note(`\n## Summary\n\n${problems.length === 0 ? '**Zero unauthorised content changes.**' : `**${problems.length} difference(s) found — see ✗ lines above.**`}`);
  note('\nNot compared (by design): UI that scripts add (tagged `data-ui`: progress buttons, dashboard, pager, search, link filter), '
    + 'and navigation links that changed from `onclick` handlers to real page links.');

  if (REPORT) fs.writeFileSync(path.resolve(ROOT, REPORT), lines.join('\n') + '\n');
  await browser.close();
  process.exit(problems.length ? 1 : 0);
})();
