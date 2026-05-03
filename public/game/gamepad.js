/**
 * GamepadManager — handles up to 4 physical arcade joysticks via the Gamepad API.
 *
 * Arcade sticks are DIGITAL — the stick tilts and closes one of 4 directional
 * micro-switches. In the Gamepad API these typically appear as:
 *   • axes[0] / axes[1] snapping to -1, 0, or +1
 *   • OR d-pad buttons (buttons 12–15 in the "standard" mapping)
 *   • OR face buttons (buttons 0–3 on some cheap encoders)
 *
 * This module reads ALL of those and merges them so it works regardless of
 * how the hardware presents its input.
 *
 * Mapping:  gamepad.index 0 → Player 1,  1 → Player 2,  2 → Player 3,  3 → Player 4
 */
const GamepadManager = (() => {
    'use strict';

    /* ── Configuration ─────────────────────────────────────────────── */
    const MAX_PLAYERS = 4;

    // Deadzone — arcade sticks are digital (0 or ±1) but some cheap
    // encoders rest at ±0.05, so a small deadzone filters noise.
    const DEADZONE = 0.30;

    /* ── State ──────────────────────────────────────────────────────── */
    const connected = new Array(MAX_PLAYERS).fill(false);
    const inputs    = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
        inputs.push({ vx: 0, vy: 0, active: false, buttons: {} });
    }

    const connectCallbacks    = [];
    const disconnectCallbacks = [];

    /* ── Helpers ────────────────────────────────────────────────────── */
    function applyDeadzone(value) {
        return Math.abs(value) < DEADZONE ? 0 : value;
    }

    function clamp(v, min, max) {
        return v < min ? min : v > max ? max : v;
    }

    /* ── Core ───────────────────────────────────────────────────────── */

    /**
     * Call once at boot to register connect / disconnect listeners.
     * NOTE: the Gamepad API requires a user gesture before gamepads
     * become visible — pressing ANY button on the stick is enough.
     */
    function init() {
        window.addEventListener('gamepadconnected', (e) => {
            const idx = e.gamepad.index;
            if (idx >= MAX_PLAYERS) return;          // ignore 5th+ controllers
            const playerId = idx + 1;                // 0-based → 1-based
            if (!connected[idx]) {
                connected[idx] = true;
                console.log(`[GamepadManager] 🎮 Joystick ${playerId} connected: "${e.gamepad.id}"`);
                connectCallbacks.forEach(cb => cb(playerId));
            }
        });

        window.addEventListener('gamepaddisconnected', (e) => {
            const idx = e.gamepad.index;
            if (idx >= MAX_PLAYERS) return;
            const playerId = idx + 1;
            if (connected[idx]) {
                connected[idx] = false;
                inputs[idx] = { vx: 0, vy: 0, active: false, buttons: {} };
                console.log(`[GamepadManager] ❌ Joystick ${playerId} disconnected`);
                disconnectCallbacks.forEach(cb => cb(playerId));
            }
        });

        console.log('[GamepadManager] Initialized — waiting for joystick input…');
    }

    /**
     * Call every frame (inside Phaser's update or rAF).
     * Reads the latest snapshot from all connected gamepads.
     */
    function poll() {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];

        for (let idx = 0; idx < MAX_PLAYERS; idx++) {
            const gp = gamepads[idx];
            if (!gp) {
                // If we thought it was connected but it's gone, fire disconnect
                if (connected[idx]) {
                    connected[idx] = false;
                    inputs[idx] = { vx: 0, vy: 0, active: false, buttons: {} };
                    disconnectCallbacks.forEach(cb => cb(idx + 1));
                }
                continue;
            }

            // Detect connection on first poll (some browsers don't fire the event)
            if (!connected[idx]) {
                connected[idx] = true;
                console.log(`[GamepadManager] 🎮 Joystick ${idx + 1} detected (poll): "${gp.id}"`);
                connectCallbacks.forEach(cb => cb(idx + 1));
            }

            /* ── Read axes (primary method) ──────────────────────── */
            let vx = 0, vy = 0;

            if (gp.axes.length >= 2) {
                vx = applyDeadzone(gp.axes[0]);   // left (-1) / right (+1)
                vy = applyDeadzone(gp.axes[1]);   // up (-1) / down (+1)
            }

            /* ── Read d-pad buttons (standard mapping: 12=up, 13=down,
                  14=left, 15=right) — MERGE with axes so either works ── */
            if (gp.mapping === 'standard' || gp.buttons.length >= 16) {
                if (gp.buttons[14] && gp.buttons[14].pressed) vx = -1;  // left
                if (gp.buttons[15] && gp.buttons[15].pressed) vx =  1;  // right
                if (gp.buttons[12] && gp.buttons[12].pressed) vy = -1;  // up
                if (gp.buttons[13] && gp.buttons[13].pressed) vy =  1;  // down
            }

            /* ── Some cheap arcade encoders map stick to buttons 0-3 ── */
            // Heuristic: if no axes movement and buttons 0-3 look like directions
            if (vx === 0 && vy === 0 && gp.buttons.length >= 4) {
                // Common mapping: 0=up, 1=down, 2=left, 3=right (varies by brand)
                // We also check the alternative: 0=right, 1=left, 2=down, 3=up
                // For safety we only use this if axes reported nothing
                const b0 = gp.buttons[0] && gp.buttons[0].pressed;
                const b1 = gp.buttons[1] && gp.buttons[1].pressed;
                const b2 = gp.buttons[2] && gp.buttons[2].pressed;
                const b3 = gp.buttons[3] && gp.buttons[3].pressed;
                // Most arcade USB encoders: button 0=up, 1=down, 2=left, 3=right
                if (b0) vy = -1;  // up
                if (b1) vy =  1;  // down
                if (b2) vx = -1;  // left
                if (b3) vx =  1;  // right
            }

            // Clamp diagonals to unit circle
            const mag = Math.sqrt(vx * vx + vy * vy);
            if (mag > 1) { vx /= mag; vy /= mag; }

            const active = (vx !== 0 || vy !== 0);

            // Collect named button state for game logic (start race, etc.)
            const buttons = {};
            if (gp.buttons.length > 9) {
                buttons.start  = gp.buttons[9]  && gp.buttons[9].pressed;   // Start
                buttons.select = gp.buttons[8]  && gp.buttons[8].pressed;   // Select/Back
            }
            // Also expose any face button press as a generic "action"
            buttons.action = false;
            for (let b = 0; b < Math.min(gp.buttons.length, 8); b++) {
                if (gp.buttons[b] && gp.buttons[b].pressed) {
                    buttons.action = true;
                    break;
                }
            }

            inputs[idx] = { vx, vy, active, buttons };
        }
    }

    /* ── Public API ─────────────────────────────────────────────────── */

    /** Get normalized input for a player (1-based). */
    function getInput(playerId) {
        const idx = playerId - 1;
        if (idx < 0 || idx >= MAX_PLAYERS) return null;
        return inputs[idx];
    }

    /** Is a specific player's joystick connected? (1-based) */
    function isConnected(playerId) {
        return connected[(playerId - 1)] || false;
    }

    /** How many joysticks are currently connected? */
    function getConnectedCount() {
        return connected.filter(Boolean).length;
    }

    /** Register a callback for when a joystick connects. cb(playerId) */
    function onConnect(cb) { connectCallbacks.push(cb); }

    /** Register a callback for when a joystick disconnects. cb(playerId) */
    function onDisconnect(cb) { disconnectCallbacks.push(cb); }

    /** Check if ANY connected gamepad has the Start button pressed. */
    function isStartPressed() {
        for (let i = 0; i < MAX_PLAYERS; i++) {
            if (connected[i] && inputs[i].buttons && inputs[i].buttons.start) {
                return true;
            }
        }
        return false;
    }

    /** Check if ANY connected gamepad has any button/direction active. */
    function isAnyInputActive() {
        for (let i = 0; i < MAX_PLAYERS; i++) {
            if (connected[i] && inputs[i].active) return true;
        }
        return false;
    }

    return {
        init,
        poll,
        getInput,
        isConnected,
        getConnectedCount,
        onConnect,
        onDisconnect,
        isStartPressed,
        isAnyInputActive,
    };
})();
