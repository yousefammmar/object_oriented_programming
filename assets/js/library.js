/**
 * library.js — the student's personal "library": last visited section, recently visited list
 * and bookmarks. Everything is optional, stored locally (no login, no backend).
 *
 * An "entry" describes one place on the site:
 *   { key: "page:cpp" | "code:sep", label: "C++ Revision", href: "cpp-revision.html" }
 *
 * Storage keys: "last" (entry + timestamp), "recent" (array, newest first, max 6), "bookmarks" (array).
 *
 * API:
 *   OOP.library.visit(entry)       record a visit (updates last + recent)
 *   OOP.library.last()             most recent entry or null
 *   OOP.library.recent()           recent entries
 *   OOP.library.bookmarks()        bookmarked entries
 *   OOP.library.isBookmarked(key)
 *   OOP.library.toggleBookmark(entry) → true if it is bookmarked afterwards
 */
(function () {
  'use strict';

  const MAX_RECENT = 6;

  /** Read an array from storage (always returns an array, even for corrupt data). */
  function readList(name) {
    const v = OOP.store.getJSON(name, []);
    return Array.isArray(v) ? v : [];
  }

  /** Fire a DOM event so the dashboard/buttons can re-render. */
  function changed() {
    document.dispatchEvent(new CustomEvent('oop:library'));
  }

  /**
   * Record that the student visited something. The Home page is never recorded — "continue
   * learning" is about content sections.
   */
  function visit(entry) {
    if (!entry || !entry.key) return;
    const slim = { key: entry.key, label: entry.label, href: entry.href };
    OOP.store.setJSON('last', Object.assign({ at: Date.now() }, slim));
    const list = readList('recent').filter(function (e) { return e.key !== slim.key; });
    list.unshift(slim);
    OOP.store.setJSON('recent', list.slice(0, MAX_RECENT));
    changed();
  }

  /** Last visited entry (or null). */
  function last() {
    const v = OOP.store.getJSON('last', null);
    return v && v.key ? v : null;
  }

  /** Recently visited entries, newest first. */
  function recent() {
    return readList('recent');
  }

  /** All bookmarks. */
  function bookmarks() {
    return readList('bookmarks');
  }

  /** Is the given key bookmarked? */
  function isBookmarked(key) {
    return bookmarks().some(function (e) { return e.key === key; });
  }

  /**
   * Add the entry to bookmarks, or remove it if already there.
   * @returns {boolean} true when bookmarked after the call
   */
  function toggleBookmark(entry) {
    let list = bookmarks();
    const exists = list.some(function (e) { return e.key === entry.key; });
    if (exists) list = list.filter(function (e) { return e.key !== entry.key; });
    else list.push({ key: entry.key, label: entry.label, href: entry.href });
    OOP.store.setJSON('bookmarks', list);
    changed();
    return !exists;
  }

  OOP.library = { visit, last, recent, bookmarks, isBookmarked, toggleBookmark };
})();
