#!/usr/bin/env node
/**
 * export_research.cjs — ADMIN ONLY: export the research data to three analysis-ready CSV files.
 *
 *   research_sessions.csv       one row per study session
 *   research_quiz_attempts.csv  one row per submitted quiz attempt
 *   research_participants.csv   one row per participant: Firestore totals + their GA4 metrics, joined on
 *                               research_id = GA4 user property participant_id (GA4 Data API)
 *
 * GA4 needs the service account added as Viewer on the GA4 property and the "Google Analytics Data API"
 * enabled in the Firebase project's Google Cloud console. Without it the export still runs and the GA4
 * columns stay empty. Property: --ga4-property <numeric id> (default below).
 *
 * Only participants whose consent record says "granted" (agreed) or "implied" (taking part by default,
 * never opted out) are exported; withdrawn, deleted or unknown participants are left out. Missing values are empty cells, never 0, so pandas reads them as NaN and
 * SPSS as system-missing. Times are UTC, "YYYY-MM-DD HH:MM:SS". Column meanings: docs/RESEARCH.md.
 * Quiz scores are recomputed from the stored answers and the answer key in assets/js/quiz-data.js
 * (`*_verified` columns), because the browser that submitted them cannot be trusted.
 *
 * Credentials never go in the website or the repository. Either:
 *   GOOGLE_APPLICATION_CREDENTIALS=/safe/place/service-account.json node tools/export_research.cjs
 *     (Firebase console → Project settings → Service accounts → Generate new private key)
 *   FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 node tools/export_research.cjs --project demo-oop
 *
 * Options: --out <dir> (default research-export, git-ignored)   --project <id> (default from .firebaserc)
 * No npm packages: Node 18+ fetch + crypto talk to the Firestore REST API directly.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');

/* ───────────── Site files (quiz answer key, session timeout) ───────────── */

function siteGlobal(files) {
  const window = {};
  files.forEach((f) => vm.runInNewContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { window }));
  return window.OOP;
}

/* ───────────── Firestore REST ───────────── */

/** GA4 property "Object Oriented" (G-FEC09FLLMC), which receives every hit of the site's Google tag. */
const GA4_PROPERTY = '558651328';

async function token(keyFile) {
  const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const body = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: key.client_email, scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/analytics.readonly',
    aud: key.token_uri || 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600
  });
  const jwt = body + '.' + crypto.createSign('RSA-SHA256').update(body).sign(key.private_key).toString('base64url');
  const res = await fetch(key.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt })
  });
  if (!res.ok) throw new Error('token request failed: ' + res.status + ' ' + (await res.text()));
  return (await res.json()).access_token;
}

/** Firestore REST value → plain JS (timestamps → Date). */
function value(v) {
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return new Date(v.timestampValue);
  if ('stringValue' in v) return v.stringValue;
  if ('mapValue' in v) return fields(v.mapValue.fields);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(value);
  return null;
}
function fields(f) {
  const out = {};
  Object.keys(f || {}).forEach((k) => { out[k] = value(f[k]); });
  return out;
}

async function fetchAll(project, auth) {
  const host = process.env.FIRESTORE_EMULATOR_HOST;
  const base = (host ? 'http://' + host : 'https://firestore.googleapis.com') + '/v1/projects/' + project + '/databases/(default)/documents';
  const headers = { Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' };
  const call = async (url, opts) => {
    const res = await fetch(url, Object.assign({ headers }, opts));
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()));
    return res.json();
  };
  const participants = {};
  let pageToken = '';
  do {
    const page = await call(base + '/researchParticipants?pageSize=300' + (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''));
    (page.documents || []).forEach((d) => { participants[d.name.split('/').pop()] = fields(d.fields); });
    pageToken = page.nextPageToken;
  } while (pageToken);
  const rows = await call(base + ':runQuery', {
    method: 'POST',
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'sessions', allDescendants: true }] } })
  });
  const sessions = rows.filter((r) => r.document && /\/researchParticipants\/[^/]+\/sessions\//.test(r.document.name))
    .map((r) => fields(r.document.fields));
  return { participants, sessions };
}

