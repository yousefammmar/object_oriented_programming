/**
 * code-viewer.js — the C++ code viewer on code-files.html.
 *
 * It is a PROFESSIONAL CODE VIEWER, not a compiler: it never runs the code and never claims to.
 *
 * Data comes from code-data.js (`cf`). The original site's functions keep their names:
 *   hlCpp(code)    syntax-highlight a source string        (logic unchanged from the original site)
 *   ct(id, line)   show a file in the editor ("change tab")
 *   copyCode()     copy the raw source of the active file
 *
 * New in this version: accessible tabs (arrow keys), line numbers + click-to-highlight lines,
 * a line-wrap toggle, a full-screen view, per-file bookmarks, and deep links:
 *     code-files.html#sep        open a tab
 *     code-files.html#sep:12     open a tab and highlight line 12 (used by search results)
 */
(function () {
  'use strict';

  const DEFAULT_TAB = 'revision';
  let activeTab = DEFAULT_TAB;

  /* ───────────── 1. Syntax highlighting (original algorithm, now commented) ───────────── */

  /**
   * Convert C++ source into HTML with <span class="kw|cm|st|pp|nu|fn"> tokens.
   * Strategy: escape HTML → pull comments/strings/preprocessor lines out into placeholders
   * (so keywords inside them are not re-coloured) → colour keywords, numbers, calls →
   * put the placeholders back.
   * @param {string} code raw source
   * @returns {string} highlighted HTML (still one string; split on '\n' by the caller)
   */
  function hlCpp(code) {
    const kws = ['int', 'void', 'return', 'class', 'public', 'private', 'protected',
      'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'default', 'new',
      'delete', 'using', 'namespace', 'const', 'static', 'bool', 'double', 'float',
      'char', 'string', 'true', 'false', 'nullptr', 'this', 'endl', 'cin', 'cout',
      'include', 'pragma', 'struct', 'operator', 'template', 'typename', 'virtual', 'override'];

    let html = code.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const tokens = [];
    /** Replace every match of `regex` with a placeholder and remember the coloured span for later. */
    const save = (regex, cls) => {
      html = html.replace(regex, (m) => {
        const id = `__T${tokens.length}__`;
        tokens.push(`<span class="${cls}">${m}</span>`);
        return id;
      });
    };

    save(/(\/\/[^\n]*)/g, 'cm');                    // // line comments
    save(/(\/\*[\s\S]*?\*\/)/g, 'cm');              // /* block comments */
    save(/"([^"\\]*(\\.[^"\\]*)*)"/g, 'st');        // "strings"
    save(/'([^'\\]*(\\.[^'\\]*)*)'/g, 'st');        // 'c' characters
    save(/^(#\w+)/gm, 'pp');                        // #include / #pragma

    const re = new RegExp('\\b(' + kws.join('|') + ')\\b', 'g');
    html = html.replace(re, '<span class="kw">$1</span>');                      // keywords
    html = html.replace(/\b(\d+(\.\d+)?)\b/g, '<span class="nu">$1</span>');   // numbers
    html = html.replace(/\b(\w+)(?=\s*\()/g, '<span class="fn">$1</span>');     // function calls

    for (let i = tokens.length - 1; i >= 0; i--) {
      html = html.replace(`__T${i}__`, tokens[i]);
    }
    return html;
  }

  /* ───────────── 2. Rendering ───────────── */

  /** Parse "#sep:12" → { id: "sep", line: 12 }. */
  function parseHash() {
    const m = /^#([\w-]+)(?::(\d+))?$/.exec(location.hash);
    return m ? { id: m[1], line: m[2] ? parseInt(m[2], 10) : 0 } : { id: DEFAULT_TAB, line: 0 };
  }

  /** The tab buttons in DOM order. */
  function tabs() {
    return Array.prototype.slice.call(document.querySelectorAll('.ftab'));
  }

  /**
   * Show one file ("change tab"). Original name kept because other code/pages may call ct('sep').
   * @param {string} id    key in `cf`
   * @param {number} [line] optional 1-based line to highlight and scroll to
   */
  function ct(id, line) {
    const f = cf[id];
    if (!f) return;
    activeTab = id;

    // Tabs: visual state + ARIA + roving tabindex (only the selected tab is in the Tab order)
    tabs().forEach(function (t) {
      const on = t.getAttribute('data-tab') === id;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on) t.scrollIntoView({ block: 'nearest', inline: 'center' });
    });
    document.getElementById('efname').textContent = f.name;

    let code = f.code;
    // The combined "Separation" file shows its three sections with clear dividers (display only).
    if (id === 'sep') {
      code = code.replace(/\/\/ ── (.+?) ─+/g, '\n/* ── $1 ── */');
    }

    const lines = hlCpp(code).split('\n');
    if (lines[0] === '' && id === 'sep') lines.shift();

    const cv = document.getElementById('cv');
    cv.innerHTML = lines.map((l, i) =>
      `<div class="line" data-line="${i + 1}"><span class="ln" aria-hidden="true">${i + 1}</span><span class="lc">${l || ' '}</span></div>`
    ).join('');
    cv.setAttribute('aria-labelledby', 'tab-' + id);
    cv.scrollTop = 0;
    cv.scrollLeft = 0;

    const meta = document.getElementById('emeta');
    if (meta) meta.textContent = 'C++ · ' + lines.length + ' lines';

    syncBookmark();
    if (line) highlightLine(line);

    // Keep the URL in sync (deep-linkable) without adding history entries
    try { history.replaceState(null, '', '#' + id); } catch (e) { /* file:// in some browsers */ }

    OOP.library.visit({ key: 'code:' + id, label: 'Code: ' + tabLabel(id), href: 'code-files.html#' + id });
  }

  /** Visible label of a tab button. */
  function tabLabel(id) {
    const t = document.getElementById('tab-' + id);
    return t ? t.textContent.trim() : cf[id].name;
  }

  /** Select (highlight) one line and scroll it into view inside the editor. */
  function highlightLine(n) {
    const cv = document.getElementById('cv');
    cv.querySelectorAll('.line.is-selected').forEach(function (l) { l.classList.remove('is-selected'); });
    const row = cv.querySelector('.line[data-line="' + n + '"]');
    if (!row) return;
    row.classList.add('is-selected');
    cv.scrollTop = Math.max(0, row.offsetTop - cv.clientHeight / 3);
  }

  /* ───────────── 3. Copy ───────────── */

  /**
   * Copy the raw (unhighlighted) source of the active file and confirm on the button and with a toast.
   * Falls back to a hidden textarea when the async Clipboard API is unavailable (e.g. file://).
   */
  function copyCode() {
    const code = (cf[activeTab] && cf[activeTab].code) || '';
    const file = cf[activeTab] && cf[activeTab].name;
    const btn = document.getElementById('copyBtn');

    const done = function (ok) {
      // GA4: successful copies only; the file name is sent, never the code. (Not "page_path": gtag.js reserves it.)
      if (ok && OOP.analytics) OOP.analytics.track('code_copy', { code_file: file, code_page_path: location.pathname });
      if (!btn) return;
      const old = 'Copy';
      btn.textContent = ok ? 'Copied!' : 'Copy failed';
      btn.classList.toggle('is-copied', ok);
      if (ok) OOP.ui.toast('Code copied to clipboard', 'copy');
      setTimeout(function () { btn.textContent = old; btn.classList.remove('is-copied'); }, 1500);
    };

    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(code).then(function () { done(true); }, function () { done(legacyCopy(code)); });
    } else {
      done(legacyCopy(code));
    }
  }

  /** Old-school copy using a temporary textarea + execCommand. Returns success. */
  function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  /* ───────────── 4. Toolbar: wrap, full screen, bookmark ───────────── */

  /** Reflect the bookmark state of the active file on the toolbar button. */
  function syncBookmark() {
    const b = document.getElementById('markBtn');
    if (b) b.setAttribute('aria-pressed', String(OOP.library.isBookmarked('code:' + activeTab)));
  }

  /** Toggle line wrapping (preference remembered). */
  function setWrap(on) {
    document.getElementById('editor').classList.toggle('is-wrapped', on);
    document.getElementById('wrapBtn').setAttribute('aria-pressed', String(on));
    OOP.store.set('code-wrap', on ? '1' : '0');
  }

  /** Toggle the full-screen overlay view (Esc leaves it). */
  function setFull(on) {
    document.getElementById('editor').classList.toggle('is-fullscreen', on);
    document.getElementById('fullBtn').setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('scroll-lock', on);
  }

  /* ───────────── 5. Wiring ───────────── */

  /**
   * A file chosen by the student (tab click/keys, back/forward, in-page search jump). Same as ct(),
   * plus the GA4 code_file_view event when it is a different file. The first render calls ct() directly.
   */
  function select(id, line) {
    if (OOP.analytics && cf[id] && id !== activeTab) OOP.analytics.track('code_file_view', { code_file: cf[id].name });
    ct(id, line);
  }

  /** Tabs: click + Left/Right/Home/End keyboard support (WAI-ARIA tabs pattern). */
  function wireTabs() {
    const list = document.getElementById('ftabs');
    list.addEventListener('click', function (e) {
      const t = e.target.closest('.ftab');
      if (t) select(t.getAttribute('data-tab'));
    });
    list.addEventListener('keydown', function (e) {
      const all = tabs();
      const i = all.indexOf(document.activeElement);
      if (i < 0) return;
      let n = null;
      if (e.key === 'ArrowRight') n = (i + 1) % all.length;
      else if (e.key === 'ArrowLeft') n = (i - 1 + all.length) % all.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = all.length - 1;
      if (n === null) return;
      e.preventDefault();
      all[n].focus();
      select(all[n].getAttribute('data-tab'));
    });
  }

  /** Initialise the viewer (called by app.js on code-files.html only). */
  function init() {
    wireTabs();
    document.addEventListener('oop:library', syncBookmark); // bookmarks can change on another device

    document.getElementById('wrapBtn').addEventListener('click', function () {
      setWrap(!document.getElementById('editor').classList.contains('is-wrapped'));
    });
    document.getElementById('fullBtn').addEventListener('click', function () {
      setFull(!document.getElementById('editor').classList.contains('is-fullscreen'));
    });
    document.getElementById('markBtn').addEventListener('click', function () {
      const on = OOP.library.toggleBookmark({ key: 'code:' + activeTab, label: 'Code: ' + tabLabel(activeTab), href: 'code-files.html#' + activeTab });
      syncBookmark();
      OOP.ui.toast(on ? 'Bookmarked ' + tabLabel(activeTab) : 'Bookmark removed', 'bookmark');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && document.getElementById('editor').classList.contains('is-fullscreen')) setFull(false);
    });
    // Click a line to highlight it (click again to clear)
    document.getElementById('cv').addEventListener('click', function (e) {
      const row = e.target.closest('.line');
      if (!row) return;
      const was = row.classList.contains('is-selected');
      document.querySelectorAll('.line.is-selected').forEach(function (l) { l.classList.remove('is-selected'); });
      if (!was) row.classList.add('is-selected');
    });
    // Back/forward or search jumping within the page
    window.addEventListener('hashchange', function () {
      const h = parseHash();
      select(h.id, h.line);
    });

    setWrap(OOP.store.get('code-wrap', '0') === '1');
    const start = parseHash();
    ct(cf[start.id] ? start.id : DEFAULT_TAB, start.line);
  }

  OOP.codeViewer = { init, ct, hlCpp };

  // Globals kept from the original site (other pages/inline code may call them).
  window.hlCpp = hlCpp;
  window.ct = ct;
  window.copyCode = copyCode;
})();
