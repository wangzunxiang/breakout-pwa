/* levels.js — deterministic 999-level generator for Breakout 999
 * IIFE; exports to browser window.LevelGen AND node module.exports (for headless validation).
 * Pure functions only — no DOM, no globals mutated, fully seeded & reproducible.
 *
 * Cell codes: 0 empty, 1 destructible, 2 indestructible (wall), 3 boss core (2 hits).
 * Reachability: a destructible cell (1/3) must be reachable from the spawn space above
 * the brick field through non-wall (non-2) cells. Enforced in the generator via a
 * deterministic retry+relax loop, and re-checked by validate().
 */
(function (global) {
  'use strict';

  var MAX_LEVEL = 999;

  // --- deterministic PRNG (mulberry32) ---
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // --- difficulty curve (monotonic + bounded) ---
  function ballSpeed(n) { return Math.min(720, 280 + n * 0.35); }
  function paddleWidth(n) { return clamp(150 - Math.min(70, n * 0.09), 80, 150); }
  function ballCount(n) { return n <= 100 ? 1 : (n <= 400 ? 2 : 3); }
  function colsFor(n) { return 10 + Math.min(6, Math.floor(n / 166)); }   // 10..16
  function rowsFor(n) { return 5 + Math.min(4, Math.floor(n / 250)); }     // 5..9
  function indestructibleRatio(n) { return n <= 50 ? 0 : 0.25 * (1 - 50 / n); } // 0..0.25

  // --- archetype by band (n>90 may mix, always seeded) ---
  function archetypeId(n, rng) {
    if (n <= 15) return 1;          // GRID
    if (n <= 30) return 2;          // PYRAMID
    if (n <= 45) return 3;          // TUNNEL
    if (n <= 60) return 4;          // RINGS
    if (n <= 75) return 5;          // SLITS
    if (n <= 90) return 6;          // OBSTACLE
    if (n <= 150) return 7;         // MULTIBALL
    if (n <= 300) return 8;         // BOSS
    // 301..999 FRACTAL, but allow seeded mixing across the 9 patterns
    var r = rng();
    if (r < 0.55) return 9;         // FRACTAL
    var picks = [1, 2, 3, 4, 5, 6, 8];
    return picks[Math.floor(rng() * picks.length)];
  }

  function blank(cols, rows) {
    var g = [];
    for (var r = 0; r < rows; r++) { var row = []; for (var c = 0; c < cols; c++) row.push(0); g.push(row); }
    return g;
  }

  // Layout a base grid (1/0 only) for a given archetype. Deterministic from rng.
  function baseLayout(type, cols, rows, rng) {
    var g = blank(cols, rows);
    var mid = Math.floor(cols / 2);
    var r, c;
    switch (type) {
      case 1: // GRID — full fill with a 1-cell border margin
        for (r = 0; r < rows; r++) for (c = 1; c < cols - 1; c++) g[r][c] = 1;
        break;
      case 2: // PYRAMID — wider at bottom, narrow at top (apex top-center)
        for (r = 0; r < rows; r++) {
          var half = Math.floor((r + 1) / 2);
          var w = Math.min(cols - 2, 1 + 2 * half);
          var left = Math.max(1, mid - Math.floor(w / 2));
          for (c = left; c < left + w && c < cols - 1; c++) g[r][c] = 1;
        }
        break;
      case 3: // TUNNEL — leave a 2-wide vertical channel down the middle
        var chL = mid - 1, chR = mid + (cols % 2 ? 0 : 1);
        for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
          if (c >= chL && c <= chR) continue;
          if (c === 0 || c === cols - 1) continue;
          g[r][c] = 1;
        }
        break;
      case 4: // RINGS — concentric rings around center (alternating bands)
        for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
          var dr = r - (rows - 1) / 2, dc = c - (cols - 1) / 2;
          var dist = Math.round(Math.sqrt(dr * dr + dc * dc * 0.5));
          if (dist % 2 === 1 && dist > 0) g[r][c] = 1;
        }
        break;
      case 5: // SLITS — horizontal bricks with empty rows between (needle gaps)
        for (r = 0; r < rows; r += 2) for (c = 1; c < cols - 1; c++) g[r][c] = 1;
        break;
      case 6: // OBSTACLE — grid; type-2 scattered later by decorate()
        for (r = 0; r < rows; r++) for (c = 1; c < cols - 1; c++) g[r][c] = 1;
        break;
      case 7: // MULTIBALL — sparse open grid (room for multiple balls)
        for (r = 0; r < rows; r++) for (c = 1; c < cols - 1; c++) { if (rng() < 0.75) g[r][c] = 1; }
        break;
      case 8: // BOSS — central core (type-3) + surrounding destructible shell
        for (r = 0; r < rows; r++) for (c = 1; c < cols - 1; c++) g[r][c] = 1;
        var cr = Math.floor(rows / 2), cc = mid;
        g[cr][cc] = 3;
        if (cr > 0) g[cr - 1][cc] = 3;
        if (cc > 1) g[cr][cc - 1] = 3;
        if (cc < cols - 2) g[cr][cc + 1] = 3;
        break;
      case 9: // FRACTAL — composite: checkerboard + ring overlay (high density)
        for (r = 0; r < rows; r++) for (c = 1; c < cols - 1; c++) {
          if ((r + c) % 2 === 0) g[r][c] = 1;
          else if (rng() < 0.4) g[r][c] = 1;
        }
        var d2r = Math.floor(rows / 2), d2c = mid;
        for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
          var dd = Math.round(Math.abs(r - d2r) + Math.abs(c - d2c));
          if (dd === 2 || dd === 4) g[r][c] = 1;
        }
        break;
    }
    return g;
  }

  // Scatter indestructible bricks (type-2) into a 1/0 grid, respecting a max ratio and
  // the edge columns (keep the outermost columns clear so side walls bounce, not walls).
  function decorate(g, cols, rows, ratio, rng) {
    if (ratio <= 0) return g;
    var candidates = [];
    for (var r = 0; r < rows; r++) for (var c = 1; c < cols - 1; c++) {
      if (g[r][c] === 1) candidates.push([r, c]);
    }
    // count occupied (destructible) to cap ratio
    var target = Math.floor(candidates.length * Math.min(0.30, ratio));
    for (var i = candidates.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = candidates[i]; candidates[i] = candidates[j]; candidates[j] = tmp;
    }
    for (var k = 0; k < target; k++) {
      g[candidates[k][0]][candidates[k][1]] = 2;
    }
    return g;
  }

  // Flood-fill reachability. Walls = type 2. Start = every top row cell whose ABOVE is the
  // spawn space (so row 0 non-wall cells are seeds; we also seed a virtual row above row 0).
  // Returns set of reachable "r,c" keys. type 0/1/3 are traversable; type 2 is a wall.
  function reachableCells(g, cols, rows) {
    var visited = {};
    var queue = [];
    for (var c = 0; c < cols; c++) {
      if (g[0][c] !== 2) { visited['0,' + c] = 1; queue.push([0, c]); }
    }
    var dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    while (queue.length) {
      var cur = queue.pop();
      var r = cur[0], c = cur[1];
      for (var d = 0; d < 4; d++) {
        var nr = r + dirs[d][0], nc = c + dirs[d][1];
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
        if (g[nr][nc] === 2) continue;             // wall
        var key = nr + ',' + nc;
        if (visited[key]) continue;
        visited[key] = 1;
        queue.push([nr, nc]);
      }
    }
    return visited;
  }

  function isReachableAll(g, cols, rows) {
    var reach = reachableCells(g, cols, rows);
    for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++) {
      if ((g[r][c] === 1 || g[r][c] === 3) && !reach[r + ',' + c]) return false;
    }
    return true;
  }

  function destructibleCount(g) {
    var n = 0;
    for (var r = 0; r < g.length; r++) for (var c = 0; c < g[0].length; c++)
      if (g[r][c] === 1 || g[r][c] === 3) n++;
    return n;
  }

  // Build one level deterministically. Bounded retry with sub-seed; then relax walls so it
  // always terminates and is reachable.
  function levelFromSeed(n) {
    n = clamp(Math.floor(n), 1, MAX_LEVEL);
    var baseRng = mulberry32(n * 0x9E3779B1 + 0x1234567);
    var cols = colsFor(n), rows = rowsFor(n);
    var type = archetypeId(n, baseRng);
    var ratio = indestructibleRatio(n);
    var maxRetry = 12;
    var g = null;
    for (var attempt = 0; attempt <= maxRetry; attempt++) {
      var subSeed = n * 131071 + attempt * 2654435761;
      var rng = mulberry32(subSeed);
      var candidate = baseLayout(type, cols, rows, rng);
      if (destructibleCount(candidate) === 0) continue;
      decorate(candidate, cols, rows, ratio, rng);
      if (isReachableAll(candidate, cols, rows) && destructibleCount(candidate) > 0) {
        g = candidate;
        break;
      }
      // relax: relax all walls to empty and try once more deterministically
      if (attempt === maxRetry) {
        for (var r = 0; r < rows; r++) for (var c = 0; c < cols; c++)
          if (candidate[r][c] === 2) candidate[r][c] = 0;
        if (isReachableAll(candidate, cols, rows) && destructibleCount(candidate) > 0) { g = candidate; }
      }
    }
    if (!g) { // final deterministic fallback: a guaranteed-open grid
      g = baseLayout(1, cols, rows, mulberry32(n));
    }

    return {
      level: n,
      type: type,
      cols: cols,
      rows: rows,
      grid: g,
      ballSpeed: Math.round(ballSpeed(n)),
      paddleWidth: Math.round(paddleWidth(n)),
      ballCount: ballCount(n)
    };
  }

  // Validation. Returns { ok:bool, errors:[string] }.
  function validate(lv) {
    var errors = [];
    if (!lv || !lv.grid) { return { ok: false, errors: ['no grid'] }; }
    var rows = lv.grid.length, cols = lv.grid[0].length;
    if (rows < 3 || rows > 12 || cols < 6 || cols > 20)
      errors.push('dims out of range ' + cols + 'x' + rows);
    for (var r = 0; r < rows; r++) {
      if (lv.grid[r].length !== cols) { errors.push('ragged row ' + r); break; }
      for (var c = 0; c < cols; c++) {
        var v = lv.grid[r][c];
        if (v !== 0 && v !== 1 && v !== 2 && v !== 3) errors.push('bad cell value ' + v + ' at ' + r + ',' + c);
      }
    }
    if (!errors.length) {
      if (destructibleCount(lv.grid) === 0) errors.push('no destructible cells');
      // spawn space: topmost occupied row must be < rows (always true) — check there is at
      // least one empty cell in the top row so the ball can spawn above bricks.
      var topAllOccupied = true;
      for (var c2 = 0; c2 < cols; c2++) if (lv.grid[0][c2] === 0) { topAllOccupied = false; break; }
      if (topAllOccupied && rows > 1) errors.push('no spawn space in top row');
      if (typeof lv.ballSpeed === 'number' && (lv.ballSpeed < 200 || lv.ballSpeed > 760))
        errors.push('ballSpeed out of range ' + lv.ballSpeed);
      if (typeof lv.paddleWidth === 'number' && (lv.paddleWidth < 60 || lv.paddleWidth > 160))
        errors.push('paddleWidth out of range ' + lv.paddleWidth);
      if (typeof lv.ballCount === 'number' && (lv.ballCount < 1 || lv.ballCount > 3))
        errors.push('ballCount out of range ' + lv.ballCount);
      if (!isReachableAll(lv.grid, cols, rows))
        errors.push('unreachable destructible cell (flood-fill)');
    }
    return { ok: errors.length === 0, errors: errors };
  }

  var api = {
    MAX_LEVEL: MAX_LEVEL,
    mulberry32: mulberry32,
    levelFromSeed: levelFromSeed,
    validate: validate,
    ballSpeed: ballSpeed,
    paddleWidth: paddleWidth,
    ballCount: ballCount,
    _reachableCells: reachableCells,
    _isReachableAll: isReachableAll,
    _destructibleCount: destructibleCount
  };

  if (typeof module !== 'undefined' && module.exports) { module.exports = api; }
  if (global) { global.LevelGen = api; }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
