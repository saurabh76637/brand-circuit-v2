// UI Elements
const uiLayer = document.getElementById('ui-layer');
const waitingRoom = document.getElementById('waiting-room');
const countdownEl = document.getElementById('countdown');
const leaderboard = document.getElementById('leaderboard');
const hud = document.getElementById('hud');
const startBtn = document.getElementById('start-btn');

// Game State
const STATE = { WAITING: 0, FORM: 1, COUNTDOWN: 2, RACING: 3, FINISHED: 4 };
let gameState = STATE.WAITING;
let connectedPlayers = 0;

// Auto-start setting — when true the race begins automatically once
// at least 1 joystick is connected (after a short delay).
let autoStartEnabled = false;
let autoStartTimer = null;
const AUTO_START_DELAY_MS = 3000; // seconds after last connect before auto-start

// Player info
const players = {
    1: { id: 1, color: 0x2ed573, cssColor: '#2ed573', name: 'GREEN', connected: false, participating: false, details: null, x: 0, y: 0, angle: 0, speed: 0, ui: document.getElementById('slot-1'), obj: null, lap: 0, finished: false, finishTime: 0, inputVx: 0, inputVy: 0, inputActive: false, trail: [], passedCheckpoint: false },
    2: { id: 2, color: 0xffa502, cssColor: '#ffa502', name: 'ORANGE', connected: false, participating: false, details: null, x: 0, y: 0, angle: 0, speed: 0, ui: document.getElementById('slot-2'), obj: null, lap: 0, finished: false, finishTime: 0, inputVx: 0, inputVy: 0, inputActive: false, trail: [], passedCheckpoint: false },
    3: { id: 3, color: 0x1e90ff, cssColor: '#1e90ff', name: 'BLUE', connected: false, participating: false, details: null, x: 0, y: 0, angle: 0, speed: 0, ui: document.getElementById('slot-3'), obj: null, lap: 0, finished: false, finishTime: 0, inputVx: 0, inputVy: 0, inputActive: false, trail: [], passedCheckpoint: false },
    4: { id: 4, color: 0xff4757, cssColor: '#ff4757', name: 'RED', connected: false, participating: false, details: null, x: 0, y: 0, angle: 0, speed: 0, ui: document.getElementById('slot-4'), obj: null, lap: 0, finished: false, finishTime: 0, inputVx: 0, inputVy: 0, inputActive: false, trail: [], passedCheckpoint: false }
};

// Form / match state
let formConnectedIds = [];
let formCurrentIdx = 0;
let matchId = null;
let matchTimestamp = null;

// Race music — loops while racing, stopped on PLAY AGAIN.
let raceMusic = null;

// Physics Constants
const MAX_SPEED = 10;
const ACCEL = 0.25;
const FRICTION = 0.96;
const REQUIRED_LAPS = 1;
const RACE_TIMEOUT_MS = 90000; // 90s race time limit — unfinished cars get DNF'd by progress
let raceTimeoutId = null;

// ─────────────────────────────────────────────
//  S-CURVE TRACK DEFINITION
// ─────────────────────────────────────────────
const TRACK_HALF_WIDTH = 45;
const TRACK_CENTER = [
    { x: 593, y: 928 }, { x: 1045, y: 928 }, { x: 1108, y: 887 }, { x: 1113, y: 819 }, { x: 1039, y: 777 },
    { x: 200, y: 777 }, { x: 100, y: 735 }, { x: 100, y: 651 }, { x: 236, y: 618 }, { x: 800, y: 618 },
    { x: 864, y: 559 }, { x: 810, y: 509 }, { x: 742, y: 531 }, { x: 671, y: 593 }, { x: 420, y: 601 },
    { x: 231, y: 521 }, { x: 151, y: 462 }, { x: 92, y: 367 }, { x: 200, y: 265 }, { x: 650, y: 457 },
    { x: 890, y: 479 }, { x: 1120, y: 700 }, { x: 1184, y: 649 }, { x: 1133, y: 524 }, { x: 969, y: 417 },
    { x: 925, y: 318 }, { x: 1056, y: 269 }, { x: 1166, y: 153 }, { x: 1051, y: 84 }, { x: 822, y: 84 },
    { x: 677, y: 205 }, { x: 500, y: 295 }, { x: 400, y: 228 }, { x: 425, y: 147 }, { x: 600, y: 73 },
    { x: 250, y: 73 }, { x: 133, y: 106 }, { x: 121, y: 185 }, { x: 300, y: 218 }, { x: 504, y: 419 },
    { x: 622, y: 436 }, { x: 742, y: 310 }, { x: 808, y: 260 }, { x: 878, y: 290 }, { x: 926, y: 152 },
    { x: 730, y: 84 }, { x: 500, y: 84 }, { x: 300, y: 130 }, { x: 100, y: 150 }, { x: 60, y: 250 },
    { x: 100, y: 450 }, { x: 60, y: 650 }, { x: 150, y: 928 },
];

