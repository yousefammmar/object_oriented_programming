#!/usr/bin/env node
/**
 * verify_analytics.cjs — 90 browser test cases for the custom GA4 events (assets/js/analytics.js).
 *
 * Serves the site locally (also under /object_oriented_programming/, like GitHub Pages) and drives the
 * real UI in Chromium with the real gtag.js. Every request to Google except gtag.js itself is answered
 * locally with "204 No Content", so NOTHING reaches the GA4 properties. Custom events are read from
 * window.dataLayer (what gtag receives); intercepted /g/collect hits show what GA4 would receive.
 *
 * Groups: A page load + page_view (1–17)   B lessons (18–34)        C labs (35–47)
 *         D code viewer (48–63)            E resource links (64–79) F GA missing / blocked / broken (80–87)
 *         G privacy + GA4 wire data (88–90)
 * Every case prepares its own state, and fails on any uncaught page error.
 *
 * Usage:
 *   npm install && npx playwright install chromium   # once
 *   node tools/verify_analytics.cjs                  # all cases  (npm run verify:analytics)
 *   node tools/verify_analytics.cjs 18 83            # only some cases
 * Environment: CHROME=/path/to/chrome   use an existing Chromium instead of Playwright's own.
 * Exit code 0 = every case passed.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SUB = 'object_oriented_programming/'; // GitHub Pages project path
const TID = 'G-4JHKFQBZ63';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const PAGES = ['index.html', 'cpp-revision.html', 'class-basics.html', 'const-static.html', 'composition.html', 'dynamic-memory.html',
  'this-pointer.html', 'friend-functions.html', 'inheritance.html', 'polymorphism.html', 'operator-overloading.html', 'labs.html',
  'code-files.html', 'revision-hall.html', 'examination-hall.html', 'all-links.html'];
const TOPICS = [['cpp', 'C++ Revision', 'cpp-revision.html'], ['classes', 'Class Basics', 'class-basics.html'],
  ['const', 'Const & Static', 'const-static.html'], ['composition', 'Composition', 'composition.html'],
  ['dma', 'Dynamic Memory', 'dynamic-memory.html'], ['this', 'this Pointer', 'this-pointer.html'],
  ['friend', 'Friend Functions', 'friend-functions.html'], ['inheritance', 'Inheritance', 'inheritance.html'],
  ['polymorphism', 'Polymorphism', 'polymorphism.html'], ['operators', 'Operator Overloading', 'operator-overloading.html'],
  ['labs', 'Labs', 'labs.html']];
const LABS = [['01', 'C++ Revision'], ['02', 'Pointers & Memory'], ['03', 'Classes Intro'], ['04', 'Ctors & Dtors'],
  ['05', 'Const & Static'], ['06', 'Composition'], ['07', 'Overloading'], ['08', 'Inheritance 1'], ['09', 'Inheritance 2'],
  ['10', 'Polymorphism']];
const EVENTS = ['lesson_complete', 'lesson_uncomplete', 'lab_complete', 'lab_uncomplete', 'code_copy', 'code_file_view', 'learning_resource_click'];
const PARAMS = ['lesson_id', 'lesson_name', 'completion_method', 'lab_number', 'code_file', 'code_page_path', 'resource_type', 'resource_name'];
const RESOURCE_TYPES = ['video', 'code_example', 'quiz', 'lab', 'pdf', 'slides', 'folder', 'document', 'external_website'];
const STORAGE_KEYS = ['oop-progress', 'oop-bookmarks', 'oop-achievements', 'oop-last', 'oop-recent', 'oop-seen', 'oop-code-wrap', 'oop-reading', 'oop-theme'];
/** resource_name values that say nothing on their own. */
const GENERIC = /^(notebook|notes|video|video walkthrough|solution drive|written solution|link|here|pdf|slides|download)$/i;
/** Representative links: [page, selector, expected params]. */
const LINKS = [
  ['cpp-revision.html', '#main a.chip:has-text("Intro")', { resource_type: 'video', resource_name: 'Intro', lesson_id: 'cpp' }],
  ['cpp-revision.html', '#main a.chip:has-text("C++_Basics_Guide.pdf")', { resource_type: 'pdf', resource_name: 'C++_Basics_Guide.pdf', lesson_id: 'cpp' }],
  ['cpp-revision.html', '#main a.chip:has-text("Revision1")', { resource_type: 'code_example', resource_name: 'Revision1', lesson_id: 'cpp' }],
  ['cpp-revision.html', '#main a.chip:has-text("Quiz1_2025")', { resource_type: 'quiz', resource_name: 'Quiz1_2025', lesson_id: 'cpp' }],
  ['cpp-revision.html', '#main a.chip:has-text("LAB1_2025")', { resource_type: 'lab', resource_name: 'LAB1_2025', lesson_id: 'cpp' }],
  ['all-links.html', 'a:has-text("OOP — Revision (Doc)")', { resource_type: 'document', resource_name: 'OOP — Revision (Doc)' }],
  ['labs.html', '.qcard:has-text("Lab 01 ·") a:has-text("Video Walkthrough")', { resource_type: 'video', resource_name: 'Lab 01 · C++ Revision — Video Walkthrough', lesson_id: 'labs' }],
  ['all-links.html', 'a:has-text("Lecture Slides")', { resource_type: 'slides', resource_name: 'Lecture Slides (Drive)' }],
  ['all-links.html', 'a:has-text("Past Labs")', { resource_type: 'folder', resource_name: 'Past Labs (Drive)' }],
  ['all-links.html', 'a:has-text("GitHub Repository")', { resource_type: 'external_website', resource_name: 'GitHub Repository' }]
];

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Poll until fn() is truthy (gtag.js batches hits for a few seconds). */
async function until(fn, ms) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(200)) if (await fn()) return true;
  return !!(await fn());
}
/** Assertion inside a case. */
function must(ok, msg, detail) {
  if (!ok) throw Object.assign(new Error(msg), { detail });
}

