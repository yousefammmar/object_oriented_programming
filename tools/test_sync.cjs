#!/usr/bin/env node
/**
 * test_sync.cjs — checks assets/js/sync.js without a real Firebase project.
 *
 *   1. merge(): the three-way rules (pure function)
 *   2. two devices syncing one account through a fake Firestore document: guest data merged at
 *      sign-in, un-marking propagates, a change made just before leaving a page is not lost,
 *      and the devices settle (no endless write ping-pong).
 *
 * Usage: npm run test:sync      Exit code 0 = all checks passed.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'assets', 'js', 'sync.js'), 'utf8');
const settle = () => new Promise((r) => setTimeout(r, 1100)); // > sync.js DELAY
const clone = (v) => JSON.parse(JSON.stringify(v));

/** One browser tab: a fresh copy of sync.js over `saved` (that device's localStorage). */
function device(saved) {
  const listeners = {};
  const document = {
    addEventListener(t, f) { (listeners[t] = listeners[t] || []).push(f); },
    dispatchEvent(e) { (listeners[e.type] || []).forEach((f) => f(e)); },
    getElementById() { return null; } // no sidebar in this test
  };
  const store = {
    getJSON: (k, fb) => (k in saved ? JSON.parse(saved[k]) : fb),
    setJSON: (k, v) => { saved[k] = JSON.stringify(v); },
    remove: (k) => { delete saved[k]; }
  };
  const ctx = {
    OOP: { config: { firebase: {} }, store, ui: { toast() {} } },
    document, console, setTimeout, clearTimeout,
    CustomEvent: class { constructor(type) { this.type = type; } }
  };
  vm.runInNewContext(SRC, ctx);
  const topics = () => Object.keys((store.getJSON('progress', {}) || {}).topics || {}).sort();
  const change = (key, value, event) => { store.setJSON(key, value); document.dispatchEvent({ type: event }); };
  return { sync: ctx.OOP.sync, saved, store, topics, change };
}

/** The shared Firestore document users/u1. */
function server() {
  const s = { doc: null, subs: [], writes: 0 };
  s.snap = () => ({ exists: !!s.doc, data: () => clone(s.doc), metadata: { hasPendingWrites: false } });
  return s;
}

/** Fake Firebase compat namespace for one tab, already signed in as u1 (a persisted session). */
function firebase(srv) {
  let dead = false; // the tab navigated away: its pending work never reaches the server
  const ref = {
    set(data) {
      if (dead) return new Promise(() => {});
      srv.doc = clone(data);
      srv.writes++;
      setImmediate(() => srv.subs.forEach((cb) => cb(srv.snap())));
      return Promise.resolve();
    },
    onSnapshot(cb) {
      const sub = (snap) => { if (!dead) cb(snap); };
      srv.subs.push(sub);
      setImmediate(() => sub(srv.snap()));
      return () => { srv.subs = srv.subs.filter((x) => x !== sub); };
    }
  };
  const fb = {
    apps: [1],
    auth: () => ({ onAuthStateChanged: (cb) => setImmediate(() => cb({ uid: 'u1' })) }),
    firestore: Object.assign(() => ({ collection: () => ({ doc: () => ref }) }), { FieldValue: { serverTimestamp: () => 'ts' } }),
    kill: () => { dead = true; }
  };
  return fb;
}

