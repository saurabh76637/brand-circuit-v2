# Change Log

Covers every code change made across this session, starting from the "cars getting stuck at track edges" issue through the HUD styling updates. Each section lists the problem, the fix, the exact file + lines touched, and the code before/after.

---

## 1. Cars getting stuck on track edges (wall-sliding, first pass)

**Problem:** When a car's next position would leave the road, the collision code rejected the whole move and halved the speed. If the player held the joystick into the wall, input kept accelerating but the position never updated — the car froze on the edge.

**File:** [public/game/game.js](public/game/game.js)

**Change:** Replaced the binary "can move / can't move" check with axis-separated sliding plus a corner-nudge fallback. Added an `isOnRoad` helper for reuse.

### Before
```js
// Hard boundary detection
let nextX = p.x + dx;
let nextY = p.y + dy;
let canMove = true;

if (roadMaskData) {
    let px = Math.floor(nextX), py = Math.floor(nextY);
    if (px >= 0 && px < 1280 && py >= 0 && py < 720) {
        let idx = (py * 1280 + px) * 4;
        let alpha = roadMaskData[idx + 3];
        let hasColor = roadMaskData[idx] > 10 || roadMaskData[idx + 1] > 10 || roadMaskData[idx + 2] > 10;
        if (!(alpha > 50 || hasColor)) canMove = false;
    } else canMove = false;
}

if (canMove) {
    p.x = nextX;
    p.y = nextY;
} else {
    p.speed *= 0.5; // Bump against wall
}
```

### After (initial wall-slide attempt, later replaced)
```js
// Hard boundary detection with wall-sliding so cars don't get stuck
let nextX = p.x + dx;
let nextY = p.y + dy;

if (isOnRoad(nextX, nextY)) {
    p.x = nextX;
    p.y = nextY;
} else if (isOnRoad(nextX, p.y)) {
    p.x = nextX;
    p.speed *= 0.8;
} else if (isOnRoad(p.x, nextY)) {
    p.y = nextY;
    p.speed *= 0.8;
} else {
    p.speed *= 0.4;
    let cs = trackSamples[getClosestTrackIndex(p.x, p.y).index];
    if (cs) {
        p.x += (cs.x - p.x) * 0.05;
        p.y += (cs.y - p.y) * 0.05;
    }
}
```

### `isOnRoad` helper added
```js
function isOnRoad(x, y) {
    if (!roadMaskData) return true;
    let px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || px >= 1280 || py < 0 || py >= 720) return false;
    let idx = (py * 1280 + px) * 4;
    let alpha = roadMaskData[idx + 3];
    let hasColor = roadMaskData[idx] > 10 || roadMaskData[idx + 1] > 10 || roadMaskData[idx + 2] > 10;
    return alpha > 50 || hasColor;
}
```

---

## 2. Cars escaping the track through parallel-road strips (wall-slide fix, second pass)

**Problem:** The first wall-slide change had two bugs:

- The **corner-nudge fallback** pulled the car toward the *globally* closest track centerline sample. Where two track sections ran in parallel, that nearest sample could be on the *other* road, so the nudge dragged the car across the grass into a parallel lane.
- The axis-slide checked **only the destination pixel**. With moves up to 10 px/frame and grass strips between parallel roads, a car could tunnel through a thin wall.

**File:** [public/game/game.js](public/game/game.js)

**Change:** Removed the nudge fallback (car just stops in true corners — the player rotates out). Sub-stepped each frame's motion into ≤ 2 px increments and ran the axis-slide check at every sub-step.

### After
```js
// Sub-stepped wall-sliding so cars slide along edges but can't tunnel
// through thin grass strips between parallel roads.
let steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 2));
let sdx = dx / steps, sdy = dy / steps;
let fullyBlocked = false;
for (let s = 0; s < steps; s++) {
    let tryX = p.x + sdx, tryY = p.y + sdy;
    if (isOnRoad(tryX, tryY)) {
        p.x = tryX; p.y = tryY;
    } else if (isOnRoad(tryX, p.y)) {
        p.x = tryX;
        p.speed *= 0.9;
        sdy = 0;
    } else if (isOnRoad(p.x, tryY)) {
        p.y = tryY;
        p.speed *= 0.9;
        sdx = 0;
    } else {
        fullyBlocked = true;
        break;
    }
}
if (fullyBlocked) p.speed = 0;
```

---

## 3. Finish line triggered before the visual checkered flag

**Problem:** The lap-detection segment used `trackInner[0]` / `trackOuter[0]` — sample 0 of the centerline — but the visual START/FINISH flag sits a few samples further along the first straight. Lap was counted before the car reached the flag.

