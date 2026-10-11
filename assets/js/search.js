/**
 * search.js — global, client-side search (Ctrl/⌘ + K).
 *
 * Because the site is several separate HTML pages, a browser can't read the other pages' text.
 * tools/build_search_index.py therefore generates assets/js/search-index.js from the real page
 * content; this module loads it on first use and searches it. Search only ever finds text that
 * already exists on the site — it never invents results.
 *
 * Sections:
 *   1. Index loading            loadIndex()
 *   2. Matching & ranking       tokenize(), score(), run()
 *   3. Rendering                highlight(), renderResults(), renderIdle()
 *   4. Navigation               hrefFor(), go(), jumpTo(), applyHash()
 *   5. Dialog + keyboard        build(), open(), close()
 *
 * Result navigation: same page → scroll to the element and flash it; other page → open
 * "<file>#hit=<index>" and let that page do the same on load (applyHash).
 * Code results open code-files.html#<tab>:<line>, handled by code-viewer.js.
 */
(function () {
  'use strict';

  const el = OOP.dom.el;
  const icon = OOP.dom.icon;
  const MAX_RESULTS = 40;

  /** Icon + label per entry type. */
  const TYPES = {
    topic: ['home', 'Topic'], section: ['hash', 'Section'], lab: ['flask', 'Lab'], exam: ['clipboard', 'Exam material'],
    text: ['text', 'Text'], resource: ['link', 'Resource'], 'code-file': ['code', 'Code file'], code: ['code', 'Code']
  };
  /** Ranking bonus per type: topics and files beat loose text and single code lines. */
  const TYPE_BONUS = { topic: 25, section: 12, lab: 12, exam: 10, 'code-file': 14, resource: 5, text: 2, code: 0 };

  let dialog, input, list, status, items = [], active = -1;
  let loading = null;

  /* ───────────── 1. Index loading ───────────── */

  /** Load search-index.js once (by injecting a <script>, so it also works from file://). */
  function loadIndex() {
    if (OOP.searchIndex) return Promise.resolve(OOP.searchIndex);
    if (loading) return loading;
    loading = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = 'assets/js/search-index.js';
      s.onload = function () { resolve(OOP.searchIndex); };
      s.onerror = function () { loading = null; reject(new Error('index')); };
      document.head.appendChild(s);
    });
    return loading;
  }

  /* ───────────── 2. Matching & ranking ───────────── */

  /** Split a query into lowercase tokens. */
  function tokenize(q) {
    return q.toLowerCase().split(/\s+/).filter(Boolean);
  }

  /** Human page name for an entry's page id. */
  function pageLabel(id) {
    const p = OOP.config.pages.filter(function (x) { return x.id === id; })[0];
    return p ? p.label : id;
  }

  /**
   * Score one entry for the tokens; 0 means "does not match".
   * Every token must appear somewhere (title, context, page name or code line).
   */
  function score(e, tokens, phrase) {
    const title = (e.ti || '').toLowerCase();
    const hay = title + ' ' + (e.cx || '').toLowerCase() + ' ' + pageLabel(e.p).toLowerCase() + ' ' + (e.tx || '').toLowerCase();
    let s = 0;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      if (hay.indexOf(t) === -1) return 0;
      if (title.indexOf(t) === 0) s += 30;
      else if (title.indexOf(' ' + t) !== -1) s += 20;
      else if (title.indexOf(t) !== -1) s += 10;
      else s += 3;
    }
    if (tokens.length > 1 && title.indexOf(phrase) !== -1) s += 15;
    return s + (TYPE_BONUS[e.ty] || 0);
  }

  /** Run a query → ranked list of {e, i} (entry + its index in the master list). */
  function run(q) {
    const tokens = tokenize(q);
    if (!tokens.length || !OOP.searchIndex) return []; // index still loading → the caller re-runs once it arrives
    const phrase = tokens.join(' ');
    const out = [];
    OOP.searchIndex.forEach(function (e, i) {
      const s = score(e, tokens, phrase);
      if (s) out.push({ e: e, i: i, s: s });
    });
    out.sort(function (a, b) { return b.s - a.s || a.i - b.i; });
    return out.slice(0, MAX_RESULTS);
  }

  /* ───────────── 3. Rendering ───────────── */

  /**
   * Return a <span> with every token occurrence wrapped in <mark>. Built from text nodes only,
   * so page text can never be interpreted as HTML.
   */
  function highlight(text, tokens) {
    const span = el('span');
    if (!tokens.length) { span.textContent = text; return span; }
    const lower = text.toLowerCase();
    const mark = new Array(text.length).fill(false);
    tokens.forEach(function (t) {
      let from = 0, at;
      while ((at = lower.indexOf(t, from)) !== -1) {
        for (let k = at; k < at + t.length; k++) mark[k] = true;
        from = at + t.length;
      }
    });
    let i = 0;
    while (i < text.length) {
      let j = i;
      while (j < text.length && mark[j] === mark[i]) j++;
      const chunk = text.slice(i, j);
      span.appendChild(mark[i] ? el('mark', { text: chunk }) : document.createTextNode(chunk));
      i = j;
    }
    return span;
  }

  /** Append one clickable result row. */
  function addRow(entry, tokens, onGo) {
    const t = TYPES[entry.ty] || TYPES.text;
    const idx = items.length;
    const body = el('span', { style: 'min-width:0' });
    body.appendChild(el('span', { class: 't' }, [highlight(entry.title, tokens)]));
    if (entry.meta) body.appendChild(el('span', { class: 'm' }, [highlight(entry.meta, tokens)]));
    if (entry.code) body.appendChild(el('span', { class: 'code-line' }, [highlight(entry.code, tokens)]));
    const row = el('div', { class: 'search-item', role: 'option', id: 'sr-' + idx, 'aria-selected': 'false' }, [icon(t[0]), body]);
    row.addEventListener('click', onGo);
    row.addEventListener('mousemove', function () { select(idx, false); });
    list.appendChild(row);
    items.push({ row: row, go: onGo });
  }

  /** Render ranked results (or the friendly empty state). */
  function renderResults(q) {
    const tokens = tokenize(q);
    const results = run(q);
    list.textContent = '';
    items = [];
    active = -1;
    if (!OOP.searchIndex) {
      list.appendChild(el('div', { class: 'search-empty' }, [el('p', { text: 'Loading search index…' })]));
      return;
    }
    if (!results.length) {
      list.appendChild(el('div', { class: 'search-empty' }, [
        el('p', { class: 'big', text: 'No results for “' + q.trim() + '”' }),
        el('p', { text: 'Try a shorter word, a topic name like “constructor”, or a file name like “Classes1”.' })
      ]));
      status.textContent = 'No results';
      input.setAttribute('aria-expanded', 'false');
      return;
    }
    results.forEach(function (r) {
      const e = r.e;
      const typeName = (TYPES[e.ty] || TYPES.text)[1];
      const where = pageLabel(e.p);
      const entry = {
        ty: e.ty,
        title: e.ln ? e.ti + ' — line ' + e.ln : e.ti,
        meta: typeName + ' · ' + where + (e.cx && e.ty !== 'code-file' ? ' › ' + e.cx : e.cx ? ' (' + e.cx + ')' : ''),
        code: e.tx ? e.tx.trim() : ''
      };
      addRow(entry, tokens, function () { go(r.i); });
    });
    status.textContent = results.length + (results.length === 1 ? ' result' : ' results');
    input.setAttribute('aria-expanded', 'true');
    select(0, false);
  }

  /** Empty-input view: bookmarks, recent places, and quick jumps to every page. */
  function renderIdle() {
    list.textContent = '';
    items = [];
    active = -1;
    const section = function (title, entries, ic) {
      if (!entries.length) return;
      list.appendChild(el('div', { class: 'search-group', text: title }));
      entries.forEach(function (e) {
        addRow({ ty: 'topic', title: e.label, meta: '' }, [], function () { location.href = e.href; });
        items[items.length - 1].row.querySelector('.i use').setAttribute('href', '#i-' + ic);
      });
    };
    section('Bookmarks', OOP.library.bookmarks().slice(0, 5), 'bookmark');
    section('Recently visited', OOP.library.recent().slice(0, 5), 'clock');
    section('Go to', OOP.config.pages.map(function (p) { return { label: p.label, href: p.file }; }), 'arrow-right');
    status.textContent = '';
    input.setAttribute('aria-expanded', 'false');
    select(0, false);
  }

  /** Move the highlighted row (keyboard or hover) and keep it visible. */
  function select(i, scroll) {
    if (!items.length) { active = -1; input.removeAttribute('aria-activedescendant'); return; }
    if (active >= 0 && items[active]) items[active].row.setAttribute('aria-selected', 'false');
    active = (i + items.length) % items.length;
    const row = items[active].row;
    row.setAttribute('aria-selected', 'true');
    input.setAttribute('aria-activedescendant', row.id);
    if (scroll !== false) row.scrollIntoView({ block: 'nearest' });
  }

  /* ───────────── 4. Navigation ───────────── */

  /** Scroll to an indexed element and flash it. Returns true if found. */
  function jumpTo(entry) {
    const target = document.querySelectorAll(entry.s)[entry.n];
    if (!target) return false;
    target.scrollIntoView({ block: 'center' });
    target.classList.remove('flash-hit');
    void target.offsetWidth;
    target.classList.add('flash-hit');
    setTimeout(function () { target.classList.remove('flash-hit'); }, 2000);
    return true;
  }

  /** Open the master-list entry `i`: same page → jump; other page → navigate with a hash. */
  function go(i) {
    const e = OOP.searchIndex[i];
    close();
    const here = OOP.layout.currentPage().file === e.f;
    if (e.tab) { // code files
      const hash = '#' + e.tab + (e.ln ? ':' + e.ln : '');
      if (here) { location.hash = hash; } else { location.href = e.f + hash; }
      return;
    }
    if (here) { jumpTo(e); return; }
    location.href = e.f + '#hit=' + i;
  }

  /** On page load: honour "#hit=<index>" links produced by go(). */
  function applyHash() {
    const m = /^#hit=(\d+)$/.exec(location.hash);
    if (!m) return;
    loadIndex().then(function () {
      const e = OOP.searchIndex[parseInt(m[1], 10)];
      if (e && e.s) setTimeout(function () { jumpTo(e); }, 150);
    }).catch(function () { /* index unavailable: the page simply opens at the top */ });
  }

  /* ───────────── 5. Dialog + keyboard ───────────── */

  /** Build the dialog once. */
  function build() {
    input = el('input', {
      type: 'text', id: 'searchInput', placeholder: 'Search topics, code, labs, exams, resources…', autocomplete: 'off', spellcheck: 'false',
      role: 'combobox', 'aria-expanded': 'false', 'aria-controls': 'searchList', 'aria-autocomplete': 'list', 'aria-label': 'Search the site'
    });
    list = el('div', { class: 'search-results', id: 'searchList', role: 'listbox', 'aria-label': 'Search results' });
    status = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite' });
    const closeBtn = el('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close search' }, [icon('x')]);
    closeBtn.addEventListener('click', close);

    dialog = el('dialog', { class: 'search-dialog', 'aria-label': 'Search' }, [
      el('div', { class: 'search-head' }, [icon('search'), input, closeBtn]),
      list,
      status,
      el('div', { class: 'search-foot', 'aria-hidden': 'true' }, [
        el('span', {}, [el('kbd', { text: '↑' }), ' ', el('kbd', { text: '↓' }), ' navigate']),
        el('span', {}, [el('kbd', { text: 'Enter' }), ' open']),
        el('span', {}, [el('kbd', { text: 'Esc' }), ' close'])
      ])
    ]);
    document.body.appendChild(dialog);

    input.addEventListener('input', function () {
      if (input.value.trim()) renderResults(input.value); else renderIdle();
    });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); select(active + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); select(active - 1); }
      else if (e.key === 'Home' && !input.value) { e.preventDefault(); select(0); }
      else if (e.key === 'Enter') { e.preventDefault(); if (items[active]) items[active].go(); }
    });
    // Click on the backdrop closes
    dialog.addEventListener('click', function (e) { if (e.target === dialog) close(); });
  }

  /** Open the search dialog (loads the index on first use). */
  function open() {
    if (!dialog) build();
    if (dialog.open) return;
    if (OOP.layout && document.body.classList.contains('nav-open')) OOP.layout.setDrawer(false);
    dialog.showModal();
    input.value = '';
    input.focus();
    renderIdle();
    loadIndex().then(function () {
      if (input.value.trim()) renderResults(input.value);
    }).catch(function () {
      list.textContent = '';
      list.appendChild(el('div', { class: 'search-empty' }, [el('p', { text: 'The search index could not be loaded. You can still use the menu to browse every section.' })]));
    });
  }

  /** Close the dialog (Esc is handled natively by <dialog>). */
  function close() {
    if (dialog && dialog.open) dialog.close();
  }

  /** Wire any element marked [data-open-search]. Called once by app.js. */
  function init() {
    document.querySelectorAll('[data-open-search]').forEach(function (b) { b.addEventListener('click', open); });
    applyHash();
  }

  OOP.search = { init, open, close };
})();
