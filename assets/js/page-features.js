/**
 * page-features.js — progressive enhancements applied to each page's existing content.
 *
 * IMPORTANT: nothing here edits course text. It only
 *   - adds classes/attributes to existing elements (e.g. resource "kind" colours),
 *   - inserts clearly separate UI controls (all marked with data-ui) such as "Mark as completed",
 *   - builds the Home dashboard and the All Links filter.
 *
 * Sections:
 *   1. Markup enhancements   (chips, placeholder links, stagger animation, GA4 resource clicks)
 *   2. Topic completion      (page actions, lab toggles, Home badges)
 *   3. Home dashboard        (continue learning, progress, bookmarks / recent, achievements)
 *   4. Previous / next pager
 *   5. All Links filter
 *   6. Entry point           OOP.features.init()
 */
(function () {
  'use strict';

  const el = OOP.dom.el;
  const icon = OOP.dom.icon;
  const page = function () { return OOP.layout.currentPage(); };

  /* ───────────── 1. Markup enhancements ───────────── */

  /**
   * Resource "kind" from the icon that already prefixes the link.
   * @param {string} text link text
   * @returns {string} doc | video | code | quiz | lab
   */
  function kindOf(a) {
    const u = a.querySelector('use');
    const id = u ? u.getAttribute('href') : '';
    return { '#i-play': 'video', '#i-code': 'code', '#i-clipboard': 'quiz', '#i-flask': 'lab' }[id] || 'doc';
  }

  /** Tag chips and card links with data-kind so CSS can colour them (the icon stays the non-colour cue). */
  function tagResourceKinds() {
    document.querySelectorAll('.chip, .qcard li a').forEach(function (a) {
      a.setAttribute('data-kind', kindOf(a));
    });
  }

  /**
   * GA4 resource_type of a link: the site's own icon cue first (kindOf), then its URL / text.
   * @returns {string} video | code_example | quiz | lab | pdf | slides | folder | document | external_website
   */
  function resourceType(a) {
    const kind = kindOf(a);
    if (kind === 'video' || kind === 'quiz' || kind === 'lab') return kind;
    if (kind === 'code' || /code-files\.html$/.test(a.pathname)) return 'code_example';
    if (/(^|\.)(youtube\.com|youtu\.be)$/.test(a.hostname)) return 'video';
    if (/\.pdf\b|\(pdf\)/i.test(a.textContent)) return 'pdf';
    if (/\bslides\b/i.test(a.textContent)) return 'slides';
    if (/\/drive\/folders\//.test(a.pathname)) return 'folder';
    if (/^(docs|drive)\.google\.com$|^api\.psutarchive\.com$/.test(a.hostname)) return 'document';
    return 'external_website';
  }

  /**
   * GA4 learning_resource_click for links in the page content that open a resource: any external
   * link, plus links to code examples. Plain page-to-page links are already counted as page_views.
   * Middle-click counts too; right-click → "Open in new tab" is invisible to the page.
   */
  function trackResourceClicks() {
    const p = page();
    const onClick = function (e) {
      if (!OOP.analytics || (e.type === 'auxclick' && e.button !== 1)) return;
      const a = e.target.closest && e.target.closest('#main a[href]');
      if (!a || a.closest('[data-ui]')) return;
      const external = /^https?:$/.test(a.protocol) && a.host !== location.host;
      if (!external && !/code-files\.html$/.test(a.pathname)) return;
      // Card links ("Video Walkthrough") need their card title; a link in a note ("notebook") the note's sentence
      const card = a.closest('.qcard');
      const note = a.closest('.pull');
      const head = card ? ['.q-num', '.q-title'].map(function (s) { return (card.querySelector(s) || {}).textContent || ''; }).join(' ') + ' — ' : '';
      OOP.analytics.track('learning_resource_click', {
        resource_type: resourceType(a),
        resource_name: note ? note.textContent : head + a.textContent,
        lesson_id: p.topic ? p.id : undefined
      });
    };
    document.addEventListener('click', onClick);
    document.addEventListener('auxclick', onClick);
  }

  /**
   * The "Key Concepts" lists use <a href="#"> placeholders that go nowhere. Remove the dead href so
   * they are no longer useless keyboard tab stops (the text is untouched).
   */
  function neutralisePlaceholderLinks() {
    document.querySelectorAll('a[href="#"]').forEach(function (a) {
      a.removeAttribute('href');
      a.classList.add('concept');
    });
  }

  /** Give grid children a capped index (--i) used for the short entrance stagger. */
  function staggerGrids() {
    document.querySelectorAll('.topic-grid, .qgrid, .lcols, .vidx, .roadmap, .dashboard').forEach(function (grid) {
      grid.classList.add('stagger');
      Array.prototype.forEach.call(grid.children, function (child, i) {
        child.style.setProperty('--i', Math.min(i, 10));
      });
    });
  }

  /* ───────────── 2. Topic completion ───────────── */

  /** Build the "Mark as completed" toggle button for a topic page. */
  function completeButton(p) {
    const btn = el('button', { type: 'button', class: 'complete-btn', 'aria-pressed': String(OOP.progress.isDone(p.id)), 'data-ui': '' }, [
      el('span', { class: 'box' }, [icon('check')]),
      el('span', { text: 'Mark as completed' })
    ]);
    btn.addEventListener('click', function () {
      const nowDone = OOP.progress.toggle(p.id);
      btn.setAttribute('aria-pressed', String(nowDone));
      if (nowDone) {
        btn.classList.remove('just-done');
        void btn.offsetWidth; // restart the one-off animation
        btn.classList.add('just-done');
      }
    });
    return btn;
  }

  /** Build the "Bookmark this page" toggle. */
  function bookmarkButton(p) {
    const entry = { key: 'page:' + p.id, label: p.label, href: p.file };
    const btn = el('button', { type: 'button', class: 'complete-btn', 'data-ui': '', 'aria-pressed': String(OOP.library.isBookmarked(entry.key)) }, [
      el('span', { class: 'box' }, [icon('check')]),
      el('span', { text: 'Bookmark this page' })
    ]);
    btn.addEventListener('click', function () {
      const on = OOP.library.toggleBookmark(entry);
      btn.setAttribute('aria-pressed', String(on));
      OOP.ui.toast(on ? 'Bookmarked ' + p.label : 'Bookmark removed', 'bookmark');
    });
    return btn;
  }

  /** Insert the action row (complete + bookmark) under a page header. */
  function addPageActions() {
    const p = page();
    const head = document.querySelector('main .pg-head');
    if (!head || p.id === 'home' || p.id === 'code') return;
    const row = el('div', { class: 'pg-actions', 'data-ui': '' });
    if (p.topic) row.appendChild(completeButton(p));
    row.appendChild(bookmarkButton(p));
    head.insertAdjacentElement('afterend', row);
  }

  /**
   * Labs page: optional "Mark done" toggle on each of the ten lab cards.
   * The lab number is read from the card's existing "Lab 01 ·" label.
   */
  function addLabToggles() {
    if (page().id !== 'labs') return;
    document.querySelectorAll('.qcard').forEach(function (card) {
      const m = /^Lab\s+(\d+)/.exec((card.querySelector('.q-num') || {}).textContent || '');
      if (!m) return; // the "Operator Overload" topic card is not a numbered lab
      const num = m[1];
      const btn = el('button', { type: 'button', class: 'complete-btn complete-btn--sm', 'data-ui': '', 'aria-pressed': String(OOP.progress.isLabDone(num)) }, [
        el('span', { class: 'box' }, [icon('check')]),
        el('span', { text: 'Mark done' }),
        el('span', { class: 'sr-only', text: 'Lab ' + num })
      ]);
      const sync = function () { card.classList.toggle('is-done', OOP.progress.isLabDone(num)); };
      btn.addEventListener('click', function () {
        const on = OOP.progress.toggleLab(num);
        btn.setAttribute('aria-pressed', String(on));
        sync();
        OOP.ui.toast(on ? 'Lab ' + num + ' marked done' : 'Lab ' + num + ' marked not done', on ? 'check' : 'clock');
      });
      sync();
      card.appendChild(el('div', { class: 'qcard-foot', 'data-ui': '' }, [btn]));
    });
  }

  /** Home: show a "Completed" badge on topic cards the student has finished. */
  function renderTopicBadges() {
    document.querySelectorAll('.topic-cell[data-topic]').forEach(function (cell) {
      const old = cell.querySelector('.badge');
      if (old) old.remove();
      if (OOP.progress.isDone(cell.getAttribute('data-topic'))) {
        cell.appendChild(el('span', { class: 'badge badge--done', 'data-ui': '' }, [icon('check'), 'Completed']));
      }
    });
  }

  /* ───────────── 3. Home dashboard ───────────── */

  /** Show a confirmation dialog, then reset progress. (Native <dialog>: focus-trapped, Esc cancels.) */
  function confirmReset() {
    const dlg = el('dialog', { 'aria-labelledby': 'resetTitle' }, [
      el('div', { class: 'dialog-body' }, [
        el('h2', { id: 'resetTitle', text: 'Reset your progress?' }),
        el('p', { text: 'This clears every completed topic and lab on this device. Your bookmarks are kept. This cannot be undone.' }),
        el('div', { class: 'dialog-actions' }, [
          el('button', { type: 'button', class: 'btn btn--ghost', 'data-act': 'cancel', text: 'Cancel' }),
          el('button', { type: 'button', class: 'btn btn--primary', 'data-act': 'ok', text: 'Reset progress' })
        ])
      ])
    ]);
    document.body.appendChild(dlg);
    dlg.addEventListener('close', function () { dlg.remove(); });
    dlg.addEventListener('click', function (e) {
      const act = e.target.getAttribute && e.target.getAttribute('data-act');
      if (act === 'ok') OOP.progress.reset();
      if (act) dlg.close();
    });
    dlg.showModal();
  }

  /** Card 1 — resume where the student left off (or suggest the first topic). */
  function continueCard() {
    const last = OOP.library.last();
    const first = OOP.config.pages[1];
    const href = last ? last.href : first.file;
    return el('div', { class: 'dash-card dash-card--hero' }, [
      el('h2', { text: 'Continue learning' }),
      el('p', { class: 'big', text: last ? last.label : 'Start with ' + first.label }),
      el('a', { class: 'btn', href: href }, [last ? 'Resume' : 'Start', icon('arrow-right', 'i-go')])
    ]);
  }

  /** Card 2 — overall progress with a (confirmed) reset. */
  function progressCard() {
    const children = [
      el('h2', { text: 'Your progress' }),
      el('div', { class: 'dash-row' }, [
        OOP.progress.ring(OOP.progress.percent()),
        el('p', { class: 'big', text: OOP.progress.count() + ' of ' + OOP.progress.total() + ' topics completed' })
      ])
    ];
    if (OOP.progress.count() > 0 || Object.keys(OOP.store.getJSON('progress', { labs: {} }).labs || {}).length) {
      const reset = el('button', { type: 'button', class: 'link-btn', text: 'Reset progress' });
      reset.addEventListener('click', confirmReset);
      children.push(reset);
    }
    return el('div', { class: 'dash-card' }, children);
  }

  /** Card 3 — bookmarks if any, otherwise recently visited sections, otherwise a hint. */
  function shortcutsCard() {
    const marks = OOP.library.bookmarks();
    const recent = OOP.library.recent();
    const list = marks.length ? marks : recent;
    const children = [el('h2', { text: marks.length ? 'Bookmarks' : 'Recently visited' })];
    if (list.length) {
      const ul = el('ul', { class: 'dash-list' });
      list.slice(0, 4).forEach(function (e) {
        ul.appendChild(el('li', {}, [el('a', { href: e.href }, [icon(marks.length ? 'bookmark' : 'clock'), el('span', { text: e.label })])]));
      });
      children.push(ul);
    } else {
      children.push(el('p', { class: 'dash-empty', text: 'Bookmark a page or code file and it will show up here.' }));
    }
    return el('div', { class: 'dash-card' }, children);
  }

  /** Card 4 — achievements: earned ones ticked, locked ones padlocked, plus a nudge toward the next. */
  function achievementsCard() {
    const list = OOP.progress.achievements();
    const got = list.filter(function (a) { return a.unlocked; }).length;
    const next = list.filter(function (a) { return !a.unlocked; })[0];
    const badges = el('div', { class: 'chips' }, list.map(function (a) {
      return el('span', { class: 'badge' + (a.unlocked ? ' badge--done' : ''), title: a.desc }, [
        icon(a.unlocked ? 'check' : 'lock'),
        a.name,
        el('span', { class: 'sr-only', text: (a.unlocked ? ' — unlocked: ' : ' — locked: ') + a.desc })
      ]);
    }));
    return el('div', { class: 'dash-card' }, [
      el('h2', { text: 'Achievements' }),
      el('p', { class: 'big', text: got + ' of ' + list.length + ' unlocked' }),
      badges,
      el('p', { class: 'dash-empty', text: next ? 'Next: ' + next.desc + ' to unlock “' + next.name + '”.' : 'Every achievement unlocked — legendary!' })
    ]);
  }

  /** (Re)render the dashboard; runs again whenever progress or the library changes. */
  function renderDashboard() {
    const host = document.getElementById('dashboard');
    if (!host) return;
    host.textContent = '';
    [continueCard(), progressCard(), shortcutsCard(), achievementsCard()].forEach(function (c) { host.appendChild(c); });
  }

  /* ───────────── 4. Previous / next pager ───────────── */

  /** Append "Previous / Next" links (in sidebar order) at the end of the page. */
  function addPager() {
    const pages = OOP.config.pages;
    const i = pages.indexOf(page());
    const prev = pages[i - 1];
    const next = pages[i + 1];
    if (!prev && !next) return;
    const nav = el('nav', { class: 'pager', 'aria-label': 'Previous and next page', 'data-ui': '' });
    if (prev) nav.appendChild(el('a', { class: 'prev', href: prev.file, rel: 'prev' }, [el('small', { text: '← Previous' }), el('strong', { text: prev.label })]));
    if (next) nav.appendChild(el('a', { class: 'next', href: next.file, rel: 'next' }, [el('small', { text: 'Next →' }), el('strong', { text: next.label })]));
    const inner = document.querySelector('main > .inner, main > .code-wrap, main > .home-grid');
    (inner && page().id !== 'home' ? inner : document.getElementById('main')).appendChild(nav);
  }

  /* ───────────── 5. All Links filter ───────────── */

  /**
   * A live filter above the link directory. It only HIDES non-matching rows while typing;
   * clearing the box shows everything again, and nothing is ever removed from the page.
   */
  function addLinksFilter() {
    if (page().id !== 'links') return;
    const cols = document.querySelector('.lcols');
    if (!cols) return;
    const items = Array.prototype.slice.call(document.querySelectorAll('.lcols li, .vidx .vl'));
    const input = el('input', { type: 'search', id: 'linkFilter', placeholder: 'Filter these links…', autocomplete: 'off' });
    const count = el('span', { class: 'count', 'aria-live': 'polite' });
    const empty = el('p', { class: 'filter-empty is-filtered-out', 'data-ui': '', role: 'status', text: 'No links match your filter. Clear it to see all links.' });
    const bar = el('div', { class: 'filterbar', 'data-ui': '' }, [
      el('label', {}, [el('span', { class: 'sr-only', text: 'Filter links' }), icon('search'), input]),
      count
    ]);
    cols.insertAdjacentElement('beforebegin', bar);
    cols.insertAdjacentElement('beforebegin', empty);

    /** Show/hide rows for the current text and refresh the counter. */
    function apply() {
      const q = input.value.trim().toLowerCase();
      let shown = 0;
      items.forEach(function (it) {
        const hit = !q || it.textContent.toLowerCase().indexOf(q) !== -1;
        it.classList.toggle('is-filtered-out', !hit);
        if (hit) shown++;
      });
      document.querySelectorAll('.lcol').forEach(function (col) {
        col.classList.toggle('is-filtered-out', !col.querySelector('li:not(.is-filtered-out)'));
      });
      empty.classList.toggle('is-filtered-out', shown > 0);
      count.textContent = q ? 'Showing ' + shown + ' of ' + items.length : items.length + ' links';
    }
    input.addEventListener('input', apply);
    apply();
  }

  /* ───────────── 6. Entry point ───────────── */

  /** Record a "visit" for content pages (the code page records per file instead). */
  function recordVisit() {
    const p = page();
    if (p.id === 'home' || p.id === 'code') return;
    OOP.library.visit({ key: 'page:' + p.id, label: p.label, href: p.file });
  }

  function init() {
    tagResourceKinds();
    trackResourceClicks();
    neutralisePlaceholderLinks();
    staggerGrids();
    addPageActions();
    addLabToggles();
    addLinksFilter();
    addPager();
    recordVisit();
    if (page().id === 'home') {
      renderTopicBadges();
      renderDashboard();
      staggerGrids(); // include the freshly built dashboard cards
      document.addEventListener('oop:progress', function () { renderTopicBadges(); renderDashboard(); });
      document.addEventListener('oop:library', renderDashboard);
    }
  }

  OOP.features = { init, kindOf };
})();
