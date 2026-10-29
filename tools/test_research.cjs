#!/usr/bin/env node
/**
 * test_research.cjs — checks for the research logic that does not need a browser:
 *   1. research.js Timer      active time, idle cut-off, hidden tab, no double counting
 *   2. quiz.js grade()        scoring against quiz-data.js, and the question bank's shape
 *   3. export_research.cjs    Firestore value decoding, consent filtering, missing values, re-scoring, CSV
 * Browser behaviour (consent, sessions, Firestore rules, withdrawal) is covered by tools/verify_research.cjs.
 * Run: node tools/test_research.cjs   (npm run test:research)
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;
function test(name, fn) {
  try { fn(); console.log('ok  ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}

/* Load the browser modules with just enough of a fake page. */
const window = { OOP: { config: { research: null, firebase: null }, dom: { el() {}, icon() {} } } };
const ctx = { window, OOP: window.OOP, document: {}, CustomEvent: function () {} };
['assets/js/research.js', 'assets/js/quiz-data.js', 'assets/js/quiz.js'].forEach((f) =>
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx));
const { Timer } = window.OOP.research;
const grade = (t, a) => Object.assign({}, window.OOP.quiz.grade(t, a)); // plain object (vm realm)
const quiz = window.OOP.quizData;
const ex = require('./export_research.cjs');

/* 1. Timer (idle = 60 s) */
const S = 1000;
test('continuous input is counted in full', () => {
  const t = Timer(60 * S);
  t.show(0);
  for (let s = 10; s <= 120; s += 10) t.input(s * S);
  assert.strictEqual(t.take(120 * S), 120 * S);
});
test('counting stops idleSeconds after the last input, not when that is noticed', () => {
  const t = Timer(60 * S);
  t.show(0);
  t.input(10 * S);
  assert.strictEqual(t.take(500 * S), 70 * S);
  assert.strictEqual(t.last, 70 * S);
});
test('input after an idle gap resumes counting from that input', () => {
  const t = Timer(60 * S);
  t.show(0);
  t.take(300 * S);
  t.input(400 * S);
  assert.strictEqual(t.take(430 * S), 30 * S);
});
test('a hidden tab is not counted, and input while hidden is ignored', () => {
  const t = Timer(60 * S);
  t.show(0);
  t.hide(20 * S);
  t.input(30 * S);
  assert.strictEqual(t.take(200 * S), 20 * S);
  t.show(300 * S);
  assert.strictEqual(t.take(310 * S), 10 * S);
});
test('repeated take() never counts the same time twice', () => {
  const t = Timer(60 * S);
  t.show(0);
  let sum = 0;
  for (let s = 1; s <= 50; s++) { t.input(s * S); sum += t.take(s * S); }
  sum += t.take(1000 * S);
  assert.strictEqual(sum, 110 * S);
});
test('a clock that jumps backwards adds nothing', () => {
  const t = Timer(60 * S);
  t.show(100 * S);
  assert.strictEqual(t.take(50 * S), 0);
});

/* 2. Quiz bank + grade() */
test('ten topics, 8 questions each, 4 distinct options, one valid answer, explanation', () => {
  assert.deepStrictEqual(Object.keys(quiz), ['cpp', 'classes', 'const', 'composition', 'dma', 'this', 'friend', 'inheritance', 'polymorphism', 'operators']);
  Object.keys(quiz).forEach((k) => {
    assert.strictEqual(quiz[k].version, 1, k);
    assert.strictEqual(quiz[k].questions.length, 8, k);
    quiz[k].questions.forEach((q, i) => {
      assert.strictEqual(new Set(q.options).size, 4, k + ' q' + i);
      assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < 4, k + ' q' + i);
      assert.ok(q.q && q.why, k + ' q' + i);
    });
  });
});
test('grade(): all right 100, all wrong 0, 5 of 8 = 63 (rounded)', () => {
  const key = quiz.classes.questions.map((q) => q.answer);
  assert.deepStrictEqual(grade('classes', key), { correct: 8, total: 8, score: 100 });
  assert.deepStrictEqual(grade('classes', key.map((a) => (a + 1) % 4)), { correct: 0, total: 8, score: 0 });
  assert.deepStrictEqual(grade('classes', key.map((a, i) => (i < 5 ? a : (a + 1) % 4))), { correct: 5, total: 8, score: 63 });
});

