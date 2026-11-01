#!/usr/bin/env node
/**
 * verify_research.cjs — browser checks for the topic quizzes and the opt-in research study.
 *
 * Drives the real site in Chromium against the Firebase EMULATORS (never a real project): it serves the
 * site locally and rewrites config.js on the fly (projectId demo-oop, emulators: true, short timings).
 * Google tag requests are blocked; GA4 events are read from window.dataLayer.
 *
 *   A  quizzes on every topic, scoring, review, retake, double submit, no progress change, GA4 payloads
 *   B  undecided / declined visitors: invitation, nothing recorded, no Firestore traffic
 *   C  participant: consent record, sessions, page views, active time, idle, hidden tab, scroll depth,
 *      quiz attempts, interactions, second tab, Google sync kept separate
 *   D  session timeout: a new session after inactivity, the old one closed (same tab and next page)
 *   E  Firestore security rules (other participants, Google accounts, tampering, consent)
 *   F  admin CSV export of the emulator data
 *   G  withdrawal deletes everything and stops recording; sync data untouched
 *   H  askConsent: false — recorded by default with no prompt, opt-out deletes, earlier "no" respected
 *   J  offline: the attempt is kept on the device and reaches Firestore after reconnecting, once
 *   K  no research account for Home-only visitors, crawlers, or browsers that block storage
 *   I  existing features still work: completion, bookmarks, dashboard, achievements, pager, theme,
 *      search, code viewer
 * Groups B–G run with askConsent: true (ask first); H with askConsent: false (the config default).
 *
 * Usage:
 *   npm run emulators                      # terminal 1 (auth :9099, firestore :8080, project demo-oop)
 *   node tools/verify_research.cjs         # terminal 2 (npm run verify:research)
 * Environment: CHROME=/path/to/chrome   use an existing Chromium instead of Playwright's own.
 * Exit code 0 = every check passed. It wipes the emulators' data first.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const ex = require('./export_research.cjs');

const ROOT = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const TOPICS = { cpp: 'cpp-revision.html', classes: 'class-basics.html', const: 'const-static.html', composition: 'composition.html',
  dma: 'dynamic-memory.html', this: 'this-pointer.html', friend: 'friend-functions.html', inheritance: 'inheritance.html',
  polymorphism: 'polymorphism.html', operators: 'operator-overloading.html' };
const OTHER = ['index.html', 'labs.html', 'code-files.html', 'revision-hall.html', 'examination-hall.html', 'all-links.html'];
const FS = 'http://127.0.0.1:8080';
const DOCS = FS + '/v1/projects/demo-oop/databases/(default)/documents';
const OWNER = { Authorization: 'Bearer owner' };

let failed = 0;
let passed = 0;
function check(name, ok, detail) {
  if (ok) { passed++; console.log('ok   ' + name); } else { failed++; console.log('FAIL ' + name + (detail !== undefined ? '\n       ' + JSON.stringify(detail) : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(fn, ms = 20000) {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) { v = await fn(); if (v) return v; await sleep(400); }
  return v;
}

/* ───────────── Local server + emulator helpers ───────────── */

function serve() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split(/[?#]/)[0]).replace(/^\//, '');
    const file = path.join(ROOT, rel || 'index.html');
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server)));
}

/** config.js pointed at the emulators, with research timings shortened for testing. */
function config(t) {
  const src = fs.readFileSync(path.join(ROOT, 'assets/js/config.js'), 'utf8')
    .replace(/projectId: '[^']+'/, "projectId: 'demo-oop'")
    .replace('firebase: {', 'firebase: {\n      emulators: true,')
    .replace(/research: \{[^}]*\}/, 'research: { askConsent: ' + (t.ask !== false) + ', consentVersion: 1, idleSeconds: ' + t.idle + ', sessionMinutes: ' + t.session +
      ', saveSeconds: 5, contact: \'\', ethics: \'\' }');
  if (!/emulators: true/.test(src) || !/sessionMinutes: [\d.]+, saveSeconds: 5/.test(src)) throw new Error('could not rewrite config.js');
  return src;
}

async function list(p) {
  const res = await fetch(DOCS + '/' + p + '?pageSize=300', { headers: OWNER });
  const j = await res.json();
  return (j.documents || []).map((d) => Object.assign({ id: d.name.split('/').pop() }, ex.fields(d.fields)));
}
async function get(p) {
  const res = await fetch(DOCS + '/' + p, { headers: OWNER });
  return res.status === 200 ? ex.fields((await res.json()).fields) : null;
}
async function sessions(rid) { return list('researchParticipants/' + rid + '/sessions'); }
async function authUser(uid) {
  const res = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-oop/accounts:lookup',
    { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, OWNER), body: JSON.stringify({ localId: [uid] }) });
  return ((await res.json()).users || [])[0] || null;
}

/* ───────────── Page helpers ───────────── */

let base = '';
const errors = [];
let firestoreTraffic = 0;