let trackSamples = [];
let trackInner = [];
let trackOuter = [];
let trailGraphics;
let tickCounter = 0;
let startTime = 0;
let finishers = [];

const NUM_SAMPLES = 800;
const CHECKPOINT_INDEX = Math.floor(NUM_SAMPLES / 2);
const FINISH_LINE_INDEX = 4; // shift lap-line forward to match the visual START/FINISH flag
const FINISH_LINE_SAMPLE_TOLERANCE = 25; // car's closest track sample must be within this many indices of FINISH_LINE_INDEX
const FINISH_LINE_MAX_SCAN = 80; // cap on auto-fit scan so mask holes can't create absurd segments

// Computed at create() from the road mask — a line segment exactly the drivable width
// at FINISH_LINE_INDEX, so it can't reach into kerb/grass or a parallel road section.
let finishLineA = null;
let finishLineB = null;

let roadMaskData = null;
let maskCanvas = null;
let maskContext = null;

// ─────────────────────────────────────────────
//  PHASER FUNCTIONS
// ─────────────────────────────────────────────
function preload() {
    this.load.image('car_1', 'assets/green.png');
    this.load.image('car_2', 'assets/orange.png');
    this.load.image('car_3', 'assets/blue.png');
    this.load.image('car_4', 'assets/red.png');
    this.load.svg('track_base', 'assets/road.svg', { width: 1280, height: 720 });
    this.load.image('track_ground', 'assets/ARGH LOGO TRACK.png');
    this.load.image('track_road', 'assets/just the road.png');
}

function create() {
    buildTrackGeometry();
    // road.svg is loaded only as the invisible collision mask (not rendered).
    const trackBase = this.add.image(640, 360, 'track_base').setVisible(false);
    const trackGround = this.add.image(640, 360, 'track_ground').setDepth(0);
    trackGround.setDisplaySize(1280, 720);

    // Use road.svg (track_base) for the movement mask
    const roadMaskImg = trackBase.texture.getSourceImage();
    maskCanvas = document.createElement('canvas');
    maskCanvas.width = 1280;
    maskCanvas.height = 720;
    maskContext = maskCanvas.getContext('2d');
    maskContext.drawImage(roadMaskImg, 0, 0, 1280, 720);
    roadMaskData = maskContext.getImageData(0, 0, 1280, 720).data;

    // Auto-fit the finish line to the drivable width at FINISH_LINE_INDEX.
    // Walk outward along the track normal on both sides until the mask says off-road.
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

    trailGraphics = this.add.graphics().setDepth(3);
    const startIndices = [12, 12, 8, 8]; // Two rows past the start/finish line
    const SPAWN_Y_OFFSET = 15; // pixels down on screen so cars sit centered on the road below the banner

    for (let i = 1; i <= 4; i++) {
        let p = players[i];
        let si = startIndices[i - 1];
        let sample = trackSamples[si];
        let nextSample = trackSamples[(si + 1) % NUM_SAMPLES];
        p.x = sample.x; p.y = sample.y;
        p.angle = Math.atan2(nextSample.y - sample.y, nextSample.x - sample.x);
        let laneOffset = ((i % 2 === 0 ? -0.5 : 0.5) + 0.2) * TRACK_HALF_WIDTH; // Shifted +0.2 to center on road boooiiii!
        p.x += sample.nx * laneOffset; p.y += sample.ny * laneOffset;
        p.y += SPAWN_Y_OFFSET;
        p.obj = this.add.sprite(p.x, p.y, `car_${i}`);
        p.obj.setDepth(10);
        let carScale = 60 / (p.obj.height || 400);
        p.obj.setScale(carScale || 0.1);
        p.obj.rotation = p.angle + Math.PI / 2;
        p.prevX = p.x; p.prevY = p.y;
        p.trail = []; p.passedCheckpoint = false;
    }

    // HUD and Timer will be initialized when the race starts.
}