**File:** [public/game/game.js](public/game/game.js)

**Change:** Introduced a `FINISH_LINE_INDEX` constant so the detection sample can be tuned to match the flag.

### Before
```js
const NUM_SAMPLES = 800;
const CHECKPOINT_INDEX = Math.floor(NUM_SAMPLES / 2);
```
```js
let fi = trackInner[0], fo = trackOuter[0];
```

### After
```js
const NUM_SAMPLES = 800;
const CHECKPOINT_INDEX = Math.floor(NUM_SAMPLES / 2);
const FINISH_LINE_INDEX = 4; // shift lap-line forward to match the visual START/FINISH flag
```
```js
let fi = trackInner[FINISH_LINE_INDEX], fo = trackOuter[FINISH_LINE_INDEX];
```

---

## 4. Cars sneaking around the finish line through the kerb (first widening attempt)

**Problem:** The drivable road mask was wider than `TRACK_HALF_WIDTH` (45 px). The finish line segment stopped at `TRACK_HALF_WIDTH`, so a car hugging the yellow kerb could pass *around* the endpoint of the segment without crossing it.

**File:** [public/game/game.js](public/game/game.js)

**Change:** Introduced `FINISH_LINE_HALF_WIDTH = 90` and rebuilt the finish-line endpoints from the centerline + normal instead of using the pre-computed `trackInner/trackOuter`.

### After
```js
const FINISH_LINE_HALF_WIDTH = 90; // extend beyond track edges so kerb/shoulder sneaks still count
```
```js
let fs = trackSamples[FINISH_LINE_INDEX];
let fi = { x: fs.x + fs.nx * FINISH_LINE_HALF_WIDTH, y: fs.y + fs.ny * FINISH_LINE_HALF_WIDTH };
let fo = { x: fs.x - fs.nx * FINISH_LINE_HALF_WIDTH, y: fs.y - fs.ny * FINISH_LINE_HALF_WIDTH };
```