async function context(browser, timings, consent, extra = {}) {
  const ctx = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 800 } }, extra.userAgent ? { userAgent: extra.userAgent } : {}));
  if (extra.noStorage) await ctx.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new Error('blocked'); } }));
  const cfg = config(timings);
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    // Google tag and fonts are not needed here; a slow font request would only stall page loads.
    if (/googletagmanager|google-analytics|analytics\.google|fonts\.(googleapis|gstatic)\.com/.test(url)) return route.fulfill({ status: 204, body: '' });
    if (url.endsWith('/assets/js/config.js')) return route.fulfill({ status: 200, contentType: 'text/javascript', body: cfg });
    if (url.startsWith(FS) || /firestore\.googleapis/.test(url)) firestoreTraffic++;
    return route.continue();
  });
  if (consent) {
    await ctx.addInitScript((c) => { if (!localStorage.getItem('oop-research-consent')) localStorage.setItem('oop-research-consent', c); },
      JSON.stringify({ status: consent === true ? 'granted' : consent, version: 1, at: Date.now() }));
  }
  return ctx;
}
async function open(ctx, file) {
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(file + ': ' + e.message));
  await page.goto(base + file, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('sbResearch'));
  return page;
}
const ls = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem('oop-' + k) || 'null'), key);
const ga = (page, name) => page.evaluate((n) => (window.dataLayer || []).filter((a) => a[0] === 'event' && a[1] === n).map((a) => a[2]), name);
/** participant_id values given to GA4 on this page, in order (gtag 'set' user_properties). */
const upIds = (page) => page.evaluate(() => (window.dataLayer || []).filter((a) => a[0] === 'set' && a[1] === 'user_properties').map((a) => a[2].participant_id));
function visibility(page, state) {
  return page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { value: s, configurable: true });
    Object.defineProperty(document, 'hidden', { value: s === 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}
/** Answer the open quiz: pattern[i] true = correct option, false = a wrong one. */
async function answer(page, topic, pattern) {
  await page.evaluate(([t, pat]) => {
    OOP.quizData[t].questions.forEach((q, i) => {
      const want = pat[i] ? q.answer : (q.answer + 1) % 4;
      document.querySelector('input[name="quiz-q' + i + '"][value="' + want + '"]').click();
    });
  }, [topic, pattern]);
  await page.click('.quiz-form button[type=submit]');
}
async function wiggle(page, ms) {
  const end = Date.now() + ms;
  let x = 300;
  while (Date.now() < end) { x = x === 300 ? 320 : 300; await page.mouse.move(x, 400); await sleep(400); }
}
const local = async (page, topic) => ((await ls(page, 'research-open')) || {})[topic];
/** This page's own research ID (its anonymous uid) once its consent record is saved — other open browsers can't interfere. */
const ridOf = (page) => poll(async () => { const c = await ls(page, 'research-consent'); return c && c.registered && c.registered.split(':')[0]; });

/* ───────────── Cases ───────────── */

async function quizzes(browser) {
  const ctx = await context(browser, { idle: 60, session: 30 }, false);
  for (const [topic, file] of Object.entries(TOPICS)) {
    const page = await open(ctx, file);
    const r = await page.evaluate(() => {
      const q = document.getElementById('topic-quiz');
      const pager = document.querySelector('main .pager');
      return { quiz: !!q, beforePager: !!(q && pager && q.compareDocumentPosition(pager) & Node.DOCUMENT_POSITION_FOLLOWING), questions: document.querySelectorAll('#topic-quiz .quiz-q').length, formHidden: q && q.querySelector('.quiz-form').hidden };
    });
    check('A ' + topic + ': Take quiz block before the pager, 8 questions, form hidden until started', r.quiz && r.beforePager && r.questions === 8 && r.formHidden, r);
    await page.close();
  }
  for (const file of OTHER) {
    const page = await open(ctx, file);
    check('A no quiz on ' + file, !(await page.$('#topic-quiz')));
    await page.close();
  }

  const page = await open(ctx, 'class-basics.html');
  await page.click('#topic-quiz .quiz-intro button');
  check('A quiz_started sent with lesson_id only', JSON.stringify(await ga(page, 'quiz_started')) === '[{"lesson_id":"classes"}]', await ga(page, 'quiz_started'));
  await page.click('.quiz-form button[type=submit]');
  check('A submitting with unanswered questions is refused', (await page.textContent('.quiz-msg')).includes('8 left') && (await ga(page, 'quiz_completed')).length === 0);
  await answer(page, 'classes', [1, 1, 1, 1, 1, 1, 1, 1]);
  const all = await page.evaluate(() => ({ score: document.querySelector('.quiz-score strong').textContent, right: document.querySelectorAll('.quiz-q.is-right').length, whys: [...document.querySelectorAll('.quiz-why')].filter((w) => !w.hidden && w.textContent).length, disabled: [...document.querySelectorAll('.quiz-form input')].every((i) => i.disabled) }));
  check('A all correct → 100%, 8 marked right, explanations shown, answers locked', all.score === '100%' && all.right === 8 && all.whys === 8 && all.disabled, all);
  check('A quiz_completed carries lesson_id + score, never answers', JSON.stringify(await ga(page, 'quiz_completed')) === '[{"lesson_id":"classes","quiz_score":100}]', await ga(page, 'quiz_completed'));
  await page.evaluate(() => { const f = document.querySelector('.quiz-form'); f.requestSubmit(); f.requestSubmit(); });
  check('A submitting the same attempt again does nothing', (await ga(page, 'quiz_completed')).length === 1);
  await page.click('.quiz-result button');
  const reset = await page.evaluate(() => ({ checked: document.querySelectorAll('.quiz-form input:checked').length, tags: document.querySelectorAll('.quiz-tag').length, result: document.querySelector('.quiz-result').hidden }));
  check('A retake clears answers, marks and the result', reset.checked === 0 && reset.tags === 0 && reset.result, reset);
  await answer(page, 'classes', [0, 0, 0, 0, 0, 0, 0, 0]);
  const none = await page.evaluate(() => ({ score: document.querySelector('.quiz-score strong').textContent, wrong: document.querySelectorAll('.quiz-q.is-wrong').length, answers: document.querySelectorAll('.quiz-opt.is-answer').length }));
  check('A all wrong → 0%, each question shows the correct answer', none.score === '0%' && none.wrong === 8 && none.answers === 8, none);
  await page.click('.quiz-result button');
  await answer(page, 'classes', [1, 1, 1, 1, 1, 0, 0, 0]);
  check('A 5 of 8 → 63%', (await page.textContent('.quiz-score')).startsWith('63%'));
  check('A each attempt sends one quiz_completed (3 attempts)', (await ga(page, 'quiz_completed')).length === 3);
  const progress = await page.evaluate(() => ({ done: OOP.progress.isDone('classes'), pressed: document.querySelector('.complete-btn').getAttribute('aria-pressed') }));
  check('A passing a quiz does not mark the topic completed', !progress.done && progress.pressed === 'false', progress);
  await ctx.close();
}

async function undecided(browser) {
  firestoreTraffic = 0;
  const ctx = await context(browser, { idle: 60, session: 30 }, false);
  const home = await open(ctx, 'index.html');
  check('B sidebar has "About the research study" on Home; no invitation off topic pages',
    (await home.textContent('#sbResearch')).includes('About the research study') && !(await home.$('#researchPrompt')));
  const page = await open(ctx, 'dynamic-memory.html');
  check('B undecided: invitation shown on a topic page', await page.isVisible('#researchPrompt'));
  await page.click('#topic-quiz .quiz-intro button');
  await answer(page, 'dma', [1, 1, 1, 1, 1, 1, 1, 1]);
  await wiggle(page, 1000);
  check('B undecided: nothing recorded locally', !(await ls(page, 'research-open')) && !(await ls(page, 'research-attempts')));
  await page.click('#researchPrompt .btn--ghost');
  check('B "No thanks" hides the invitation and stores the choice', !(await page.$('#researchPrompt')) && (await ls(page, 'research-consent')).status === 'declined' &&
    (await page.textContent('#sbResearch')).includes('not taking part'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('sbResearch'));
  await wiggle(page, 1500);
  await visibility(page, 'hidden');
  await sleep(1500);
  check('B declined: no invitation after reload, nothing recorded, no Firestore requests at all',
    !(await page.$('#researchPrompt')) && !(await ls(page, 'research-open')) && firestoreTraffic === 0, { firestoreTraffic });
  check('B declined: no study_session events in GA4', (await ga(page, 'study_session_started')).length === 0);
  check('B undecided / declined: no participant_id in GA4', !(await upIds(page)).length && !(await upIds(home)).length);
  await ctx.close();
}

async function participant(browser) {
  const ctx = await context(browser, { idle: 3, session: 5 }, false);
  const page = await open(ctx, 'dynamic-memory.html');
  check('C before consent: no Firestore loaded', await page.evaluate(() => !(window.firebase && window.firebase.firestore)));
  await page.click('#researchPrompt .btn--primary');
  check('C "Learn more" opens the information dialog with an explicit agree button', await page.isVisible('#researchDlg') &&
    (await page.textContent('#researchDlg')).includes('Never in the research data') && (await page.isVisible('#researchDlg >> text=I agree to take part')));
  await page.click('#researchDlg >> text=I agree to take part');
  const rid = await ridOf(page);
  const part = rid && await get('researchParticipants/' + rid);
  check('C consent record created (granted, version 1, timestamps)', part && part.consentStatus === 'granted' && part.consentVersion === 1 &&
    part.consentedAt instanceof Date && part.researchId === rid, part);
  const user = rid && await authUser(rid);
  check('C research ID is an anonymous account with no email or name', user && !user.email && !user.displayName && !(user.providerUserInfo || []).length, user);
  let s = await poll(async () => { const x = await sessions(rid); return x.length === 1 && x[0]; });
  check('C study session saved: topic dma, 1 page view, quiz not_started, no score', s && s.topicId === 'dma' && s.pageViews === 1 &&
    s.quizStatus === 'not_started' && s.quizScore === null && s.endedAt === null && s.sessionId === s.id && s.researchId === rid, s);
  check('C study_session_started sent to GA4 (lesson_id only)', JSON.stringify(await ga(page, 'study_session_started')) === '[{"lesson_id":"dma"}]');
  check('C GA4 user property participant_id = research ID once it exists', await poll(async () => (await upIds(page)).slice(-1)[0] === rid), await upIds(page));
  check('C sync sign-in is separate: still offers "Sign in with Google"', (await page.textContent('#sbAccount')).includes('Sign in with Google') &&
    await page.evaluate(() => firebase.auth().currentUser === null));
  const sid = s.id;

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('sbResearch'));
  check('C next page load: participant_id set at the start from the saved ID (before any GA4 event)', await page.evaluate((r) => {
    const i = dataLayer.findIndex((a) => a[0] === 'set' && a[1] === 'user_properties' && a[2].participant_id === r);
    return i > -1 && !dataLayer.slice(0, i).some((a) => a[0] === 'event');
  }, rid), await upIds(page));
  s = await poll(async () => { const x = await sessions(rid); return x.length === 1 && x[0].pageViews === 2 && x[0]; });
  check('C refresh resumes the same session and counts a page view', s && s.id === sid, await sessions(rid));

  // Active time: idle limit is 3 s here.
  await visibility(page, 'hidden');
  const e0 = (await local(page, 'dma')).engagementMs;
  await visibility(page, 'visible');
  await wiggle(page, 6000);
  await sleep(6000);
  await visibility(page, 'hidden');
  const d1 = (await local(page, 'dma')).engagementMs - e0;
  check('C 6 s of input + 6 s idle → ~9 s active (counting stops 3 s after the last input)', d1 >= 8000 && d1 <= 10500, d1);
  await wiggle(page, 4000);
  await visibility(page, 'visible');
  await visibility(page, 'hidden');
  const d2 = (await local(page, 'dma')).engagementMs - e0 - d1;
  check('C time in a hidden tab is not counted, even with mouse movement', d2 < 500, d2);
  s = await poll(async () => { const x = (await sessions(rid))[0]; return x.engagementTimeSeconds >= Math.floor((e0 + d1) / 1000) && x; });
  check('C hiding the tab saves engagement to Firestore', !!s, await sessions(rid));

  // Scroll depth
  await visibility(page, 'visible');
  const before = (await local(page, 'dma')).maxScrollDepth;
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await sleep(300);
  await visibility(page, 'hidden');
  const after = (await local(page, 'dma')).maxScrollDepth;
  check('C scroll depth: partial at the top, 100 after scrolling to the end', before > 0 && before < 100 && after === 100, { before, after });
  await page.evaluate(() => window.scrollTo(0, 0));
  await visibility(page, 'visible');
  await sleep(300);
  await visibility(page, 'hidden');
  check('C scroll depth keeps the maximum after scrolling back up', (await local(page, 'dma')).maxScrollDepth === 100);
  await visibility(page, 'visible');

  // Quiz attempts
  await page.click('#topic-quiz .quiz-intro button');
  await visibility(page, 'hidden');
  s = await poll(async () => { const x = (await sessions(rid))[0]; return x.quizStatus === 'started' && x; });
  check('C opening the quiz → quizStatus started, quizStartedAt set', s && s.quizStartedAt instanceof Date, s);
  await visibility(page, 'visible');
  await answer(page, 'dma', [1, 1, 1, 1, 0, 0, 0, 0]);
  s = await poll(async () => { const x = (await sessions(rid))[0]; return x.quizStatus === 'completed' && x; });
  const a1 = s && Object.values(s.quizAttempts)[0];
  check('C first attempt: completed, score 50, 1 attempt, completion time, answers + version stored', s && s.quizScore === 50 &&
    s.quizAttemptCount === 1 && s.quizCompletedAt instanceof Date && a1.answers.length === 8 && a1.quizVersion === 1 && a1.correctCount === 4, s);
  await page.click('.quiz-result button');
  await answer(page, 'dma', [1, 1, 1, 1, 1, 1, 1, 1]);
  s = await poll(async () => { const x = (await sessions(rid))[0]; return x.quizAttemptCount === 2 && x; });
  check('C retake: 2 attempts kept, session score stays the first (50), last score 100', s && s.quizScore === 50 && s.quizLastScore === 100 &&
    Object.values(s.quizAttempts).map((a) => a.score).sort().join() === '100,50', s);

  // Interactions
  await page.click('.complete-btn');
  await visibility(page, 'hidden');
  s = await poll(async () => { const x = (await sessions(rid))[0]; return x.interactions.lesson_complete === 1 && x; });
  check('C marking the topic complete: counted as an interaction and topicCompleted = true', !!s && s.interactionsTracked === true &&
    s.topicCompleted === true, (await sessions(rid))[0]);
  await visibility(page, 'visible');

  // Second tab, same topic → same session
  const tab2 = await open(ctx, 'dynamic-memory.html');
  s = await poll(async () => { const x = await sessions(rid); return x.length === 1 && x[0].pageViews === 3 && x[0]; });
  check('C a second tab on the same topic joins the session (3 page views)', !!s, await sessions(rid));
  await tab2.close();

  // A different topic → its own session; prior attempts counted for a later dma session
  const other = await open(ctx, 'friend-functions.html');
  const both = await poll(async () => { const x = await sessions(rid); return x.length === 2 && x; });
  check('C another topic gets its own session', both && both.some((x) => x.topicId === 'friend' && x.pageViews === 1), both);
  await other.close();

  // GA4: every event this page sent during the run (the page was reloaded once, after consent)
  const evs = await page.evaluate(() => (window.dataLayer || []).filter((a) => a[0] === 'event').map((a) => [a[1], a[2] || {}]));
  const NAME = /^[a-z][a-z0-9_]{0,39}$/;
  const badGa = evs.filter(([n, p]) => !NAME.test(n) || Object.keys(p).length > 25 || Object.entries(p).some(([k, v]) =>
    !NAME.test(k) || !(Number.isFinite(v) || typeof v === 'boolean' || (typeof v === 'string' && v.length <= 100 &&
      !/[0-9a-f]{8}-[0-9a-f]{4}-|@/i.test(v) && !v.includes(rid)))));
  check('C GA4: valid names, ≤ 25 primitive params, no ids, answers or emails', evs.length > 0 && !badGa.length, badGa);
  const n = (name) => evs.filter(([x]) => x === name).length;
  const qc = evs.filter(([x]) => x === 'quiz_completed').map(([, p]) => Object.keys(p).sort().join());
  check('C GA4: no duplicates — refresh sends no new study_session_started; 2 quiz_started, 2 quiz_completed, 1 lesson_complete',
    n('study_session_started') === 0 && n('quiz_started') === 2 && n('quiz_completed') === 2 && n('lesson_complete') === 1 &&
    qc.every((k) => k === 'lesson_id,quiz_score'), evs.map(([x]) => x));

  // Google sign-in for sync stays separate from research
  await page.evaluate(() => firebase.auth().signInWithCredential(firebase.auth.GoogleAuthProvider.credential(
    JSON.stringify({ sub: 'google-student', email: 'student@example.com', email_verified: true }))));
  const syncId = await page.evaluate(() => firebase.auth().currentUser.uid);
  const synced = await poll(async () => { const u = await get('users/' + syncId); return u && u.state && Object.assign({ id: syncId }, u); });
  check('C Google sync still works next to research (users/{uid} saved)', synced && synced.state && synced.state.progress.topics.dma, synced);
  const dump = JSON.stringify([await get('researchParticipants/' + rid), await sessions(rid)]);
  check('C research records contain no email, name or Google uid', !/student@example\.com|google-student|@/.test(dump) && !dump.includes(synced && synced.id));
  return { ctx, page, rid, syncId };
}

async function timeout(browser) {
  const ctx = await context(browser, { idle: 3, session: 0.1 }, true); // a session ends after 6 s idle
  const page = await open(ctx, 'this-pointer.html');
  const rid = await ridOf(page);
  const first = await poll(async () => { const x = await sessions(rid); return x.length === 1 && x[0]; });
  await visibility(page, 'hidden');
  await sleep(8000);
  await visibility(page, 'visible');
  await wiggle(page, 1000);
  const two = await poll(async () => { const x = await sessions(rid); return x.length === 2 && x.find((y) => y.id === first.id).endedAt && x; }, 25000);
  const old = two && two.find((y) => y.id === first.id);
  const fresh = two && two.find((y) => y.id !== first.id);
  check('D activity after the timeout starts a new session in the same tab', !!two && fresh.pageViews === 1, two || await sessions(rid));
  check('D the old session ends at its last active moment', old && old.endedAt.getTime() === old.lastActiveAt.getTime(), old);
  check('D study_session_completed sent with lesson_id, active seconds, quiz status', (await ga(page, 'study_session_completed')).some((e) =>
    e.lesson_id === 'this' && Number.isInteger(e.study_active_sec) && e.study_quiz_status === 'not_started'), await ga(page, 'study_session_completed'));
  await visibility(page, 'hidden');
  await sleep(8000);
  const home = await open(ctx, 'index.html');
  const closed = await poll(async () => { const x = await sessions(rid); return x.length === 2 && x.every((y) => y.endedAt) && x; }, 25000);
  check('D loading any page closes a timed-out session', !!closed, await sessions(rid));
  check('D no session is created on non-topic pages', (await sessions(rid)).length === 2 && !(await ls(home, 'research-open') || {}).index);
  await ctx.close();
}

async function rules(page, rid) {
  const r = await page.evaluate(async (rid) => {
    const fb = firebase;
    const T = fb.firestore.Timestamp.now();
    const ST = fb.firestore.FieldValue.serverTimestamp;
    const out = {};
    const attempt = (k, p) => p.then(() => { out[k] = 'allowed'; }, (e) => { out[k] = e.code; });
    const make = (name) => {
      const app = fb.initializeApp(OOP.config.firebase, name);
      app.auth().useEmulator('http://127.0.0.1:9099');
      const db = app.firestore();
      db.useEmulator('127.0.0.1', 8080);
      return { app, auth: app.auth(), db };
    };
    const session = (me, id, over) => Object.assign({
      researchId: me, sessionId: id, topicId: 'dma', startedAt: T, lastActiveAt: T, endedAt: null, engagementTimeSeconds: 100,
      pageViews: 1, maxScrollDepth: 50, quizStatus: 'not_started', quizStartedAt: null, quizCompletedAt: null, quizScore: null,
      quizLastScore: null, quizAttemptCount: 0, quizPriorAttempts: 0, quizAttempts: {}, interactions: {}, interactionsTracked: true,
      topicCompleted: false, consentVersion: 1, schemaVersion: 1, updatedAt: ST()
    }, over);
    const one = { a1: { attemptNumber: 1, quizVersion: 1, score: 50, correctCount: 4, questionCount: 8, answers: [0, 0, 0, 0, 0, 0, 0, 0], startedAt: T, submittedAt: T } };
    const done = { quizStatus: 'completed', quizScore: 50, quizLastScore: 50, quizAttemptCount: 1, quizAttempts: one };

    const x = make('intruder');
    await x.auth.signInAnonymously();
    const me = x.auth.currentUser.uid;
    const mine = (id) => x.db.doc('researchParticipants/' + me + '/sessions/' + id);
    await attempt('readOtherParticipant', x.db.doc('researchParticipants/' + rid).get());
    await attempt('listOtherSessions', x.db.collection('researchParticipants/' + rid + '/sessions').get());
    await attempt('writeOtherSession', x.db.doc('researchParticipants/' + rid + '/sessions/evil').set(session(rid, 'evil')));
    await attempt('writeOtherConsent', x.db.doc('researchParticipants/' + rid).update({ consentStatus: 'withdrawn', withdrawnAt: T, updatedAt: ST() }));
    await attempt('ownValidSession', mine('s1').set(session(me, 's1', done)));
    await attempt('scoreAbove100', mine('s2').set(session(me, 's2', Object.assign({}, done, { quizScore: 150 }))));
    await attempt('zeroPageViews', mine('s3').set(session(me, 's3', { pageViews: 0 })));
    await attempt('extraField', mine('s4').set(session(me, 's4', { email: 'a@b.c' })));
    await attempt('wrongSessionId', mine('s5').set(session(me, 'other')));
    await attempt('completedWithoutAttempt', mine('s6').set(session(me, 's6', { quizStatus: 'completed' })));
    await attempt('clientTimeAsUpdatedAt', mine('s7').set(session(me, 's7', { updatedAt: T })));
    await attempt('lowerEngagement', mine('s1').set(session(me, 's1', Object.assign({}, done, { engagementTimeSeconds: 10 }))));
    await attempt('changeTopic', mine('s1').set(session(me, 's1', Object.assign({}, done, { topicId: 'this' }))));
    await attempt('alterAttempt', mine('s1').set(session(me, 's1', Object.assign({}, done, { quizAttempts: { a1: Object.assign({}, one.a1, { score: 100 }) } }))));
    await attempt('dropAttempt', mine('s1').set(session(me, 's1', Object.assign({}, done, { quizAttempts: {}, quizAttemptCount: 0, quizStatus: 'started' }))));
    await attempt('addAttempt', mine('s1').set(session(me, 's1', Object.assign({}, done, { quizAttemptCount: 2, quizLastScore: 100,
      quizAttempts: Object.assign({ a2: Object.assign({}, one.a1, { attemptNumber: 2, score: 100 }) }, one) }))));
    const consent = x.db.doc('researchParticipants/' + me);
    await attempt('createWithdrawnConsent', consent.set({ researchId: me, consentStatus: 'withdrawn', consentVersion: 1, consentedAt: T, updatedAt: ST() }));
    await attempt('createConsent', consent.set({ researchId: me, consentStatus: 'granted', consentVersion: 1, consentedAt: T, updatedAt: ST() }));
    await attempt('withdraw', consent.update({ consentStatus: 'withdrawn', withdrawnAt: T, updatedAt: ST() }));
    await attempt('unwithdraw', consent.update({ consentStatus: 'granted', updatedAt: ST() }));
    await attempt('readOwn', mine('s1').get());
    await attempt('topicCompletedNotBool', mine('s8').set(session(me, 's8', { topicCompleted: 'yes' })));

    const g = make('google');
    await g.auth.signInWithCredential(fb.auth.GoogleAuthProvider.credential(JSON.stringify({ sub: 'g2', email: 'g2@example.com', email_verified: true })));
    const guid = g.auth.currentUser.uid;
    await attempt('googleAccountConsent', g.db.doc('researchParticipants/' + guid).set({ researchId: guid, consentStatus: 'granted', consentVersion: 1, consentedAt: T, updatedAt: ST() }));
    await attempt('googleAccountSession', g.db.doc('researchParticipants/' + guid + '/sessions/s1').set(session(guid, 's1')));
    await attempt('googleReadsOtherSync', g.db.doc('users/someone-else').get());
    await x.app.delete();
    await g.app.delete();
    return out;
  }, rid);
  const expect = {
    readOtherParticipant: 'permission-denied', listOtherSessions: 'permission-denied', writeOtherSession: 'permission-denied',
    writeOtherConsent: 'permission-denied', ownValidSession: 'allowed', scoreAbove100: 'permission-denied', zeroPageViews: 'permission-denied',
    extraField: 'permission-denied', wrongSessionId: 'permission-denied', completedWithoutAttempt: 'permission-denied',
    clientTimeAsUpdatedAt: 'permission-denied', lowerEngagement: 'permission-denied', changeTopic: 'permission-denied',
    alterAttempt: 'permission-denied', dropAttempt: 'permission-denied', addAttempt: 'allowed', createWithdrawnConsent: 'permission-denied',
    createConsent: 'allowed', withdraw: 'allowed', unwithdraw: 'permission-denied', readOwn: 'allowed',
    googleAccountConsent: 'permission-denied', googleAccountSession: 'permission-denied', googleReadsOtherSync: 'permission-denied',
    topicCompletedNotBool: 'permission-denied'
  };
  Object.keys(expect).forEach((k) => check('E rules: ' + k + ' → ' + expect[k], r[k] === expect[k], r[k]));
  const anon = await fetch(DOCS + '/researchParticipants/' + rid);
  check('E rules: unauthenticated REST read → 403', anon.status === 403, anon.status);
}

function exportCsv(tmp) {
  execFileSync(process.execPath, [path.join(ROOT, 'tools/export_research.cjs'), '--project', 'demo-oop', '--out', tmp],
    { env: Object.assign({}, process.env, { FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080' }), stdio: 'pipe' });
  const parse = (f) => {
    const [head, ...lines] = fs.readFileSync(path.join(tmp, f), 'utf8').trim().split('\n');
    const cols = head.split(',');
    return lines.filter(Boolean).map((l) => { const v = l.split(','); return Object.fromEntries(cols.map((c, i) => [c, v[i]])); });
  };
  return { sessions: parse('research_sessions.csv'), attempts: parse('research_quiz_attempts.csv') };
}

async function exporting(rid) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oop-export-'));
  const out = exportCsv(tmp);
  const mine = out.sessions.filter((r) => r.research_id === rid);
  const dma = mine.find((r) => r.topic_id === 'dma');
  const friend = mine.find((r) => r.topic_id === 'friend');
  check('F export: participant\'s sessions present (dma + friend)', mine.length === 2 && !!dma && !!friend, mine);
  check('F export: dma row → score 50 (first attempt, verified), last 100, best 100, 2 attempts, 3 views, depth 100',
    dma && dma.quiz_score === '50' && dma.quiz_score_verified === '1' && dma.quiz_last_score === '100' && dma.quiz_best_score === '100' &&
    dma.quiz_attempt_count === '2' && dma.page_views === '3' && dma.max_scroll_depth === '100' && dma.lesson_complete_count === '1', dma);
  check('F export: no quiz → empty quiz_score / quiz_completed_at (missing, not 0)', friend && friend.quiz_status === 'not_started' &&
    friend.quiz_score === '' && friend.quiz_completed_at === '' && friend.quiz_attempt_count === '0', friend);
  const att = out.attempts.filter((a) => a.research_id === rid);
  check('F export: 2 attempt rows, both re-scored and verified, answers + item correctness listed', att.length === 2 &&
    att.every((a) => a.score_verified === '1' && a.answers.split(';').length === 8 && a.item_correct.split(';').length === 8), att);
  check('F export: sessions without a "granted" consent record are left out', !out.sessions.some((r) => r.session_id === 's1' || r.session_id === 'evil'));
  const ids = out.sessions.map((r) => r.session_id);
  check('F export: session IDs are unique', ids.length > 0 && new Set(ids).size === ids.length);
  const num = (v, lo, hi) => /^\d+$/.test(v) && +v >= lo && +v <= hi;
  check('F export: engagement in whole seconds, scroll 0–100, scores 0–100 or empty, end source identifies open sessions',
    out.sessions.every((r) => num(r.engagement_time_seconds, 0, 86400) && num(r.max_scroll_depth, 0, 100) &&
      (r.quiz_score === '' || num(r.quiz_score, 0, 100)) && ['recorded', 'inferred', 'open'].includes(r.session_end_source)), out.sessions);
  check('F export: topic completion column (dma = 1)', dma && dma.topic_completed === '1', dma && dma.topic_completed);
  const files = fs.readFileSync(path.join(tmp, 'research_sessions.csv'), 'utf8') + fs.readFileSync(path.join(tmp, 'research_quiz_attempts.csv'), 'utf8');
  check('F export: no names, emails or Google ids in the CSV files', !/@|student|google-student/i.test(files));
  check('F export: timestamps are UTC "YYYY-MM-DD HH:MM:SS"', /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(dma && dma.session_started_at), dma && dma.session_started_at);
  return tmp;
}

async function withdrawal(ctx, page, rid, tmp, syncId) {
  await visibility(page, 'visible');
  await page.click('#sbResearch button');
  check('G sidebar dialog offers withdrawal and shows the research ID', (await page.textContent('#researchDlg')).includes(rid) &&
    await page.isVisible('#researchDlg >> text=Withdraw and delete my data'));
  await page.click('#researchDlg >> text=Withdraw and delete my data');
  const gone = await poll(async () => !(await get('researchParticipants/' + rid)) && (await sessions(rid)).length === 0);
  check('G withdrawal deletes the consent record and every session', gone, await sessions(rid));
  check('G withdrawal deletes the anonymous research account', !(await authUser(rid)));
  check('G withdrawal removes participant_id from later GA4 hits', (await upIds(page)).slice(-1)[0] === null, await upIds(page));
  const c = await ls(page, 'research-consent');
  check('G local research data removed; withdrawal recorded as finished', c.status === 'withdrawn' && c.purged === true &&
    !(await ls(page, 'research-open')) && !(await ls(page, 'research-outbox')) && !(await ls(page, 'research-attempts')), c);
  check('G sidebar says "not taking part"', (await page.textContent('#sbResearch')).includes('not taking part'));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('sbResearch'));
  await wiggle(page, 2000);
  await page.click('#topic-quiz .quiz-intro button');
  await answer(page, 'dma', [1, 1, 1, 1, 1, 1, 1, 1]);
  await visibility(page, 'hidden');
  await sleep(4000);
  check('G after withdrawing nothing is recorded or saved', !(await ls(page, 'research-open')) && !(await get('researchParticipants/' + rid)) &&
    (await sessions(rid)).length === 0);
  check('G withdrawal does not touch the Google sync data', !!(await get('users/' + syncId)));
  check('G after withdrawing: participant_id never set again', !(await upIds(page)).length, await upIds(page));
  const after = exportCsv(tmp);
  check('G export no longer contains the withdrawn participant', !after.sessions.some((r) => r.research_id === rid) && !after.attempts.some((r) => r.research_id === rid));
}

async function optOutMode(browser) {
  firestoreTraffic = 0;
  const ctx = await context(browser, { idle: 3, session: 5, ask: false }, false);
  const page = await open(ctx, 'polymorphism.html');
  check('H no invitation or dialog; sidebar says "taking part"', !(await page.$('#researchPrompt')) && !(await page.$('#researchDlg')) &&
    (await page.textContent('#sbResearch')).includes('taking part') && !(await page.textContent('#sbResearch')).includes('not taking part'));
  check('H recorded by default as "implied" (no click needed)', (await ls(page, 'research-consent')).status === 'implied');
  const rid = await ridOf(page);
  const p = rid && await get('researchParticipants/' + rid);
  check('H consent record saved with consentStatus "implied"', p && p.consentStatus === 'implied', p);
  check('H default participants: participant_id = research ID in GA4', await poll(async () => (await upIds(page)).includes(rid)), await upIds(page));
  const s = rid && await poll(async () => { const x = await sessions(rid); return x.length === 1 && x[0]; });
  check('H study session saved straight away (topic polymorphism, 1 page view)', s && s.topicId === 'polymorphism' && s.pageViews === 1, s);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'oop-export-'));
  const row = exportCsv(tmp).sessions.find((r) => r.research_id === rid);
  check('H export includes default participants, marked consent_status "implied"', row && row.consent_status === 'implied', row);
  await page.click('#sbResearch button');
  check('H sidebar dialog explains the recording and offers opt-out', (await page.textContent('#researchDlg')).includes('While you take part') &&
    await page.isVisible('#researchDlg >> text=Withdraw and delete my data'));
  await page.click('#researchDlg >> text=Withdraw and delete my data');
  const gone = await poll(async () => !(await get('researchParticipants/' + rid)) && (await sessions(rid)).length === 0);
  check('H opting out deletes the data', gone, await sessions(rid));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('sbResearch'));
  await wiggle(page, 1500);
  await visibility(page, 'hidden');
  await sleep(3000);
  check('H after opting out: participant_id not set on reload', !(await upIds(page)).length, await upIds(page));
  check('H after opting out: not re-enrolled on reload, nothing recorded', (await ls(page, 'research-consent')).status === 'withdrawn' &&
    !(await ls(page, 'research-open')) && !(await get('researchParticipants/' + rid)) && (await page.textContent('#sbResearch')).includes('not taking part'));
  await ctx.close();

  firestoreTraffic = 0;
  const ctx2 = await context(browser, { idle: 3, session: 5, ask: false }, 'declined');
  const page2 = await open(ctx2, 'polymorphism.html');
  await wiggle(page2, 1500);
  await visibility(page2, 'hidden');
  await sleep(3000);
  check('H a browser that already said "No thanks" is not enrolled', (await ls(page2, 'research-consent')).status === 'declined' &&
    !(await ls(page2, 'research-open')) && firestoreTraffic === 0, { firestoreTraffic });
  await ctx2.close();
}