function update() {
    tickCounter++;

    // Poll physical gamepads every frame (even outside RACING so the
    // waiting-room connection detection and auto-start keep working).
    GamepadManager.poll();

    // Feed gamepad input into each player's state.
    for (let i = 1; i <= 4; i++) {
        const gp = GamepadManager.getInput(i);
        if (gp && gp.active) {
            players[i].inputVx = gp.vx;
            players[i].inputVy = gp.vy;
            players[i].inputActive = true;
        } else if (GamepadManager.isConnected(i)) {
            players[i].inputVx = 0;
            players[i].inputVy = 0;
            players[i].inputActive = false;
        }
    }

    // In the waiting room, allow the Start button on any gamepad to
    // trigger the race (manual-start mode).
    if (gameState === STATE.WAITING && connectedPlayers > 0) {
        if (GamepadManager.isStartPressed()) {
            startRace();
        }
    }

    if (gameState !== STATE.RACING) return;

    if (tickCounter % 6 === 0) {
        let elapsed = (Date.now() - startTime) / 1000;
        let mins = Math.floor(elapsed / 60);
        let secs = (elapsed % 60).toFixed(1);
        if (parseFloat(secs) < 10) secs = '0' + secs;
        let timerEl = document.getElementById('race-timer');
        if (timerEl) timerEl.textContent = `${mins}:${secs}`;
    }

    if (tickCounter % 3 === 0) trailGraphics.clear();
    let activeRacersCount = 0;

    for (let i = 1; i <= 4; i++) {
        let p = players[i];
        if (!p.participating || p.finished) continue;
        activeRacersCount++;
        p.prevX = p.x; p.prevY = p.y;

        let joyMag = Math.sqrt(p.inputVx * p.inputVx + p.inputVy * p.inputVy);
        if (p.inputActive && joyMag > 0.15) {
            p.speed += ACCEL * Math.min(1, joyMag);
            let targetAngle = Math.atan2(p.inputVy, p.inputVx);
            let angleDiff = targetAngle - p.angle;
            while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
            while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
            let maxTurn = 0.15;
            if (angleDiff > maxTurn) angleDiff = maxTurn;
            if (angleDiff < -maxTurn) angleDiff = -maxTurn;
            p.angle += angleDiff;
        }

        p.speed *= FRICTION;
        if (p.speed > MAX_SPEED) p.speed = MAX_SPEED;

        let dx = Math.cos(p.angle) * p.speed;
        let dy = Math.sin(p.angle) * p.speed;

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

        let closest = getClosestTrackIndex(p.x, p.y);
        let cpDist = Math.abs(closest.index - CHECKPOINT_INDEX);
        if (cpDist < 15 || cpDist > NUM_SAMPLES - 15) p.passedCheckpoint = true;

        let fi = finishLineA, fo = finishLineB;
        let finishDist = Math.abs(closest.index - FINISH_LINE_INDEX);
        let nearFinish = finishDist < FINISH_LINE_SAMPLE_TOLERANCE || finishDist > NUM_SAMPLES - FINISH_LINE_SAMPLE_TOLERANCE;
        if (p.passedCheckpoint && nearFinish && fi && fo && segmentsCross(p.prevX, p.prevY, p.x, p.y, fi.x, fi.y, fo.x, fo.y)) {
            p.lap++; p.passedCheckpoint = false;
            let hudEl = document.querySelector(`#hud-p${i} .hud-lap`);
            if (hudEl) hudEl.textContent = `Lap ${Math.min(REQUIRED_LAPS, p.lap + 1)}/${REQUIRED_LAPS}`;
            if (p.lap >= REQUIRED_LAPS) {
                p.finished = true; p.finishTime = Date.now() - startTime;
                finishers.push(p); p.obj.setAlpha(0.4);
                if (hudEl) hudEl.textContent = `Finished!`;
            }
        }

        p.obj.x = p.x; p.obj.y = p.y;
        p.obj.rotation = p.angle + Math.PI / 2;

        if (p.speed > 3) {
            p.trail.push({ x: p.x, y: p.y });
            if (p.trail.length > 12) p.trail.shift();
            for (let t = 0; t < p.trail.length; t++) {
                let alpha = (t / p.trail.length) * 0.35 * (p.speed / MAX_SPEED);
                trailGraphics.fillStyle(p.color, alpha);
                trailGraphics.fillCircle(p.trail[t].x, p.trail[t].y, 2 + (t / p.trail.length) * 5);
            }
        } else p.trail = [];
    }
    if (activeRacersCount > 0 && finishers.length === getParticipatingCount()) {
        if (raceTimeoutId) { clearTimeout(raceTimeoutId); raceTimeoutId = null; }
        gameState = STATE.FINISHED;
        showLeaderboard();
    }
}

