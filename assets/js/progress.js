/**
 * progress.js — optional learning-progress tracking.
 *
 * Students MANUALLY mark topics (and individual labs) as completed; nothing is ever marked
 * automatically just because a page was opened.
 *
 * Storage key "progress" (JSON):  { topics: { cpp: true, … }, labs: { "01": true, … } }
 *
 * Achievements are derived from that progress (plus visits and bookmarks from library.js); see
 * ACHIEVEMENTS below. Storage key "achievements" only remembers which ones were already announced.
 *
 * What this module renders:
 *   - the progress card at the bottom of the sidebar (topics + achievements count)
 *   - small ticks next to completed topics in the sidebar
 *   - an "Achievement unlocked" toast when one is earned
 * (Buttons on the pages and the Home dashboard are built in page-features.js using this API.)
 *
 * API:
 *   OOP.progress.topics()          → config pages that can be completed
 *   OOP.progress.isDone(id) / setDone(id, bool) / toggle(id)
 *   OOP.progress.isLabDone(num) / toggleLab(num)
 *   OOP.progress.count() / total() / percent()
 *   OOP.progress.reset()           (callers must confirm first — see confirmReset in page-features.js)
 *   OOP.progress.ring(pct)         → a progress-ring element
 *   OOP.progress.achievements()    → [{ id, name, desc, unlocked }]
 * Fires the DOM event "oop:progress" on every change.
 */