*(This introduced a new bug — see change #5.)*

---

## 5. Laps registering from a parallel road section

**Problem:** With `FINISH_LINE_HALF_WIDTH = 90`, the line reached from the bottom straight (y ≈ 928) up into the parallel stretch above (y ≈ 777). Cars driving on the upper stretch crossed the extended line segment and triggered laps.

**File:** [public/game/game.js](public/game/game.js)

**Change:** Shrank the half-width to 60 px and added a sample-tolerance guard — the car's closest centerline sample must be within `FINISH_LINE_SAMPLE_TOLERANCE` of `FINISH_LINE_INDEX` for a crossing to count.

### After
```js
const FINISH_LINE_HALF_WIDTH = 60; // extend past kerb but not into parallel road sections
const FINISH_LINE_SAMPLE_TOLERANCE = 25; // car's closest track sample must be within this many indices of FINISH_LINE_INDEX
```
```js
let finishDist = Math.abs(closest.index - FINISH_LINE_INDEX);
let nearFinish = finishDist < FINISH_LINE_SAMPLE_TOLERANCE || finishDist > NUM_SAMPLES - FINISH_LINE_SAMPLE_TOLERANCE;
if (p.passedCheckpoint && nearFinish && segmentsCross(p.prevX, p.prevY, p.x, p.y, fi.x, fi.y, fo.x, fo.y)) {
```

---

## 6. Server restart

**Action (no code change):** Killed the running `node.exe` (PID 39412) with `taskkill`, then re-launched `node server.js` in the background. Later, the user asked to terminate port 3000 — the second instance (PID 37912) was killed and port 3000 confirmed free via `netstat`.

---

## 7. Switching `road.svg` to mask-only and using `ARGH LOGO TRACK.png` as the sole visual

**Request:** Stop rendering `road.svg`, keep it only as the collision mask; use `ARGH LOGO TRACK.png` as the top visual.

**File:** [public/game/game.js](public/game/game.js)

**Change:** `trackBase` now has `setVisible(false)` so the texture is loaded (and fed to `roadMaskData` via `getSourceImage()`) but never drawn. The `just the road.png` overlay was removed since `ARGH LOGO TRACK.png` already contains the full track art.

### Before
```js
const trackBase = this.add.image(640, 360, 'track_base').setDepth(0);
const trackGround = this.add.image(640, 360, 'track_ground').setDepth(1);
trackGround.setDisplaySize(1280, 720);
const trackRoad = this.add.image(640, 360, 'track_road').setDepth(2);
trackRoad.setDisplaySize(1280, 720);

// Use road.svg (track_base) for the movement mask
const roadMaskImg = trackBase.texture.getSourceImage();
```

### After
```js
// road.svg is loaded only as the invisible collision mask (not rendered).
const trackBase = this.add.image(640, 360, 'track_base').setVisible(false);
const trackGround = this.add.image(640, 360, 'track_ground').setDepth(0);
trackGround.setDisplaySize(1280, 720);

// Use road.svg (track_base) for the movement mask
const roadMaskImg = trackBase.texture.getSourceImage();
```

---

## 8. Auto-fit finish line to the drivable width

**Problem:** With the visual layer changed, the user confirmed the detection should match the checkered flag's drivable zone exactly — not a fixed 60 px half-width.

**File:** [public/game/game.js](public/game/game.js)

**Change:** Dropped the `FINISH_LINE_HALF_WIDTH` constant. Computed the endpoints at `create()` time by walking outward along the track normal from `trackSamples[FINISH_LINE_INDEX]` in both directions until the mask reports off-road. Added `FINISH_LINE_MAX_SCAN = 80` as a hard cap.

### Constants
```js
const FINISH_LINE_INDEX = 4; // shift lap-line forward to match the visual START/FINISH flag
const FINISH_LINE_SAMPLE_TOLERANCE = 25; // car's closest track sample must be within this many indices of FINISH_LINE_INDEX
const FINISH_LINE_MAX_SCAN = 80; // cap on auto-fit scan so mask holes can't create absurd segments

// Computed at create() from the road mask — a line segment exactly the drivable width
// at FINISH_LINE_INDEX, so it can't reach into kerb/grass or a parallel road section.
let finishLineA = null;
let finishLineB = null;
```

### Scan in `create()` (initial version — later refined)
```js
{
    const fsS = trackSamples[FINISH_LINE_INDEX];
    let posD = 0, negD = 0;
    for (let d = 1; d <= FINISH_LINE_MAX_SCAN; d++) {
        if (isOnRoad(fsS.x + fsS.nx * d, fsS.y + fsS.ny * d)) posD = d; else break;
    }
    for (let d = 1; d <= FINISH_LINE_MAX_SCAN; d++) {
        if (isOnRoad(fsS.x - fsS.nx * d, fsS.y - fsS.ny * d)) negD = d; else break;
    }
    finishLineA = { x: fsS.x + fsS.nx * posD, y: fsS.y + fsS.ny * posD };
    finishLineB = { x: fsS.x - fsS.nx * negD, y: fsS.y - fsS.ny * negD };
}
```

### Lap check updated
```js
let fi = finishLineA, fo = finishLineB;
let finishDist = Math.abs(closest.index - FINISH_LINE_INDEX);
let nearFinish = finishDist < FINISH_LINE_SAMPLE_TOLERANCE || finishDist > NUM_SAMPLES - FINISH_LINE_SAMPLE_TOLERANCE;
if (p.passedCheckpoint && nearFinish && fi && fo && segmentsCross(p.prevX, p.prevY, p.x, p.y, fi.x, fi.y, fo.x, fo.y)) {
```

---

## 9. Yellow kerb sneak still possible — gap-skip + floor added to auto-fit

**Problem:** Cars could still slip through the yellow side band at the bottom of the track. The auto-fit scan stopped at thin painted line separators inside the mask, cutting the finish line short of the true drivable edge.

**File:** [public/game/game.js](public/game/game.js)

**Change:** Rewrote the scan so it skips up to 6 consecutive off-road pixels before giving up, and enforced a minimum half-width floor of `TRACK_HALF_WIDTH + 30` (75 px).

### After
```js
// Auto-fit the finish line to the drivable width at FINISH_LINE_INDEX.
// Walk outward along the track normal on both sides until the mask says off-road
// for a sustained stretch — this lets us step over thin line/kerb separators in the
// mask and reach the true drivable edge (incl. yellow kerb side band).
{
    const fsS = trackSamples[FINISH_LINE_INDEX];
    const GAP_SKIP = 6; // allow up to 6 consecutive off-road pixels before stopping
    const FLOOR = TRACK_HALF_WIDTH + 30; // minimum half-width so kerb is always covered
    const scan = (sign) => {
        let lastHit = 0, streak = 0;
        for (let d = 1; d <= FINISH_LINE_MAX_SCAN; d++) {
            if (isOnRoad(fsS.x + fsS.nx * d * sign, fsS.y + fsS.ny * d * sign)) {
                lastHit = d;
                streak = 0;
            } else if (++streak > GAP_SKIP) break;
        }
        return Math.max(lastHit, FLOOR);
    };
    const posD = scan(+1);
    const negD = scan(-1);
    finishLineA = { x: fsS.x + fsS.nx * posD, y: fsS.y + fsS.ny * posD };
    finishLineB = { x: fsS.x - fsS.nx * negD, y: fsS.y - fsS.ny * negD };
}
```

---

## 10. Top glassmorphic HUD bar turned off

**Request:** Remove the translucent top bar behind the HUD.

**File:** [public/game/style.css](public/game/style.css)

**Change:** Stripped the gradient background, `backdrop-filter`, bottom border, and shadow from `#hud`. The player pills and timer still render in the same positions but the bar itself is gone.

### Before
```css
#hud {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 60px;
    background: linear-gradient(to bottom, rgba(10, 10, 20, 0.95) 0%, rgba(10, 10, 20, 0.7) 100%);
    backdrop-filter: blur(20px);
    border-bottom: 1px solid var(--glass-border);
    display: flex;
    gap: 12px;
    padding: 0 24px;
    align-items: center;
    pointer-events: none;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
    z-index: 100;
}
```

### After
```css
#hud {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 60px;
    background: transparent;
    display: flex;
    gap: 12px;
    padding: 0 24px;
    align-items: center;
    pointer-events: none;
    z-index: 100;
}
```

---

## 11. Player lap pills — light glass → dark glass

**Problem:** Once the top bar was off, the player pills used a white-tinted background that washed out against bright track areas and was hard to read.

**File:** [public/game/style.css](public/game/style.css)

**Change:** Swapped `.hud-player` to a dark glassmorphic pill matching the waiting-room palette — `rgba(10, 10, 20, 0.75)` background, light border, `blur(14px)` backdrop filter, dark drop shadow.

### Before
```css
.hud-player {
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    padding: 6px 14px;
    border-radius: 10px;
    font-size: 0.9rem;
    font-weight: 800;
    letter-spacing: 1px;
    display: flex;
    align-items: center;
    gap: 10px;
    white-space: nowrap;
    transition: all 0.3s ease;
    box-shadow: inset 0 1px 1px rgba(255, 255, 255, 0.05);
}
```

### After
```css
.hud-player {
    background: rgba(10, 10, 20, 0.75);
    border: 1px solid rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    padding: 6px 14px;
    border-radius: 10px;
    font-size: 0.9rem;
    font-weight: 800;
    letter-spacing: 1px;
    display: flex;
    align-items: center;
    gap: 10px;
    white-space: nowrap;
    transition: all 0.3s ease;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.06);
}
```

---

## 12. Race timer wrapped in the same dark glass pill

**Request:** Put the race timer (right side) inside the same pill styling as the left-side player boxes.

**File:** [public/game/style.css](public/game/style.css)

**Change:** Added the dark glassmorphic background/border/blur/shadow to `#race-timer` so it visually matches the `.hud-player` pills. Bumped horizontal padding to `18px` since the timer has no dot/label, keeping the pill from looking cramped. Kept the orange text color and glow.

### Before
```css
#race-timer {
    margin-left: auto;
    font-family: 'Outfit', sans-serif;
    font-size: 1.6rem;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
    letter-spacing: 2px;
    color: #ffa502;
    text-shadow: 0 0 15px rgba(255, 165, 2, 0.4);
    padding: 0 10px;
}
```

### After
```css
#race-timer {
    margin-left: auto;
    font-family: 'Outfit', sans-serif;
    font-size: 1.6rem;
    font-weight: 900;
    font-variant-numeric: tabular-nums;
    letter-spacing: 2px;
    color: #ffa502;
    text-shadow: 0 0 15px rgba(255, 165, 2, 0.4);
    background: rgba(10, 10, 20, 0.75);
    border: 1px solid rgba(255, 255, 255, 0.12);
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    padding: 6px 18px;
    border-radius: 10px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.06);
}
```

---

## Summary — files touched across this session

| File | What changed |
|---|---|
| [public/game/game.js](public/game/game.js) | Wall-sliding / sub-stepped collision, `isOnRoad` helper, `FINISH_LINE_INDEX` + `FINISH_LINE_SAMPLE_TOLERANCE` + `FINISH_LINE_MAX_SCAN` constants, auto-fit finish line with gap-skip + floor, `finishLineA/B` globals, `track_base` hidden, `track_road` layer removed |
| [public/game/style.css](public/game/style.css) | `#hud` top bar made transparent, `.hud-player` converted to dark glassmorphic pill, `#race-timer` wrapped in matching dark glass pill |
| [server.js](server.js) | *No code changes* — only process restarts / termination |

No changes were made to [public/game/index.html](public/game/index.html), [public/controller/](public/controller/), or any server-side code.