function getParticipatingCount() {
    let n = 0;
    for (let i = 1; i <= 4; i++) if (players[i].participating) n++;
    return n;
}

function handleRaceTimeout() {
    if (gameState !== STATE.RACING) return;
    raceTimeoutId = null;

    // Rank unfinished participating players by track progress (laps + position-on-lap),
    // then push them into finishers so the leaderboard renders them after real finishers.
    const unfinished = [];
    for (let i = 1; i <= 4; i++) {
        const p = players[i];
        if (!p.participating || p.finished) continue;
        const closest = getClosestTrackIndex(p.x, p.y);
        p._progress = p.lap + (closest.index / NUM_SAMPLES);
        p.finishTime = RACE_TIMEOUT_MS;
        p.dnf = true;
        unfinished.push(p);
    }
    unfinished.sort((a, b) => b._progress - a._progress);
    for (const p of unfinished) {
        finishers.push(p);
        if (p.obj) p.obj.setAlpha(0.4);
    }

    gameState = STATE.FINISHED;
    showLeaderboard();
}

function renderResultsTable() {
    if (finishers.length === 0) return;

    const winnerTime = finishers[0].finishTime;
    const winnerName = (finishers[0].details && finishers[0].details.name)
        ? finishers[0].details.name
        : `P${finishers[0].id}`;

    const rows = finishers.map((p, idx) => {
        const d = p.details || { name: `P${p.id}`, zone: '', channel: '' };
        const finishSec = +(p.finishTime / 1000).toFixed(2);
        const gapSec = (p.finishTime - winnerTime) / 1000;
        const score = +Math.max(0, 9.5 - gapSec * 0.7).toFixed(1);
        return {
            playerSlot: `P${p.id}`,
            name: d.name,
            zone: d.zone,
            channel: d.channel,
            position: idx + 1,
            finishTimeSec: finishSec,
            score: score
        };
    });

    // Console TSV for quick copy/paste — kept for debugging; no longer
    // rendered on screen (the on-leaderboard results block was removed).
    const headers = ['playerSlot', 'name', 'zone', 'channel', 'position', 'finishTimeSec', 'score'];
    const tsv = [headers.join('\t')]
        .concat(rows.map(r => headers.map(h => r[h]).join('\t')))
        .join('\n');
    console.log(`[Results] match ${matchId} @ ${matchTimestamp} — winner: ${winnerName}\n${tsv}`);

    saveResultsToServer({ matchId, timestamp: matchTimestamp, winner: winnerName, rows });
}

