/**
 * app.js — page bootstrap. Loaded LAST on every page.
 *
 * Order matters: the shell must exist before other modules look for its elements.
 *   1. layout   – build sidebar / top bar / masthead / footer around <main>
 *   2. progress – sidebar progress card
 *   3. features – per-page enhancements (dashboard, completion buttons, link filter …)
 *      sync     – optional sign-in / cross-device sync (does nothing until Firebase is configured)
 *   4. search   – wire the search buttons, honour #hit= links
 *   5. code viewer (code-files.html only)
 *   6. global behaviour – keyboard shortcuts, reading mode, shortcuts dialog
 */
(function () {
  'use strict';

  const el = OOP.dom.el;

  /* ───────────── Reading mode ───────────── */

  /** Toggle the distraction-free layout (hides sidebar + masthead). Preference is remembered. */
  function setReading(on) {
    document.body.classList.toggle('reading-mode', on);
    const b = document.getElementById('readingBtn');
    if (b) b.setAttribute('aria-pressed', String(on));
    OOP.store.set('reading', on ? '1' : '0');
  }

  /* ───────────── Keyboard shortcuts dialog ───────────── */

  /** Lazily create and show the list of shortcuts. */
  function showShortcuts() {
    const existing = document.getElementById('shortcutsDlg');
    if (existing) { if (!existing.open) existing.showModal(); return; }
    const row = function (keys, text) {
      return el('div', {}, [el('span', { text: text }), el('span', {}, keys.map(function (k, i) { return el('kbd', { text: k }); }))]);
    };
    const dlg = el('dialog', { class: 'shortcuts-dialog', id: 'shortcutsDlg', 'aria-labelledby': 'scTitle' }, [
      el('div', { class: 'dialog-body' }, [
        el('h2', { id: 'scTitle', text: 'Keyboard shortcuts' }),
        el('div', { class: 'shortcut-list' }, [
          row(['Ctrl / ⌘', 'K'], 'Search'),
          row(['/'], 'Search'),
          row(['T'], 'Switch theme'),
          row(['R'], 'Reading mode'),
          row(['?'], 'Show this help'),
          row(['Esc'], 'Close dialogs / full screen')
        ]),
        el('div', { class: 'dialog-actions' }, [el('button', { type: 'button', class: 'btn btn--primary', 'data-close': '', text: 'Close' })])
      ])
    ]);
    dlg.addEventListener('click', function (e) { if (e.target === dlg || e.target.hasAttribute('data-close')) dlg.close(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  /** True when the user is typing in a field (single-key shortcuts must not fire then). */
  function typing(e) {
    const t = e.target;
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  /** Global keyboard handling. */
  function bindShortcuts() {
    document.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); OOP.search.open(); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e) || document.querySelector('dialog[open]')) return;
      if (e.key === '/') { e.preventDefault(); OOP.search.open(); }
      else if (e.key === '?') { e.preventDefault(); showShortcuts(); }
      else if (e.key.toLowerCase() === 't') OOP.theme.toggle();
      else if (e.key.toLowerCase() === 'r') setReading(!document.body.classList.contains('reading-mode'));
      else if (e.key === 'Escape' && document.body.classList.contains('nav-open')) OOP.layout.setDrawer(false);
    });
    // Esc also closes the mobile drawer when focus is inside it
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.body.classList.contains('nav-open')) OOP.layout.setDrawer(false);
    });
  }

  /* ───────────── Start ───────────── */

  function start() {
    OOP.layout.render();
    OOP.progress.init();
    OOP.features.init();
    OOP.sync.init();
    OOP.search.init();
    if (document.body.getAttribute('data-page') === 'code') OOP.codeViewer.init();
    // The browser jumps to #id before the shell exists; redo the jump now that the layout is final.
    const anchor = location.hash && document.getElementById(decodeURIComponent(location.hash.slice(1)));
    if (anchor) anchor.scrollIntoView({ behavior: 'instant' });

    document.getElementById('readingBtn').addEventListener('click', function () {
      setReading(!document.body.classList.contains('reading-mode'));
    });
    document.getElementById('helpBtn').addEventListener('click', showShortcuts);
    if (OOP.store.get('reading', '0') === '1') setReading(true);
    bindShortcuts();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