/* ───────────── GA4 Data API ───────────── */

const GA4_ID = 'customUser:participant_id';
/** GA4 event → column. The learning events cover every page (Labs, Code Files…), not only topic pages. */
const GA4_EVENTS = { scroll: 'ga4_scroll_events', lesson_complete: 'ga4_lesson_completions', lab_complete: 'ga4_lab_completions',
  code_file_view: 'ga4_code_file_views', learning_resource_click: 'ga4_resource_clicks' };

/** The three GA4 reports, each broken down by participant_id. */
function ga4Requests(startDate) {
  const base = { dateRanges: [{ startDate, endDate: 'today' }], limit: 100000 };
  return {
    totals: Object.assign({ dimensions: [{ name: GA4_ID }],
      metrics: ['userEngagementDuration', 'screenPageViews', 'sessions', 'engagedSessions'].map((name) => ({ name })) }, base),
    events: Object.assign({ dimensions: [{ name: GA4_ID }, { name: 'eventName' }], metrics: [{ name: 'eventCount' }],
      dimensionFilter: { filter: { fieldName: 'eventName', inListFilter: { values: Object.keys(GA4_EVENTS) } } } }, base),
    device: Object.assign({ dimensions: [{ name: GA4_ID }, { name: 'deviceCategory' }], metrics: [{ name: 'sessions' }] }, base)
  };
}

async function fetchGa4(property, auth, startDate) {
  const reqs = ga4Requests(startDate);
  const out = {};
  for (const k of Object.keys(reqs)) {
    const res = await fetch('https://analyticsdata.googleapis.com/v1beta/properties/' + property + ':runReport', {
      method: 'POST', headers: { Authorization: 'Bearer ' + auth, 'Content-Type': 'application/json' }, body: JSON.stringify(reqs[k])
    });
    if (!res.ok) throw new Error(res.status + ' ' + (await res.text()).slice(0, 300));
    out[k] = await res.json();
  }
  return out;
}

/** runReport responses → { researchId: GA4 columns }. Rows without an ID ("(not set)") are dropped. */
function ga4ByParticipant(reports) {
  const rows = (r) => (r.rows || []).map((x) => ({ d: x.dimensionValues.map((v) => v.value), m: x.metricValues.map((v) => Number(v.value)) }))
    .filter((x) => x.d[0] && x.d[0] !== '(not set)');
  const by = {};
  const get = (id) => (by[id] = by[id] || Object.assign({ ga4_engagement_seconds: 0, ga4_views: 0, ga4_sessions: 0, ga4_engaged_sessions: 0 },
    ...Object.values(GA4_EVENTS).map((c) => ({ [c]: 0 })), { ga4_device: null }));
  rows(reports.totals).forEach(({ d, m }) => Object.assign(get(d[0]),
    { ga4_engagement_seconds: Math.round(m[0]), ga4_views: m[1], ga4_sessions: m[2], ga4_engaged_sessions: m[3] }));
  rows(reports.events).forEach(({ d, m }) => { if (GA4_EVENTS[d[1]]) get(d[0])[GA4_EVENTS[d[1]]] = m[0]; });
  const top = {}; // device with the most sessions
  rows(reports.device).forEach(({ d, m }) => { if (!(top[d[0]] >= m[0])) { top[d[0]] = m[0]; get(d[0]).ga4_device = d[1]; } });
  return by;
}

/* ───────────── Rows ───────────── */

/** Consent states that are exported (see docs/RESEARCH.md §3). */
const ENROLLED = ['granted', 'implied'];
const INTERACTIONS = ['lesson_complete', 'lesson_uncomplete', 'learning_resource_click', 'code_copy', 'code_file_view', 'lab_complete', 'lab_uncomplete'];