function saveResultsToServer(payload) {
    let status = document.getElementById('save-status');
    if (!status) {
        status = document.createElement('div');
        status.id = 'save-status';
        status.className = 'save-status';
        document.getElementById('leaderboard').insertBefore(
            status,
            document.getElementById('restart-btn')
        );
    }
    // Status is shown as a small colored dot (CSS-driven via data-state):
    //   pending = pulsing gray, ok = green, error = red. The full error/
    //   match-number details land in the dot's title tooltip and the console.
    status.dataset.state = 'pending';
    status.title = 'Saving…';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    fetch('/api/results', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal
    })
        .then(r => r.json().then(j => ({ ok: r.ok, body: j })))
        .then(({ ok, body }) => {
            clearTimeout(timeoutId);
            if (ok && body.ok) {
                status.dataset.state = 'ok';
                status.title = `Saved match #${body.matchNum} (${body.saved} rows)`;
            } else {
                status.dataset.state = 'error';
                const msg = (body && body.error) || 'unknown error';
                status.title = `Save failed: ${msg}`;
                console.error('[Save] Failed:', msg);
            }
        })
        .catch(err => {
            clearTimeout(timeoutId);
            status.dataset.state = 'error';
            const msg = err.name === 'AbortError' ? 'timed out' : err.message;
            status.title = `Save failed: ${msg}`;
            console.error('[Save] Failed:', msg);
        });
}

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function buildTrackGeometry() {
    // 1. Precise scale based on SVG viewBox (1861.6 x 1056.27)
    const origW = 1861.6;
    const origH = 1056.27;
    const cw = 1280;
    const ch = 720;
    const scale = Math.min(cw / origW, ch / origH);

    // Calculate offset to center the scaled SVG on the 1280x720 canvas
    const offsetX = (cw - origW * scale) / 2;
    const offsetY = (ch - origH * scale) / 2;

    // 2. Apply transformation to TRACK_CENTER
    const normalizedPoints = TRACK_CENTER.map(p => ({
        x: p.x * scale + offsetX,
        y: p.y * scale + offsetY
    }));

    // 3. Sample the transformed points
    trackSamples = sampleClosedCatmullRom(normalizedPoints, NUM_SAMPLES);
    for (let i = 0; i < trackSamples.length; i++) {
        let prev = trackSamples[(i - 1 + trackSamples.length) % trackSamples.length];
        let next = trackSamples[(i + 1) % trackSamples.length];
        let dx = next.x - prev.x, dy = next.y - prev.y;
        let len = Math.sqrt(dx * dx + dy * dy) || 1;
        trackSamples[i].nx = -dy / len; trackSamples[i].ny = dx / len;
    }
    trackInner = []; trackOuter = [];
    for (let i = 0; i < trackSamples.length; i++) {
        let s = trackSamples[i];
        trackInner.push({ x: s.x + s.nx * TRACK_HALF_WIDTH, y: s.y + s.ny * TRACK_HALF_WIDTH });
        trackOuter.push({ x: s.x - s.nx * TRACK_HALF_WIDTH, y: s.y - s.ny * TRACK_HALF_WIDTH });
    }
}

function sampleClosedCatmullRom(points, numSamples) {
    const n = points.length; const samples = [];
    for (let s = 0; s < numSamples; s++) {
        let t = s / numSamples; let segment = t * n; let idx = Math.floor(segment); let frac = segment - idx;
        let p0 = points[(idx - 1 + n) % n], p1 = points[idx % n], p2 = points[(idx + 1) % n], p3 = points[(idx + 2) % n];
        let tt = frac, tt2 = tt * tt, tt3 = tt2 * tt;
        let x = 0.5 * ((2 * p1.x) + (-p0.x + p2.x) * tt + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * tt2 + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * tt3);
        let y = 0.5 * ((2 * p1.y) + (-p0.y + p2.y) * tt + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * tt2 + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * tt3);
        samples.push({ x, y });
    }
    return samples;
}

