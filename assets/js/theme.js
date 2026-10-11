/**
 * theme.js — light / dark theme switching.
 *
 * The theme is a class on <html> (`html.dark`). An inline script in each page's <head> applies the
 * saved choice before first paint; this module keeps the toggle button and its label in sync and
 * stores the choice.
 *
 * Storage key: "oop-theme" = "dark" | "light" (same key as the original site, so existing
 * visitors keep their preference). With no saved choice we follow the OS setting.
 *
 * Public API: OOP.theme.toggle(), OOP.theme.sync()   (+ global toggleTheme() for backwards compatibility)
 */
(function () {
  'use strict';

  /** True when the dark class is currently applied. */
  function isDark() {
    return document.documentElement.classList.contains('dark');
  }

  /**
   * Update the toggle button (label text + aria-pressed) to match the current theme.
   * The label shows the theme you will SWITCH TO, exactly like the original site ("DARK" in light mode).
   */
  function sync() {
    const label = document.getElementById('themeLabel');
    const btn = document.getElementById('themeToggle');
    if (label) label.textContent = isDark() ? 'LIGHT' : 'DARK';
    if (btn) btn.setAttribute('aria-pressed', String(isDark()));
  }

  /** Flip the theme, persist the choice and refresh the button. */
  function toggle() {
    const dark = document.documentElement.classList.toggle('dark');
    OOP.store.set('theme', dark ? 'dark' : 'light');
    sync();
  }

  OOP.theme = { toggle, sync, isDark };

  // Kept as a global because the original site exposed toggleTheme().
  window.toggleTheme = toggle;
})();
