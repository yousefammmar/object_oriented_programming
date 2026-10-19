/**
 * config.js — single source of truth for the site structure.
 *
 * Every page of the site loads this file first. It defines the global `OOP` namespace that all
 * other modules attach to, plus:
 *   - the list of pages (used by the sidebar, breadcrumb, previous/next links and search)
 *   - the course title/masthead and footer text (shown on every page by layout.js)
 *
 * To add a page: create the .html file, then add one entry to `pages` below.
 * NOTE: wording in `site` is course content copied from the original site — do not reword it.
 */
(function (global) {
  'use strict';

  /** Global namespace — every module adds itself here (OOP.store, OOP.layout, OOP.search …). */
  const OOP = (global.OOP = global.OOP || {});

  OOP.config = {
    /** Prefix for every localStorage key the site uses (kept short and namespaced). */
    storagePrefix: 'oop-',

    /**
     * Pages, in navigation order.
     *   id     – short id, also the value of <body data-page="…">
     *   file   – HTML file name
     *   label  – name shown in navigation (original wording)
     *   group  – sidebar group heading (null = ungrouped)
     *   icon   – icon id from the sprite in layout.js
     *   topic  – true if the student can mark this page "completed" (progress tracking)
     */
    pages: [
      { id: 'home', file: 'index.html', label: 'Home', group: null, icon: 'home', topic: false },
      { id: 'cpp', file: 'cpp-revision.html', label: 'C++ Revision', group: 'Learn', icon: 'zap', topic: true },
      { id: 'classes', file: 'class-basics.html', label: 'Class Basics', group: 'Learn', icon: 'layers', topic: true },
      { id: 'const', file: 'const-static.html', label: 'Const & Static', group: 'Learn', icon: 'lock', topic: true },
      { id: 'composition', file: 'composition.html', label: 'Composition', group: 'Learn', icon: 'boxes', topic: true },
      { id: 'dma', file: 'dynamic-memory.html', label: 'Dynamic Memory', group: 'Learn', icon: 'cpu', topic: true },
      { id: 'this', file: 'this-pointer.html', label: 'this Pointer', group: 'Learn', icon: 'pointer', topic: true },
      { id: 'friend', file: 'friend-functions.html', label: 'Friend Functions', group: 'Learn', icon: 'users', topic: true },
      { id: 'inheritance', file: 'inheritance.html', label: 'Inheritance', group: 'Learn', icon: 'branch', topic: true },
      { id: 'polymorphism', file: 'polymorphism.html', label: 'Polymorphism', group: 'Learn', icon: 'shapes', topic: true },
      { id: 'operators', file: 'operator-overloading.html', label: 'Operator Overloading', group: 'Learn', icon: 'operator', topic: true },
      { id: 'labs', file: 'labs.html', label: 'Labs', group: 'Practice', icon: 'flask', topic: true },
      { id: 'code', file: 'code-files.html', label: 'Code Files', group: 'Practice', icon: 'code', topic: false },
      { id: 'revision', file: 'revision-hall.html', label: 'Revision Hall', group: 'Practice', icon: 'book', topic: false },
      { id: 'quizzes', file: 'examination-hall.html', label: 'Examination Hall', group: 'Practice', icon: 'clipboard', topic: false },
      { id: 'links', file: 'all-links.html', label: 'All Links', group: 'Resources', icon: 'link', topic: false }
    ],

    /** Masthead + footer text (HTML strings because of the <em> and &nbsp; in the original). */
    site: {
      homeLabel: 'OOP — CS11253', // used for the brand link and breadcrumb root (from the original <title>)
      kicker: 'Princess Sumaya University for Technology',
      issue: 'CS11253 · Winter 2026',
      titleHtml: 'Object <em>Oriented</em> Programming',
      subtitleHtml: 'A Complete Study Guide &nbsp;·&nbsp; C++ &nbsp;·&nbsp; Classes &nbsp;·&nbsp; Composition',
      footerLeftHtml: 'OOP Study Guide · CS11253 · PSUT',
      footerRightHtml:
        '<a class="signature" href="https://yousefammmar.github.io/profile" target="_blank" rel="noopener noreferrer" aria-label="Yousef Odeh, open portfolio">' +
        '<img src="assets/img/yousef.png" alt="Yousef Odeh" width="44" height="44" loading="lazy">' +
        '<span><strong>Yousef Odeh</strong><small>Built by Yousef &middot; Winter 2026</small></span></a>'
    },

    /** Decorative floating symbols in the Home hero ([symbol, top %, left %, animation seconds, font-size px | null]). */
    heroSymbols: [
      ['{ }', 10, 5, 45, null], ['*', 25, 85, 70, 40], ['->', 60, 15, 55, null], ['::', 80, 70, 80, null],
      ['&', 40, 40, 65, 32], ['[ ]', 15, 60, 50, null], ['( )', 70, 5, 75, null], ['#', 5, 45, 60, null]
    ]
  };
})(window);
