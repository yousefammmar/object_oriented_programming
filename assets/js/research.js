/**
 * research.js — OPT-IN research data collection (study sessions + quiz results). docs/RESEARCH.md
 *
 * Off unless OOP.config.research and OOP.config.firebase are set. Even then nothing is recorded and
 * no Firebase code is loaded until the student agrees in the consent dialog; declining changes nothing.
 *
 * Identity: a consenting browser signs in ANONYMOUSLY on a separate Firebase app named "research", so
 * the research ID is a random uid that is never linked to the Google sign-in used by sync.js.
 *
 * Study session (one topic, one browser) — NOT a GA4 session:
 *   - starts with a page view of a topic page that has a quiz, unless that topic already has a session
 *     active in the last `sessionMinutes`; then it resumes, so refreshes, back/forward, another tab or
 *     a detour to another page and back all stay in one session
 *   - ends after `sessionMinutes` without activity, with endedAt = its last active moment. It is closed
 *     by the next page load, or by new activity in the same tab (which then starts a new session)
 *   - pageViews: loads and back/forward restores of the page, plus the view that starts a session
 *   - engagement: time the page is visible AND had input (pointer, key, wheel, touch, scroll) in the
 *     last `idleSeconds` (Timer below)
 *   - maxScrollDepth: highest % of the topic content (top of <main> → top of the quiz block) that
 *     reached the bottom of the window
 *
 * Saving: changes go to localStorage first (every 5 s and whenever the tab is hidden), then to
 * Firestore every `saveSeconds`, when the tab is hidden, after a quiz and on the next page load.
 * Each write is a full snapshot of the session, so a lost or repeated write is harmless.
 *
 * Firestore: researchParticipants/{researchId}                consent record
 *            researchParticipants/{researchId}/sessions/{id}  one document per study session
 *
 * API:
 *   OOP.research.init()          called once by app.js
 *   OOP.research.open()          show the participant information / consent dialog
 *   OOP.research.Timer(idleMs)   active-time clock (pure; tested by tools/test_research.cjs)
 */
