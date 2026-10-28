/**
 * analytics.js — custom GA4 events for learning interactions. Loaded right after config.js.
 *
 * It does NOT install or configure Google Analytics: the Google tag in each page's <head> already
 * does that (and sends the page_view). This module only forwards a few extra events through the
 * existing window.gtag. Events, parameters and how to analyse them: docs/GA4-ENGAGEMENT-TRACKING.md
 *
 *   lesson_complete / lesson_uncomplete   progress.js  setDone()   (only on a real state change)
 *   lab_complete / lab_uncomplete         progress.js  toggleLab()
 *   code_copy / code_file_view            code-viewer.js
 *   learning_resource_click               page-features.js  trackResourceClicks()
 *
 * Safety rules:
 *   - no gtag (tag removed) or gtag.js blocked → nothing is sent and the site works exactly as before
 *   - tracking errors are swallowed, so they can never break a button
 *   - only short, non-personal values are sent (ids, labels, file names). Never names, emails,
 *     code contents or anything the student types.
 *   - an identical event repeated within DEDUPE_MS (e.g. two listeners on one click) is sent once
 *   - consent: the site has no consent banner; events go through gtag, so Consent Mode or the
 *     standard opt-out flag window['ga-disable-G-4JHKFQBZ63'] = true apply to them automatically.
 *
 * API:
 *   OOP.analytics.track(name, params) → true when the event was handed to gtag
 */
(function () {
  'use strict';

  const DEDUPE_MS = 1000;
  let last = { key: '', at: 0 };

  /** Keep primitive values only; strings are whitespace-collapsed and cut to GA4's 100-char limit. */
  function clean(params) {
    const out = {};
    Object.keys(params || {}).forEach(function (k) {
      const v = params[k];
      if (typeof v === 'number' || typeof v === 'boolean') out[k] = v;
      else if (typeof v === 'string' && v.trim()) out[k] = v.replace(/\s+/g, ' ').trim().slice(0, 100);
    });
    return out;
  }

  /**
   * Send one GA4 event. Names are snake_case (GA4 limit: 40 chars).
   * @param {string} name   e.g. "lesson_complete"
   * @param {Object} params flat { key: string | number | boolean }
   */
  function track(name, params) {
    try {
      if (typeof window.gtag !== 'function' || !/^[a-z][a-z0-9_]{0,39}$/.test(name)) return false;
      const data = clean(params);
      const key = name + JSON.stringify(data);
      const now = Date.now();
      if (key === last.key && now - last.at < DEDUPE_MS) return false;
      last = { key: key, at: now };
      window.gtag('event', name, data);
      return true;
    } catch (e) {
      return false;
    }
  }

  OOP.analytics = { track };
})();