const SESSION_COLUMNS = ['research_id', 'session_id', 'topic_id', 'session_started_at', 'session_last_active_at', 'session_ended_at',
  'session_end_source', 'engagement_time_seconds', 'page_views', 'max_scroll_depth', 'quiz_status', 'quiz_score', 'quiz_score_verified',
  'quiz_last_score', 'quiz_best_score', 'quiz_attempt_count', 'quiz_prior_attempts', 'quiz_started_at', 'quiz_completed_at',
  'topic_completed', 'interactions_tracked'].concat(INTERACTIONS.map((n) => n + '_count'), ['consent_status', 'consent_version', 'schema_version', 'updated_at']);

const ATTEMPT_COLUMNS = ['research_id', 'session_id', 'topic_id', 'attempt_id', 'attempt_number', 'quiz_prior_attempts', 'quiz_version',
  'question_count', 'correct_count', 'score_reported', 'score_recomputed', 'score_verified', 'started_at', 'submitted_at',
  'duration_seconds', 'answers', 'item_correct'];

function time(d) { return d instanceof Date ? d.toISOString().slice(0, 19).replace('T', ' ') : null; }
function flag(b) { return b === true ? 1 : b === false ? 0 : null; }

/** Re-score an attempt against the answer key; null when the quiz version no longer matches. */
function rescore(quiz, topicId, a) {
  const q = quiz[topicId];
  if (!q || q.version !== a.quizVersion || !Array.isArray(a.answers) || a.answers.length !== q.questions.length) return null;
  const items = q.questions.map((x, i) => (a.answers[i] === x.answer ? 1 : 0));
  const correct = items.reduce((s, x) => s + x, 0);
  return { items, correct, score: Math.round(correct / items.length * 100) };
}

/**
 * Build both tables. `now` (Date) and `timeoutMs` decide whether an open session counts as ended:
 * open sessions inactive for longer than the timeout get session_ended_at = last activity ("inferred").
 */
function build(data, quiz, timeoutMs, now) {
  const sessionRows = [];
  const attemptRows = [];
  const stats = { participants: 0, excludedParticipants: 0, sessions: 0, excludedSessions: 0, attempts: 0, unverified: 0 };
  Object.keys(data.participants).forEach((rid) => {
    if (ENROLLED.includes(data.participants[rid].consentStatus)) stats.participants++; else stats.excludedParticipants++;
  });
  data.sessions.forEach((s) => {
    const p = data.participants[s.researchId];
    if (!p || !ENROLLED.includes(p.consentStatus)) { stats.excludedSessions++; return; }
    stats.sessions++;
    const attempts = Object.keys(s.quizAttempts || {}).map((id) => Object.assign({ id }, s.quizAttempts[id]))
      .sort((a, b) => a.attemptNumber - b.attemptNumber);
    const checked = attempts.map((a) => ({ a, r: rescore(quiz, s.topicId, a) }));
    checked.forEach(({ a, r }) => {
      stats.attempts++;
      if (!r || r.score !== a.score) stats.unverified++;
      attemptRows.push({
        research_id: s.researchId, session_id: s.sessionId, topic_id: s.topicId, attempt_id: a.id, attempt_number: a.attemptNumber,
        quiz_prior_attempts: s.quizPriorAttempts, quiz_version: a.quizVersion, question_count: a.questionCount,
        correct_count: a.correctCount, score_reported: a.score, score_recomputed: r ? r.score : null,
        score_verified: r ? flag(r.score === a.score) : null, started_at: time(a.startedAt), submitted_at: time(a.submittedAt),
        duration_seconds: a.startedAt && a.submittedAt ? Math.round((a.submittedAt - a.startedAt) / 1000) : null,
        answers: Array.isArray(a.answers) ? a.answers.join(';') : null, item_correct: r ? r.items.join(';') : null
      });
    });
    let ended = s.endedAt;
    let source = ended ? 'recorded' : 'open';
    if (!ended && s.lastActiveAt && now - s.lastActiveAt > timeoutMs) { ended = s.lastActiveAt; source = 'inferred'; }
    const first = checked[0];
    const scores = attempts.map((a) => a.score);
    const row = {
      research_id: s.researchId, session_id: s.sessionId, topic_id: s.topicId,
      session_started_at: time(s.startedAt), session_last_active_at: time(s.lastActiveAt), session_ended_at: time(ended),
      session_end_source: source, engagement_time_seconds: s.engagementTimeSeconds, page_views: s.pageViews,
      max_scroll_depth: s.maxScrollDepth, quiz_status: s.quizStatus, quiz_score: s.quizScore,
      quiz_score_verified: first ? (first.r ? flag(first.r.score === s.quizScore) : null) : null,
      quiz_last_score: s.quizLastScore, quiz_best_score: scores.length ? Math.max.apply(null, scores) : null,
      quiz_attempt_count: s.quizAttemptCount, quiz_prior_attempts: s.quizPriorAttempts,
      quiz_started_at: time(s.quizStartedAt), quiz_completed_at: time(s.quizCompletedAt), topic_completed: flag(s.topicCompleted),
      interactions_tracked: flag(s.interactionsTracked), consent_status: p.consentStatus, consent_version: s.consentVersion,
      schema_version: s.schemaVersion, updated_at: time(s.updatedAt)
    };
    INTERACTIONS.forEach((n) => { row[n + '_count'] = s.interactionsTracked ? (s.interactions || {})[n] || 0 : null; });
    sessionRows.push(row);
  });
  const order = (a, b) => (a.research_id + a.session_started_at).localeCompare(b.research_id + b.session_started_at);
  sessionRows.sort(order);
  attemptRows.sort((a, b) => (a.research_id + a.submitted_at).localeCompare(b.research_id + b.submitted_at));
  return { sessionRows, attemptRows, stats };
}

