# TASK — Build the PWA Breakout core (vanilla JS + Canvas, ZERO third-party deps)

You are implementing U1 of a Breakout (打砖块) game. Work ONLY inside:
  /mnt/e/codex/breakout/web/
Do NOT touch any file outside that directory. No build step, no bundler, no npm,
no external CDN, no framework. Pure HTML/CSS/JS, loadable by file:// and by an
Android WebView (old Chromium). The same PWA is also wrapped into a zero-permission
Android APK, so compatibility with old Android WebView matters.

## Deliverable file tree (create exactly these)
web/index.html
web/css/style.css
web/js/levels.js     (IIFE -> window.LevelGen)
web/js/audio.js      (IIFE -> window.GameAudio)
web/js/store.js      (IIFE -> window.GameStore)
web/js/engine.js     (IIFE -> window.Breakout + window.__breakout test hook)
web/manifest.json
web/icons/icon.svg   (simple SVG paddle/brick logo; favicon too)
web/sw.js            (tiny service worker: cache app shell, versioned cache name "breakout-pwa-v1")

## Game rules
- Canvas play area, responsive (fit to viewport, cap logical size). Landscape ok.
- Ball: position + velocity; bounces off left/right/top walls. Bottom = ball lost.
- Paddle: at bottom. Move by touch (drag finger) and by keyboard (Left/Right, A/D,
  ArrowLeft/ArrowRight) and mouse (move). Reflect angle depends on where the ball hits
  the paddle (center = straight up, edges = angled), standard Breakout feel.
- Bricks: grid of cells. Types:
    0 = empty, 1 = destructible brick, 2 = indestructible brick (does not break, ball bounces),
    3 = boss core (destructible but takes 2 hits — store hits).
- Level cleared when all destructible cells (1 and 3) are gone. Then auto-advance level+1
  after a short "LEVEL CLEAR" pause.
- Lives: start 3. Losing all balls (life) decrements lives; 0 lives => Game Over.
- Score: +10 per destructible brick, +25 per boss-core hit, +50 per boss core destroyed,
  +100 bonus per level cleared.
- Screens: TITLE (tap/click/space to start), PLAYING, LEVEL_CLEAR (auto), GAME_OVER (score + restart button).
- HUD: Level, Score, Lives, HighScore.

## Level generator (the heart of the task) — js/levels.js
Expose window.LevelGen with:
- MAX_LEVEL = 999
- mulberry32(seed) -> () => float in [0,1)   (deterministic PRNG, pure, stateless-per-seed)
- levelFromSeed(n) -> a plain object {
      level: n, type: <archetype id 1..9>, cols, rows,
      grid: array[rows] of array[cols] of {0|1|2|3},
      ballSpeed: number,   // px/sec, monotonically non-decreasing in n, capped
      paddleWidth: number, // px, monotonically non-increasing in n, floored
      ballCount: number,   // 1..3, monotonically non-decreasing in n
      winScore: number     // optional target; if set, reaching it also clears level
    }
  levelFromSeed(n) MUST be deterministic: same n always same level. Clamp n to 1..999.
- validate(lv) -> { ok: bool, errors: [string] }   (see assertions below)

### 9 archetypes (assign by level band; for n>90 mix freely, always seeded)
  1 GRID      plain filled grid
  2 PYRAMID   triangular (fewer cells per row going up)
  3 TUNNEL    vertical gap/channel down the middle
  4 RINGS     concentric target / ring pattern
  5 SLITS     narrow gaps between brick rows
  6 OBSTACLE  includes indestructible bricks (type 2) mixed in
  7 MULTIBALL starts with >1 ball (ballCount 2-3)
  8 BOSS      a central type-3 core surrounded by destructible shells
  9 FRACTAL   composite (combine 2 patterns + higher density, endgame)
Band assignment (a starting point, you may refine but keep deterministic):
  1-15 GRID, 16-30 PYRAMID, 31-45 TUNNEL, 46-60 RINGS,
  61-75 SLITS, 76-90 OBSTACLE, 91-150 MULTIBALL,
  151-300 BOSS, 301-999 FRACTAL  (with 76+ bands allowed to mix archetypes by seed).

### Difficulty curve (parameterize; must be monotonic & bounded)
- ballSpeed(n):   280 + n*0.35, capped at ~720
- paddleWidth(n): 150 - min(70, n*0.09)  (so ~150 early -> ~80 late, floor ~80, cap by field width)
- ballCount(n):   1 for n<=100, 2 for 101-400, 3 for n>400
- indestructible ratio (only in OBSTACLE/FRACTAL/BOSS bands): 0 for n<=50, then
  rise to ~0.25 by n=999, NEVER create a fully sealed column/row that blocks all
  destructible cells (see validate).
- Keep playable field: cols in 10..16, rows in 5..9 (scale with n within these bounds).

### Hard boundaries enforced in the GENERATOR (not the tests):
- Every destructible cell must be reachable: no row and no column of the *occupied*
  region may be a complete wall of type-2 that encloses destructible cells. Practical
  rule: after layout, run a flood-fill from the ball spawn point (top center of play
  area, above bricks) treating type-2 as walls; every cell with 1 or 3 must be in the
  reachable flood region. If not, regenerate that level's layout with a new sub-seed
  (deterministic: sub-seed = mulberry32-derived from n + retry counter) — bounded retries,
  then relax (drop the offending type-2) so it always terminates.
