#!/usr/bin/env node
/**
 * verify_analytics.cjs — browser test for the custom GA4 events in assets/js/analytics.js.
 *
 * Serves the site locally, opens it in Chromium (Playwright) and drives the real UI. Every request to
 * Google except the gtag.js library itself is answered locally with "204 No Content", so NOTHING
 * reaches the production GA4 property. The intercepted /g/collect hits prove the page_view (and the
 * custom events) still leave the page; window.dataLayer shows exactly what gtag received.
 *
 * Usage:
 *   npm install                       # once (Playwright is the repo's existing dev dependency)
 *   node tools/verify_analytics.cjs   # or: npm run verify:analytics
 * Environment: CHROME=/path/to/chrome   use an existing Chromium instead of Playwright's own.
 * Exit code 0 = every check passed.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
/** Every parameter a custom event may carry — anything else would be a privacy regression. */
const ALLOWED = ['lesson_id', 'lesson_name', 'completion_method', 'lab_number', 'code_file', 'page_path', 'resource_type', 'resource_name'];
const CUSTOM = /^(lesson_|lab_|code_|learning_resource_)/;
const TID = 'G-4JHKFQBZ63';

let failures = 0;
function check(name, ok, detail) {
  if (!ok) failures++;
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok || detail === undefined ? '' : '\n        ' + JSON.stringify(detail)));
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Poll until fn() is truthy (gtag.js batches hits for a few seconds). */
async function until(fn, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (fn()) return true;
  return !!fn();
}