function isOnRoad(x, y) {
    if (!roadMaskData) return true;
    let px = Math.floor(x), py = Math.floor(y);
    if (px < 0 || px >= 1280 || py < 0 || py >= 720) return false;
    let idx = (py * 1280 + px) * 4;
    let alpha = roadMaskData[idx + 3];
    let hasColor = roadMaskData[idx] > 10 || roadMaskData[idx + 1] > 10 || roadMaskData[idx + 2] > 10;
    return alpha > 50 || hasColor;
}

function getClosestTrackIndex(px, py) {
    let minDist = Infinity; let closestIdx = 0;
    for (let i = 0; i < trackSamples.length; i++) {
        let dx = px - trackSamples[i].x, dy = py - trackSamples[i].y;
        let d = dx * dx + dy * dy;
        if (d < minDist) { minDist = d; closestIdx = i; }
    }
    return { distance: Math.sqrt(minDist), index: closestIdx };
}

function segmentsCross(ax, ay, bx, by, cx, cy, dx, dy) {
    let det = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(det) < 0.0001) return false;
    let t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / det;
    let u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / det;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

function showLeaderboard() {
    hud.classList.add('hidden'); leaderboard.classList.remove('hidden');
    const list = document.getElementById('leaderboard-list'); list.innerHTML = '';
    const medals = ['🏆', '🥈', '🥉', '🏁'];
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
    finishers.forEach((p, index) => {
        const displayName = (p.details && p.details.name) ? p.details.name : `P${p.id} ${p.name}`;
        const zone = (p.details && p.details.zone) ? p.details.zone : '';
        const channel = (p.details && p.details.channel) ? p.details.channel : '';
        const subParts = [];
        if (zone) subParts.push(escapeHtml(zone));
        if (channel) subParts.push(escapeHtml(channel));
        const subLine = subParts.length
            ? `<span class="lb-sub">${subParts.join(' · ')}</span>`
            : '';

        const entry = document.createElement('div');
        entry.className = 'lb-entry';
        entry.style.color = p.cssColor;
        entry.style.animationDelay = `${index * 0.3}s`;
        entry.innerHTML =
            `<span class="lb-medal">${medals[index] || '🏁'}</span>` +
            `<span class="lb-info">` +
                `<span class="lb-name">${escapeHtml(displayName)}</span>` +
                subLine +
            `</span>` +
            `<span class="lb-time">${(p.finishTime / 1000).toFixed(2)}s</span>`;
        list.appendChild(entry);
    });

    renderResultsTable();
    if (typeof confetti === 'function') {
        const duration = 4000; const animationEnd = Date.now() + duration;
        const defaults = { startVelocity: 30, spread: 360, ticks: 80, zIndex: 1000 };
        const interval = setInterval(() => {
            const timeLeft = animationEnd - Date.now(); if (timeLeft <= 0) return clearInterval(interval);
            const particleCount = 60 * (timeLeft / duration);
            confetti({ ...defaults, particleCount, origin: { x: Math.random() * 0.2 + 0.1, y: Math.random() - 0.2 } });
            confetti({ ...defaults, particleCount, origin: { x: Math.random() * 0.2 + 0.7, y: Math.random() - 0.2 } });
        }, 200);
    }
}

// ─────────────────────────────────────────────
//  INITIALIZATION
// ─────────────────────────────────────────────
const config = {
    type: Phaser.AUTO, width: 1280, height: 720, parent: 'game-container', backgroundColor: '#0a0a14',
    scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
    scene: { preload, create, update }
};

// ─────────────────────────────────────────────
//  START RACE — pressing Start (button, gamepad, or auto-start)
//  opens the per-player details form. Submitting the form kicks off
//  the countdown via beginRaceCountdown().
// ─────────────────────────────────────────────
function startRace() {
    if (gameState !== STATE.WAITING || connectedPlayers === 0) return;

    // Cancel any pending auto-start timer
    if (autoStartTimer) { clearTimeout(autoStartTimer); autoStartTimer = null; }

    showPlayerForm();
}

