/**
 * sync.js — OPTIONAL cross-device sync of progress, bookmarks and history (Firebase).
 *
 * Off by default. With OOP.config.firebase = null nothing is loaded and the site stays exactly as
 * before: everything lives in this browser (guest mode). With a config, a "Sign in with Google"
 * button appears under the sidebar progress card. Signing in is never required.
 *
 * Signed in, the account's data is one Firestore document, users/{uid} = { state, updatedAt },
 * where `state` holds the same values as the local storage keys listed in SYNCED.
 *
 * Local and cloud are reconciled with a three-way merge per key against "base" — the last state
 * both sides agreed on (storage key "sync-base"):
 *   only local changed → keep local      only cloud changed → take cloud
 *   both changed       → MERGE[key]      (union of lists / newest "last")
 * So un-marking a topic sticks on every device, guest progress is merged into the account at the
 * first sign-in (there is no base yet), and a change made just before leaving a page is pushed
 * from the next page (base still differs from it).
 *
 * Signing out keeps this device's data; the visitor simply continues as a guest.
 *
 * API:
 *   OOP.sync.init()                   load Firebase and start (called once by app.js)
 *   OOP.sync.start(firebase)          start with an already-loaded Firebase compat namespace
 *   OOP.sync.merge(local, cloud, base) → merged state (pure; tested by tools/test_sync.cjs)
 */