async function offline(browser) {
  const ctx = await context(browser, { idle: 3, session: 5, ask: false }, false);
  const page = await open(ctx, 'operator-overloading.html');
  const rid = await ridOf(page);
  await poll(async () => (await sessions(rid)).length === 1);
  await ctx.setOffline(true);
  await page.click('#topic-quiz .quiz-intro button');
  await answer(page, 'operators', [1, 1, 1, 1, 1, 1, 1, 1]);
  await visibility(page, 'hidden');
  await sleep(4000);
  const during = (await sessions(rid))[0];
  check('J offline: quiz still works, attempt kept on the device, nothing reaches Firestore yet', (await page.textContent('.quiz-score')).startsWith('100%') &&
    (await local(page, 'operators')).quizAttemptCount === 1 && during.quizAttemptCount === 0, during);
  await ctx.setOffline(false);
  await visibility(page, 'visible');
  await visibility(page, 'hidden');
  const after = await poll(async () => { const x = (await sessions(rid))[0]; return x.quizAttemptCount === 1 && x; }, 90000);
  check('J back online: the attempt reaches Firestore in the same session (score 100)', after && after.quizScore === 100 &&
    after.topicId === 'operators' && after.id === during.id, after || (await sessions(rid))[0]);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.getElementById('sbResearch'));
  await visibility(page, 'hidden');
  await sleep(3000);
  const again = await sessions(rid);
  check('J no duplicate attempt or session after reconnect + reload', again.length === 1 && again[0].quizAttemptCount === 1 && again[0].pageViews === 2, again);
  await ctx.close();
}

