/**
 * layout.js — builds the shared site shell around each page's <main>, once, for every page.
 *
 *   .app
 *   ├── .sidebar  navigation (grouped), progress card
 *   ├── .scrim    overlay behind the mobile drawer
 *   └── .shell    top bar · masthead · <main> (the page's own content) · footer
 *
 * It also provides small shared UI helpers used by the other modules:
 *   OOP.dom.el(), OOP.dom.icon()   – tiny DOM builders (text is always set via textContent)
 *   OOP.ui.toast()                 – polite status notification
 *   OOP.layout.render()            – build the shell (called once by app.js)
 *   OOP.layout.currentPage()       – the config entry of the page being viewed
 */
(function () {
  'use strict';

  /* ───────────── 1. DOM helpers ───────────── */

  /**
   * Create an element.
   * @param {string} tag
   * @param {Object} [attrs]    attribute map. `class`, `text` (→ textContent) and `html` (trusted markup only) are special.
   * @param {Array<Node|string>} [children]
   */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      const v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else if (k === 'html') node.innerHTML = v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    (children || []).forEach(function (c) {
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  }

  /** Create an <svg> that references a symbol from the inline sprite below. */
  function icon(name, cls) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'i' + (cls ? ' ' + cls : ''));
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(ns, 'use');
    use.setAttribute('href', '#i-' + name);
    svg.appendChild(use);
    return svg;
  }

  OOP.dom = { el, icon };

  /* ───────────── 2. Icon sprite (Lucide-style stroke icons) ───────────── */

  const SPRITE = {
    search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/>',
    zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9z"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5"/><path d="m2 12 10 5 10-5"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    boxes: '<rect x="3" y="3" width="12" height="12" rx="2"/><rect x="9" y="9" width="12" height="12" rx="2"/>',
    flask: '<path d="M10 2v7.5a2 2 0 0 1-.2.9L4.7 20.5a1 1 0 0 0 .9 1.5h12.8a1 1 0 0 0 .9-1.5l-5.1-10.1a2 2 0 0 1-.2-.9V2"/><path d="M8.5 2h7M7 16h10"/>',
    code: '<path d="m16 18 6-6-6-6M8 6l-6 6 6 6"/>',
    clipboard: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="m9 14 2 2 4-4"/>',
    link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    bookmark: '<path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>',
    'arrow-up': '<path d="m5 12 7-7 7 7M12 19V5"/>',
    'arrow-right': '<path d="M5 12h14m-7-7 7 7-7 7"/>',
    'arrow-left': '<path d="M19 12H5m7 7-7-7 7-7"/>',
    'chevron-right': '<path d="m9 18 6-6-6-6"/>',
    copy: '<rect x="8" y="8" width="14" height="14" rx="2"/><path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2"/>',
    maximize: '<path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>',
    wrap: '<path d="M3 6h18M3 12h15a3 3 0 1 1 0 6h-4m0 0 2-2m-2 2 2 2M3 18h7"/>',
    book: '<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>',
    help: '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3M12 17h.01"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    play: '<path d="m6 3 14 9-14 9z"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7z"/><path d="M14 2v4a2 2 0 0 0 2 2h4M10 9H8M16 13H8M16 17H8"/>',
    text: '<path d="M4 7V4h16v3M9 20h6M12 4v16"/>',
    folder: '<path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.7-.9l-.8-1.2A2 2 0 0 0 7.9 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2z"/>',
    pin: '<path d="M12 17v5M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V17h14v-1.8a2 2 0 0 0-1.1-1.8l-1.8-.9a2 2 0 0 1-1.1-1.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
    diamond: '<path d="M12 2 22 12 12 22 2 12z"/>',
    hash: '<path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18"/>'
  };

  /** Inject the sprite once (hidden). Icons elsewhere use <svg class="i"><use href="#i-name"/></svg>. */
  function injectSprite() {
    const symbols = Object.keys(SPRITE)
      .map(function (n) {
        return '<symbol id="i-' + n + '" viewBox="0 0 24 24">' + SPRITE[n] + '</symbol>';
      })
      .join('');
    const wrap = document.createElement('div');
    wrap.setAttribute('aria-hidden', 'true');
    wrap.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    wrap.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg">' + symbols + '</svg>';
    document.body.insertBefore(wrap, document.body.firstChild);
  }

  /* ───────────── 3. Toasts ───────────── */

  let toastHost = null;

  /**
   * Show a short, polite status message (announced to screen readers via aria-live).
   * @param {string} message
   * @param {string} [iconName='check']
   */
  function toast(message, iconName) {
    if (!toastHost) return;
    const t = el('div', { class: 'toast' }, [icon(iconName || 'check'), el('span', { text: message })]);
    toastHost.appendChild(t);
    setTimeout(function () {
      t.classList.add('is-leaving');
      setTimeout(function () { t.remove(); }, 220);
    }, 2600);
  }

  OOP.ui = { toast };

  /* ───────────── 4. Page lookups ───────────── */

  /** Config entry for the page identified by <body data-page>. */
  function currentPage() {
    const id = document.body.getAttribute('data-page');
    return OOP.config.pages.filter(function (p) { return p.id === id; })[0] || OOP.config.pages[0];
  }

  /* ───────────── 5. Shell builders ───────────── */

  /** Sidebar: brand, close button (mobile), grouped navigation, progress card slot. */
  function buildSidebar(current) {
    const brand = el('a', { class: 'brand', href: 'index.html' }, [
      el('span', { class: 'brand-mark', 'aria-hidden': 'true', text: '</>' }),
      el('span', { class: 'brand-text', text: OOP.config.site.homeLabel })
    ]);
    const close = el('button', { type: 'button', class: 'icon-btn sb-close', 'aria-label': 'Close menu', id: 'navClose' }, [icon('x')]);

    const nav = el('nav', { class: 'nav', 'aria-label': 'Main' });
    let lastGroup = null;
    OOP.config.pages.forEach(function (p) {
      if (p.group && p.group !== lastGroup) {
        nav.appendChild(el('p', { class: 'nav-group', text: p.group }));
      }
      lastGroup = p.group;
      const a = el('a', { class: 'nav-btn', href: p.file, 'data-page': p.id }, [icon(p.icon), el('span', { text: p.label })]);
      if (p.id === current.id) a.setAttribute('aria-current', 'page');
      nav.appendChild(a);
    });

    return el('aside', { class: 'sidebar', id: 'sidebar', 'aria-label': 'Site navigation' }, [
      el('div', { class: 'sb-head' }, [brand, close]),
      nav,
      el('div', { class: 'sb-foot', id: 'sbProgress' })
    ]);
  }

  /** Breadcrumb: Home › Group › Page (the root link returns to Home from anywhere). */
  function buildBreadcrumb(current) {
    const items = [{ label: OOP.config.site.homeLabel, href: 'index.html' }];
    if (current.id !== 'home') {
      if (current.group) items.push({ label: current.group });
      items.push({ label: current.label, current: true });
    }
    const ol = el('ol');
    items.forEach(function (it, i) {
      const li = el('li');
      if (i > 0) li.appendChild(icon('chevron-right'));
      if (it.href && !it.current && current.id !== 'home') li.appendChild(el('a', { href: it.href, text: it.label }));
      else li.appendChild(el('span', { text: it.label, 'aria-current': it.current || current.id === 'home' ? 'page' : null }));
      ol.appendChild(li);
    });
    return el('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' }, [ol]);
  }

  /** Sticky top bar: menu (mobile), breadcrumb, search, reading mode, help, theme switch. */
  function buildTopbar(current) {
    const menu = el('button', { type: 'button', class: 'icon-btn menu-btn', id: 'menuBtn', 'aria-label': 'Open menu', 'aria-controls': 'sidebar', 'aria-expanded': 'false' }, [icon('menu')]);

    const search = el('button', { type: 'button', class: 'search-btn', 'data-open-search': '', 'aria-label': 'Search the site', 'aria-keyshortcuts': 'Control+K Meta+K' }, [
      icon('search'),
      el('span', { class: 'label', text: 'Search…' }),
      el('kbd', { text: /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K' })
    ]);

    const reading = el('button', { type: 'button', class: 'icon-btn hide-sm', id: 'readingBtn', 'aria-pressed': 'false', 'aria-label': 'Reading mode', title: 'Reading mode (R)' }, [icon('book')]);
    const help = el('button', { type: 'button', class: 'icon-btn hide-sm', id: 'helpBtn', 'aria-label': 'Keyboard shortcuts', title: 'Keyboard shortcuts (?)' }, [icon('help')]);

    // Same ids/classes as the original theme switch so existing behaviour carries over.
    const theme = el('button', { type: 'button', class: 'theme-toggle', id: 'themeToggle', 'aria-label': 'Toggle theme' }, [
      el('div', { class: 'toggle-track' }, [el('div', { class: 'toggle-thumb' })]),
      el('span', { id: 'themeLabel', text: 'DARK' })
    ]);

    return el('div', { class: 'topbar' }, [menu, buildBreadcrumb(current), el('div', { class: 'topbar-tools' }, [search, reading, help, theme])]);
  }

  /** Masthead: university, term, course title and subtitle (+ decorative floating symbols on Home). */
  function buildMasthead() {
    const s = OOP.config.site;
    const symbols = el('div', { class: 'bg-symbols', 'aria-hidden': 'true' });
    OOP.config.heroSymbols.forEach(function (sym) {
      const d = el('div', { class: 'bg-sym', text: sym[0] });
      d.style.top = sym[1] + '%';
      d.style.left = sym[2] + '%';
      d.style.animationDuration = sym[3] + 's';
      if (sym[4]) d.style.fontSize = sym[4] + 'px';
      symbols.appendChild(d);
    });
    return el('header', { class: 'masthead' }, [
      symbols,
      el('div', { class: 'masthead-top' }, [
        el('span', { class: 'masthead-kicker', text: s.kicker }),
        el('span', { class: 'masthead-issue', text: s.issue })
      ]),
      el('div', { class: 'masthead-title' }, [
        el('h1', { html: s.titleHtml }),
        el('p', { class: 'subtitle', html: s.subtitleHtml })
      ])
    ]);
  }

  /** Footer (original wording). */
  function buildFooter() {
    const s = OOP.config.site;
    return el('footer', { class: 'site-footer' }, [el('span', { html: s.footerLeftHtml }), el('span', { html: s.footerRightHtml })]);
  }

  /* ───────────── 6. Mobile drawer ───────────── */

  /** Open/close the navigation drawer (mobile only; on desktop the sidebar is always visible). */
  function setDrawer(open) {
    document.body.classList.toggle('nav-open', open);
    document.body.classList.toggle('scroll-lock', open);
    const btn = document.getElementById('menuBtn');
    if (btn) btn.setAttribute('aria-expanded', String(open));
    const shell = document.querySelector('.shell');
    if (shell) {
      // While open, everything behind the drawer is inert (not focusable, hidden from screen readers).
      if (open) shell.setAttribute('inert', ''); else shell.removeAttribute('inert');
    }
    const target = document.getElementById(open ? 'navClose' : 'menuBtn');
    if (target) target.focus();
  }

  /* ───────────── 7. Back-to-top button ───────────── */

  /** Floating "back to top" button, shown after scrolling ~1.5 screens. */
  function buildBackToTop() {
    const btn = el('button', { type: 'button', class: 'fab', id: 'toTop', 'aria-label': 'Back to top', title: 'Back to top' }, [icon('arrow-up')]);
    btn.addEventListener('click', function () { window.scrollTo({ top: 0 }); });
    let ticking = false;
    window.addEventListener('scroll', function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        btn.classList.toggle('is-visible', window.scrollY > window.innerHeight * 1.5);
        ticking = false;
      });
    }, { passive: true });
    return btn;
  }

  /* ───────────── 8. Render ───────────── */

  /**
   * Build the whole shell and move the page's <main> into it.
   * Called once from app.js before any other module touches the DOM.
   */
  function render() {
    const current = currentPage();
    const main = document.getElementById('main');
    injectSprite();

    const skip = el('a', { class: 'skip-link', href: '#main', text: 'Skip to main content' });
    const sidebar = buildSidebar(current);
    const scrim = el('div', { class: 'scrim', id: 'scrim' });
    const shell = el('div', { class: 'shell' }, [buildTopbar(current), buildMasthead()]);
    const app = el('div', { class: 'app' }, [sidebar, scrim, shell]);

    document.body.insertBefore(skip, document.body.firstChild);
    document.body.insertBefore(app, main);
    shell.appendChild(main);       // existing <main> becomes a child of .shell
    shell.appendChild(buildFooter());

    toastHost = el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(toastHost);
    document.body.appendChild(buildBackToTop());

    // Page title: keep the original for Home, "<Page> · OOP — CS11253" for the rest (set in the HTML <title>).
    document.getElementById('menuBtn').addEventListener('click', function () { setDrawer(true); });
    document.getElementById('navClose').addEventListener('click', function () { setDrawer(false); });
    scrim.addEventListener('click', function () { setDrawer(false); });
    document.getElementById('themeToggle').addEventListener('click', OOP.theme.toggle);
    // Following a nav link navigates away, so no extra handling is needed for closing the drawer.
    window.matchMedia('(min-width: 1024px)').addEventListener('change', function (e) {
      if (e.matches && document.body.classList.contains('nav-open')) setDrawer(false);
    });
    OOP.theme.sync();
  }

  OOP.layout = { render, currentPage, setDrawer };
})();