// ── Player details form ──────────────────────────────────────────
function showPlayerForm() {
    formConnectedIds = [];
    for (let i = 1; i <= 4; i++) {
        if (players[i].connected) formConnectedIds.push(i);
        players[i].participating = false;
        players[i].details = null;
    }
    if (formConnectedIds.length === 0) return;
    formCurrentIdx = 0;
    gameState = STATE.FORM;
    waitingRoom.classList.add('hidden');
    document.getElementById('player-details-form').classList.remove('hidden');
    renderPlayerForm();
}

function renderPlayerForm() {
    const id = formConnectedIds[formCurrentIdx];
    const p = players[id];
    const label = document.getElementById('form-player-label');
    label.textContent = `Player ${id} (${p.name}) Details`;
    label.style.color = p.cssColor;
    document.getElementById('form-progress').textContent =
        `Player ${formCurrentIdx + 1} of ${formConnectedIds.length}`;
    const d = p.details || { name: '', zone: '', channel: '' };
    document.getElementById('form-name').value = d.name;
    document.getElementById('form-zone').value = d.zone;
    document.getElementById('form-channel').value = d.channel;
    document.getElementById('form-prev-btn').disabled = formCurrentIdx === 0;
    document.getElementById('form-next-btn').disabled = formCurrentIdx >= formConnectedIds.length - 1;
    document.getElementById('form-name').focus();
}

function captureCurrentForm() {
    const id = formConnectedIds[formCurrentIdx];
    const name = document.getElementById('form-name').value.trim();
    const zone = document.getElementById('form-zone').value.trim();
    const channel = document.getElementById('form-channel').value.trim();
    if (name || zone || channel) {
        players[id].details = {
            name: name || `P${id}`,
            zone: zone,
            channel: channel
        };
        players[id].participating = true;
    } else {
        players[id].details = null;
        players[id].participating = false;
    }
}

function onFormNext() {
    captureCurrentForm();
    if (formCurrentIdx < formConnectedIds.length - 1) {
        formCurrentIdx++;
        renderPlayerForm();
    }
}

function onFormPrev() {
    captureCurrentForm();
    if (formCurrentIdx > 0) {
        formCurrentIdx--;
        renderPlayerForm();
    }
}

function onFormSubmit() {
    captureCurrentForm();
    if (getParticipatingCount() === 0) {
        document.getElementById('form-name').focus();
        return;
    }
    document.getElementById('player-details-form').classList.add('hidden');
    beginRaceCountdown();
}

// ── Actual race countdown — runs after form submission ───────────
function beginRaceCountdown() {
    matchId = generateMatchId();
    matchTimestamp = formatTimestamp(new Date());

    // Hide cars for players who didn't fill out the form
    for (let i = 1; i <= 4; i++) {
        if (players[i].obj) players[i].obj.setVisible(players[i].participating);
    }

    // Initialize HUD for participating players
    let hudContainer = document.getElementById('hud');
    hudContainer.innerHTML = '';
    for (let i = 1; i <= 4; i++) {
        let p = players[i];
        if (!p.participating) continue;
        const displayName = (p.details && p.details.name) ? p.details.name : `P${i}`;
        let div = document.createElement('div');
        div.className = 'hud-player';
        div.id = `hud-p${i}`;
        div.innerHTML = `<span class="hud-dot" style="background:${p.cssColor}; color:${p.cssColor}"></span> ${displayName} <span class="hud-lap">Lap 1/${REQUIRED_LAPS}</span>`;
        hudContainer.appendChild(div);
    }
    let timerDiv = document.createElement('div');
    timerDiv.id = 'race-timer';
    timerDiv.textContent = '0:00.0';
    hudContainer.appendChild(timerDiv);

    gameState = STATE.COUNTDOWN; countdownEl.classList.remove('hidden');
    let count = 3; countdownEl.textContent = count;
    let interval = setInterval(() => {
        count--;
        if (count > 0) { countdownEl.textContent = count; }
        else if (count === 0) { countdownEl.textContent = "GO!"; countdownEl.style.color = '#2ed573'; }
        else {
            clearInterval(interval);
            countdownEl.classList.add('hidden');
            hud.classList.remove('hidden');
            gameState = STATE.RACING;
            startTime = Date.now();
            startRaceMusic();
            raceTimeoutId = setTimeout(handleRaceTimeout, RACE_TIMEOUT_MS);
        }
    }, 1000);
}