(function () {
  'use strict';

  const el = OOP.dom.el;
  const icon = OOP.dom.icon;

  /** Read the saved state, tolerating missing/corrupt data. */
  function read() {
    const s = OOP.store.getJSON('progress', null);
    return {
      topics: (s && s.topics) || {},
      labs: (s && s.labs) || {}
    };
  }

  /** Save state and notify listeners. */
  function write(state) {
    OOP.store.setJSON('progress', state);
    document.dispatchEvent(new CustomEvent('oop:progress'));
  }

  /** Pages that have a "mark as completed" control. */
  function topics() {
    return OOP.config.pages.filter(function (p) { return p.topic; });
  }

  function isDone(id) { return !!read().topics[id]; }

  /** Mark/unmark a topic and (only when completing) show a brief positive notification. */
  function setDone(id, done) {
    const s = read();
    if (done) s.topics[id] = true; else delete s.topics[id];
    write(s);
    const page = OOP.config.pages.filter(function (p) { return p.id === id; })[0];
    if (!page) return;
    if (done) {
      const all = count() === total();
      OOP.ui.toast(all ? 'All topics complete — great work!' : page.label + ' marked as complete', 'check');
    } else {
      OOP.ui.toast(page.label + ' marked as not complete', 'clock');
    }
  }

  function toggle(id) { setDone(id, !isDone(id)); return isDone(id); }

  function isLabDone(num) { return !!read().labs[num]; }

  /** Toggle an individual lab ("01" … "10"). Labs never auto-complete the Labs topic. */
  function toggleLab(num) {
    const s = read();
    if (s.labs[num]) delete s.labs[num]; else s.labs[num] = true;
    write(s);
    return !!s.labs[num];
  }

  function count() { return topics().filter(function (p) { return isDone(p.id); }).length; }
  function total() { return topics().length; }
  function percent() { return total() ? Math.round((count() / total()) * 100) : 0; }

  /** Forget all progress (the caller asks the student to confirm first). */
  function reset() {
    write({ topics: {}, labs: {} });
    OOP.ui.toast('Progress reset', 'clock');
  }

  /**
   * Build a circular progress indicator.
   * @param {number} pct 0–100
   */
  function ring(pct) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 40 40');
    svg.setAttribute('aria-hidden', 'true');
    [['ring-bg', 0], ['ring-fg', pct]].forEach(function (c) {
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('class', c[0]);
      circle.setAttribute('cx', '20');
      circle.setAttribute('cy', '20');
      circle.setAttribute('r', '15.9155'); // circumference = 100 → dash values are percentages
      svg.appendChild(circle);
    });
    const wrap = el('div', { class: 'ring', style: '--pct:' + pct }, [svg, el('span', { class: 'ring-label', text: pct + '%' })]);
    return wrap;
  }

  /* ───────────── Achievements ───────────── */

  /** Numbered labs on labs.html (Lab 01 … Lab 10). */
  const LAB_COUNT = 10;

  /**
   * Achievements are derived from what is already tracked (topics, labs, visits, bookmarks), so they
   * can never drift out of sync — un-marking a topic re-locks what depended on it.
   * test(s) receives a snapshot: { done, total, labs, seen, marks }.
   */
  const ACHIEVEMENTS = [
    { id: 'first-topic', name: 'First Step', desc: 'Complete your first topic', test: function (s) { return s.done >= 1; } },
    { id: 'foundations', name: 'Solid Foundations', desc: 'Complete C++ Revision, Class Basics, Const & Static and Composition',
      test: function () { return ['cpp', 'classes', 'const', 'composition'].every(isDone); } },
    { id: 'pillars', name: 'Pillars of OOP', desc: 'Complete Inheritance and Polymorphism',
      test: function () { return ['inheritance', 'polymorphism'].every(isDone); } },
    { id: 'halfway', name: 'Halfway There', desc: 'Complete half of the topics', test: function (s) { return s.done >= Math.ceil(s.total / 2); } },
    { id: 'all-topics', name: 'Course Complete', desc: 'Complete every topic', test: function (s) { return s.done === s.total; } },
    { id: 'first-lab', name: 'Lab Rat', desc: 'Mark your first lab done', test: function (s) { return s.labs >= 1; } },
    { id: 'all-labs', name: 'Lab Legend', desc: 'Mark all ' + LAB_COUNT + ' labs done', test: function (s) { return s.labs >= LAB_COUNT; } },
    { id: 'explorer', name: 'Explorer', desc: 'Open every topic page',
      test: function (s) { return topics().every(function (p) { return s.seen.indexOf('page:' + p.id) !== -1; }); } },
    { id: 'code-reader', name: 'Code Reader', desc: 'Open 5 code files',
      test: function (s) { return s.seen.filter(function (k) { return k.indexOf('code:') === 0; }).length >= 5; } },
    { id: 'collector', name: 'Collector', desc: 'Bookmark 3 pages or code files', test: function (s) { return s.marks >= 3; } }
  ];

  /** Every achievement with its current state: [{ id, name, desc, unlocked }]. */
  function achievements() {
    const s = {
      done: count(),
      total: total(),
      labs: Object.keys(read().labs).length,
      seen: OOP.library.seen(),
      marks: OOP.library.bookmarks().length
    };
    return ACHIEVEMENTS.map(function (a) { return { id: a.id, name: a.name, desc: a.desc, unlocked: a.test(s) }; });
  }

  /**
   * Announce achievements that became unlocked since the last check. Storage key "achievements"
   * holds the ids unlocked at that check, so each unlock is celebrated once.
   */
  function announceAchievements() {
    const list = achievements();
    const before = OOP.store.getJSON('achievements', []);
    const prev = Array.isArray(before) ? before : [];
    const fresh = list.filter(function (a) { return a.unlocked && prev.indexOf(a.id) === -1; });
    OOP.store.setJSON('achievements', list.filter(function (a) { return a.unlocked; }).map(function (a) { return a.id; }));
    if (fresh.length === 1) OOP.ui.toast('Achievement unlocked: ' + fresh[0].name, 'award');
    else if (fresh.length > 1) OOP.ui.toast(fresh.length + ' achievements unlocked', 'award');
  }

  let announceTimer = null;
  /** Check shortly after a change, so the unlock toast follows the action's own toast. */
  function scheduleAnnounce() {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(announceAchievements, 400);
  }

  /* ───────────── Sidebar rendering ───────────── */

  /** Rebuild the sidebar progress card and the completion ticks next to nav items. */
  function renderSidebar() {
    const host = document.getElementById('sbProgress');
    if (host) {
      host.textContent = '';
      host.appendChild(
        el('div', { class: 'sb-card' }, [
          el('div', { class: 'dash-row' }, [
            ring(percent()),
            el('div', {}, [
              el('strong', { text: 'Your progress' }),
              el('small', { text: count() + ' of ' + total() + ' topics completed' }),
              el('small', { class: 'sb-achievements', text: achievements().filter(function (a) { return a.unlocked; }).length + ' of ' + ACHIEVEMENTS.length + ' achievements' })
            ])
          ])
        ])
      );
    }
    document.querySelectorAll('.nav-btn').forEach(function (a) {
      const id = a.getAttribute('data-page');
      const old = a.querySelector('.nav-done');
      if (old) old.remove();
      const page = OOP.config.pages.filter(function (p) { return p.id === id; })[0];
      if (page && page.topic && isDone(id)) {
        a.appendChild(el('span', { class: 'nav-done' }, [icon('check'), el('span', { class: 'sr-only', text: '(completed)' })]));
      }
    });
  }

  /** Called once by app.js. */
  function init() {
    renderSidebar();
    document.addEventListener('oop:progress', renderSidebar);
    document.addEventListener('oop:library', renderSidebar);
    document.addEventListener('oop:progress', scheduleAnnounce);
    document.addEventListener('oop:library', scheduleAnnounce);
    scheduleAnnounce();
  }

  OOP.progress = { init, topics, isDone, setDone, toggle, isLabDone, toggleLab, count, total, percent, reset, ring, achievements };
})();