/** Minimal static file server for the repo root. */
function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(ROOT, decodeURIComponent(req.url.split(/[?#]/)[0]).replace(/\/$/, '/index.html'));
    if (!file.startsWith(ROOT) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

/** GA4 collect request → [{ en, params }] (one entry per event; batched POST bodies hold several). */
function parseHit(req) {
  const base = Object.fromEntries(new URL(req.url()).searchParams);
  const lines = (req.postData() || '').split(/\r?\n/).filter(Boolean);
  return (lines.length ? lines : ['']).map((l) => Object.assign({}, base, Object.fromEntries(new URLSearchParams(l))));
}

(async () => {
  const server = await serve();
  const BASE = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE.slice(0, -1) });

  let hits = []; // collect hits for TID only
  const otherTids = new Set();
  let mode = 'normal'; // normal | blockGtag | noTag
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(BASE)) {
      if (mode === 'noTag' && req.resourceType() === 'document') {
        const res = await route.fetch();
        const body = (await res.text()).replace(/<!-- Google tag \(gtag\.js\) -->[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/, '');
        return route.fulfill({ response: res, body });
      }
      return route.continue();
    }
    if (/googletagmanager\.com\/gtag\/js/.test(url)) return mode === 'normal' ? route.continue() : route.abort();
    if (/\/g\/collect/.test(url)) {
      const parsed = parseHit(req);
      parsed.forEach((h) => { if (h.tid !== TID) otherTids.add(h.tid); });
      hits = hits.concat(parsed.filter((h) => h.tid === TID));
    }
    // Nothing leaves this machine. CORS headers as Google sends them, or gtag.js retries the hit.
    return route.fulfill({ status: 204, body: '', headers: { 'access-control-allow-origin': BASE.slice(0, -1), 'access-control-allow-credentials': 'true' } });
  });

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // Keep every click on this page: no navigation, no new tabs (our listener on document still runs first).
  await page.addInitScript(() => {
    ['click', 'auxclick'].forEach((t) => window.addEventListener(t, (e) => { if (e.target.closest && e.target.closest('a[href]')) e.preventDefault(); }));
  });

  /** Custom events gtag has received on the current page, as [name, params]. */
  const events = () => page.evaluate(() => (window.dataLayer || [])
    .filter((a) => a[0] === 'event').map((a) => [a[1], a[2]]));
  const custom = async () => (await events()).filter((e) => CUSTOM.test(e[0]));
  /** Run an action and return the custom events it produced. */
  async function during(action) {
    const before = (await custom()).length;
    await action();
    await sleep(150);
    return (await custom()).slice(before);
  }
  const open = async (file) => { await page.goto(BASE + file); await page.waitForFunction(() => window.OOP && OOP.features && document.querySelector('.sidebar, #sbProgress')); };
  const store = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k.startsWith('oop-')).sort().map((k) => [k, localStorage.getItem(k)])));
  const all = [];
  const keep = (evts) => { all.push(...evts); return evts; };

  /* ── Existing student data (as an older visitor would have it) ── */
  console.log('\nSetup — seed existing progress and bookmarks');
  await page.goto(BASE + 'index.html');
  await page.evaluate(() => {
    localStorage.setItem('oop-progress', JSON.stringify({ topics: { cpp: true }, labs: { '01': true } }));
    localStorage.setItem('oop-bookmarks', JSON.stringify([{ key: 'page:cpp', label: 'C++ Revision', href: 'cpp-revision.html' }]));
  });

  /* ── 1. Page views ── */
  console.log('\n1. Existing page_view tracking');
  hits = [];
  await open('index.html');
  await until(() => hits.some((h) => h.en === 'page_view'), 10000);
  await sleep(2000); // room for an (unwanted) second one
  const pv = hits.filter((h) => h.en === 'page_view');
  check('index.html sends exactly one page_view to ' + TID, pv.length === 1, hits.map((h) => h.en));
  check('opening a page sends no custom event', (await custom()).length === 0, await custom());

  /* ── 2. Lessons ── */
  console.log('\n2. Lesson completion (class-basics.html)');
  await open('class-basics.html');
  check('opening a topic page sends no completion event', (await custom()).length === 0, await custom());
  const btn = page.locator('.pg-actions .complete-btn').first();
  let ev = keep(await during(() => btn.click()));
  check('complete → one lesson_complete', same(ev, [['lesson_complete', { lesson_id: 'classes', lesson_name: 'Class Basics', completion_method: 'manual' }]]), ev);
  ev = keep(await during(() => btn.click()));
  check('reverse → one lesson_uncomplete', same(ev, [['lesson_uncomplete', { lesson_id: 'classes', lesson_name: 'Class Basics', completion_method: 'manual' }]]), ev);
  ev = keep(await during(() => btn.click()));
  check('complete again → one lesson_complete', ev.length === 1 && ev[0][0] === 'lesson_complete', ev);
  ev = await during(() => page.evaluate(() => OOP.progress.setDone('classes', true)));
  check('setDone on an already-complete lesson sends nothing', ev.length === 0, ev);
  await open('class-basics.html');
  check('refresh sends no completion event', (await custom()).length === 0, await custom());
  check('progress kept: cpp (seeded) + classes', same(JSON.parse((await store())['oop-progress']).topics, { cpp: true, classes: true }), await store());

  /* ── 3. Labs ── */
  console.log('\n3. Lab completion (labs.html)');
  await open('labs.html');
  check('opening Labs sends nothing', (await custom()).length === 0, await custom());
  const lab = (n) => page.locator('.qcard', { hasText: 'Lab ' + n + ' ·' }).locator('.complete-btn');
  ev = keep(await during(() => lab('03').click()));
  check('Lab 03 done → lab_complete', same(ev, [['lab_complete', { lab_number: '03', completion_method: 'manual' }]]), ev);
  ev = keep(await during(() => lab('03').click()));
  check('Lab 03 undone → lab_uncomplete', same(ev, [['lab_uncomplete', { lab_number: '03', completion_method: 'manual' }]]), ev);
  ev = keep(await during(() => lab('01').click()));
  check('seeded Lab 01 undone → lab_uncomplete', same(ev, [['lab_uncomplete', { lab_number: '01', completion_method: 'manual' }]]), ev);
  ev = keep(await during(() => lab('01').click()));
  check('Lab 01 done again → lab_complete', same(ev, [['lab_complete', { lab_number: '01', completion_method: 'manual' }]]), ev);
  check('lab progress kept: { "01": true }', same(JSON.parse((await store())['oop-progress']).labs, { '01': true }), await store());

  /* ── 4. Code viewer ── */
  console.log('\n4. Code viewer (code-files.html)');
  await open('code-files.html#sep');
  check('first render (deep link #sep) sends no code_file_view', (await custom()).length === 0, await custom());
  ev = keep(await during(() => page.click('#tab-revision2')));
  check('click another tab → code_file_view', same(ev, [['code_file_view', { code_file: 'Revision2.cpp' }]]), ev);
  ev = await during(() => page.click('#tab-revision2'));
  check('click the active tab again → nothing', ev.length === 0, ev);
  ev = keep(await during(() => page.keyboard.press('ArrowRight')));
  check('ArrowRight to next tab → one code_file_view', ev.length === 1 && ev[0][0] === 'code_file_view', ev);
  ev = keep(await during(() => page.evaluate(() => { location.hash = '#dma:3'; })));
  check('in-page jump (#dma:3, as search does) → code_file_view', ev.length === 1 && ev[0][0] === 'code_file_view', ev);
  const fileName = await page.evaluate(() => cf.dma.name);
  ev = keep(await during(async () => { await page.click('#copyBtn'); await sleep(300); }));
  check('successful copy → code_copy with file + path only', same(ev, [['code_copy', { code_file: fileName, page_path: '/code-files.html' }]]), ev);
  check('clipboard really holds the code', (await page.evaluate(() => navigator.clipboard.readText())) === (await page.evaluate(() => cf.dma.code)));
  await sleep(1100);
  ev = await during(async () => {
    await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); document.execCommand = () => false; });
    await page.click('#copyBtn');
    await sleep(300);
  });
  check('failed copy → no code_copy, button says "Copy failed"', ev.length === 0 && (await page.textContent('#copyBtn')) === 'Copy failed', ev);

  /* ── 5. Resource links ── */
  console.log('\n5. Learning-resource clicks');
  const linkCases = [
    ['cpp-revision.html', '#main a.chip:has-text("Intro")', { resource_type: 'video', resource_name: 'Intro', lesson_id: 'cpp' }],
    ['cpp-revision.html', '#main a.chip:has-text("C++_Basics_Guide.pdf")', { resource_type: 'pdf', resource_name: 'C++_Basics_Guide.pdf', lesson_id: 'cpp' }],
    ['cpp-revision.html', '#main a.chip:has-text("Revision1")', { resource_type: 'code_example', resource_name: 'Revision1', lesson_id: 'cpp' }],
    ['cpp-revision.html', '#main a.chip:has-text("Quiz1_2025")', { resource_type: 'quiz', resource_name: 'Quiz1_2025', lesson_id: 'cpp' }],
    ['cpp-revision.html', '#main a.chip:has-text("LAB1_2025")', { resource_type: 'lab', resource_name: 'LAB1_2025', lesson_id: 'cpp' }],
    ['cpp-revision.html', '#main .pull a', { resource_type: 'document', resource_name: 'notebook', lesson_id: 'cpp' }],
    ['labs.html', '.qcard:has-text("Lab 01 ·") a:has-text("Video Walkthrough")', { resource_type: 'video', resource_name: 'Lab 01 · C++ Revision — Video Walkthrough', lesson_id: 'labs' }],
    ['all-links.html', 'a:has-text("Lecture Slides")', { resource_type: 'slides', resource_name: 'Lecture Slides (Drive)' }],
    ['all-links.html', 'a:has-text("Past Labs")', { resource_type: 'folder', resource_name: 'Past Labs (Drive)' }],
    ['all-links.html', 'a:has-text("Find the Errors (PDF)")', { resource_type: 'pdf', resource_name: 'Find the Errors (PDF)' }],
    ['all-links.html', 'a:has-text("OOP — Revision (Doc)")', { resource_type: 'document', resource_name: 'OOP — Revision (Doc)' }],
    ['all-links.html', 'a:has-text("GitHub Repository")', { resource_type: 'external_website', resource_name: 'GitHub Repository' }],
    ['all-links.html', 'a.vl:has-text("01 · Introduction to C++")', { resource_type: 'video', resource_name: '01 · Introduction to C++' }],
    ['index.html', '#main a:has-text("Recorded Lectures")', { resource_type: 'video', resource_name: 'Recorded Lectures' }]
  ];
  let current = '';
  for (const [file, sel, want] of linkCases) {
    if (file !== current) { await open(file); current = file; }
    ev = keep(await during(() => page.locator(sel).first().click()));
    check(file + ' ' + want.resource_name + ' → ' + want.resource_type, same(ev, [['learning_resource_click', want]]), ev);
  }
  await open('cpp-revision.html');
  await sleep(1100);
  ev = keep(await during(() => page.locator('#main a.chip:has-text("Intro")').click({ button: 'middle' })));
  check('middle-click (new tab) counts once', ev.length === 1 && ev[0][0] === 'learning_resource_click', ev);
  ev = await during(() => page.locator('#main .concept').first().click());
  check('"Key Concepts" placeholder → nothing', ev.length === 0, ev);
  ev = await during(() => page.locator('.pager a').first().click());
  check('previous/next pager → nothing', ev.length === 0, ev);
  ev = await during(() => page.locator('.nav-btn').nth(3).click());
  check('sidebar navigation → nothing', ev.length === 0, ev);
  await open('all-links.html');
  ev = await during(() => page.locator('a:has-text("Specific Lab Index")').click());
  check('internal page link (labs.html) → nothing', ev.length === 0, ev);

  /* ── 6. Network: custom events really reach (the intercepted) GA endpoint ── */
  console.log('\n6. Custom events leave the page via gtag.js');
  hits = [];
  await open('class-basics.html');
  await page.locator('.pg-actions .complete-btn').first().click(); // classes → incomplete
  await until(() => hits.some((h) => h.en === 'lesson_uncomplete'), 15000);
  await sleep(2000);
  const hit = hits.filter((h) => h.en === 'lesson_uncomplete');
  check('one lesson_uncomplete hit in /g/collect with ep.lesson_id=classes', hit.length === 1 && hit[0]['ep.lesson_id'] === 'classes' && hit[0]['ep.completion_method'] === 'manual', hits.map((h) => h.en));
  hits = [];
  await open('code-files.html');
  for (const id of ['revision2', 'sep', 'dma']) await page.click('#tab-' + id);
  await until(() => hits.filter((h) => h.en === 'code_file_view').length >= 3, 15000);
  await sleep(2000);
  check('3 tab switches → 3 code_file_view hits and still 1 page_view', same(hits.map((h) => h.en).sort(), ['code_file_view', 'code_file_view', 'code_file_view', 'page_view']), hits.map((h) => h.en));

  /* ── 7. Privacy ── */
  console.log('\n7. Privacy');
  const keys = [...new Set(all.flatMap((e) => Object.keys(e[1])))];
  check('only whitelisted parameters were sent (' + keys.join(', ') + ')', keys.every((k) => ALLOWED.includes(k)), keys);
  check('no value contains code, e-mail or exceeds 100 chars',
    all.every((e) => Object.values(e[1]).every((v) => String(v).length <= 100 && !/#include|\n|@/.test(String(v)))));
  check('no new localStorage keys', Object.keys(await store()).every((k) => ['oop-progress', 'oop-bookmarks', 'oop-achievements', 'oop-last', 'oop-recent', 'oop-seen', 'oop-code-wrap', 'oop-reading', 'oop-theme'].includes(k)), Object.keys(await store()));

  /* ── 8. GA unavailable ── */
  console.log('\n8. Site without Google Analytics');
  for (const m of ['blockGtag', 'noTag']) {
    mode = m;
    await open('class-basics.html');
    const before = JSON.parse((await store())['oop-progress']).topics.classes;
    await page.locator('.pg-actions .complete-btn').first().click();
    const after = JSON.parse((await store())['oop-progress']).topics.classes;
    const gtagType = await page.evaluate(() => typeof window.gtag);
    check(m + ': completion still works (gtag is ' + gtagType + ')', !!before !== !!after && (await page.locator('.toast').count()) > 0);
    await open('code-files.html');
    await page.click('#tab-sep');
    check(m + ': code viewer still switches files', (await page.textContent('#efname')) === (await page.evaluate(() => cf.sep.name)));
  }
  mode = 'normal';
  await open('labs.html');
  await page.evaluate(() => { window.gtag = () => { throw new Error('broken gtag'); }; });
  const r = await page.evaluate(() => OOP.progress.toggleLab('05'));
  check('gtag that throws: toggleLab still returns and saves', r === true && JSON.parse((await store())['oop-progress']).labs['05'] === true);
  await page.evaluate(() => OOP.progress.toggleLab('05'));

  /* ── 9. Errors ── */
  console.log('\n9. Console');
  check('no uncaught JavaScript errors on any page', pageErrors.length === 0, pageErrors);

  await browser.close();
  server.close();
  if (otherTids.size) console.log('\nNOTE: the Google tag also forwards every hit to: ' + [...otherTids].join(', ') + ' (configured in Google tag settings, not in this repo)');
  console.log('\n' + (failures ? failures + ' check(s) FAILED' : 'All checks passed'));
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