(function () {
  'use strict';

  /* ───────────── 1. Active-time clock (pure) ───────────── */

  /**
   * Counts time that is visible AND within idleMs of the last input. A stretch is credited up to the
   * moment it went idle (not until that was noticed) and every moment is credited once.
   * Methods take the current time in ms; take() returns the credited ms and resets the counter.
   */
  function Timer(idleMs) {
    let mark = null; // start of the stretch not credited yet (null = not counting)
    let input = -Infinity;
    let banked = 0;
    const t = { visible: true, last: 0 }; // last = end of the last credited moment

    function settle(now) {
      if (mark === null) return;
      const end = Math.min(now, input + idleMs);
      if (end > mark) { banked += end - mark; t.last = end; }
      mark = now < input + idleMs ? now : null;
    }
    t.input = function (now) {
      if (!t.visible) return;
      settle(now);
      input = now;
      if (mark === null) mark = now;
    };
    t.hide = function (now) { settle(now); t.visible = false; mark = null; };
    t.show = function (now) { t.visible = true; t.input(now); }; // coming back to the tab counts as input
    t.take = function (now) { settle(now); const ms = banked; banked = 0; return ms; };
    return t;
  }

  const cfg = OOP.config.research;
  if (!cfg || !OOP.config.firebase) {
    OOP.research = { init: function () {}, open: function () {}, Timer: Timer };
    return;
  }

  const K = { consent: 'research-consent', open: 'research-open', outbox: 'research-outbox', past: 'research-attempts' };
  /** analytics.js events counted per session as learning interactions (names only). */
  const COUNTED = ['lesson_complete', 'lesson_uncomplete', 'lab_complete', 'lab_uncomplete', 'code_copy', 'code_file_view', 'learning_resource_click'];
  const TICK = 5000;
  const GAP = cfg.sessionMinutes * 60000;
  const MAX_OUTBOX = 200; // ponytail: oldest unsaved sessions are dropped if Firestore keeps failing
  const el = OOP.dom.el;
  const icon = OOP.dom.icon;

  /* ───────────── 2. Consent + local records ───────────── */

  function now() { return Date.now(); }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    const b = crypto.getRandomValues(new Uint8Array(16)); // randomUUID needs https; this does not
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    const h = Array.prototype.map.call(b, function (x) { return (x + 256).toString(16).slice(1); }).join('');
    return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20)].join('-');
  }

  /** { status: 'granted' | 'declined' | 'withdrawn', version, at, registered?, purged? } or null */
  function consent() { return OOP.store.getJSON(K.consent, null); }
  function setConsent(c) { OOP.store.setJSON(K.consent, c); }
  /** Agreed to the CURRENT information sheet. After a change (new consentVersion) nothing is recorded until asked again. */
  function participating() {
    const c = consent();
    return !!c && c.status === 'granted' && c.version === cfg.consentVersion;
  }
  function decided() {
    const c = consent();
    return participating() || (!!c && c.status !== 'granted');
  }

  function readOpen() { return OOP.store.getJSON(K.open, {}); }
  function writeOpen(map) { OOP.store.setJSON(K.open, map); }
  function readOutbox() { return OOP.store.getJSON(K.outbox, []); }
  function writeOutbox(list) { OOP.store.setJSON(K.outbox, list.slice(-MAX_OUTBOX)); }
  /** Completed quiz attempts per topic in earlier sessions (→ quizPriorAttempts). */
  function past() { return OOP.store.getJSON(K.past, {}); }

  function ga(name, params) { if (OOP.analytics) OOP.analytics.track(name, params); }

  /** End a session at its last active moment and queue it for saving. */
  function close(r) {
    r.endedAt = r.lastActiveAt;
    r.rev++;
    const box = readOutbox();
    box.push(r);
    writeOutbox(box);
    ga('study_session_completed', { lesson_id: r.topicId, study_active_sec: Math.floor(r.engagementMs / 1000), study_quiz_status: r.quizStatus });
  }

  /** Close every open session (any topic) that has been inactive for longer than the timeout. */
  function sweep(t) {
    const map = readOpen();
    let changed = false;
    Object.keys(map).forEach(function (k) {
      if (t - map[k].lastActiveAt > GAP) { close(map[k]); delete map[k]; changed = true; }
    });
    if (changed) writeOpen(map);
  }

  /* ───────────── 3. Tracking on a topic page ───────────── */

  const page = OOP.layout.currentPage();
  const topic = OOP.quizData && OOP.quizData[page.id] ? page.id : null;
  const timer = Timer(cfg.idleSeconds * 1000);
  let tracking = false;
  let sid = null;      // the session this tab records into
  let viewed = false;  // this document's page view has been counted
  let depthMax = 0;    // deepest scroll seen by this tab in the current session
  let attempt = null;  // quiz attempt in progress { id, startedAt }

  /** % of the topic content (top of <main> → quiz block) above the bottom of the window. */
  function depth() {
    const main = document.getElementById('main');
    if (!main) return 0;
    const top = main.getBoundingClientRect().top;
    const stop = document.querySelector('#topic-quiz, main .pager');
    const end = stop ? stop.getBoundingClientRect().top : main.getBoundingClientRect().bottom;
    if (end - top <= 0) return 100;
    return Math.max(0, Math.min(100, Math.round((window.innerHeight - top) / (end - top) * 100)));
  }

  /** Count a page view: resume this topic's open session, or start a new one. */
  function begin(t) {
    const map = readOpen();
    let r = map[topic];
    if (r && t - r.lastActiveAt > GAP) { close(r); r = null; }
    if (!r) {
      r = {
        sessionId: uuid(), topicId: topic, startedAt: t, lastActiveAt: t, endedAt: null,
        engagementMs: 0, pageViews: 0, maxScrollDepth: 0,
        quizStatus: 'not_started', quizStartedAt: null, quizCompletedAt: null, quizScore: null, quizLastScore: null,
        quizAttemptCount: 0, quizPriorAttempts: past()[topic] || 0, quizAttempts: {},
        interactions: {}, interactionsTracked: !!OOP.analytics, consentVersion: cfg.consentVersion,
        rev: 0, syncedRev: -1
      };
      ga('study_session_started', { lesson_id: topic });
    }
    r.pageViews++;
    r.lastActiveAt = Math.max(r.lastActiveAt, t);
    depthMax = depth();
    r.maxScrollDepth = Math.max(r.maxScrollDepth, depthMax);
    r.rev++;
    map[topic] = r;
    writeOpen(map);
    sid = r.sessionId;
  }

  /** Change this tab's session. If it ended meanwhile (timed out, closed elsewhere) a new one starts first. */
  function update(t, fn) {
    const cur = readOpen()[topic];
    if (!cur || cur.sessionId !== sid || t - cur.lastActiveAt > GAP) begin(t);
    const map = readOpen();
    fn(map[topic]);
    map[topic].rev++;
    writeOpen(map);
  }

  /** Move credited active time and scroll depth into the stored session. */
  function commit(t) {
    if (!tracking || !viewed) return;
    const ms = timer.take(t);
    depthMax = Math.max(depthMax, depth());
    const r = readOpen()[topic];
    if (!ms && (!r || r.sessionId !== sid || depthMax <= r.maxScrollDepth)) return; // nothing new
    update(t, function (s) {
      s.engagementMs += ms;
      if (ms) s.lastActiveAt = Math.max(s.lastActiveAt, timer.last);
      s.maxScrollDepth = Math.max(s.maxScrollDepth, depthMax);
    });
  }

  function view(t) {
    if (viewed || !tracking || document.visibilityState !== 'visible') return;
    viewed = true;
    timer.show(t);
    begin(t);
  }

  function onQuiz(e) {
    if (!tracking || !viewed) return;
    const d = e.detail;
    const t = now();
    if (d.type === 'start') {
      attempt = { id: uuid(), startedAt: t };
      update(t, function (r) {
        if (r.quizStatus === 'not_started') { r.quizStatus = 'started'; r.quizStartedAt = t; }
      });
    } else if (d.type === 'submit' && attempt) {
      const a = attempt;
      attempt = null; // one record per attempt, however often submit fires
      update(t, function (r) {
        const n = r.quizAttemptCount + 1;
        r.quizAttempts[a.id] = {
          attemptNumber: n, quizVersion: d.version, score: d.score, correctCount: d.correct, questionCount: d.total,
          answers: d.answers, startedAt: a.startedAt, submittedAt: t
        };
        r.quizAttemptCount = n;
        r.quizStatus = 'completed';
        if (!r.quizStartedAt) r.quizStartedAt = a.startedAt;
        if (r.quizScore === null) { r.quizScore = d.score; r.quizCompletedAt = t; } // first attempt = primary score
        r.quizLastScore = d.score;
      });
      const p = past();
      p[topic] = (p[topic] || 0) + 1;
      OOP.store.setJSON(K.past, p);
      save();
    }
  }

  function onTrack(e) {
    if (!tracking || !viewed || COUNTED.indexOf(e.detail.name) === -1) return;
    update(now(), function (r) { r.interactions[e.detail.name] = (r.interactions[e.detail.name] || 0) + 1; });
  }

  let wired = false;
  function startTracking() {
    if (tracking || !topic) return;
    tracking = true;
    if (!wired) {
      wired = true;
      let frame = 0;
      const input = function (e) {
        if (!tracking) return;
        timer.input(now());
        if (e.type === 'scroll' && !frame) {
          frame = requestAnimationFrame(function () { frame = 0; depthMax = Math.max(depthMax, depth()); });
        }
      };
      ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(function (type) {
        window.addEventListener(type, input, { passive: true });
      });
      document.addEventListener('visibilitychange', function () {
        if (!tracking) return;
        const t = now();
        if (document.visibilityState === 'visible') { if (viewed) timer.show(t); else view(t); return; }
        timer.hide(t);
        commit(t);
        save();
      });
      window.addEventListener('pagehide', function () {
        if (!tracking) return;
        const t = now();
        timer.hide(t);
        commit(t);
        save();
      });
      window.addEventListener('pageshow', function (e) {
        if (!e.persisted || !tracking) return; // restored from the back/forward cache = a new page view
        viewed = false;
        view(now());
      });
      document.addEventListener('oop:quiz', onQuiz);
      document.addEventListener('oop:track', onTrack);
      let n = 0;
      setInterval(function () {
        if (!tracking) return;
        commit(now());
        if (++n % Math.max(1, Math.round(cfg.saveSeconds * 1000 / TICK)) === 0) save();
      }, TICK);
    }
    view(now());
  }

  function stopTracking() {
    tracking = false;
    viewed = false;
    attempt = null;
  }

  /* ───────────── 4. Firestore ───────────── */

  let fb = null;
  let auth = null;
  let db = null;
  let ready = null;    // Promise: SDK loaded + auth state restored
  let signing = null;  // Promise: anonymous sign-in in flight
  let saving = false;

  /**
   * Load Firebase and restore this browser's research identity. A new anonymous identity is only
   * created for a participant; otherwise this resolves to the existing user or null.
   */
  function connect() {
    if (!ready) {
      ready = OOP.sync.load('app')
        .then(function () { return OOP.sync.load('auth'); })
        .then(function () { return OOP.sync.load('firestore'); })
        .then(function () {
          fb = window.firebase;
          const app = fb.apps.filter(function (a) { return a.name === 'research'; })[0] || fb.initializeApp(OOP.config.firebase, 'research');
          auth = app.auth();
          db = app.firestore();
          if (OOP.sync.emulated()) { auth.useEmulator('http://127.0.0.1:9099'); db.useEmulator('127.0.0.1', 8080); }
          return new Promise(function (resolve) { const off = auth.onAuthStateChanged(function () { off(); resolve(); }); });
        })
        .catch(function (e) { ready = null; throw e; });
    }
    return ready.then(function () {
      if (auth.currentUser || !participating()) return auth.currentUser;
      signing = signing || auth.signInAnonymously()
        .then(function (c) { return c.user; })
        .catch(function (e) { signing = null; throw e; });
      return signing;
    });
  }

  function ts(ms) { return ms ? fb.firestore.Timestamp.fromMillis(ms) : null; }
  function serverTime() { return fb.firestore.FieldValue.serverTimestamp(); }

  /** Firestore document for a local session record (fields: docs/RESEARCH.md data dictionary). */
  function toDoc(r, rid) {
    const attempts = {};
    Object.keys(r.quizAttempts).forEach(function (id) {
      const a = r.quizAttempts[id];
      attempts[id] = Object.assign({}, a, { startedAt: ts(a.startedAt), submittedAt: ts(a.submittedAt) });
    });
    return {
      researchId: rid, sessionId: r.sessionId, topicId: r.topicId,
      startedAt: ts(r.startedAt), lastActiveAt: ts(r.lastActiveAt), endedAt: ts(r.endedAt),
      engagementTimeSeconds: Math.floor(r.engagementMs / 1000), pageViews: r.pageViews, maxScrollDepth: r.maxScrollDepth,
      quizStatus: r.quizStatus, quizStartedAt: ts(r.quizStartedAt), quizCompletedAt: ts(r.quizCompletedAt),
      quizScore: r.quizScore, quizLastScore: r.quizLastScore, quizAttemptCount: r.quizAttemptCount,
      quizPriorAttempts: r.quizPriorAttempts, quizAttempts: attempts,
      interactions: r.interactions, interactionsTracked: r.interactionsTracked,
      consentVersion: r.consentVersion, schemaVersion: 1, updatedAt: serverTime()
    };
  }

  /** Remember that revision `rev` of a session is on the server; finished sessions leave the outbox. */
  function markSaved(id, rev) {
    const map = readOpen();
    Object.keys(map).forEach(function (k) { if (map[k].sessionId === id) map[k].syncedRev = Math.max(map[k].syncedRev, rev); });
    writeOpen(map);
    writeOutbox(readOutbox().filter(function (r) { return !(r.sessionId === id && rev >= r.rev); }));
  }

  /** Write the consent record and every session that changed since it was last saved. */
  function save() {
    if (!participating() || saving) return;
    saving = true;
    connect().then(function (u) {
      if (!u || !participating()) return null;
      const c = consent();
      const ref = db.collection('researchParticipants').doc(u.uid);
      const jobs = [];
      if (c.registered !== u.uid + ':' + c.version) {
        jobs.push(ref.set({ researchId: u.uid, consentStatus: 'granted', consentVersion: c.version, consentedAt: ts(c.at), updatedAt: serverTime() })
          .then(function () {
            const c2 = consent();
            if (c2 && c2.status === 'granted') { c2.registered = u.uid + ':' + c.version; setConsent(c2); }
          }));
      }
      const map = readOpen();
      Object.keys(map).map(function (k) { return map[k]; }).concat(readOutbox())
        .filter(function (r) { return r.rev > r.syncedRev; })
        .forEach(function (r) {
          jobs.push(ref.collection('sessions').doc(r.sessionId).set(toDoc(r, u.uid)).then(function () { markSaved(r.sessionId, r.rev); }));
        });
      return Promise.all(jobs);
    }).catch(function (e) { console.warn('[research] not saved yet — kept on this device and retried later', e); })
      .then(function () { saving = false; });
  }

  /** After withdrawal: delete this browser's research data and anonymous identity (retried until done). */
  function purge() {
    const c = consent();
    if (!c || c.status !== 'withdrawn' || c.purged) return Promise.resolve();
    return connect().then(function (u) {
      if (!u) return null; // no research identity in this browser: nothing on the server to delete
      const ref = db.collection('researchParticipants').doc(u.uid);
      return ref.update({ consentStatus: 'withdrawn', withdrawnAt: ts(c.at), updatedAt: serverTime() })
        .catch(function (e) { if (!e || e.code !== 'not-found') throw e; }) // never registered
        .then(function () { return ref.collection('sessions').get(); })
        .then(function (snap) { return Promise.all(snap.docs.map(function (d) { return d.ref.delete(); })); })
        .then(function () { return ref.delete(); })
        .then(function () { return u.delete(); });
    }).then(function () {
      const c2 = consent();
      if (c2 && c2.status === 'withdrawn') { c2.purged = true; setConsent(c2); }
    });
  }

  /* ───────────── 5. Consent UI ───────────── */

  function grant() {
    const c = consent();
    if (c && c.status === 'withdrawn' && !c.purged) {
      OOP.ui.toast('Your earlier data is still being deleted — try again once you are online', 'clock');
      purge().catch(function () {});
      return;
    }
    setConsent({ status: 'granted', version: cfg.consentVersion, at: now() });
    OOP.ui.toast('Thank you for taking part', 'check');
    render();
    sweep(now());
    startTracking();
    save();
  }

  function decline() {
    setConsent({ status: 'declined', version: cfg.consentVersion, at: now() });
    render();
  }

  function withdraw() {
    stopTracking();
    setConsent({ status: 'withdrawn', version: cfg.consentVersion, at: now(), purged: false });
    [K.open, K.outbox, K.past].forEach(function (k) { OOP.store.remove(k); });
    render();
    purge()
      .then(function () { OOP.ui.toast('You have withdrawn and your research data was deleted', 'check'); })
      .catch(function (e) {
        console.warn('[research] withdrawal finishes on your next visit', e);
        OOP.ui.toast('You have withdrawn. Your data will be deleted on your next visit', 'clock');
      });
  }

  function list(items) { return el('ul', {}, items.map(function (t) { return el('li', { text: t }); })); }

  /** The participant information sheet and the choice. */
  function open() {
    const old = document.getElementById('researchDlg');
    if (old) old.remove();
    const on = participating();
    const c = consent();
    const body = [
      el('h2', { id: 'researchTitle', text: 'Research study: web analytics and learning' }),
      el('p', { text: 'This site is part of a study asking whether common website measures — time on a page, page views and how far you scroll — reflect meaningful learning, compared with scores on the optional topic quizzes. It is observational: it looks for relationships between these numbers. It does not grade you.' }),
      el('p', { text: 'Taking part is voluntary. If you say no, nothing changes: every page, quiz and feature works the same.' }),
      el('h3', { text: 'If you agree, this browser records' }),
      list([
        'A random research ID made for this browser — not your name, email or Google account',
        'Which of the ten topic pages you study, when, and how long you are active on them',
        'Page views and how far down each topic page you scroll',
        'Whether you take a topic quiz, your answers and your score',
        'How often you mark a topic complete, open a learning resource or copy code'
      ]),
      el('h3', { text: 'Never in the research data' }),
      list([
        'Your name, email address or Google account (signing in to sync progress is not linked to this)',
        'Anything you type, and your IP address',
        'Anything before you agree or after you withdraw'
      ]),
      el('p', { text: 'The data is stored in this site\'s Google Firebase project and only the research team can export it. Each browser has its own research ID, so taking part on another device is a separate choice.' }),
      el('p', { text: 'You can withdraw at any time from "Research study" in the sidebar. Withdrawing stops recording and deletes the research data collected from this browser.' })
    ];
    if (cfg.contact) body.push(el('p', { class: 'research-meta', text: 'Contact: ' + cfg.contact }));
    if (cfg.ethics) body.push(el('p', { class: 'research-meta', text: cfg.ethics }));
    if (on && auth && auth.currentUser) body.push(el('p', { class: 'research-meta', text: 'Your research ID: ' + auth.currentUser.uid }));
    if (c && c.status === 'granted' && !on) body.push(el('p', { class: 'research-meta', text: 'This information has changed since you agreed, so nothing is recorded until you choose again.' }));

    const dlg = el('dialog', { class: 'research-dialog', id: 'researchDlg', 'aria-labelledby': 'researchTitle' });
    const btn = function (cls, text, fn) {
      const b = el('button', { type: 'button', class: 'btn ' + cls, text: text });
      b.addEventListener('click', function () { dlg.close(); fn(); });
      return b;
    };
    const agreedBefore = !!c && c.status === 'granted'; // possibly to an older version of this sheet
    body.push(el('div', { class: 'dialog-actions' }, [
      agreedBefore ? btn('btn--ghost btn--danger', 'Withdraw and delete my data', withdraw) : btn('btn--ghost', 'No thanks', decline),
      on ? btn('btn--primary', 'Keep taking part', function () {}) : btn('btn--primary', 'I agree to take part', grant)
    ]));
    dlg.appendChild(el('div', { class: 'dialog-body' }, body));
    dlg.addEventListener('click', function (e) { if (e.target === dlg) dlg.close(); });
    dlg.addEventListener('close', function () { dlg.remove(); });
    document.body.appendChild(dlg);
    dlg.showModal();
  }

  /** Sidebar entry on every page, plus an invitation on topic pages until the student decides. */
  function render() {
    const host = document.getElementById('sbResearch');
    if (host) {
      host.textContent = '';
      const c = consent();
      const label = participating() ? 'Research study: taking part' : c && c.status !== 'granted' ? 'Research study: not taking part' : 'About the research study';
      const b = el('button', { type: 'button', class: 'link-btn sb-research' }, [icon('flask'), el('span', { text: label })]);
      b.addEventListener('click', open);
      host.appendChild(b);
    }
    const old = document.getElementById('researchPrompt');
    if (old) old.remove();
    if (!topic || decided()) return;
    const more = el('button', { type: 'button', class: 'btn btn--primary', text: 'Learn more' });
    const no = el('button', { type: 'button', class: 'btn btn--ghost', text: 'No thanks' });
    more.addEventListener('click', open);
    no.addEventListener('click', decline);
    document.body.appendChild(el('aside', { class: 'research-prompt', id: 'researchPrompt', 'aria-label': 'Research study invitation', 'data-ui': '' }, [
      el('p', {}, [el('strong', { text: 'Help with a research study? ' }), 'It is optional and anonymous, and nothing is recorded unless you agree.']),
      el('div', { class: 'research-prompt-actions' }, [no, more])
    ]));
  }

  function init() {
    if (location.protocol === 'file:') return;
    render();
    const c = consent();
    if (c && c.status === 'withdrawn' && !c.purged) purge().catch(function (e) { console.warn('[research] withdrawal not finished yet', e); });
    if (!participating()) return;
    sweep(now());
    startTracking();
    save();
  }

  OOP.research = { init: init, open: open, Timer: Timer };
})();