const PARTICIPANT_COLUMNS = ['research_id', 'sessions', 'topics_studied', 'engagement_time_seconds', 'page_views', 'max_scroll_depth_mean',
  'quizzes_first_attempt', 'quiz_first_score_mean', 'quiz_attempts', 'topics_completed', 'learning_resource_clicks', 'code_copies',
  'ga4_linked', 'ga4_engagement_seconds', 'ga4_views', 'ga4_sessions', 'ga4_engaged_sessions', 'ga4_scroll_events', 'ga4_device',
  'ga4_lesson_completions', 'ga4_lab_completions', 'ga4_code_file_views', 'ga4_resource_clicks'];

/**
 * One row per participant: totals of their build() session rows (consenting participants only) plus their GA4
 * metrics. GA4 IDs with no Firestore record (withdrawn) drop out. ga4 = null (not fetched) → GA4 columns empty.
 * Quiz columns count only first attempts on a topic whose score was verified.
 */
function participants(sessionRows, ga4) {
  const sum = (a, b) => (b === null || b === undefined ? a : (a || 0) + b);
  const mean = (xs) => (xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length * 10) / 10 : null);
  const by = {};
  sessionRows.forEach((s) => {
    const p = by[s.research_id] = by[s.research_id] || { sessions: 0, topics: new Set(), completed: new Set(), scroll: [], first: [] };
    p.sessions++;
    p.topics.add(s.topic_id);
    if (s.topic_completed === 1) p.completed.add(s.topic_id);
    if (typeof s.max_scroll_depth === 'number') p.scroll.push(s.max_scroll_depth);
    if (s.quiz_status === 'completed' && s.quiz_prior_attempts === 0 && s.quiz_score_verified === 1) p.first.push(s.quiz_score);
    p.engagement_time_seconds = sum(p.engagement_time_seconds, s.engagement_time_seconds);
    p.page_views = sum(p.page_views, s.page_views);
    p.quiz_attempts = sum(p.quiz_attempts, s.quiz_attempt_count);
    p.learning_resource_clicks = sum(p.learning_resource_clicks, s.learning_resource_click_count);
    p.code_copies = sum(p.code_copies, s.code_copy_count);
  });
  return Object.keys(by).sort().map((id) => {
    const p = by[id];
    const g = ga4 && ga4[id];
    return Object.assign({
      research_id: id, sessions: p.sessions, topics_studied: p.topics.size, engagement_time_seconds: p.engagement_time_seconds,
      page_views: p.page_views, max_scroll_depth_mean: mean(p.scroll), quizzes_first_attempt: p.first.length,
      quiz_first_score_mean: mean(p.first), quiz_attempts: p.quiz_attempts, topics_completed: p.completed.size,
      learning_resource_clicks: p.learning_resource_clicks, code_copies: p.code_copies, ga4_linked: ga4 ? flag(!!g) : null
    }, g || {});
  });
}