/* 3. Export */
const T = (iso) => ({ timestampValue: iso });
test('Firestore REST values decode (int, null, timestamp, map, array, bool)', () => {
  const f = ex.fields({ n: { integerValue: '42' }, z: { nullValue: null }, t: T('2026-10-29T10:00:00Z'), b: { booleanValue: true },
    m: { mapValue: { fields: { a: { arrayValue: { values: [{ integerValue: '1' }, { integerValue: '3' }] } } } } } });
  assert.strictEqual(f.n, 42);
  assert.strictEqual(f.z, null);
  assert.strictEqual(f.t.toISOString(), '2026-10-29T10:00:00.000Z');
  assert.strictEqual(f.b, true);
  assert.deepStrictEqual(f.m.a, [1, 3]);
});

const key = quiz.dma.questions.map((q) => q.answer);
const d = (s) => new Date('2026-10-29T' + s + 'Z');
function session(over) {
  return Object.assign({
    researchId: 'r1', sessionId: 's1', topicId: 'dma', startedAt: d('10:00:00'), lastActiveAt: d('10:20:00'), endedAt: null,
    engagementTimeSeconds: 900, pageViews: 2, maxScrollDepth: 87, quizStatus: 'not_started', quizStartedAt: null,
    quizCompletedAt: null, quizScore: null, quizLastScore: null, quizAttemptCount: 0, quizPriorAttempts: 0, quizAttempts: {},
    interactions: { lesson_complete: 1 }, interactionsTracked: true, topicCompleted: true, consentVersion: 1, schemaVersion: 1, updatedAt: d('10:20:05')
  }, over);
}
const data = {
  participants: { r1: { consentStatus: 'granted' }, r2: { consentStatus: 'withdrawn' }, r3: { consentStatus: 'implied' } },
  sessions: [
    session(),
    session({ sessionId: 's2', endedAt: d('11:00:00'), quizStatus: 'completed', quizScore: 100, quizLastScore: 25, quizAttemptCount: 2,
      quizStartedAt: d('10:50:00'), quizCompletedAt: d('10:55:00'), quizAttempts: {
        b: { attemptNumber: 2, quizVersion: 1, score: 25, correctCount: 2, questionCount: 8, answers: key.map((a, i) => (i < 2 ? a : (a + 1) % 4)), startedAt: d('10:56:00'), submittedAt: d('10:58:00') },
        a: { attemptNumber: 1, quizVersion: 1, score: 100, correctCount: 8, questionCount: 8, answers: key, startedAt: d('10:50:00'), submittedAt: d('10:55:00') }
      } }),
    session({ sessionId: 's3', quizStatus: 'completed', quizScore: 100, quizLastScore: 100, quizAttemptCount: 1, interactionsTracked: false,
      quizAttempts: { c: { attemptNumber: 1, quizVersion: 1, score: 100, correctCount: 8, questionCount: 8, answers: [0, 0, 0, 0, 0, 0, 0, 0], startedAt: d('10:00:00'), submittedAt: d('10:01:00') } } }),
    session({ researchId: 'r2', sessionId: 'x1' }),
    session({ researchId: 'r3', sessionId: 'i1' }),
    session({ researchId: 'r9', sessionId: 'x2' })
  ]
};
const out = ex.build(data, quiz, 30 * 60000, d('12:00:00'));
const byId = (id) => out.sessionRows.find((r) => r.session_id === id);

