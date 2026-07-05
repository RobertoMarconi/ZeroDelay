// ZeroDelay — keep YouTube live streams in real time
// Author: João Gustavo França <joao@solitus.com.br> (https://github.com/joaogfc)
//
// Pure catch-up controller — the core "how fast should we play to trim latency"
// math, extracted from inject.js so it can be unit-tested without a browser.
//
// Dual-loaded on purpose:
//   • Browser: loaded as a CLASSIC script (before inject.js) and exposes
//     `window.ZeroDelay.createController`. `module` is undefined there, so the
//     CommonJS branch is skipped.
//   • Node/tests: the sibling `engine/package.json` ({"type":"commonjs"}) makes
//     Node treat this file as CommonJS even though the root package is ESM, so
//     `module.exports` works and `window` is undefined.
'use strict';
(function () {
    // Speeding up consumes the buffered-ahead content, pulling the playhead
    // toward real time, which REDUCES live latency. The rate is CONTINUOUS
    // (latency-proportional), but it only ever spends buffer that sits ABOVE
    // the mode's cushion: the bufferTarget is the equilibrium the buffer rests
    // at, not just a taper width. A stream whose latency floor is unreachable
    // (every real live: encoder+CDN pipeline keeps latency well above
    // MIN_LATENCY) must NOT grind the buffer down to the stall floor trying —
    // that exact regression shipped in v1.2.0 and stalled lives worldwide:
    // demand saturated forever, the only rest was STALL_FLOOR=1.5s, and the
    // engine held ~1.05x with no margin until any late segment stalled the
    // stream (then the buffer refilled behind live and the cycle repeated).
    function createController() {
        const STALL_FLOOR = 1.5;       // hard rest below this instantaneous buffer (stall protection)
        const BUFFER_BACKOFF = 2.5;    // instantaneous backoff: cut acceleration here...
        const BUFFER_RESUME = 4.0;     // ...and only allow it again once recovered to this
        const MIN_LATENCY = 2.0;       // already this close to live -> nothing to gain
        const LATENCY_FULL = 6.0;      // excess latency (s) past the floor at which we reach full speed
        const RAMP = 2.0;              // full speed once the buffer sits this far above the cushion
        const ENGAGE_BAND = 1.5;       // hysteresis: only engage this far above the cushion
        const DRAIN_BRAKE = -0.02;     // Δbuffer/tick below which we rest pre-emptively (issue #12)

        let buffer_ema = null;         // smoothed buffer health
        let last_health = null;        // previous tick's raw buffer health
        let drain_ema = 0;             // smoothed Δbuffer/tick (draining < 0, filling > 0)
        let engaged = false;           // catch-up hysteresis state
        let backoff_ok = true;         // instantaneous-buffer backoff state
        let auto_target = 6.0;         // automatic-mode buffer cushion
        let auto_cooldown = 0;         // ticks to wait after a near-stall
        let last_rate = 1.0;           // last rate we returned (diagnostics)

        function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

        // Automatic mode: adapt the buffer cushion to the connection over time.
        function auto_buffer_target(health) {
            if (isFinite(health) && health < 1.0) {              // a near-stall just happened
                auto_target = Math.min(9.0, auto_target + 1.0);    // back off: keep more buffer
                auto_cooldown = 240;                               // ~60s at 250ms
            } else if (auto_cooldown > 0) {
                auto_cooldown--;
            } else if (buffer_ema !== null && buffer_ema > auto_target + 2.0) {
                auto_target = Math.max(4.0, auto_target - 0.01);   // calm -> creep closer to live
            }
            return auto_target;
        }

        // Returns the playback rate to apply this tick — a continuous value
        // between 1.0 (rest) and `speed` (the mode's max, e.g. 1.25).
        function calcPlaybackRate(speed, latency, health, bufferTarget, auto) {
            if (!isFinite(health) || !isFinite(latency)) return (last_rate = 1.0);
            buffer_ema = buffer_ema === null ? health : buffer_ema * 0.9 + health * 0.1;
            // Buffer trend (first derivative, short EMA). A steadily draining
            // buffer means the connection is losing ground even while the level
            // still looks fine — the predictive brake behind issue #12.
            if (last_health !== null) drain_ema = drain_ema * 0.8 + (health - last_health) * 0.2;
            last_health = health;
            if (latency < MIN_LATENCY) return (last_rate = 1.0);   // already at the stream's floor

            // Resolve the cushion first so automatic mode keeps adapting (a
            // near-stall must still raise the target) before any early rest.
            const target = auto ? auto_buffer_target(health) : bufferTarget;
            if (health < STALL_FLOOR) return (last_rate = 1.0);    // instantaneous stall guard

            // Instantaneous backoff hysteresis (the third field-proven guard):
            // a raw dip to 2.5s cuts acceleration NOW — no EMA, no taper — and
            // it stays cut until the raw level recovers to 4.0s. This protects
            // the descent phase, where a jitter trough near the band bottom is
            // exactly how late segments used to become stalls.
            if (health <= BUFFER_BACKOFF) backoff_ok = false;
            else if (health >= BUFFER_RESUME) backoff_ok = true;
            if (!backoff_ok) return (last_rate = 1.0);

            // The EMA smooths upward noise, but a REAL drop must bite at once —
            // taking the min means a fast segment-sized dip can never hide
            // behind a stale, fatter average.
            const buffer_now = Math.min(health, buffer_ema);

            // Pre-emptive brake (issue #12): don't push against a connection
            // that's already losing ground — rest BEFORE the level dips toward
            // a stall. Unconditional like the field-proven original: while
            // genuinely behind, downloads outpace playback (the trend is
            // positive) and the brake never fires; at the live edge it turns
            // surplus-spending into short, safe pushes. The brake keeps the
            // hysteresis state: once the trend recovers we resume mid-band.
            if (drain_ema < DRAIN_BRAKE) return (last_rate = 1.0);

            // Hysteresis (the old controller's field-proven CATCH_UP_BAND):
            // engage only once the buffer sits comfortably ABOVE the cushion,
            // disengage the moment it touches the cushion. Without the band the
            // engine rides pinned to the target, spending every crumb of
            // surplus, and segment jitter has no margin to land in.
            // Arming reads the SLOW ema on purpose: a momentary spike must not
            // re-arm a parked engine into sawtooth cycling at the band bottom —
            // only sustained comfort does. Resting reads the fast signal.
            if (engaged) { if (buffer_now <= target) engaged = false; }
            else if (buffer_ema > target + ENGAGE_BAND) engaged = true;
            if (!engaged) return (last_rate = 1.0);

            // 1) Linear demand from latency: 0 at the floor, ramping up to 1
            //    once we're LATENCY_FULL seconds behind it.
            const demand = clamp01((latency - MIN_LATENCY) / LATENCY_FULL);

            // 2) Buffer SURPLUS above the mode's cushion: 0 at/below the target
            //    (rest — the cushion is the equilibrium), ramping to 1 once the
            //    buffer sits RAMP seconds above it. Catch-up spends only the
            //    surplus; it never digs into the cushion itself.
            const headroom = clamp01((buffer_now - target) / RAMP);

            const rate = 1.0 + (speed - 1.0) * demand * headroom;
            return (last_rate = rate);
        }

        // Read-only snapshot of internal state — for tests and diagnostics.
        function getState() {
            return { buffer_ema, drain_ema, engaged, auto_target, auto_cooldown, rate: last_rate, catching_up: last_rate > 1.001 };
        }

        // The buffer level below which the UI should warn (red) — exported so the
        // player indicator and the controller share one source of truth.
        return { calcPlaybackRate, getState, WARN_BUFFER: STALL_FLOOR + 1.0 };
    }

    // ----------------------------------------------------------------------
    // "Stable" (band) controller. Same goal as the classic one above — keep you
    // close to live — but built for connections that WOBBLE. Two differences make
    // it survive oscillation where the classic modes stall:
    //   1. it targets a chosen distance-behind-live `center` (the slider, seconds)
    //      instead of always chasing the ~2s edge, so it holds a real cushion;
    //   2. it will play BELOW 1.0x to REBUILD the buffer when it starves — the
    //      classic controller never does (it only speeds up or rests, hoping the
    //      network refills on its own).
    //
    // One rule drives it, no branches:
    //
    //     rate = 1 + chase - rebuild
    //
    //   • chase  (>= 0): speed up toward live, in proportion to how far past
    //                    `center` the LATENCY is (capped), BRAKED by buffer safety;
    //   • rebuild(>= 0): slow below 1.0x to refill a starving cushion, eased out as
    //                    latency climbs so we can't drift behind live forever.
    // A single buffer-safety factor (0 at the stall floor, 1 at/above the center)
    // gates both: healthy cushion -> chase freely, no rebuild; thin cushion -> stop
    // chasing and rebuild. Because latency is read directly (not through the lagging
    // buffer EMA), it settles onto the target instead of overshooting it. The 30s
    // skip in inject.js is the final backstop; `center` is clamped defensively (the
    // popup already caps it to [2, 6]).
    function createBandController(center) {
        const STALL_FLOOR = 1.5;   // buffer danger line: below it we play <1.0x to rebuild
        const SLOW_MIN = 0.90;     // slowest playback while rebuilding
        const MAX_RATE = 1.15;     // fastest playback while chasing live (calmer than the aggressive modes)
        const CHASE_GAIN = 0.05;   // +rate per second of latency beyond the target
        const DRIFT_CEIL = 12.0;   // stop rebuilding (let latency hold) once this far behind
        const DRIFT_SPAN = 5.0;    // ease the rebuild out over the seconds before the ceiling

        const C = Math.min(6.0, Math.max(2.0, isFinite(center) ? center : 3.5));
        const SPAN = Math.max(0.5, C - STALL_FLOOR); // buffer range the safety factor spans

        let buffer_ema = null;     // smoothed buffer health (same EMA as the classic one)
        let last_rate = 1.0;

        function clamp(x, lo, hi) { return x < lo ? lo : x > hi ? hi : x; }

        // Signature mirrors the classic controller (speed/bufferTarget/auto are
        // ignored) so inject.js drives both through one code path.
        function calcPlaybackRate(_speed, latency, health) {
            if (!isFinite(health)) return (last_rate = 1.0);
            buffer_ema = buffer_ema === null ? health : buffer_ema * 0.9 + health * 0.1;
            const b = buffer_ema;

            // Buffer safety: 1 when the cushion is at/above the target, 0 at (or
            // below) the stall floor. Its complement is the rebuild "deficit".
            const safety = clamp((b - STALL_FLOOR) / SPAN, 0, 1);

            // OBJECTIVE — chase live: how far past the target latency we are, turned
            // into a catch-up rate (capped), then braked by buffer safety. Zero once
            // we're at/inside the target, so it never speeds up past live.
            const behind = isFinite(latency) ? Math.max(0, latency - C) : 0;
            const chase = Math.min(CHASE_GAIN * behind, MAX_RATE - 1.0) * safety;

            // SAFETY — rebuild: slow below 1.0x to refill a thin cushion (hardest at
            // the floor), but eased out as latency climbs so a weak link can't keep
            // us slowing while we drift ever further behind (30s skip is the backstop).
            const budget = isFinite(latency) ? clamp((DRIFT_CEIL - latency) / DRIFT_SPAN, 0, 1) : 1;
            const rebuild = (1.0 - SLOW_MIN) * (1 - safety) * budget;

            return (last_rate = 1.0 + chase - rebuild);
        }

        function getState() {
            return {
                buffer_ema, center: C, rate: last_rate,
                catching_up: last_rate > 1.001,
                rebuilding: last_rate < 0.999,
            };
        }

        // Warn (red) roughly a second below the center, but never above the
        // classic threshold — so a small center doesn't paint the chip red always.
        return { calcPlaybackRate, getState, center: C, WARN_BUFFER: Math.min(2.5, Math.max(1.5, C - 1.0)) };
    }

    const api = { createController, createBandController };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (typeof window !== 'undefined') {
        const zd = (window.ZeroDelay = window.ZeroDelay || {});
        zd.createController = createController;
        zd.createBandController = createBandController;
    }
}());
