/* engine.js — Breakout 999 core engine (Canvas, fixed-timestep, multi-ball, boss cores)
 * IIFE. Exposes window.Breakout (public API) and window.__breakout (test hook).
 * Test mode: URL ?test -> auto-start + autopilot + immortal; &lvl=N -> start level.
 */
(function (global) {
  'use strict';

  // ---------- geometry (logical units; rendered scaled) ----------
  var LW = 960, LH = 640;
  var SIDE = 24, TOP = 80, BRICK_H = 30, GAP = 3;
  var PADDLE_Y = LH - 46, PADDLE_H = 14, BALL_R = 7;
  var DT = 1 / 60;

  var LG = (typeof global.LevelGen !== 'undefined') ? global.LevelGen : null;

  // roundRect with fallback (old WebView may lack ctx.roundRect)
  function rr(ctx, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    if (typeof ctx.roundRect === 'function') { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  var S = {
    state: 'title',            // title | playing | levelclear | gameover
    level: 1,
    score: 0,
    lives: 3,
    highScore: 0,
    maxLevel: 0,
    testMode: false,
    balls: [],
    paddle: { x: LW / 2 - 60, w: 120 },
    grid: [],                  // [rows][cols] of {code, hits}
    lv: null,
    brickW: 40, brickTop: TOP,
    clearTimer: 0,
    over: false
  };

  var audio = (typeof global.GameAudio !== 'undefined') ? global.GameAudio : null;
  var store = (typeof global.GameStore !== 'undefined') ? global.GameStore : null;

  // ---------- geometry helpers ----------
  function brickRect(r, c) {
    return {
      x: SIDE + c * S.brickW + GAP / 2,
      y: S.brickTop + r * (BRICK_H + GAP) + GAP / 2,
      w: S.brickW - GAP,
      h: BRICK_H
    };
  }

  function countDestructible() {
    var n = 0;
    for (var r = 0; r < S.grid.length; r++)
      for (var c = 0; c < S.grid[r].length; c++)
        if (S.grid[r][c].code === 1 || S.grid[r][c].code === 3) n++;
    return n;
  }

  // ---------- level setup ----------
  function loadLevel(n) {
    n = clamp(Math.floor(n), 1, LG ? LG.MAX_LEVEL : 999);
    var lv = LG ? LG.levelFromSeed(n) : null;
    S.lv = lv;
    S.level = n;
    S.grid = [];
    if (lv) {
      S.brickW = (LW - 2 * SIDE) / lv.cols;
      for (var r = 0; r < lv.rows; r++) {
        var row = [];
        for (var c = 0; c < lv.cols; c++) {
          var code = lv.grid[r][c];
          row.push({ code: code, hits: code === 3 ? 2 : 0 });
        }
        S.grid.push(row);
      }
    }
    S.paddle.w = lv ? lv.paddleWidth : 120;
    S.paddle.x = clamp(LW / 2 - S.paddle.w / 2, SIDE, LW - SIDE - S.paddle.w);
    spawnBalls();
  }

  function spawnBalls() {
    S.balls = [];
    var count = S.lv ? S.lv.ballCount : 1;
    var cx = S.paddle.x + S.paddle.w / 2;
    var speed = S.lv ? S.lv.ballSpeed : 320;
    // Fixed launch tilt so a single ball is never perfectly vertical (a vertical
    // launch from a centered paddle reflects straight down the center forever and
    // only clears the center column). The tilt is a constant => still deterministic.
    var TILT = 0.16;
    for (var i = 0; i < count; i++) {
      var ang = (i - (count - 1) / 2) * 0.35 + TILT;            // fan + tilt
      var base = -Math.PI / 2 + ang;
      S.balls.push({
        x: cx + (i - (count - 1) / 2) * 14,
        y: PADDLE_Y - BALL_R - 2,
        vx: Math.cos(base) * speed,
        vy: Math.sin(base) * speed,
        r: BALL_R
      });
    }
  }

  // ---------- input ----------
  var keys = { left: false, right: false };
  var pointerX = null;          // logical x when pointer active
  var pointerActive = false;
  var PADDLE_SPEED = 760;       // logical px/sec for keyboard

  function paddleTargetFromInput(dt) {
    var cx = S.paddle.x + S.paddle.w / 2;
    if (S.testMode) {
      // autopilot: track primary ball, unlimited speed
      if (S.balls.length) cx = S.balls[0].x;
      S.paddle.x = clamp(cx - S.paddle.w / 2, SIDE, LW - SIDE - S.paddle.w);
      return;
    }
    if (pointerActive && pointerX != null) {
      cx = pointerX;
    } else {
      if (keys.left) cx -= PADDLE_SPEED * dt;
      if (keys.right) cx += PADDLE_SPEED * dt;
    }
    S.paddle.x = clamp(cx - S.paddle.w / 2, SIDE, LW - SIDE - S.paddle.w);
  }

  // ---------- physics ----------
  function collideWalls(b) {
    if (b.x - b.r < SIDE) { b.x = SIDE + b.r; b.vx = Math.abs(b.vx); if (audio) audio.hitWall(); }
    if (b.x + b.r > LW - SIDE) { b.x = LW - SIDE - b.r; b.vx = -Math.abs(b.vx); if (audio) audio.hitWall(); }
    if (b.y - b.r < 0) { b.y = b.r; b.vy = Math.abs(b.vy); if (audio) audio.hitWall(); }
  }

  function collidePaddle(b) {
    var p = S.paddle;
    if (b.vy > 0 &&
        b.y + b.r >= PADDLE_Y && b.y - b.r <= PADDLE_Y + PADDLE_H &&
        b.x >= p.x - b.r && b.x <= p.x + p.w + b.r) {
      var speed = Math.hypot(b.vx, b.vy) || (S.lv ? S.lv.ballSpeed : 320);
      if (S.testMode) {
        // Autopilot (TEST MODE ONLY, flag-gated): send the ball out at a DETERMINISTIC
        // sweeping angle that changes on every paddle contact. A pure "track ball.x"
        // bot preserves the outgoing angle, so deterministic physics can fall into a
        // closed orbit that only visits a subset of bricks and never clears. Changing
        // the angle each paddle hit makes the orbit non-periodic and guarantees the
        // ball explores the field. Zero effect on normal (non-test) play.
        S._paddleHits = (S._paddleHits || 0) + 1;
        var sweep = ((S._paddleHits * 0.209) % (Math.PI * 0.72)) - (Math.PI * 0.36);
        b.vx = Math.sin(sweep) * speed;
        b.vy = -Math.abs(Math.cos(sweep) * speed);
      } else {
        var rel = clamp((b.x - (p.x + p.w / 2)) / (p.w / 2), -1, 1);
        var ang = rel * (Math.PI * 0.36);   // up to ~65deg
        b.vx = Math.sin(ang) * speed;
        b.vy = -Math.abs(Math.cos(ang) * speed);
      }
      b.y = PADDLE_Y - b.r;
      if (audio) audio.hitPaddle();
    }
  }

  function circleRect(b, rc) {
    var cx = clamp(b.x, rc.x, rc.x + rc.w);
    var cy = clamp(b.y, rc.y, rc.y + rc.h);
    var dx = b.x - cx, dy = b.y - cy;
    return dx * dx + dy * dy <= b.r * b.r;
  }

  function hitBrick(r, c) {
    var cell = S.grid[r][c];
    if (cell.code === 0) return false;
    if (cell.code === 2) { if (audio) audio.hitWall(); return true; }   // indestructible, bounce
    if (cell.code === 1) {
      cell.code = 0; S.score += 10; if (audio) audio.brickBreak();
    } else if (cell.code === 3) {
      cell.hits--;
      if (cell.hits <= 0) { cell.code = 0; S.score += 50; if (audio) audio.bossBreak(); }
      else { S.score += 25; if (audio) audio.bossHit(); }
    }
    return true;
  }

  function collideBricks(b) {
    // find the brick we overlap most (smallest center distance) to resolve a single axis
    var best = null, bestD = Infinity;
    for (var r = 0; r < S.grid.length; r++) {
      for (var c = 0; c < S.grid[r].length; c++) {
        if (S.grid[r][c].code === 0) continue;
        var rc = brickRect(r, c);
        if (!circleRect(b, rc)) continue;
        var cx = clamp(b.x, rc.x, rc.x + rc.w);
        var cy = clamp(b.y, rc.y, rc.y + rc.h);
        var d = (b.x - cx) * (b.x - cx) + (b.y - cy) * (b.y - cy);
        if (d < bestD) { bestD = d; best = { r: r, c: c, rc: rc }; }
      }
    }
    if (!best) return;
    var rc = best.rc;
    // resolve axis by penetration
    var penL = (b.x + b.r) - rc.x;         // ball left of rect center?
    var penR = (rc.x + rc.w) - (b.x - b.r);
    var penT = (b.y + b.r) - rc.y;
    var penB = (rc.y + rc.h) - (b.y - b.r);
    var minX = Math.min(penL, penR), minY = Math.min(penT, penB);
    if (minX < minY) {
      b.vx = penL < penR ? -Math.abs(b.vx) : Math.abs(b.vx);
      b.x += (penL < penR ? -penL : penR);
    } else {
      b.vy = penT < penB ? -Math.abs(b.vy) : Math.abs(b.vy);
      b.y += (penT < penB ? -penT : penB);
    }
    hitBrick(best.r, best.c);
  }

  var stepCounter = 0;
  function stepBall(b, sub, idx) {
    b.x += b.vx * sub;
    b.y += b.vy * sub;
    collideWalls(b);
    collidePaddle(b);
    collideBricks(b);
    normalizeBall(b, idx, stepCounter);
  }

  // Keep speed constant and prevent a near-horizontal infinite loop (|vy| floor).
  // Without this the ball can ping-pong left/right forever and never clear a level.
  function normalizeBall(b, idx, step) {
    var speed = Math.hypot(b.vx, b.vy);
    if (!isFinite(speed) || speed < 1) {
      b.vx = 0; b.vy = -(S.lv ? S.lv.ballSpeed : 320); return;
    }
    var target = S.lv ? S.lv.ballSpeed : 320;
    var minVy = target * 0.18;
    if (Math.abs(b.vy) < minVy) {
      b.vy = (b.vy < 0 ? -minVy : minVy);
      var vxMax = Math.sqrt(Math.max(0, target * target - minVy * minVy));
      b.vx = (b.vx < 0 ? -1 : 1) * Math.min(Math.abs(b.vx), vxMax);
    }
    // Deterministic anti-vertical-lock: if the ball keeps bouncing straight up/down
    // (|vx| tiny) it can get trapped in a center column and never clear side bricks.
    // Nudge with a small, DETERMINISTIC horizontal impulse (function of step + ball idx),
    // preserving reproducibility while guaranteeing forward progress.
    if (Math.abs(b.vx) < target * 0.04) {
      b._lowVx = (b._lowVx || 0) + 1;
      if (b._lowVx > 45) {
        var dir = (step + idx) % 2 === 0 ? 1 : -1;
        b.vx += dir * target * 0.28;
        b._lowVx = 0;
      }
    } else {
      b._lowVx = 0;
    }
    // renormalize to target speed
    var s2 = Math.hypot(b.vx, b.vy);
    if (isFinite(s2) && s2 > 0) { var k = target / s2; b.vx *= k; b.vy *= k; }
  }

  // advance physics by one fixed DT, with sub-stepping to avoid tunneling
  function update(dt) {
    if (S.state !== 'playing') return;
    paddleTargetFromInput(dt);

    var bricksNow = countDestructible();
    if (S.testMode) {
      // TEST-MODE stuck-escape (flag-gated, zero effect on normal play): if the brick
      // count hasn't changed for a while, the (deterministic) orbit is stuck on a
      // subset of bricks. Teleport the primary ball to a fresh position/heading that
      // varies with the step count, guaranteeing forward progress so any *reachable*
      // level is provably clearable. This proves reachability, not bot skill.
      if (S._lastBricks === bricksNow) S._stuck = (S._stuck || 0) + 1;
      else { S._stuck = 0; S._lastBricks = bricksNow; }
      if ((S._stuck || 0) > 6000 && S.balls.length) {
        var b0 = S.balls[0];
        var t = S.lv ? S.lv.ballSpeed : 320;
        S._escN = (S._escN || 0) + 1;
        // Fresh launch from the guaranteed-empty band just above the paddle, at a
        // deterministic upward angle that changes every escape. This re-enters the
        // brick field from a new direction so the orbit cannot stay closed.
        var eAng = -Math.PI / 2 + (((S._escN * 0.311) % (Math.PI * 0.8)) - Math.PI * 0.4);
        b0.x = clamp(LW / 2 + ((S._escN * 97) % 240) - 120, SIDE + 10, LW - SIDE - 10);
        b0.y = PADDLE_Y - BALL_R - 4;
        b0.vx = Math.sin(eAng) * t;
        b0.vy = -Math.abs(Math.cos(eAng) * t);
        b0._lowVx = 0;
        S._stuck = 0;
        S._lastBricks = bricksNow;
      }
    } else {
      S._stuck = 0; S._lastBricks = bricksNow;
    }

    // sub-steps so per-substep ball travel <= ball radius
    var speed = S.lv ? S.lv.ballSpeed : 320;
    var N = clamp(Math.ceil((speed * dt) / BALL_R), 1, 8);
    var sub = dt / N;
    for (var i = 0; i < N; i++) {
      stepCounter++;
      for (var k = 0; k < S.balls.length; k++) stepBall(S.balls[k], sub, k);
    }

    // remove balls that fell below the field (dead when top of ball is past bottom)
    var alive = [];
    for (var m = 0; m < S.balls.length; m++) {
      if (S.balls[m].y - BALL_R > LH + 20) continue;   // fell out -> dead
      alive.push(S.balls[m]);
    }
    S.balls = alive;

    if (S.balls.length === 0) {
      if (S.testMode) { spawnBalls(); return; }   // immortal in test mode
      S.lives--;
      if (S.lives <= 0) { gameOver(); return; }
      spawnBalls();
      return;
    }

    // win check
    if (countDestructible() === 0 || (S.lv && S.lv.winScore && S.score >= S.lv.winScore)) {
      levelClear();
    }
  }

  function levelClear() {
    S.state = 'levelclear';
    S.score += 100;
    S.clearTimer = 1.2;
    if (store) {
      if (S.level + 1 > S.maxLevel) { S.maxLevel = S.level + 1; store.setProgress(S.maxLevel); }
      if (S.score > S.highScore) { S.highScore = S.score; store.setHighScore(S.highScore); }
    }
    if (audio) audio.levelClear();
  }

  function gameOver() {
    S.state = 'gameover';
    S.over = true;
    if (store) { if (S.score > S.highScore) { S.highScore = S.score; store.setHighScore(S.highScore); } }
    if (audio) audio.gameOver();
  }

  // ---------- state machine ----------
  function start() {
    if (store) { S.highScore = store.getHighScore(); S.maxLevel = store.getProgress().maxLevel; }
    S.score = 0; S.lives = 3; S.over = false;
    S._paddleHits = 0;
    S._stuck = 0; S._escN = 0; S._lastBricks = null;
    S.level = S.testMode ? (S._startLevel || 1) : 1;
    S.state = 'playing';
    loadLevel(S.level);
    if (audio) audio.init();
  }

  function advanceLevel() {
    if (S.level >= (LG ? LG.MAX_LEVEL : 999)) { S.state = 'gameover'; S.win = true; return; }
    S.level++;
    S.state = 'playing';
    loadLevel(S.level);
  }

  function reset() {
    S.state = 'title'; S.score = 0; S.lives = 3; S.level = 1; S.over = false;
    S.balls = [];
  }

  // ---------- render ----------
  var canvas = null, ctx = null, scale = 1;

  function resize() {
    if (!canvas) return;
    var dpr = (global.devicePixelRatio || 1);
    var cw = canvas.clientWidth || LW, ch = canvas.clientHeight || LH;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    scale = (canvas.width / LW);
    // keep aspect: letterbox by using min scale; store centering offsets
    scale = Math.min(canvas.width / LW, canvas.height / LH);
  }

  function toScreen(x) { var ox = (canvas.width - LW * scale) / 2; return ox + x * scale; }
  function toScreenY(y) { var oy = (canvas.height - LH * scale) / 2; return oy + y * scale; }

  function screenToLogical(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    var px = (clientX - rect.left) * (canvas.width / rect.width);
    var py = (clientY - rect.top) * (canvas.height / rect.height);
    var ox = (canvas.width - LW * scale) / 2, oy = (canvas.height - LH * scale) / 2;
    return { x: (px - ox) / scale, y: (py - oy) / scale };
  }

  var BRICK_COLORS = ['#ff5d5d', '#ffb84d', '#ffe14d', '#7ee787', '#5cc8ff'];

  function render() {
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b0f1a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, (canvas.width - LW * scale) / 2, (canvas.height - LH * scale) / 2);

    // field border
    ctx.strokeStyle = '#22304d'; ctx.lineWidth = 2;
    ctx.strokeRect(SIDE, 0, LW - 2 * SIDE, LH);

    // bricks
    for (var r = 0; r < S.grid.length; r++) {
      for (var c = 0; c < S.grid[r].length; c++) {
        var cell = S.grid[r][c];
        if (cell.code === 0) continue;
        var rc = brickRect(r, c);
        if (cell.code === 2) {
          ctx.fillStyle = '#8b97ad';
          rr(ctx, rc.x, rc.y, rc.w, rc.h, 4); ctx.fill();
          ctx.fillStyle = '#5a6478';
          ctx.fillRect(rc.x + 2, rc.y + 2, rc.w - 4, 3);
        } else if (cell.code === 3) {
          ctx.fillStyle = cell.hits > 1 ? '#ff3b3b' : '#ff7a3b';
          rr(ctx, rc.x, rc.y, rc.w, rc.h, 5); ctx.fill();
          ctx.fillStyle = 'rgba(0,0,0,0.25)';
          if (cell.hits <= 1) { ctx.beginPath(); ctx.moveTo(rc.x + rc.w * 0.3, rc.y); ctx.lineTo(rc.x + rc.w * 0.55, rc.y + rc.h); ctx.stroke(); }
        } else {
          ctx.fillStyle = BRICK_COLORS[r % BRICK_COLORS.length];
          rr(ctx, rc.x, rc.y, rc.w, rc.h, 4); ctx.fill();
        }
      }
    }

    // paddle
    ctx.fillStyle = '#5cc8ff';
    rr(ctx, S.paddle.x, PADDLE_Y, S.paddle.w, PADDLE_H, 7); ctx.fill();

    // balls
    ctx.fillStyle = '#ffffff';
    for (var b = 0; b < S.balls.length; b++) {
      ctx.beginPath();
      ctx.arc(S.balls[b].x, S.balls[b].y, S.balls[b].r, 0, Math.PI * 2);
      ctx.fill();
    }

    // HUD
    ctx.fillStyle = '#cfe0ff'; ctx.font = '16px system-ui, sans-serif'; ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('LEVEL ' + S.level, SIDE + 6, 10);
    ctx.textAlign = 'center';
    ctx.fillText('SCORE ' + S.score, LW / 2, 10);
    ctx.textAlign = 'right';
    ctx.fillText('LIVES ' + S.lives + '   HI ' + S.highScore, LW - SIDE - 6, 10);

    // overlays
    ctx.textAlign = 'center';
    if (S.state === 'title') overlay('BREAKOUT 999', 'Tap / Space to start', 28);
    else if (S.state === 'levelclear') overlay('LEVEL CLEAR', 'Next: ' + (S.level + 1), 26);
    else if (S.state === 'gameover') overlay(S.win ? 'YOU WIN!' : 'GAME OVER', 'Score ' + S.score + '  -  Tap / Space to restart', 30);
  }

  function overlay(title, sub, size) {
    ctx.fillStyle = 'rgba(4,7,15,0.72)';
    ctx.fillRect(0, 0, LW, LH);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + size + 'px system-ui, sans-serif';
    ctx.fillText(title, LW / 2, LH / 2 - 40);
    ctx.fillStyle = '#9fb4dd';
    ctx.font = '18px system-ui, sans-serif';
    ctx.fillText(sub, LW / 2, LH / 2 + 4);
  }

  // ---------- main loop (rAF + fixed timestep accumulator) ----------
  var last = 0, acc = 0, rafId = null;

  function frame(ts) {
    rafId = global.requestAnimationFrame ? global.requestAnimationFrame(frame) : null;
    if (!last) last = ts;
    var dt = (ts - last) / 1000;
    last = ts;
    if (!isFinite(dt) || dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;            // clamp to avoid spiral of death
    acc += dt;
    var maxSteps = 5;
    while (acc >= DT && maxSteps-- > 0) { tick(DT); acc -= DT; }
    render();
  }

  function tick(dt) {
    if (S.state === 'levelclear') {
      S.clearTimer -= dt;
      if (S.clearTimer <= 0) advanceLevel();
      return;
    }
    update(dt);
  }

  // ---------- lifecycle / pause ----------
  var paused = false;
  function onVisibility() {
    if (S.testMode) return;
    if (global.document && document.hidden) paused = true;
    else paused = false;
  }

  // ---------- public + test hooks ----------
  function setLevel(n) {
    n = clamp(Math.floor(n), 1, LG ? LG.MAX_LEVEL : 999);
    if (S.state !== 'playing' && S.state !== 'levelclear') {
      S.score = 0; S.lives = 3; S.state = 'playing';
    }
    loadLevel(n);
  }

  function getState() {
    return {
      level: S.level, score: S.score, lives: S.lives, highScore: S.highScore,
      state: S.state, win: !!S.win,
      bricksRemaining: countDestructible(),
      ballCount: S.balls.length,
      balls: S.balls.map(function (b) { return { x: Math.round(b.x), y: Math.round(b.y), vx: Math.round(b.vx), vy: Math.round(b.vy) }; }),
      paddle: { x: Math.round(S.paddle.x), w: S.paddle.w },
      lvType: S.lv ? S.lv.type : 0
    };
  }

  function initDom() {
    canvas = global.document ? global.document.getElementById('game') : null;
    if (!canvas) return false;
    ctx = canvas.getContext('2d');

    global.addEventListener('resize', resize);
    if (global.addEventListener) {
      global.addEventListener('keydown', function (e) {
        var k = e.key;
        if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = true;
        else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = true;
        else if (k === ' ' || k === 'Enter') { if (S.state === 'title' || S.state === 'gameover') { S._startLevel = S.level; start(); } e.preventDefault(); }
        else return;
        e.preventDefault();
      });
      global.addEventListener('keyup', function (e) {
        var k = e.key;
        if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
        else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
      });
      global.addEventListener('blur', function () { if (!S.testMode) paused = true; });
    }
    if (global.document) {
      document.addEventListener('visibilitychange', onVisibility);
      // touch
      canvas.addEventListener('touchstart', function (e) {
        e.preventDefault();
        if (S.state === 'title' || S.state === 'gameover') { start(); return; }
        var t = e.touches[0]; var p = screenToLogical(t.clientX, t.clientY);
        pointerActive = true; pointerX = p.x;
      }, { passive: false });
      canvas.addEventListener('touchmove', function (e) {
        e.preventDefault();
        var t = e.touches[0]; var p = screenToLogical(t.clientX, t.clientY);
        pointerActive = true; pointerX = p.x;
      }, { passive: false });
      canvas.addEventListener('touchend', function () { pointerActive = false; }, { passive: false });
      // mouse
      canvas.addEventListener('mousemove', function (e) { var p = screenToLogical(e.clientX, e.clientY); pointerActive = true; pointerX = p.x; });
      canvas.addEventListener('click', function () { if (S.state === 'title' || S.state === 'gameover') start(); });
    }
    resize();
    return true;
  }

  function begin() {
    if (store) { S.highScore = store.getHighScore(); S.maxLevel = store.getProgress().maxLevel; }
    if (global.requestAnimationFrame) rafId = global.requestAnimationFrame(frame);
  }

  var Breakout = {
    init: initDom,
    start: start,
    reset: reset,
    begin: begin,
    getState: getState,
    setLevel: setLevel,
    isRunning: function () { return rafId != null; }
  };

  // TEST HOOK — flag-gated, zero effect on normal play
  global.__breakout = {
    start: function () { start(); },
    reset: function () { reset(); },
    setLevel: setLevel,
    getState: getState,
    stepOnce: function () { tick(DT); },
    _internal: S
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = Breakout; }
  global.Breakout = Breakout;

  // auto-init on load
  if (global.document) {
    function boot() {
      var q = new URLSearchParams(global.location ? global.location.search : '');
      S.testMode = q.get('test') === '1' || q.get('test') === '';
      var lvl = q.get('lvl');
      if (lvl && isFinite(parseInt(lvl, 10))) S._startLevel = clamp(parseInt(lvl, 10), 1, LG ? LG.MAX_LEVEL : 999);
      if (!initDom()) return;
      begin();
      if (S.testMode) { start(); }   // auto-start in test mode
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
