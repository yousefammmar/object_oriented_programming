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
 *   - callers check `OOP.analytics` first, so the site also works when THIS file is blocked
 *     (ad blockers often block any file named analytics.js) or missing from a cached page
 *   - tracking errors are swallowed, so they can never break a button
 *   - only short, non-personal values are sent (ids, labels, file names). Never names, emails,
 *     code contents or anything the student types.
 *   - an identical event repeated within DEDUPE_MS (e.g. two listeners on one click) is sent once
 *   - consent: the site has no consent banner; events go through gtag, so Consent Mode or the
 *     standard opt-out flag window['ga-disable-G-4JHKFQBZ63'] = true apply to them automatically.
 *   - never use parameter names gtag.js reserves for itself (page_path, page_title, page_location …):
 *     it turns them into its own fields and they never arrive as custom parameters.
 *
 * API:
 *   OOP.analytics.track(name, params) → true when the event was handed to gtag
 */
(function () {
  'use strict';

  const DEDUPE_MS = 1000;
  /** GA4 naming rule, used for event and parameter names: snake_case, starts with a letter, ≤ 40 chars. */
  const NAME = /^[a-z][a-z0-9_]{0,39}$/;
  let last = { key: '', at: 0 };

  /**
   * Keep valid keys with a boolean, finite number or non-empty string value.
   * Strings are whitespace-collapsed and cut to GA4's 100-character limit.
   */
  function clean(params) {
    const out = {};
    if (!params || typeof params !== 'object') return out;
    Object.keys(params).forEach(function (k) {
      const v = params[k];
      if (!NAME.test(k)) return;
      if (typeof v === 'boolean' || (typeof v === 'number' && isFinite(v))) out[k] = v;
      else if (typeof v === 'string' && v.trim()) out[k] = v.replace(/\s+/g, ' ').trim().slice(0, 100).trim();
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
      if (typeof window.gtag !== 'function' || typeof name !== 'string' || !NAME.test(name)) return false;
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
