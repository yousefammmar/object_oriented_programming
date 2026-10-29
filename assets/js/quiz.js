/**
 * quiz.js — optional end-of-topic quiz (questions in quiz-data.js).
 *
 * Adds a "Take quiz" block near the end of every topic page that has questions, just above the
 * previous/next links. The quiz is optional and never changes progress: a topic is only ever completed
 * with "Mark as completed". Everyone gets the same questions in the same order; all of them must be
 * answered before submitting, and score = correct / total as a whole percent. After submitting, each
 * question shows the student's answer, the correct one and a short explanation. "Retake" starts a new
 * attempt; nothing is overwritten.
 *
 * Events for research.js (no personal data; research.js ignores them unless the student consented):
 *   'oop:quiz' { type: 'start',  topicId, version }
 *   'oop:quiz' { type: 'submit', topicId, version, answers: [option index…], correct, total, score }
 * GA4 (analytics.js), for everyone: quiz_started { lesson_id }, quiz_completed { lesson_id, quiz_score }.
 * The answers themselves are never sent to GA4.
 *
 * API:
 *   OOP.quiz.init()
 *   OOP.quiz.grade(topicId, answers) → { correct, total, score } (pure; used by tests)
 */
(function () {
  'use strict';

  const el = OOP.dom.el;
  const icon = OOP.dom.icon;

  function grade(topicId, answers) {
    const qs = OOP.quizData[topicId].questions;
    const correct = qs.filter(function (q, i) { return answers[i] === q.answer; }).length;
    return { correct: correct, total: qs.length, score: Math.round(correct / qs.length * 100) };
  }

  function emit(detail) { document.dispatchEvent(new CustomEvent('oop:quiz', { detail: detail })); }
  function ga(name, params) { if (OOP.analytics) OOP.analytics.track(name, params); }

  function render(p, data) {
    const qs = data.questions;
    const total = qs.length;
    let submitted = false;

    const items = qs.map(function (q, i) {
      const opts = q.options.map(function (text, j) {
        return el('label', { class: 'quiz-opt' }, [
          el('input', { type: 'radio', name: 'quiz-q' + i, value: String(j) }),
          el('span', { text: text })
        ]);
      });
      const body = [el('legend', {}, [el('span', { class: 'quiz-n', text: 'Question ' + (i + 1) + ' of ' + total }), el('span', { text: q.q })])];
      if (q.code) body.push(el('pre', { class: 'quiz-code' }, [el('code', { text: q.code })]));
      body.push(el('div', { class: 'quiz-opts' }, opts));
      body.push(el('p', { class: 'quiz-why', hidden: true }));
      return el('li', { class: 'quiz-q' }, [el('fieldset', {}, body)]);
    });

    const msg = el('p', { class: 'quiz-msg', role: 'status', 'aria-live': 'polite' });
    const submit = el('button', { type: 'submit', class: 'btn btn--primary', text: 'Submit answers' });
    const form = el('form', { class: 'quiz-form', hidden: true, novalidate: true, 'aria-label': p.label + ' quiz' }, [
      el('ol', { class: 'quiz-list' }, items),
      el('div', { class: 'quiz-actions' }, [submit, msg])
    ]);
    const result = el('div', { class: 'quiz-result', hidden: true, tabindex: '-1' });
    const start = el('button', { type: 'button', class: 'btn btn--primary' }, [icon('play'), el('span', { text: 'Take quiz' })]);
    const intro = el('div', { class: 'quiz-intro' }, [
      el('p', {}, [
        el('strong', { text: 'Check your understanding. ' }),
        total + ' multiple-choice questions on ' + p.label + '. Optional — it does not change your progress.'
      ]),
      start
    ]);

    function answers() {
      return qs.map(function (q, i) {
        const c = form.querySelector('input[name="quiz-q' + i + '"]:checked');
        return c ? Number(c.value) : null;
      });
    }

    function begin() {
      submitted = false;
      form.reset();
      form.querySelectorAll('input').forEach(function (inp) { inp.disabled = false; });
      items.forEach(function (li) {
        li.classList.remove('is-right', 'is-wrong');
        li.querySelectorAll('.quiz-opt').forEach(function (o) { o.classList.remove('is-chosen', 'is-answer'); });
        li.querySelectorAll('.quiz-tag').forEach(function (t) { t.remove(); });
        li.querySelector('.quiz-why').hidden = true;
      });
      msg.textContent = '';
      submit.hidden = false;
      result.hidden = true;
      intro.hidden = true;
      form.hidden = false;
      items[0].querySelector('input').focus({ preventScroll: true });
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      emit({ type: 'start', topicId: p.id, version: data.version });
      ga('quiz_started', { lesson_id: p.id });
    }

    function review(chosen) {
      items.forEach(function (li, i) {
        const q = qs[i];
        const ok = chosen[i] === q.answer;
        li.classList.add(ok ? 'is-right' : 'is-wrong');
        li.querySelectorAll('.quiz-opt').forEach(function (o, j) {
          if (j === chosen[i]) { o.classList.add('is-chosen'); o.appendChild(el('span', { class: 'quiz-tag', text: ok ? 'Your answer · correct' : 'Your answer' })); }
          if (j === q.answer && !ok) { o.classList.add('is-answer'); o.appendChild(el('span', { class: 'quiz-tag', text: 'Correct answer' })); }
        });
        const why = li.querySelector('.quiz-why');
        why.textContent = q.why;
        why.hidden = false;
      });
      form.querySelectorAll('input').forEach(function (inp) { inp.disabled = true; });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (submitted) return; // one result per attempt, however often submit fires
      const chosen = answers();
      const missing = chosen.indexOf(null);
      if (missing !== -1) {
        const left = chosen.filter(function (a) { return a === null; }).length;
        msg.textContent = 'Answer every question to submit (' + left + ' left).';
        items[missing].querySelector('input').focus();
        return;
      }
      submitted = true;
      const g = grade(p.id, chosen);
      submit.hidden = true;
      msg.textContent = '';
      review(chosen);
      const again = el('button', { type: 'button', class: 'btn btn--ghost', text: 'Retake quiz' });
      again.addEventListener('click', begin);
      result.textContent = '';
      result.appendChild(el('p', { class: 'quiz-score' }, [el('strong', { text: g.score + '%' }), el('span', { text: g.correct + ' of ' + g.total + ' correct' })]));
      result.appendChild(el('p', { class: 'quiz-note', text: 'Review your answers below. Retaking starts a new attempt with the same questions.' }));
      result.appendChild(again);
      result.hidden = false;
      result.focus({ preventScroll: true });
      result.scrollIntoView({ behavior: 'smooth', block: 'start' });
      emit({ type: 'submit', topicId: p.id, version: data.version, answers: chosen, correct: g.correct, total: g.total, score: g.score });
      ga('quiz_completed', { lesson_id: p.id, quiz_score: g.score });
    });
    start.addEventListener('click', begin);

    return el('section', { class: 'quiz', id: 'topic-quiz', 'aria-labelledby': 'quizTitle', 'data-ui': '' }, [
      el('h3', { class: 'section-tag', id: 'quizTitle', text: 'Topic quiz' }),
      el('div', { class: 'quiz-card' }, [intro, result, form])
    ]);
  }

  function init() {
    const p = OOP.layout.currentPage();
    const data = OOP.quizData && OOP.quizData[p.id];
    const inner = document.querySelector('main > .inner');
    if (!data || !inner) return;
    const section = render(p, data);
    const pager = inner.querySelector('.pager');
    if (pager) inner.insertBefore(section, pager); else inner.appendChild(section);
  }

  OOP.quiz = { init: init, grade: grade };
})();
