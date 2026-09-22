/* pwa.js — service worker registration (guarded; no-op on file:// or unsupported).
 * Kept in its own file so the strict CSP (default-src 'self') allows it. */
(function () {
  'use strict';
  try {
    if ('serviceWorker' in navigator && location.protocol !== 'file:') {
      navigator.serviceWorker.register('sw.js?v=1').catch(function () {});
    }
  } catch (e) { /* private mode / file:// — ignore */ }
})();