function startRaceMusic() {
    if (!raceMusic) return;
    raceMusic.currentTime = 0;
    const p = raceMusic.play();
    if (p && typeof p.catch === 'function') {
        p.catch(err => console.warn('[RaceMusic] play() blocked:', err.message));
    }
}

function stopRaceMusic() {
    if (!raceMusic) return;
    raceMusic.pause();
    raceMusic.currentTime = 0;
}

function generateMatchId() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const block = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    return `m-${block(3)}-${block(3)}`;
}

function formatTimestamp(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

// ─────────────────────────────────────────────
//  HELPER — connect a player
// ─────────────────────────────────────────────
function connectPlayer(id) {
    const p = players[id];
    if (!p || p.connected) return;
    p.connected = true;
    p.ui.classList.add('connected');
    p.ui.querySelector('.status').textContent = '🎮 Joystick Connected!';
    connectedPlayers++;
    if (connectedPlayers > 0 && gameState === STATE.WAITING) startBtn.classList.remove('hidden');

    // Auto-start: reset the timer every time a new player joins so
    // latecomers have time to connect too.
    if (autoStartEnabled && gameState === STATE.WAITING) {
        if (autoStartTimer) clearTimeout(autoStartTimer);
        autoStartTimer = setTimeout(() => { startRace(); }, AUTO_START_DELAY_MS);
    }
}

function disconnectPlayer(id) {
    const p = players[id];
    if (!p || !p.connected) return;
    p.connected = false;
    p.ui.classList.remove('connected');
    p.ui.querySelector('.status').textContent = 'Waiting...';
    connectedPlayers--;
    if (connectedPlayers === 0 && gameState === STATE.WAITING) {
        startBtn.classList.add('hidden');
        if (autoStartTimer) { clearTimeout(autoStartTimer); autoStartTimer = null; }
    }
}

function initGame() {
    console.log("Initializing Gamepad...");

    // ── Race music ────────────────────────────────────────────────
    raceMusic = new Audio('assets/multiplayer.mp3.mpeg');
    raceMusic.loop = true;
    raceMusic.preload = 'auto';

    // ── Gamepad (physical joystick) setup ──────────────────────────
    GamepadManager.init();

    GamepadManager.onConnect((playerId) => {
        console.log(`[Game] Gamepad → Player ${playerId} connected`);
        connectPlayer(playerId);
    });

    GamepadManager.onDisconnect((playerId) => {
        console.log(`[Game] Gamepad → Player ${playerId} disconnected`);
        disconnectPlayer(playerId);
    });

    // ── Auto-start toggle ─────────────────────────────────────────
    const autoStartToggle = document.getElementById('auto-start-toggle');
    if (autoStartToggle) {
        autoStartToggle.addEventListener('change', (e) => {
            autoStartEnabled = e.target.checked;
            console.log(`[Game] Auto-start ${autoStartEnabled ? 'ENABLED' : 'DISABLED'}`);
            if (autoStartEnabled && connectedPlayers > 0 && gameState === STATE.WAITING) {
                if (autoStartTimer) clearTimeout(autoStartTimer);
                autoStartTimer = setTimeout(() => { startRace(); }, AUTO_START_DELAY_MS);
            }
        });
    }

    // ── Manual start button ────────────────────────────────────────
    startBtn.addEventListener('click', () => { startRace(); });

    // ── Player details form buttons ────────────────────────────────
    document.getElementById('form-prev-btn').addEventListener('click', onFormPrev);
    document.getElementById('form-next-btn').addEventListener('click', onFormNext);
    document.getElementById('form-submit-btn').addEventListener('click', onFormSubmit);

    // ── PLAY AGAIN — stop music, then reload to reset all state ────
    document.getElementById('restart-btn').addEventListener('click', () => {
        stopRaceMusic();
        location.reload();
    });

    new Phaser.Game(config);
}

window.addEventListener('load', initGame);
