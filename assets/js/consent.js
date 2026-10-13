/**
 * consent.js — the small cookie/analytics notice (bottom bar, NOT a blocking dialog).
 *
 * Behaviour:
 *   - First visit: a bar asks Accept / Decline. Nothing is blocked while it is open; focus is not
 *     moved to it, so reading and keyboard use are undisturbed.
 *   - The choice is saved ("oop-consent") and sent to Google with gtag('consent','update', …).
 *   - A "Cookie settings" button in the footer re-opens the bar so the choice can be changed.
 *   - If storage is unavailable the bar simply shows on every visit (the site still works).
 *
 * API: OOP.consent.init() (called by app.js after the shell exists), OOP.consent.open()
 */
(function () {
  'use strict';

  const el = OOP.dom.el;
  let bar = null;

  /** Tell Google about the choice and remember it. */
  function save(choice) {
    OOP.store.set('consent', choice);
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', { analytics_storage: choice });
    }
    close();
    OOP.ui.toast(choice === 'granted' ? 'Analytics enabled' : 'Analytics declined', 'check');
  }

  /** Hide the bar. */
  function close() {
    if (bar) { bar.remove(); bar = null; }
    document.body.classList.remove('has-consent-bar');
  }

  /** Show the bar (first visit, or from the footer button). */
  function open() {
    if (bar) return;
    const accept = el('button', { type: 'button', class: 'btn btn--primary', text: 'Accept' });
    const decline = el('button', { type: 'button', class: 'btn btn--ghost', text: 'Decline' });
    accept.addEventListener('click', function () { save('granted'); });
    decline.addEventListener('click', function () { save('denied'); });
    bar = el('section', { class: 'consent-bar', 'aria-label': 'Analytics cookies', 'data-ui': '' }, [
      el('p', { text: 'This site uses Google Analytics cookies to count visits. The site works the same whether you accept or decline.' }),
      el('div', { class: 'consent-actions' }, [decline, accept])
    ]);
    document.body.appendChild(bar);
    document.body.classList.add('has-consent-bar');
  }

  /** Add the "Cookie settings" button to the footer and show the bar if no choice was made yet. */
  function init() {
    const footer = document.querySelector('.site-footer');
    if (footer) {
      const b = el('button', { type: 'button', class: 'link-btn consent-link', 'data-ui': '', text: 'Cookie settings' });
      b.addEventListener('click', open);
      footer.appendChild(b);
    }
    if (OOP.store.get('consent', null) === null) open();
  }

  OOP.consent = { open, init };
})();
