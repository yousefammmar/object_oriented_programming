/**
 * storage.js — safe wrapper around localStorage.
 *
 * The site only stores NON-ESSENTIAL data (theme, progress, last visited section, bookmarks).
 * localStorage can be missing or throw (private windows, blocked cookies, file:// in some
 * browsers), so every access is wrapped: when it is unavailable we silently fall back to an
 * in-memory object and the site keeps working — it just forgets things on reload.
 *
 * API (all keys are automatically prefixed with OOP.config.storagePrefix):
 *   OOP.store.get(key, fallback)      → string | fallback
 *   OOP.store.set(key, value)         → boolean (true if persisted)
 *   OOP.store.remove(key)
 *   OOP.store.getJSON(key, fallback)  → parsed value | fallback
 *   OOP.store.setJSON(key, value)
 *   OOP.store.persistent              → true when real localStorage is in use
 */
(function () {
  'use strict';

  const prefix = OOP.config.storagePrefix;
  const memory = {}; // fallback store

  /** Real storage object, or null if the browser blocks it. */
  let backend = null;
  try {
    backend = window.localStorage;
    backend.setItem(prefix + '__probe', '1'); // some browsers only throw on write
    backend.removeItem(prefix + '__probe');
  } catch (e) {
    backend = null;
  }

  /**
   * Read a raw string.
   * @param {string} key      key without prefix
   * @param {*}      fallback returned when the key is missing or storage fails
   */
  function get(key, fallback) {
    try {
      const v = backend ? backend.getItem(prefix + key) : memory[key];
      return v === null || v === undefined ? fallback : v;
    } catch (e) {
      return fallback;
    }
  }

  /**
   * Write a raw string. Returns true when it was written to real localStorage.
   * @param {string} key
   * @param {string} value
   */
  function set(key, value) {
    try {
      if (backend) {
        backend.setItem(prefix + key, String(value));
        return true;
      }
    } catch (e) {
      /* quota exceeded etc. – fall through to memory */
    }
    memory[key] = String(value);
    return false;
  }

  /** Delete a key. */
  function remove(key) {
    try {
      if (backend) backend.removeItem(prefix + key);
    } catch (e) {
      /* ignore */
    }
    delete memory[key];
  }

  /** Read and JSON-parse a value; corrupt data yields the fallback instead of throwing. */
  function getJSON(key, fallback) {
    const raw = get(key, null);
    if (raw === null) return fallback;
    try {
      return JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  /** JSON-stringify and store a value. */
  function setJSON(key, value) {
    return set(key, JSON.stringify(value));
  }

  OOP.store = { get, set, remove, getJSON, setJSON, persistent: !!backend };
})();
