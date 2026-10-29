#!/usr/bin/env node
/**
 * export_research.cjs — ADMIN ONLY: export the research data to two analysis-ready CSV files.
 *
 *   research_sessions.csv       one row per study session
 *   research_quiz_attempts.csv  one row per submitted quiz attempt
 *
 * Only participants whose consent record says "granted" are exported (withdrawn, deleted or unknown
 * participants are left out). Missing values are empty cells, never 0, so pandas reads them as NaN and
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

async function token(keyFile) {
  const key = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const iat = Math.floor(Date.now() / 1000);
  const body = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
    iss: key.client_email, scope: 'https://www.googleapis.com/auth/datastore',
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

/* ───────────── Rows ───────────── */

const INTERACTIONS = ['lesson_complete', 'lesson_uncomplete', 'learning_resource_click', 'code_copy', 'code_file_view', 'lab_complete', 'lab_uncomplete'];

const SESSION_COLUMNS = ['research_id', 'session_id', 'topic_id', 'session_started_at', 'session_last_active_at', 'session_ended_at',
  'session_end_source', 'engagement_time_seconds', 'page_views', 'max_scroll_depth', 'quiz_status', 'quiz_score', 'quiz_score_verified',
  'quiz_last_score', 'quiz_best_score', 'quiz_attempt_count', 'quiz_prior_attempts', 'quiz_started_at', 'quiz_completed_at',
  'interactions_tracked'].concat(INTERACTIONS.map((n) => n + '_count'), ['consent_version', 'schema_version', 'updated_at']);

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
    if (data.participants[rid].consentStatus === 'granted') stats.participants++; else stats.excludedParticipants++;
  });
  data.sessions.forEach((s) => {
    const p = data.participants[s.researchId];
    if (!p || p.consentStatus !== 'granted') { stats.excludedSessions++; return; }
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
      quiz_started_at: time(s.quizStartedAt), quiz_completed_at: time(s.quizCompletedAt),
      interactions_tracked: flag(s.interactionsTracked), consent_version: s.consentVersion,
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
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'research_sessions.csv'), csv(SESSION_COLUMNS, result.sessionRows));
  fs.writeFileSync(path.join(out, 'research_quiz_attempts.csv'), csv(ATTEMPT_COLUMNS, result.attemptRows));
  const s = result.stats;
  console.log('Project ' + project + (process.env.FIRESTORE_EMULATOR_HOST ? ' (emulator)' : ''));
  console.log('Participants exported: ' + s.participants + '   left out (not consenting): ' + s.excludedParticipants);
  console.log('Sessions exported:     ' + s.sessions + '   left out: ' + s.excludedSessions);
  console.log('Quiz attempts:         ' + s.attempts + '   score not verified: ' + s.unverified);
  console.log('Wrote ' + path.join(out, 'research_sessions.csv') + ' and research_quiz_attempts.csv');
}

if (require.main === module) {
  main().catch((e) => { console.error('Export failed:', e.message); process.exit(1); });
} else {
  module.exports = { value, fields, build, csv, rescore, SESSION_COLUMNS, ATTEMPT_COLUMNS };
}
