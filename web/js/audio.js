/* audio.js — WebAudio SFX with headless hardening (no audio backend => NaN guards + try/catch) */
(function (global) {
  'use strict';

  var AC = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
  var ctx = null;
  var enabled = true;

  function ensureCtx() {
    if (!AC) return null;
    if (!ctx) {
      try { ctx = new AC(); } catch (e) { return null; }
    }
    if (ctx && ctx.state === 'suspended') { try { ctx.resume(); } catch (e) {} }
    return ctx;
  }

  // A short blip. All scheduling guarded: isFinite(t) + try/catch.
  function blip(freq, dur, type, gainVal) {
    if (!enabled) return;
    var c = ensureCtx();
    if (!c) return;
    try {
      var t = c.currentTime;
      if (typeof t !== 'number' || !isFinite(t)) return;
      var osc = c.createOscillator();
      var g = c.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, t);
      g.gain.setValueAtTime(gainVal || 0.08, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.08));
      osc.connect(g); g.connect(c.destination);
      osc.start(t);
      osc.stop(t + (dur || 0.08) + 0.02);
    } catch (e) { /* swallow: audio must never crash the game */ }
  }

  var GameAudio = {
    init: function () { try { ensureCtx(); } catch (e) {} },
    setEnabled: function (v) { enabled = !!v; },
    isEnabled: function () { return enabled; },
    hitWall: function () { blip(180, 0.05, 'square', 0.05); },
    hitPaddle: function () { blip(300, 0.06, 'triangle', 0.07); },
    brickBreak: function () { blip(520, 0.07, 'square', 0.08); },
    bossHit: function () { blip(140, 0.12, 'sawtooth', 0.09); },
    bossBreak: function () { blip(720, 0.18, 'sawtooth', 0.10); },
    levelClear: function () {
      blip(440, 0.12, 'triangle', 0.08);
      setTimeout(function () { blip(660, 0.16, 'triangle', 0.08); }, 110);
    },
    gameOver: function () {
      blip(220, 0.2, 'sawtooth', 0.09);
      setTimeout(function () { blip(150, 0.25, 'sawtooth', 0.09); }, 160);
    },
    launch: function () { blip(380, 0.08, 'sine', 0.07); }
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = GameAudio; }
  global.GameAudio = GameAudio;
})(typeof window !== 'undefined' ? window : globalThis);