(async function main() {
  /* 1. merge() rules */
  const { merge } = device({}).sync;
  const P = (...ids) => ({ topics: Object.fromEntries(ids.map((i) => [i, true])), labs: {} });

  // first sign-in (no base): guest data and account data are combined
  let m = merge({ progress: P('cpp'), bookmarks: [{ key: 'a' }] }, { progress: P('inheritance'), bookmarks: [{ key: 'b' }] }, null);
  assert.deepStrictEqual(Object.keys(m.progress.topics).sort(), ['cpp', 'inheritance']);
  assert.deepStrictEqual(m.bookmarks.map((b) => b.key), ['a', 'b']);
  // only local changed (un-mark) → local wins, the topic does not come back
  m = merge({ progress: P('cpp') }, { progress: P('cpp', 'inheritance') }, { progress: P('cpp', 'inheritance') });
  assert.deepStrictEqual(Object.keys(m.progress.topics), ['cpp']);
  // only cloud changed → cloud wins
  m = merge({ progress: P('cpp') }, { progress: P('cpp', 'poly') }, { progress: P('cpp') });
  assert.deepStrictEqual(Object.keys(m.progress.topics).sort(), ['cpp', 'poly']);
  // both changed → union; "last" keeps the newest; "recent" is capped at 6
  m = merge(
    { progress: P('cpp', 'a'), last: { key: 'x', at: 5 }, recent: [1, 2, 3, 4].map((k) => ({ key: 'l' + k })) },
    { progress: P('cpp', 'b'), last: { key: 'y', at: 9 }, recent: [1, 2, 3, 4].map((k) => ({ key: 'c' + k })) },
    { progress: P('cpp') });
  assert.deepStrictEqual(Object.keys(m.progress.topics).sort(), ['a', 'b', 'cpp']);
  assert.strictEqual(m.last.key, 'y');
  assert.deepStrictEqual(m.recent.map((r) => r.key), ['l1', 'l2', 'l3', 'l4', 'c1', 'c2']);
  // same data stored in a different key order is not a change
  m = merge({ progress: { labs: {}, topics: { b: true, a: true } } }, { progress: { topics: { a: true, b: true }, labs: {} } }, null);
  assert.deepStrictEqual(Object.keys(m.progress.topics), ['b', 'a']);
  console.log('ok  merge rules');

  /* 2. two devices, one account */
  const srv = server();
  const A = device({ progress: JSON.stringify(P('cpp')) });
  const B = device({ progress: JSON.stringify(P('inheritance')), bookmarks: JSON.stringify([{ key: 'page:poly', label: 'Polymorphism', href: 'polymorphism.html' }]) });

  A.sync.start(firebase(srv));
  await settle();
  assert.deepStrictEqual(Object.keys(srv.doc.state.progress.topics), ['cpp']);
  const fbB = firebase(srv);
  B.sync.start(fbB);
  await settle();
  assert.deepStrictEqual(A.topics(), ['cpp', 'inheritance'], 'guest progress from both devices is merged');
  assert.deepStrictEqual(B.topics(), ['cpp', 'inheritance']);
  assert.strictEqual(A.store.getJSON('bookmarks', []).length, 1, 'bookmark reached the other device');
  console.log('ok  guest progress merged into the account at sign-in');

  A.change('progress', P('cpp'), 'oop:progress'); // un-mark Inheritance on A
  await settle();
  assert.deepStrictEqual(B.topics(), ['cpp'], 'un-marking propagates and sticks');
  console.log('ok  un-marking a topic propagates');

  // B marks Polymorphism and navigates away while its push is still in flight
  B.change('progress', P('cpp', 'polymorphism'), 'oop:progress');
  fbB.kill();
  await settle(); // B's push has started and will never land
  assert.deepStrictEqual(srv.doc.state.progress.topics, { cpp: true });
  const B2 = device(B.saved); // the next page on device B, same localStorage
  B2.sync.start(firebase(srv));
  await settle();
  assert.deepStrictEqual(srv.doc.state.progress.topics, { cpp: true, polymorphism: true }, 'change survived navigation');
  assert.deepStrictEqual(A.topics(), ['cpp', 'polymorphism']);
  console.log('ok  a change made just before navigating is pushed from the next page');

  const writes = srv.writes;
  await settle();
  assert.strictEqual(srv.writes, writes, 'devices settle without endless writes');
  console.log('ok  devices settle (' + writes + ' writes in total)');
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