(function () {
  'use strict';

  const SDK = 'https://www.gstatic.com/firebasejs/12.19.0/firebase-';
  const SYNCED = ['progress', 'bookmarks', 'recent', 'last', 'seen', 'achievements'];
  const MAX_RECENT = 6; // same cap as library.js
  const DELAY = 800;    // ms to wait after a local change before pushing (batches rapid clicks)

  /* ───────────── 1. Pure merge ───────────── */

  /** JSON with object keys sorted, so equal data compares equal whatever order it was stored in. */
  function json(v) {
    return JSON.stringify(v === undefined ? null : v, function (k, x) {
      if (!x || typeof x !== 'object' || Array.isArray(x)) return x;
      return Object.keys(x).sort().reduce(function (o, key) { o[key] = x[key]; return o; }, {});
    });
  }

  /** A state object with every synced key present (missing → null). */
  function norm(s) {
    const out = {};
    SYNCED.forEach(function (k) { out[k] = s && s[k] !== undefined ? s[k] : null; });
    return out;
  }

  /** Union of two lists, entries matched by .key (objects) or value. First list wins on order. */
  function union(a, b) {
    const id = function (x) { return x && typeof x === 'object' ? x.key : x; };
    const out = Array.isArray(a) ? a.slice() : [];
    const have = out.map(id);
    (Array.isArray(b) ? b : []).forEach(function (x) {
      if (have.indexOf(id(x)) === -1) { out.push(x); have.push(id(x)); }
    });
    return out;
  }

  /** How to combine a key that changed on BOTH sides since the last sync. */
  const MERGE = {
    progress: function (l, c) {
      l = l || {}; c = c || {};
      return { topics: Object.assign({}, c.topics, l.topics), labs: Object.assign({}, c.labs, l.labs) };
    },
    bookmarks: union,
    seen: union,
    achievements: union,
    recent: function (l, c) { return union(l, c).slice(0, MAX_RECENT); },
    last: function (l, c) { return ((l && l.at) || 0) >= ((c && c.at) || 0) ? l : c; }
  };

  function merge(local, cloud, base) {
    const l = norm(local), c = norm(cloud), b = norm(base);
    const out = {};
    SYNCED.forEach(function (k) {
      if (json(l[k]) === json(c[k])) out[k] = l[k];
      else if (json(l[k]) === json(b[k])) out[k] = c[k];
      else if (json(c[k]) === json(b[k])) out[k] = l[k];
      else out[k] = MERGE[k](l[k], c[k]);
    });
    return out;
  }

  /* ───────────── 2. Runtime ───────────── */

  let fb = null;          // Firebase compat namespace
  let user = null;        // signed-in Firebase user, or null (guest)
  let ref = null;         // users/{uid}
  let cloud = null;       // last state seen on the server (null until the first snapshot)
  let unlisten = null;
  let applying = false;   // true while we write remote data locally (ignore our own events)
  let busy = false;       // a push is in flight; reconcile again once it lands
  let again = false;
  let timer = null;

  function readLocal() {
    const s = {};
    SYNCED.forEach(function (k) { s[k] = OOP.store.getJSON(k, null); });
    return s;
  }

  /** Write merged data locally and let the sidebar/dashboard re-render. */
  function writeLocal(state) {
    applying = true;
    SYNCED.forEach(function (k) {
      if (state[k] === null) OOP.store.remove(k); else OOP.store.setJSON(k, state[k]);
    });
    document.dispatchEvent(new CustomEvent('oop:progress'));
    document.dispatchEvent(new CustomEvent('oop:library'));
    applying = false;
  }

  /** The last agreed state — only valid for the same account. */
  function readBase() {
    const b = OOP.store.getJSON('sync-base', null);
    return b && b.uid === user.uid ? b.state : null;
  }

  function saveBase(state) {
    OOP.store.setJSON('sync-base', { uid: user.uid, state: state });
  }

  /** Bring this device and the account to the same state. */
  function reconcile() {
    if (!user || !cloud) return;
    if (busy) { again = true; return; }
    const local = norm(readLocal());
    const out = merge(local, cloud, readBase());
    if (json(out) !== json(local)) writeLocal(out);
    if (json(out) === json(cloud)) { saveBase(out); return; }

    // ponytail: last write wins if two devices push within the same second; a transaction would fix it.
    busy = true;
    const uid = user.uid;
    ref.set({ state: out, updatedAt: fb.firestore.FieldValue.serverTimestamp() })
      .then(function () {
        if (user && user.uid === uid) { cloud = out; saveBase(out); }
      })
      .catch(function (e) { console.warn('[sync] could not save to your account', e); })
      .then(function () {
        busy = false;
        if (again) { again = false; reconcile(); }
      });
  }

  function onLocalChange() {
    if (applying || !user) return;
    clearTimeout(timer);
    timer = setTimeout(reconcile, DELAY);
  }

  function load(src) {
    return new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  /** Local testing against `npm run emulators` (config `emulators: true`, honoured on localhost only). */
  function emulated() {
    return !!OOP.config.firebase.emulators && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  }

  let db = null;
  function firestore() {
    if (!db) {
      db = fb.firestore();
      if (emulated()) db.useEmulator('127.0.0.1', 8080);
    }
    return db;
  }

  /** Firestore is only downloaded once someone signs in — guests never need it. */
  function listen(u) {
    (fb.firestore ? Promise.resolve() : load(SDK + 'firestore-compat.js')).then(function () {
      if (user !== u) return; // signed out meanwhile
      ref = firestore().collection('users').doc(u.uid);
      unlisten = ref.onSnapshot(function (snap) {
        if (snap.metadata.hasPendingWrites) return; // our own write echoing back
        cloud = norm(snap.exists ? snap.data().state : null);
        reconcile();
      }, function (e) { console.warn('[sync] could not read your account', e); });
    }).catch(function (e) { console.warn('[sync] Firestore unavailable', e); });
  }

  /* ───────────── 3. Account UI (sidebar) ───────────── */

  function signIn() {
    fb.auth().signInWithPopup(new fb.auth.GoogleAuthProvider())
      .then(function () { OOP.ui.toast('Signed in — your progress now syncs across devices', 'cloud'); })
      .catch(function (e) {
        if (e && (e.code === 'auth/popup-closed-by-user' || e.code === 'auth/cancelled-popup-request')) return;
        console.warn('[sync] sign-in failed', e);
        OOP.ui.toast(e && e.code === 'auth/popup-blocked'
          ? 'Allow pop-ups for this site to sign in'
          : 'Sign-in failed — your progress is still saved on this device', 'x');
      });
  }

  function signOut() {
    fb.auth().signOut().then(function () { OOP.ui.toast('Signed out — progress stays on this device', 'check'); });
  }

  function renderAccount() {
    const host = document.getElementById('sbAccount');
    if (!host) return;
    const el = OOP.dom.el, icon = OOP.dom.icon;
    host.textContent = '';
    if (user) {
      const out = el('button', { type: 'button', class: 'link-btn', text: 'Sign out' });
      out.addEventListener('click', signOut);
      host.appendChild(el('div', { class: 'sb-account' }, [
        el('p', { class: 'sb-account-who' }, [icon('cloud'), el('span', { text: 'Syncing as ' + (user.email || user.displayName || 'your account') })]),
        out
      ]));
    } else {
      const btn = el('button', { type: 'button', class: 'btn btn--ghost sb-signin' }, [icon('cloud'), el('span', { text: 'Sign in with Google' })]);
      btn.addEventListener('click', signIn);
      host.appendChild(el('div', { class: 'sb-account' }, [
        btn,
        el('small', { text: 'Optional — sync your progress across devices.' })
      ]));
    }
  }

  /* ───────────── 4. Start ───────────── */

  function start(firebase) {
    fb = firebase;
    if (!fb.apps.length) fb.initializeApp(OOP.config.firebase);
    if (emulated()) fb.auth().useEmulator('http://127.0.0.1:9099');
    document.addEventListener('oop:progress', onLocalChange);
    document.addEventListener('oop:library', onLocalChange);
    fb.auth().onAuthStateChanged(function (u) {
      if (unlisten) { unlisten(); unlisten = null; }
      clearTimeout(timer);
      user = u;
      ref = null;
      cloud = null;
      renderAccount();
      if (u) listen(u);
    });
  }

  function init() {
    // Guest-only site, or opened from disk (Google sign-in needs a real web address).
    if (!OOP.config.firebase || location.protocol === 'file:') return;
    load(SDK + 'app-compat.js')
      .then(function () { return load(SDK + 'auth-compat.js'); })
      .then(function () { start(window.firebase); })
      .catch(function () { /* offline or blocked: the site simply stays local */ });
  }

  OOP.sync = { init, start, merge };
})();