/** RFC 4180 CSV; null/undefined → empty cell (missing). */
function csv(columns, rows) {
  const cell = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [columns.join(',')].concat(rows.map((r) => columns.map((c) => cell(r[c])).join(','))).join('\n') + '\n';
}

/* ───────────── CLI ───────────── */

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => { const i = args.indexOf(name); return i === -1 ? fallback : args[i + 1]; };
  const out = path.resolve(opt('--out', path.join(ROOT, 'research-export')));
  const project = opt('--project', JSON.parse(fs.readFileSync(path.join(ROOT, '.firebaserc'), 'utf8')).projects.default);
  let auth;
  if (process.env.FIRESTORE_EMULATOR_HOST) auth = 'owner'; // the emulator's admin token
  else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) auth = await token(process.env.GOOGLE_APPLICATION_CREDENTIALS);
  else throw new Error('Set GOOGLE_APPLICATION_CREDENTIALS (service-account key, kept OUTSIDE the repo) or FIRESTORE_EMULATOR_HOST.');

  const OOP = siteGlobal(['assets/js/config.js', 'assets/js/quiz-data.js']);
  const timeoutMs = OOP.config.research.sessionMinutes * 60000;
  const result = build(await fetchAll(project, auth), OOP.quizData, timeoutMs, new Date());
  const property = opt('--ga4-property', GA4_PROPERTY);
  const start = result.sessionRows.map((r) => r.session_started_at).filter(Boolean).sort()[0];
  let ga4 = null;
  if (process.env.FIRESTORE_EMULATOR_HOST) console.log('GA4: skipped (emulator)');
  else if (!start) console.log('GA4: skipped (no sessions yet)');
  else {
    try { ga4 = ga4ByParticipant(await fetchGa4(property, auth, start.slice(0, 10))); } catch (e) {
      console.warn('GA4: not fetched, GA4 columns left empty. ' + e.message + '\n     Check: the service account is a Viewer on GA4 property '
        + property + ' and the Google Analytics Data API is enabled (docs/RESEARCH.md §8).');
    }
  }
  const people = participants(result.sessionRows, ga4);
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'research_sessions.csv'), csv(SESSION_COLUMNS, result.sessionRows));
  fs.writeFileSync(path.join(out, 'research_quiz_attempts.csv'), csv(ATTEMPT_COLUMNS, result.attemptRows));
  fs.writeFileSync(path.join(out, 'research_participants.csv'), csv(PARTICIPANT_COLUMNS, people));
  const s = result.stats;
  console.log('Project ' + project + (process.env.FIRESTORE_EMULATOR_HOST ? ' (emulator)' : ''));
  console.log('Participants exported: ' + s.participants + '   left out (withdrawn): ' + s.excludedParticipants);
  console.log('Sessions exported:     ' + s.sessions + '   left out: ' + s.excludedSessions);
  console.log('Quiz attempts:         ' + s.attempts + '   score not verified: ' + s.unverified);
  console.log('With a first quiz:     ' + people.filter((p) => p.quizzes_first_attempt > 0).length + ' of ' + people.length + ' participants with sessions');
  console.log('With GA4 data:         ' + (ga4 ? people.filter((p) => p.ga4_linked === 1).length + ' of ' + people.length + ' (GA4 property ' + property + ', since ' + start.slice(0, 10) + ')' : 'not fetched'));
  console.log('Wrote ' + out + '/research_sessions.csv, research_quiz_attempts.csv and research_participants.csv');
}

if (require.main === module) {
  main().catch((e) => { console.error('Export failed:', e.message); process.exit(1); });
} else {
  module.exports = { value, fields, fetchAll, build, csv, rescore, participants, ga4Requests, ga4ByParticipant,
    SESSION_COLUMNS, ATTEMPT_COLUMNS, PARTICIPANT_COLUMNS };
}
