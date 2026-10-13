/**
 * consent-init.js — sets Google's analytics consent state BEFORE the Google tag runs.
 *
 * Loaded synchronously in <head>, right before the gtag.js snippet. It defines the dataLayer /
 * gtag() helpers and tells Google (Consent Mode v2) to treat analytics storage as DENIED unless the
 * visitor previously accepted. The visitor's choice is stored in localStorage under "oop-consent"
 * ("granted" | "denied"). The banner that asks the question lives in consent.js.
 *
 * While denied, Google does not set analytics cookies. The site itself behaves identically either way.
 */
(function () {
  'use strict';
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };

  var saved = null;
  try { saved = localStorage.getItem('oop-consent'); } catch (e) { /* storage blocked: stay denied */ }

  window.gtag('consent', 'default', {
    analytics_storage: saved === 'granted' ? 'granted' : 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied'
  });
})();
