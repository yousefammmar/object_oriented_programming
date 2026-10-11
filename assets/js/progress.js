/**
 * progress.js — optional learning-progress tracking.
 *
 * Students MANUALLY mark topics (and individual labs) as completed; nothing is ever marked
 * automatically just because a page was opened.
 *
 * Storage key "progress" (JSON):  { topics: { cpp: true, … }, labs: { "01": true, … } }
 *
 * What this module renders:
 *   - the progress card at the bottom of the sidebar
 *   - small ticks next to completed topics in the sidebar
 * (Buttons on the pages and the Home dashboard are built in page-features.js using this API.)
 *
 * API:
 *   OOP.progress.topics()          → config pages that can be completed
 *   OOP.progress.isDone(id) / setDone(id, bool) / toggle(id)
 *   OOP.progress.isLabDone(num) / toggleLab(num)
 *   OOP.progress.count() / total() / percent()
 *   OOP.progress.reset()           (callers must confirm first — see confirmReset in page-features.js)
 *   OOP.progress.ring(pct)         → a progress-ring element
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
              el('small', { text: count() + ' of ' + total() + ' topics completed' })
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
  }

  OOP.progress = { init, topics, isDone, setDone, toggle, isLabDone, toggleLab, count, total, percent, reset, ring };
})();