test('granted and implied participants are exported; withdrawn and unknown are left out', () => {
  assert.deepStrictEqual(out.sessionRows.map((r) => r.session_id).sort(), ['i1', 's1', 's2', 's3']);
  assert.strictEqual(out.stats.excludedSessions, 2);
  assert.deepStrictEqual([byId('s1').consent_status, byId('i1').consent_status], ['granted', 'implied']);
});
test('no quiz → empty score cells (missing), not 0', () => {
  const r = byId('s1');
  assert.strictEqual(r.quiz_score, null);
  assert.strictEqual(r.quiz_best_score, null);
  assert.strictEqual(r.quiz_attempt_count, 0);
});
test('first attempt is the session score; last and best kept separately; attempts listed in order', () => {
  const r = byId('s2');
  assert.deepStrictEqual([r.quiz_score, r.quiz_last_score, r.quiz_best_score, r.quiz_score_verified], [100, 25, 100, 1]);
  const a = out.attemptRows.filter((x) => x.session_id === 's2');
  assert.deepStrictEqual(a.map((x) => x.attempt_number), [1, 2]);
  assert.deepStrictEqual([a[1].score_recomputed, a[1].score_verified, a[1].duration_seconds], [25, 1, 120]);
});
test('a tampered score is flagged as not verified', () => {
  assert.strictEqual(byId('s3').quiz_score_verified, 0);
  assert.strictEqual(out.attemptRows.find((x) => x.attempt_id === 'c').score_verified, 0);
});
test('open sessions: inferred end after the timeout, recorded end kept', () => {
  assert.deepStrictEqual([byId('s1').session_ended_at, byId('s1').session_end_source], ['2026-10-29 10:20:00', 'inferred']);
  assert.strictEqual(byId('s2').session_end_source, 'recorded');
  const fresh = ex.build(data, quiz, 30 * 60000, d('10:30:00')).sessionRows.find((r) => r.session_id === 's1');
  assert.deepStrictEqual([fresh.session_ended_at, fresh.session_end_source], [null, 'open']);
});
test('topic completion exported as 1/0, empty for records without it', () => {
  assert.strictEqual(byId('s1').topic_completed, 1);
  const r = ex.build({ participants: { r1: { consentStatus: 'granted' } }, sessions: [session({ topicCompleted: false }), session({ sessionId: 'old', topicCompleted: undefined })] }, quiz, 30 * 60000, d('12:00:00'));
  assert.deepStrictEqual(r.sessionRows.map((x) => x.topic_completed).sort(), [0, null].sort());
});
test('interaction counts: 0 when tracked but none, empty when not tracked', () => {
  assert.strictEqual(byId('s1').lesson_complete_count, 1);
  assert.strictEqual(byId('s1').code_copy_count, 0);
  assert.strictEqual(byId('s3').code_copy_count, null);
});
test('an attempt from an older quiz version is not re-scored (empty, not 0)', () => {
  const old = { participants: { r1: { consentStatus: 'granted' } }, sessions: [session({ quizStatus: 'completed', quizScore: 50, quizAttemptCount: 1,
    quizAttempts: { a: { attemptNumber: 1, quizVersion: 0, score: 50, correctCount: 4, questionCount: 8, answers: key, startedAt: null, submittedAt: d('10:10:00') } } })] };
  const r = ex.build(old, quiz, 30 * 60000, d('12:00:00'));
  assert.deepStrictEqual([r.sessionRows[0].quiz_score_verified, r.attemptRows[0].score_recomputed, r.attemptRows[0].duration_seconds], [null, null, null]);
});
test('CSV: header row, quoting, empty cells for missing values', () => {
  const text = ex.csv(['a', 'b', 'c'], [{ a: 'x,y', b: null, c: 'say "hi"' }, { a: 0, b: undefined, c: 'z' }]);
  assert.strictEqual(text, 'a,b,c\n"x,y",,"say ""hi"""\n0,,z\n');
  const header = ex.csv(ex.SESSION_COLUMNS, out.sessionRows).split('\n')[0].split(',');
  ['research_id', 'session_id', 'topic_id', 'engagement_time_seconds', 'page_views', 'max_scroll_depth', 'quiz_status', 'quiz_score',
    'quiz_attempt_count', 'session_started_at', 'quiz_completed_at'].forEach((c) => assert.ok(header.includes(c), c));
});

console.log(failed ? '\n' + failed + ' FAILED' : '\nAll research checks passed');
process.exit(failed ? 1 : 0);