async function guards(browser) {
  const idle = async (page) => { await wiggle(page, 1500); await visibility(page, 'hidden'); await sleep(3000); };

  firestoreTraffic = 0;
  let ctx = await context(browser, { idle: 3, session: 5, ask: false }, false);
  const home = await open(ctx, 'index.html');
  await idle(home);
  check('K a visitor who only opens Home gets no research account and no Firestore traffic', !(await ls(home, 'research-consent')).registered && firestoreTraffic === 0 &&
    await home.evaluate(() => !(window.firebase && window.firebase.firestore)), { firestoreTraffic });
  await ctx.close();

  firestoreTraffic = 0;
  ctx = await context(browser, { idle: 3, session: 5, ask: false }, false,
    { userAgent: 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });
  const bot = await open(ctx, 'polymorphism.html');
  await idle(bot);
  check('K a search-engine crawler is never enrolled or recorded', firestoreTraffic === 0 && !(await ls(bot, 'research-consent')) && !(await ls(bot, 'research-open')), { firestoreTraffic });
  await ctx.close();

  firestoreTraffic = 0;
  ctx = await context(browser, { idle: 3, session: 5, ask: false }, false, { noStorage: true });
  const blocked = await open(ctx, 'polymorphism.html');
  await blocked.click('#topic-quiz .quiz-intro button');
  await answer(blocked, 'polymorphism', [1, 1, 1, 1, 1, 1, 1, 1]);
  await idle(blocked);
  check('K storage blocked: the quiz still works, nothing is recorded or sent', (await blocked.textContent('.quiz-score')).startsWith('100%') && firestoreTraffic === 0, { firestoreTraffic });
  await ctx.close();
}