- Ball spawn: top center, must be empty (above all bricks).
- At least 1 destructible cell per level.
- Indestructible bricks never more than ~30% of occupied cells.

## validate(lv) assertions (run for EVERY level 1..999)
- grid is rectangular, rows x cols, all values in {0,1,2,3}
- at least one cell is 1 or 3
- topmost occupied row < rows (spawn space above bricks)
- ballSpeed, paddleWidth, ballCount within the bounded ranges above
- flood-fill reachability: every 1/3 cell reachable from spawn through non-type-2 cells
Return ok=false with a descriptive error string for the first failures.

## Audio — js/audio.js (window.GameAudio)
- WebAudio. Methods: init() (on first user gesture), hitWall(), hitPaddle(),
  brickBreak(), bossHit(), levelClear(), gameOver(), startBgm()/stopBgm() optional.
- HARDENING (headless has no audio backend; currentTime can be NaN): guard every
  oscillator schedule with if(!isFinite(t)) return; and wrap each method body in
  try/catch that swallows errors. Never let audio throw into the game loop.

## Store — js/store.js (window.GameStore)
- localStorage only. getHighScore(), setHighScore(v), getProgress() {maxLevel}, setProgress(n).
- EVERY access wrapped in try/catch (private mode / blocked storage must not crash).
- On any storage error, fall back to in-memory defaults silently.

## Test hook (critical for my acceptance) — end of engine.js
window.__breakout = {
  start(),               // start game at current level
  setLevel(n),           // load level n (clamped 1..999), deterministic
  getState(),            // { level, score, lives, balls:[{x,y,vx,vy}], bricksRemaining,
                         //   state: 'title'|'playing'|'levelclear'|'gameover', paddle:{x,w} }
  stepOnce(),            // advance physics by one fixed dt (1/60s) for deterministic tests
  reset()                // back to TITLE
}
URL flags:
  ?test      -> TEST MODE: auto-start on load; autopilot moves the paddle to track
                the ball (in test mode the paddle may move at unlimited speed, set paddle.x
                to track ball.x each step); losing a ball in test mode does NOT decrement
                lives (effectively immortal) — so autopilot can clear any reachable level.
                This proves level reachability.
  &lvl=N     -> start at level N.
TEST MODE must be flag-gated and have ZERO effect on normal play (no flag = normal game).
Do NOT leave console noise in normal mode.

## Technology hardening checklist (from hard-won experience — all REQUIRED)
1. node --check must pass on EVERY .js file. After you finish, run it yourself on each
   file and fix any error. Report the results.
2. NO external URLs, NO eval, NO new Function, NO innerHTML, NO dynamically loaded code.
   All UI text via textContent. All icons/buttons as inline SVG (NO emoji / unicode
   symbols like ◀▶⏸⟳ — old WebView renders them as tofu boxes).
3. Wrap ctx.roundRect: if (typeof c.roundRect==='function') c.roundRect(...) else c.rect(...)
   Provide a helper rr(ctx,x,y,w,h,r) used everywhere you round.
4. <meta http-equiv="Content-Security-Policy" content="default-src 'self'; object-src 'none'">
   in index.html. No external requests at all.
5. Persistence ONLY via localStorage, ALL try/catch.
6. requestAnimationFrame main loop with a fixed-timestep accumulator (dt clamped to avoid
   spiral of death). Pause on document.visibilitychange hidden (and on window blur) — but
   in ?test mode keep stepping (headless background tabs throttle rAF, so the test path
   must be drivable via stepOnce() regardless of rAF).
7. Touch: preventDefault on touchmove in the play area to stop page scroll; canvas
   touch-action: none.
8. Version-stamp every script tag with ?v=1 so I can bump and bust caches.
9. manifest.json: name "Breakout 999", start_url ".", display "fullscreen",
   background_color + theme_color, icons -> icons/icon.svg (sizes "any", type image/svg+xml)
   plus a 192 and 512 entry (you may point both to icon.svg for now; I will add PNGs later).
10. Keep the whole app small and readable. No dead code, no TODOs left.

## SELF-CHECK you MUST run before finishing (and paste results in your reply)
- node --check on js/levels.js, js/audio.js, js/store.js, js/engine.js  (all must pass)
- node -e: require levels.js logic standalone is NOT possible (it's a browser IIFE); instead
  create a throwaway test: write /tmp/lvltest.js that loads the pure generator functions.
  To make levels.js testable in node, expose the PURE functions (mulberry32, levelFromSeed,
  validate, and the layout helpers) on a global that works in BOTH browser and node:
     (typeof module!=='undefined') ? (module.exports={...}) : (window.LevelGen={...})
  Then in /tmp/lvltest.js: const L=require('/mnt/e/codex/breakout/web/js/levels.js');
    for n=1..999: lv=L.levelFromSeed(n); r=L.validate(lv); if(!r.ok) {console.log('FAIL',n,r.errors); process.exitCode=1}
  Print "ALL 999 VALID" only if zero failures. Run it and paste the tail.
- Confirm determinism: levelFromSeed(123) deep-equals levelFromSeed(123); != levelFromSeed(124).

## Final reply (concise)
- List files created
- node --check results
- The 999-level validation tail output
- Determinism check result
- Any deviations from this spec and why
Do NOT git commit (I handle git). Do NOT push. Just create the files and self-check.
