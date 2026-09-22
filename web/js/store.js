/* store.js — persistence. localStorage ONLY, every access try/catch (private mode must not crash). */
(function (global) {
  'use strict';

  var KEY_HS = 'breakout_highscore';
  var KEY_PROG = 'breakout_progress';

  var mem = { highScore: 0, maxLevel: 0 }; // in-memory fallback

  function ls() {
    try { return (typeof window !== 'undefined' && window.localStorage) || null; }
    catch (e) { return null; }
  }

  function readInt(key, def) {
    var s = ls();
    try {
      if (!s) return def;
      var v = s.getItem(key);
      if (v == null) return def;
      var n = parseInt(v, 10);
      return isFinite(n) ? n : def;
    } catch (e) { return def; }
  }
  function writeInt(key, val) {
    var s = ls();
    try { if (s) s.setItem(key, String(val)); } catch (e) { /* silent */ }
  }

  var GameStore = {
    getHighScore: function () {
      var v = readInt(KEY_HS, 0);
      mem.highScore = v;
      return v;
    },
    setHighScore: function (v) {
      v = Math.max(0, parseInt(v, 10) || 0);
      mem.highScore = v;
      writeInt(KEY_HS, v);
      return v;
    },
    getProgress: function () {
      return { maxLevel: readInt(KEY_PROG, 0) };
    },
    setProgress: function (n) {
      n = Math.max(0, parseInt(n, 10) || 0);
      mem.maxLevel = n;
      writeInt(KEY_PROG, n);
      return n;
    }
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = GameStore; }
  global.GameStore = GameStore;
})(typeof window !== 'undefined' ? window : globalThis);