async function features(browser) {
  const ctx = await context(browser, { idle: 60, session: 30, ask: false }, false);
  const page = await open(ctx, 'class-basics.html');
  const btns = page.locator('.pg-actions .complete-btn');
  await btns.nth(0).click();
  await btns.nth(1).click();
  check('I "Mark as completed" and "Bookmark this page" still toggle', (await btns.nth(0).getAttribute('aria-pressed')) === 'true' &&
    (await btns.nth(1).getAttribute('aria-pressed')) === 'true');
  await page.click('.pager .next');
  await page.waitForURL(/const-static\.html$/);
  check('I previous/next pager navigates', page.url().endsWith('const-static.html'));
  const home = await open(ctx, 'index.html');
  const dash = await home.evaluate(() => [...document.querySelectorAll('.dash-card')].map((c) => c.textContent).join(' | '));
  check('I Home dashboard: 1 topic completed, the bookmark listed, "First Step" achievement unlocked', /1 of \d+ topics completed/.test(dash) &&
    dash.includes('Bookmarks') && dash.includes('Class Basics') &&
    await home.evaluate(() => OOP.progress.achievements().some((a) => a.id === 'first-topic' && a.unlocked)), dash.slice(0, 300));
  const dark = await home.evaluate(() => document.documentElement.classList.contains('dark'));
  await home.keyboard.press('t');
  check('I theme switch (T) still works', (await home.evaluate(() => document.documentElement.classList.contains('dark'))) === !dark);
  await home.keyboard.press('Control+k');
  await home.keyboard.type('friend');
  await sleep(500);
  check('I search (Ctrl+K) still finds topics', await home.evaluate(() => document.querySelector('.search-dialog').open &&
    document.getElementById('searchList').textContent.toLowerCase().includes('friend')));
  const code = await open(ctx, 'code-files.html');
  check('I code viewer still renders the C++ examples', await code.evaluate(() => (document.getElementById('cv') || {}).textContent.length > 100));
  await ctx.close();
}

(async function main() {
  try { await fetch(FS); } catch (e) { console.error('Firestore emulator not running on :8080 — start it with: npm run emulators'); process.exit(1); }
  await fetch(FS + '/emulator/v1/projects/demo-oop/databases/(default)/documents', { method: 'DELETE' });
  await fetch('http://127.0.0.1:9099/emulator/v1/projects/demo-oop/accounts', { method: 'DELETE' });
  const server = await serve();
  base = 'http://127.0.0.1:' + server.address().port + '/';
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  try {
    await quizzes(browser);
    await undecided(browser);
    const p = await participant(browser);
    await timeout(browser);
    await rules(p.page, p.rid);
    const tmp = await exporting(p.rid);
    await withdrawal(p.ctx, p.page, p.rid, tmp, p.syncId);
    await p.ctx.close();
    await optOutMode(browser);
    await offline(browser);
    await guards(browser);
    await features(browser);
  } catch (e) {
    failed++;
    console.log('FAIL crashed: ' + (e && e.stack));
  }
  check('no uncaught page errors', errors.length === 0, errors);
  await browser.close();
  server.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