/** Static server for the repo root, also reachable under /object_oriented_programming/. */
function serve() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split(/[?#]/)[0]).replace(/^\//, '');
    if (rel.startsWith(SUB)) rel = rel.slice(SUB.length);
    const file = path.join(ROOT, rel || 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404, { 'Content-Type': 'text/html' });
      return res.end('<!doctype html><title>blank</title>');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

/** GA4 collect request → one object per event (batched POST bodies hold several). */
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

  /* ── Network: what each case's "mode" changes ── */
  let mode = 'normal'; // normal | blockGtag | slowGtag | noTag | blockAnalytics | noStorage | optOut
  let hits = []; // collect hits for TID
  let gtagReleasedAt = 0;
  const otherTids = new Set();
  const INJECT = {
    noStorage: "<script>Object.defineProperty(window,'localStorage',{get:function(){throw new DOMException('blocked','SecurityError');}});</script>",
    optOut: "<script>window['ga-disable-G-4JHKFQBZ63']=true;window['ga-disable-G-FEC09FLLMC']=true;</script>"
  };
  await ctx.route('**/*', async (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(BASE)) {
      if (mode === 'blockAnalytics' && /\/assets\/js\/analytics\.js/.test(url)) return route.abort('blockedbyclient');
      if (req.resourceType() === 'document' && (mode === 'noTag' || INJECT[mode])) {
        const res = await route.fetch();
        let body = await res.text();
        body = mode === 'noTag'
          ? body.replace(/<!-- Google tag \(gtag\.js\) -->[\s\S]*?<\/script>\s*<script>[\s\S]*?<\/script>/, '')
          : body.replace(/<head>/i, '<head>' + INJECT[mode]);
        return route.fulfill({ response: res, body });
      }
      return route.continue();
    }
    if (/googletagmanager\.com\/gtag\/js/.test(url)) {
      if (mode === 'blockGtag') return route.abort('blockedbyclient');
      if (mode === 'slowGtag') { await sleep(3000); gtagReleasedAt = Date.now(); }
      return route.continue();
    }
    if (/\/g\/collect/.test(url)) {
      parseHit(req).forEach((h) => { if (h.tid === TID) hits.push(h); else otherTids.add(h.tid); });
    }
    // Nothing leaves this machine. CORS headers as Google sends them, or gtag.js retries the hit.
    return route.fulfill({ status: 204, body: '', headers: { 'access-control-allow-origin': BASE.slice(0, -1), 'access-control-allow-credentials': 'true' } });
  });

  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  // Links never navigate or open tabs during the tests (the site's own listeners still run first).
  await page.addInitScript(() => {
    ['click', 'auxclick'].forEach((t) => window.addEventListener(t, (e) => {
      if (e.target.closest && e.target.closest('a[href]')) e.preventDefault();
    }));
  });

  /* ── Helpers ── */
  const all = []; // every custom event seen, for the privacy case
  const custom = () => page.evaluate(() => (window.dataLayer || [])
    .filter((a) => a[0] === 'event' && /^(lesson_|lab_|code_|learning_resource_)/.test(a[1])).map((a) => [a[1], a[2]]));
  /** Run an action (that does not navigate) and return the custom events it produced. */
  async function during(action) {
    const before = (await custom()).length;
    await action();
    await sleep(150);
    const ev = (await custom()).slice(before);
    all.push(...ev);
    return ev;
  }
  const waitApp = () => page.waitForFunction(() => !!document.querySelector('#sbProgress .sb-card'));
  async function open(file) { await page.goto(BASE + file); await waitApp(); }
  /** Start from a clean localStorage, optionally seeded ({ key: string | JSON value }). */
  async function prep(seed) {
    await page.goto(BASE + '__blank');
    await page.evaluate((s) => {
      localStorage.clear();
      Object.keys(s).forEach((k) => localStorage.setItem(k, typeof s[k] === 'string' ? s[k] : JSON.stringify(s[k])));
    }, seed || {});
  }
  const store = () => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).sort().map((k) => [k, localStorage.getItem(k)])));
  const progress = async () => JSON.parse((await store())['oop-progress'] || 'null');
  const completeBtn = () => page.locator('.pg-actions .complete-btn').first();
  const labBtn = (n) => page.locator('.qcard', { hasText: 'Lab ' + n + ' ·' }).locator('.complete-btn');
  const pressed = async (loc) => (await loc.getAttribute('aria-pressed')) === 'true';
  const copyText = () => page.textContent('#copyBtn');
  const copyDone = () => until(async () => (await copyText()) !== 'Copy', 3000);
  const fileName = (id) => page.evaluate((i) => cf[i].name, id);

  /** Core features still work (used when GA is missing/blocked/broken). */
  async function siteStillWorks() {
    await open('class-basics.html');
    await completeBtn().click();
    must(await pressed(completeBtn()) && await page.evaluate(() => OOP.progress.isDone('classes')), 'topic completion broken');
    must(await page.locator('.toast').count() > 0, 'no confirmation toast');
    await page.locator('#main a.chip').first().click();
    await open('labs.html');
    await labBtn('05').click();
    must(await pressed(labBtn('05')) && await page.evaluate(() => OOP.progress.isLabDone('05')), 'lab toggle broken');
    await open('code-files.html');
    await page.click('#tab-sep');
    must((await page.textContent('#efname')) === await fileName('sep'), 'tab switch broken');
    await page.click('#copyBtn');
    await copyDone();
    must((await copyText()) === 'Copied!', 'copy broken', await copyText());
  }

  /* ── Cases ── */
  const cases = [];
  const tc = (title, fn) => cases.push({ title, fn });

  /* A. Page load and page_view (1–17) */
  PAGES.forEach((file) => tc(file + ': analytics.js loads right after config.js; one page_view; no custom event on load', async () => {
    await prep();
    hits = [];
    await open(file);
    const src = await page.evaluate(() => [...document.scripts].map((s) => (s.getAttribute('src') || '').replace('assets/js/', '')).filter(Boolean));
    const i = src.indexOf('analytics.js');
    must(i > 0 && src[i - 1] === 'config.js' && i < src.indexOf('progress.js'), 'script order', src);
    await until(() => hits.some((h) => h.en === 'page_view'), 10000);
    await sleep(1500); // room for an unwanted second one
    const pv = hits.filter((h) => h.en === 'page_view');
    must(pv.length === 1 && pv[0].dl.endsWith('/' + file), 'page_view hits', hits.map((h) => h.en + ' ' + h.dl));
    must((await custom()).length === 0, 'custom event on load', await custom());
  }));
  tc('Redirect stubs cpp-basics.html / class-revision.html still forward to their pages', async () => {
    for (const [from, to] of [['cpp-basics.html', 'cpp-revision.html'], ['class-revision.html', 'class-basics.html']]) {
      await page.goto(BASE + from);
      await page.waitForURL('**/' + to, { timeout: 10000 });
      await waitApp();
    }
  });

  /* B. Lessons (18–34) */
  TOPICS.forEach(([id, name, file]) => tc(file + ': "Mark as completed" → one lesson_complete (' + id + ')', async () => {
    await prep();
    await open(file);
    const ev = await during(() => completeBtn().click());
    must(same(ev, [['lesson_complete', { lesson_id: id, lesson_name: name, completion_method: 'manual' }]]), 'events', ev);
    must((await progress()).topics[id] === true && await pressed(completeBtn()), 'not saved / not shown', await progress());
  }));
  tc('Un-ticking a completed topic → one lesson_uncomplete with the same parameters', async () => {
    await prep({ 'oop-progress': { topics: { inheritance: true }, labs: {} } });
    await open('inheritance.html');
    must(await pressed(completeBtn()), 'seeded completion not shown');
    const ev = await during(() => completeBtn().click());
    must(same(ev, [['lesson_uncomplete', { lesson_id: 'inheritance', lesson_name: 'Inheritance', completion_method: 'manual' }]]), 'events', ev);
    must(!(await progress()).topics.inheritance, 'still saved as completed');
  });
  tc('5 rapid clicks → exactly 5 alternating events; final state completed', async () => {
    await prep();
    await open('polymorphism.html');
    const ev = await during(async () => { for (let i = 0; i < 5; i++) await completeBtn().click(); });
    must(same(ev.map((e) => e[0]), ['lesson_complete', 'lesson_uncomplete', 'lesson_complete', 'lesson_uncomplete', 'lesson_complete']), 'sequence', ev.map((e) => e[0]));
    must((await progress()).topics.polymorphism === true, 'final state');
  });
  tc('Keyboard: Space then Enter on the button → lesson_complete then lesson_uncomplete', async () => {
    await prep();
    await open('composition.html');
    await completeBtn().focus();
    const ev = await during(async () => { await page.keyboard.press('Space'); await page.keyboard.press('Enter'); });
    must(same(ev.map((e) => e[0]), ['lesson_complete', 'lesson_uncomplete']), 'events', ev);
  });
  tc('setDone() without a state change, or for an unknown id, sends nothing', async () => {
    await prep({ 'oop-progress': { topics: { cpp: true }, labs: {} } });
    await open('index.html');
    const ev = await during(() => page.evaluate(() => { OOP.progress.setDone('cpp', true); OOP.progress.setDone('dma', false); OOP.progress.setDone('nope', true); }));
    must(ev.length === 0, 'events', ev);
  });
  tc('Reloading a completed topic sends nothing and still shows it completed', async () => {
    await prep({ 'oop-progress': { topics: { dma: true }, labs: {} } });
    await open('dynamic-memory.html');
    await page.reload();
    await waitApp();
    must((await custom()).length === 0 && await pressed(completeBtn()), 'after reload', await custom());
  });
  tc('Home → Reset progress (Cancel, then confirm) sends no event and keeps bookmarks', async () => {
    await prep({
      'oop-progress': { topics: { cpp: true, classes: true }, labs: { '01': true, '07': true } },
      'oop-bookmarks': [{ key: 'page:cpp', label: 'C++ Revision', href: 'cpp-revision.html' }]
    });
    await open('index.html');
    const ev = await during(async () => {
      await page.click('.dash-card .link-btn');
      await page.click('dialog[open] [data-act="cancel"]');
      must((await progress()).topics.cpp === true, 'Cancel reset the progress');
      await page.click('.dash-card .link-btn');
      await page.click('dialog[open] [data-act="ok"]');
    });
    must(ev.length === 0, 'events', ev);
    must(same(await progress(), { topics: {}, labs: {} }), 'not reset', await progress());
    must(JSON.parse((await store())['oop-bookmarks']).length === 1, 'bookmarks lost');
  });

  /* C. Labs (35–47) */
  LABS.forEach(([n, title]) => tc('Lab ' + n + ' (' + title + '): Mark done → lab_complete; again → lab_uncomplete', async () => {
    await prep();
    await open('labs.html');
    let ev = await during(() => labBtn(n).click());
    must(same(ev, [['lab_complete', { lab_number: n, completion_method: 'manual' }]]), 'complete', ev);
    must((await progress()).labs[n] === true && await pressed(labBtn(n)), 'not saved / not shown');
    ev = await during(() => labBtn(n).click());
    must(same(ev, [['lab_uncomplete', { lab_number: n, completion_method: 'manual' }]]), 'uncomplete', ev);
    must(!(await progress()).labs[n], 'still saved as done');
  }));
  tc('4 rapid clicks on one lab → exactly 4 alternating events; final state not done', async () => {
    await prep();
    await open('labs.html');
    const ev = await during(async () => { for (let i = 0; i < 4; i++) await labBtn('06').click(); });
    must(same(ev.map((e) => e[0]), ['lab_complete', 'lab_uncomplete', 'lab_complete', 'lab_uncomplete']), 'sequence', ev.map((e) => e[0]));
    must(!(await progress()).labs['06'], 'final state');
  });
  tc('Labs page: page "Mark as completed" → lesson_complete(labs); lab toggles send only lab_*; Operator Overload card has no toggle', async () => {
    await prep();
    await open('labs.html');
    const ev = await during(async () => { await completeBtn().click(); await labBtn('02').click(); });
    must(same(ev, [['lesson_complete', { lesson_id: 'labs', lesson_name: 'Labs', completion_method: 'manual' }], ['lab_complete', { lab_number: '02', completion_method: 'manual' }]]), 'events', ev);
    must(await page.locator('.qcard--feature .complete-btn').count() === 0, 'topic card got a lab toggle');
  });
  tc('Existing student data keeps its keys and shape after tracked actions', async () => {
    const marks = [{ key: 'page:cpp', label: 'C++ Revision', href: 'cpp-revision.html' }];
    await prep({ 'oop-progress': { topics: { cpp: true }, labs: { '01': true } }, 'oop-bookmarks': marks, 'oop-theme': 'dark' });
    await open('class-basics.html');
    await completeBtn().click();
    await completeBtn().click();
    await open('labs.html');
    await labBtn('04').click();
    await labBtn('04').click();
    await open('code-files.html');
    await page.click('#tab-sep');
    const s = await store();
    must(same(JSON.parse(s['oop-progress']), { topics: { cpp: true }, labs: { '01': true } }), 'progress changed', s['oop-progress']);
    must(s['oop-bookmarks'] === JSON.stringify(marks) && s['oop-theme'] === 'dark', 'bookmarks/theme changed', s);
    must(Object.keys(s).every((k) => STORAGE_KEYS.includes(k)), 'unknown localStorage key', Object.keys(s));
  });

  /* D. Code viewer (48–63) */
  tc('Code Files default first render → no code_file_view', async () => {
    await prep();
    await open('code-files.html');
    must((await custom()).length === 0 && (await page.textContent('#efname')) === 'Revision1.cpp', 'first render', await custom());
  });
  tc('Deep link #sep:12 on first load → no event, line 12 highlighted', async () => {
    await prep();
    await open('code-files.html#sep:12');
    must((await custom()).length === 0, 'event on load', await custom());
    must((await page.textContent('#efname')) === await fileName('sep') && await page.locator('.line.is-selected[data-line="12"]').count() === 1, 'deep link not applied');
  });
  tc('Unknown deep link #bogus → default file, no event, no error', async () => {
    await prep();
    await open('code-files.html#bogus');
    must((await custom()).length === 0 && (await page.textContent('#efname')) === 'Revision1.cpp', 'fallback', await custom());
  });
  tc('Clicking each of the 19 tabs → one code_file_view each, named after the file shown', async () => {
    await prep();
    await open('code-files.html');
    const ids = await page.evaluate(() => [...document.querySelectorAll('.ftab')].map((t) => t.getAttribute('data-tab')));
    must(ids.length === 19, 'tab count', ids.length);
    for (const id of ids.slice(1).concat(ids[0])) {
      const ev = await during(() => page.click('#tab-' + id));
      must(same(ev, [['code_file_view', { code_file: await page.textContent('#efname') }]]), 'tab ' + id, ev);
    }
  });
  tc('Clicking the already-open tab → nothing', async () => {
    await prep();
    await open('code-files.html#dma');
    const ev = await during(async () => { await page.click('#tab-dma'); await page.click('#tab-dma'); });
    must(ev.length === 0, 'events', ev);
  });
  tc('Arrow keys: Right, Left, Left (wraps to last) → one event each', async () => {
    await prep();
    await open('code-files.html');
    await page.focus('#tab-revision');
    const names = [];
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowLeft']) {
      const ev = await during(() => page.keyboard.press(key));
      must(ev.length === 1 && ev[0][0] === 'code_file_view', key, ev);
      names.push(ev[0][1].code_file);
    }
    must(same(names, ['Revision2.cpp', 'Revision1.cpp', await fileName('ops')]), 'files', names);
  });
  tc('Home / End keys → one event each', async () => {
    await prep();
    await open('code-files.html#sep');
    await page.focus('#tab-sep');
    let ev = await during(() => page.keyboard.press('End'));
    must(same(ev, [['code_file_view', { code_file: await fileName('ops') }]]), 'End', ev);
    ev = await during(() => page.keyboard.press('Home'));
    must(same(ev, [['code_file_view', { code_file: 'Revision1.cpp' }]]), 'Home', ev);
  });
  tc('In-page jumps: #dma:3 → event; #dma:5 (same file) → none; #bogus → none', async () => {
    await prep();
    await open('code-files.html');
    let ev = await during(() => page.evaluate(() => { location.hash = '#dma:3'; }));
    must(same(ev, [['code_file_view', { code_file: 'DynamicMemory.cpp' }]]), '#dma:3', ev);
    ev = await during(() => page.evaluate(() => { location.hash = '#dma:5'; }));
    must(ev.length === 0 && await page.locator('.line.is-selected[data-line="5"]').count() === 1, '#dma:5', ev);
    ev = await during(() => page.evaluate(() => { location.hash = '#bogus'; }));
    must(ev.length === 0 && (await page.textContent('#efname')) === 'DynamicMemory.cpp', '#bogus', ev);
  });
  tc('Copy succeeds (Clipboard API) → code_copy with file + path; clipboard holds the code', async () => {
    await prep();
    await open('code-files.html#dma');
    const ev = await during(async () => { await page.click('#copyBtn'); await copyDone(); });
    must(same(ev, [['code_copy', { code_file: 'DynamicMemory.cpp', code_page_path: '/code-files.html' }]]), 'events', ev);
    must(await page.evaluate(async () => (await navigator.clipboard.readText()) === cf.dma.code), 'clipboard content');
    must((await copyText()) === 'Copied!', 'button', await copyText());
  });
  tc('Copy, switch file, copy → code_copy names the file that was copied each time', async () => {
    await prep();
    await open('code-files.html');
    const ev = await during(async () => {
      await page.click('#copyBtn'); await copyDone();
      await page.click('#tab-this');
      await page.click('#copyBtn'); await sleep(200);
    });
    const thisName = await fileName('this');
    must(same(ev, [['code_copy', { code_file: 'Revision1.cpp', code_page_path: '/code-files.html' }], ['code_file_view', { code_file: thisName }],
      ['code_copy', { code_file: thisName, code_page_path: '/code-files.html' }]]), 'events', ev);
  });
  tc('No Clipboard API (old browser / file://) → fallback copy succeeds → one code_copy', async () => {
    await prep();
    await open('code-files.html');
    await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); document.execCommand = () => true; });
    const ev = await during(async () => { await page.click('#copyBtn'); await copyDone(); });
    must(ev.length === 1 && ev[0][0] === 'code_copy' && (await copyText()) === 'Copied!', 'events', ev);
  });
  tc('Clipboard API rejects but fallback works → one code_copy', async () => {
    await prep();
    await open('code-files.html');
    await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); document.execCommand = () => true; });
    const ev = await during(async () => { await page.click('#copyBtn'); await copyDone(); });
    must(ev.length === 1 && ev[0][0] === 'code_copy' && (await copyText()) === 'Copied!', 'events', ev);
  });
  tc('Both copy methods fail → no code_copy, button says "Copy failed"', async () => {
    await prep();
    await open('code-files.html');
    await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); document.execCommand = () => false; });
    const ev = await during(async () => { await page.click('#copyBtn'); await copyDone(); });
    must(ev.length === 0 && (await copyText()) === 'Copy failed', 'events', ev);
  });
  tc('Double-click Copy → one code_copy (duplicate guard); another copy after 1 s → counted', async () => {
    await prep();
    await open('code-files.html');
    let ev = await during(async () => { await page.click('#copyBtn'); await page.click('#copyBtn'); await sleep(300); });
    must(ev.length === 1, 'double click', ev);
    await sleep(1100);
    ev = await during(async () => { await page.click('#copyBtn'); await sleep(300); });
    must(ev.length === 1, 'copy after 1 s', ev);
  });
  tc('Other UI (wrap, full screen, bookmarks, line highlight, theme, reading mode, search, shortcuts, link filter) → no custom event', async () => {
    await prep();
    await open('code-files.html');
    let ev = await during(async () => {
      await page.click('#wrapBtn'); await page.click('#wrapBtn');
      await page.click('#fullBtn'); await page.keyboard.press('Escape');
      await page.click('#markBtn'); await page.click('#markBtn');
      await page.click('#cv .line[data-line="3"]');
      await page.keyboard.press('t'); await page.keyboard.press('t');
      await page.keyboard.press('r'); await page.keyboard.press('r');
      await page.keyboard.press('ControlOrMeta+k'); await page.keyboard.type('class'); await page.keyboard.press('Escape');
      await page.keyboard.press('?'); await page.keyboard.press('Escape');
    });
    must(ev.length === 0, 'code page', ev);
    await open('all-links.html');
    ev = await during(async () => { await page.fill('#linkFilter', 'video'); await page.fill('#linkFilter', ''); });
    must(ev.length === 0, 'link filter', ev);
    await open('class-basics.html');
    ev = await during(async () => { const b = page.locator('.pg-actions .complete-btn').nth(1); await b.click(); await b.click(); });
    must(ev.length === 0, 'page bookmark', ev);
  });
  tc('window.ct() called by code (not the student) → no event', async () => {
    await prep();
    await open('code-files.html');
    const ev = await during(() => page.evaluate(() => window.ct('sep')));
    must(ev.length === 0 && (await page.textContent('#efname')) === await fileName('sep'), 'events', ev);
  });

  /* E. Resource links (64–79) */
  LINKS.forEach(([file, sel, want]) => tc(file + ': "' + want.resource_name + '" → learning_resource_click (' + want.resource_type + ')', async () => {
    await prep();
    await open(file);
    const ev = await during(() => page.locator(sel).first().click());
    must(same(ev, [['learning_resource_click', want]]), 'events', ev);
  }));
  tc('Names are clean: multi-line link text collapsed; a link inside a note is named by the note', async () => {
    await prep();
    await open('all-links.html');
    let ev = await during(() => page.locator('a:has-text("Full Playlist")').click());
    must(same(ev, [['learning_resource_click', { resource_type: 'video', resource_name: 'Dr. Ibrahim — Full Playlist' }]]), 'multi-line', ev);
    await open('class-basics.html');
    ev = await during(() => page.locator('#main .pull a').click());
    must(same(ev, [['learning_resource_click', { resource_type: 'document', resource_name: "Pages 10–19 in Dana AL-taher's notebook cover this topic.", lesson_id: 'classes' }]]), 'note link', ev);
  });
  tc('Clicking the icon inside a chip → one event for that link', async () => {
    await prep();
    await open('cpp-revision.html');
    const ev = await during(() => page.locator('#main a.chip:has-text("Functions") svg').click({ force: true }));
    must(same(ev, [['learning_resource_click', { resource_type: 'video', resource_name: 'Functions', lesson_id: 'cpp' }]]), 'events', ev);
  });
  tc('Middle-click (new tab) → one event; right-click → none', async () => {
    await prep();
    await open('cpp-revision.html');
    let ev = await during(() => page.locator('#main a.chip:has-text("Arrays")').click({ button: 'middle' }));
    must(ev.length === 1 && ev[0][1].resource_name === 'Arrays', 'middle', ev);
    ev = await during(() => page.locator('#main a.chip:has-text("Pointers 1")').click({ button: 'right' }));
    must(ev.length === 0, 'right', ev);
  });
  tc('Ctrl/Cmd-click and keyboard Enter on a link → one event each', async () => {
    await prep();
    await open('cpp-revision.html');
    let ev = await during(() => page.locator('#main a.chip:has-text("Pointers 2")').click({ modifiers: ['ControlOrMeta'] }));
    must(ev.length === 1 && ev[0][1].resource_name === 'Pointers 2', 'modifier click', ev);
    await page.locator('#main a.chip:has-text("Intro")').focus();
    ev = await during(() => page.keyboard.press('Enter'));
    must(ev.length === 1 && ev[0][1].resource_name === 'Intro', 'Enter', ev);
  });
  tc('Not resources: dashboard resume link, placeholders, pager, sidebar, footer signature, internal page links', async () => {
    await prep({ 'oop-last': { at: Date.now(), key: 'code:sep', label: 'Code: Separation', href: 'code-files.html#sep' } });
    await open('index.html');
    let ev = await during(() => page.locator('.dash-card--hero a').click());
    must(ev.length === 0, 'dashboard resume link', ev);
    await open('cpp-revision.html');
    ev = await during(async () => {
      await page.locator('#main .concept').first().click();
      await page.locator('.pager a').first().click();
      await page.locator('.nav-btn').nth(3).click();
      await page.locator('.signature').click();
    });
    must(ev.length === 0, 'cpp page', ev);
    await open('all-links.html');
    ev = await during(() => page.locator('a:has-text("Specific Lab Index")').click());
    must(ev.length === 0, 'internal page link', ev);
  });
  tc('Sweep: every link in the content of all 16 pages → one well-formed event if it is a resource, none otherwise', async () => {
    await prep();
    const problems = [];
    const tally = {};
    for (const file of PAGES) {
      await open(file);
      const r = await page.evaluate(async () => {
        const p = OOP.layout.currentPage();
        const items = [];
        const grab = (a) => {
          const n = dataLayer.length;
          a.click();
          return dataLayer.slice(n).filter((x) => x[0] === 'event' && /^(lesson_|lab_|code_|learning_resource_)/.test(x[1])).map((x) => [x[1], x[2]]);
        };
        for (const a of document.querySelectorAll('#main a[href]')) {
          if (a.closest('[data-ui]')) continue;
          const resource = (/^https?:$/.test(a.protocol) && a.host !== location.host) || /code-files\.html$/.test(a.pathname);
          let ev = grab(a);
          let retried = false;
          if (resource && !ev.length) { await new Promise((ok) => setTimeout(ok, 1050)); ev = grab(a); retried = true; }
          items.push({ href: a.getAttribute('href'), text: a.textContent.replace(/\s+/g, ' ').trim(), resource, ev, retried });
        }
        return { topic: p.topic, id: p.id, items };
      });
      let prev = null;
      for (const it of r.items) {
        const where = file + ' "' + it.text + '"';
        if (!it.resource) { if (it.ev.length) problems.push(where + ': not a resource but sent ' + JSON.stringify(it.ev)); continue; }
        if (it.ev.length !== 1 || it.ev[0][0] !== 'learning_resource_click') { problems.push(where + ': expected 1 event, got ' + JSON.stringify(it.ev)); continue; }
        const e = it.ev[0][1];
        if (it.retried && !same(e, prev)) problems.push(where + ': dropped although different from the previous event');
        if (!RESOURCE_TYPES.includes(e.resource_type)) problems.push(where + ': resource_type ' + e.resource_type);
        const nm = e.resource_name || '';
        if (!nm || nm.length > 100 || nm !== nm.trim() || /^[—·-]/.test(nm) || GENERIC.test(nm)) problems.push(where + ': resource_name "' + nm + '"');
        if (e.lesson_id !== (r.topic ? r.id : undefined)) problems.push(where + ': lesson_id ' + e.lesson_id);
        tally[e.resource_type] = (tally[e.resource_type] || 0) + 1;
        prev = e;
      }
    }
    notes.push('sweep: ' + Object.values(tally).reduce((a, b) => a + b, 0) + ' resource links — ' + Object.entries(tally).map((t) => t.join(' ')).join(', '));
    must(!problems.length, problems.length + ' link problem(s)', problems);
  });

  /* F. GA missing / blocked / broken (80–87) */
  tc('gtag.js blocked (ad blocker) → completion, labs, code viewer, copy and links still work', async () => {
    await prep();
    mode = 'blockGtag';
    await siteStillWorks();
  });
  tc('Google tag removed from the page (no window.gtag) → site works, track() returns false', async () => {
    await prep();
    mode = 'noTag';
    await siteStillWorks();
    must(await page.evaluate(() => typeof window.gtag === 'undefined' && OOP.analytics.track('code_copy', { code_file: 'x' }) === false), 'gtag present or track() true');
  });
  tc('gtag that throws → buttons, labs and tabs still work, track() returns false', async () => {
    await prep();
    await open('labs.html');
    await page.evaluate(() => { window.gtag = () => { throw new Error('broken gtag'); }; });
    await labBtn('05').click();
    await completeBtn().click();
    must(await pressed(labBtn('05')) && await pressed(completeBtn()), 'buttons broken');
    must(await page.evaluate(() => OOP.analytics.track('lab_complete', { lab_number: '05' }) === false), 'track() should return false');
    await open('code-files.html');
    await page.evaluate(() => { window.gtag = () => { throw new Error('broken gtag'); }; });
    await page.click('#tab-sep');
    must((await page.textContent('#efname')) === await fileName('sep'), 'tab switch broken');
  });
  tc('assets/js/analytics.js itself blocked (ad blockers match "analytics.js") → site still works', async () => {
    await prep();
    mode = 'blockAnalytics';
    await siteStillWorks();
  });
  tc('localStorage unavailable (privacy mode) → events still follow state changes', async () => {
    await prep();
    mode = 'noStorage';
    await open('class-basics.html');
    must(await page.evaluate(() => OOP.store.persistent === false), 'localStorage was not blocked');
    let ev = await during(async () => { await completeBtn().click(); await completeBtn().click(); });
    must(same(ev.map((e) => e[0]), ['lesson_complete', 'lesson_uncomplete']), 'lesson', ev);
    await open('labs.html');
    ev = await during(() => labBtn('02').click());
    must(same(ev, [['lab_complete', { lab_number: '02', completion_method: 'manual' }]]), 'lab', ev);
  });
  tc('Corrupt saved progress → completing still works and is tracked', async () => {
    await prep({ 'oop-progress': '{not json' });
    await open('class-basics.html');
    const ev = await during(() => completeBtn().click());
    must(ev.length === 1 && ev[0][0] === 'lesson_complete' && (await progress()).topics.classes === true, 'events', ev);
  });
  tc('GA opt-out flag set before the tag → nothing reaches GA4, site works', async () => {
    await prep();
    mode = 'optOut';
    hits = [];
    await open('class-basics.html');
    const ev = await during(() => completeBtn().click());
    must(ev.length === 1 && await pressed(completeBtn()), 'completion', ev);
    await sleep(5000);
    must(hits.length === 0, 'hits despite opt-out', hits.map((h) => h.en));
  });
  tc('Click before gtag.js has loaded (slow network) → event is queued and sent once it loads', async () => {
    await prep();
    mode = 'slowGtag';
    hits = [];
    gtagReleasedAt = 0;
    await page.goto(BASE + 'class-basics.html', { waitUntil: 'domcontentloaded' }); // "load" would wait for gtag.js
    await waitApp();
    await completeBtn().click();
    const clickedAt = Date.now();
    must(!gtagReleasedAt || clickedAt < gtagReleasedAt, 'gtag.js was already loaded');
    must(await until(() => hits.some((h) => h.en === 'lesson_complete'), 20000), 'queued event never sent', hits.map((h) => h.en));
  });

  /* G. Privacy and GA4 wire data (88–90) */
  tc('Privacy: every custom event of the run uses documented names/parameters, short primitive values, no code or e-mail', async () => {
    await prep();
    await open('class-basics.html'); await during(() => completeBtn().click());
    await open('code-files.html'); await during(async () => { await page.click('#tab-dma'); await page.click('#copyBtn'); await copyDone(); });
    await open('labs.html'); await during(() => page.locator('.qcard:has-text("Lab 02 ·") a').first().click());
    const bad = all.filter(([name, p]) => !EVENTS.includes(name) || Object.keys(p).length > 25 || !Object.entries(p).every(([k, v]) =>
      PARAMS.includes(k) && (typeof v === 'boolean' || Number.isFinite(v) ||
        (typeof v === 'string' && v.length <= 100 && v === v.trim() && !/\n|#include|cout|@/.test(v)))));
    must(all.length >= 5 && !bad.length, all.length + ' events checked', bad);
  });
  tc('OOP.analytics.track(): rejects bad names, drops bad keys/values, collapses + cuts strings, ignores non-object params, 1 s duplicate guard', async () => {
    await prep();
    await open('index.html');
    const r = await page.evaluate(async () => {
      const t = OOP.analytics.track;
      const last = () => { const a = dataLayer.filter((x) => x[0] === 'event').pop(); return [a[1], Object.keys(a[2]), a[2].s, (a[2].long || '').length]; };
      const out = {};
      out.badNames = [t('Bad Name', {}), t('', {}), t('x'.repeat(41), {}), t('1abc', {}), t(null, {})];
      out.cleaned = [t('qa_clean', { s: '  a \n b  ', long: 'y'.repeat(150), n: 3, b: false, nan: NaN, inf: Infinity, obj: { a: 1 },
        arr: [1], fn() {}, nul: null, und: undefined, empty: '  ', 'bad key': 'v', '1st': 'v' }), last()];
      out.nonObject = [t('qa_str', 'oops'), last()];
      out.dupes = [t('qa_dup', { a: 1 }), t('qa_dup', { a: 1 }), t('qa_other', {}), t('qa_dup', { a: 1 })];
      t('qa_late', {});
      await new Promise((ok) => setTimeout(ok, 1100));
      out.late = t('qa_late', {});
      return out;
    });
    must(same(r.badNames, [false, false, false, false, false]), 'bad names accepted', r.badNames);
    must(same(r.cleaned, [true, ['qa_clean', ['s', 'long', 'n', 'b'], 'a b', 100]]), 'cleaning', r.cleaned);
    must(same(r.nonObject, [true, ['qa_str', [], null, 0]]), 'string params', r.nonObject);
    must(same(r.dupes, [true, false, true, true]) && r.late === true, 'duplicate guard', r);
  });
  tc('GA4 wire data under the GitHub Pages path with a UTM landing: campaign URL kept, one cid/sid, text parameters', async () => {
    await prep();
    hits = [];
    const wait = (en) => until(() => hits.some((h) => h.en === en), 15000);
    await open(SUB + 'index.html?utm_source=qa&utm_medium=test&utm_campaign=tc90');
    must(await wait('page_view'), 'no page_view');
    await open(SUB + 'labs.html'); await labBtn('03').click();
    must(await wait('lab_complete'), 'no lab_complete hit', hits.map((h) => h.en));
    await open(SUB + 'cpp-revision.html'); await page.locator('#main a.chip:has-text("Revision1")').click();
    must(await wait('learning_resource_click'), 'no learning_resource_click hit');
    await open(SUB + 'code-files.html'); await page.click('#copyBtn');
    must(await wait('code_copy'), 'no code_copy hit');
    const get = (en) => hits.find((h) => h.en === en);
    must(/\/object_oriented_programming\/index\.html\?utm_source=qa&utm_medium=test&utm_campaign=tc90/.test(get('page_view').dl), 'landing URL', get('page_view').dl);
    must(new Set(hits.map((h) => h.cid)).size === 1 && new Set(hits.map((h) => h.sid)).size === 1, 'cid/sid differ', hits.map((h) => h.en + ' ' + h.cid + ' ' + h.sid));
    must(get('lab_complete')['ep.lab_number'] === '03' && !('epn.lab_number' in get('lab_complete')), 'lab_number not sent as text', get('lab_complete'));
    const rc = get('learning_resource_click');
    must(rc['ep.resource_type'] === 'code_example' && rc['ep.lesson_id'] === 'cpp', 'resource hit', rc);
    must(get('code_copy')['ep.code_page_path'] === '/object_oriented_programming/code-files.html' && get('code_copy')['ep.code_file'] === 'Revision1.cpp', 'code_copy hit', get('code_copy'));
    const extra = hits.filter((h) => EVENTS.includes(h.en)).flatMap((h) => Object.keys(h).filter((k) => /^epn?\./.test(k) && !PARAMS.includes(k.replace(/^epn?\./, ''))));
    must(!extra.length, 'undocumented parameters on the wire', extra);
  });

  /* ── Run ── */
  const notes = [];
  const only = process.argv.slice(2).map(Number).filter(Boolean);
  let failed = 0;
  let ran = 0;
  const t0 = Date.now();
  for (let i = 0; i < cases.length; i++) {
    if (only.length && !only.includes(i + 1)) continue;
    ran++;
    const id = 'TC' + String(i + 1).padStart(2, '0');
    const errs = pageErrors.length;
    let err = null;
    try { await cases[i].fn(); } catch (e) { err = e; } finally { mode = 'normal'; }
    if (!err && pageErrors.length > errs) err = { message: 'uncaught page error', detail: pageErrors.slice(errs) };
    if (err) failed++;
    console.log((err ? 'FAIL ' : 'PASS ') + id + '  ' + cases[i].title +
      (err ? '\n        → ' + err.message + (err.detail !== undefined ? ': ' + JSON.stringify(err.detail).slice(0, 1500) : '') : ''));
  }
  if (otherTids.size) notes.push('the Google tag also forwards every hit to ' + [...otherTids].join(', ') + ' (set in Google tag settings, not in this repo)');
  notes.forEach((n) => console.log('NOTE ' + n));
  console.log('\n' + (ran - failed) + '/' + ran + ' passed' + (failed ? ', ' + failed + ' FAILED' : '') + ' in ' + Math.round((Date.now() - t0) / 1000) + ' s (' + cases.length + ' cases defined)');
  await browser.close();
  server.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
