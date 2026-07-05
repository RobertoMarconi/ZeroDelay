// ZeroDelay — keep YouTube live streams in real time
// Author: João Gustavo França <joao@solitus.com.br> (https://github.com/joaogfc)

(() => {
    // Catch-up control logic lives in engine/controller.js (a classic script
    // injected just before this one) — unit-tested in test/controller.test.mjs.
    // If it somehow didn't load, we stay safely at 1.0x (no acceleration).
    // A fresh controller is created per attach (see detect_and_attach) so one
    // stream's EMAs/hysteresis never steer the first seconds of the next one.
    const zd = (typeof window !== 'undefined' && window.ZeroDelay) ? window.ZeroDelay : null;
    const classicFactory = (zd && typeof zd.createController === 'function') ? zd.createController : null;
    const bandFactory = (zd && typeof zd.createBandController === 'function') ? zd.createBandController : null;

    // Pick the controller for the current settings: the buffer-centric "Estável"
    // (band) controller when `band` is on, otherwise the classic catch-up one.
    // Both expose the same calcPlaybackRate signature so the hot loop is agnostic.
    function make_controller(settings) {
        const s = settings || {};
        if (s.band && bandFactory) return bandFactory(s.centerBuffer);
        return classicFactory ? classicFactory() : null;
    }

    let controller = make_controller(null);
    let controller_band = false;   // whether `controller` is the band variant
    let controller_center = null;  // its center (to detect slider changes)
    // Buffer level below which the health indicator turns red — shared with the
    // controller's own back-off threshold (falls back if the controller is absent).
    const BUFFER_WARN = controller ? controller.WARN_BUFFER : 2.5;

    // Build "<span translate="no">TEXT</span>" via DOM (no innerHTML): avoids the
    // Trusted-Types dependency on YouTube and the addons-linter UNSAFE_VAR_ASSIGNMENT
    // warning. translate="no" keeps Google Translate from mangling the numbers.
    function setChip(el, text) {
        el.textContent = '';
        const span = document.createElement('span');
        span.setAttribute('translate', 'no');
        span.textContent = text;
        el.appendChild(span);
    }

    function update_playbackRate(playbackRate) {
        const video = video_instance();
        if (video) {
            setChip(button_playbackrate, video.playbackRate.toFixed(2) + 'x');

            if (video.playbackRate === playbackRate) {
                button_playbackrate.style.color = '#ff8983';
            } else {
                button_playbackrate.style.color = '#eee';
            }

            button_playbackrate.style.display = 'inline-block';
        } else {
            button_playbackrate.style.display = 'none';
        }
    }

    function hide_playbackRate() {
        button_playbackrate.style.display = 'none';
    }

    function update_latency(latency, isAtLiveHead) {
        if (isAtLiveHead) {
            setChip(button_latency, isFinite(latency) ? latency.toFixed(2) + 's' : '—');
        } else {
            setChip(button_latency, '(DVR)');
        }

        button_latency.style.display = 'inline-block';
    }

    function hide_latency() {
        button_latency.style.display = 'none';
    }

    function update_health(health) {
        setChip(button_health, isFinite(health) ? health.toFixed(2) + 's' : '—');

        // Warn (red) when the buffer is running low.
        if (health < BUFFER_WARN) {
            button_health.style.color = '#ff8983';
        } else {
            button_health.style.color = '#eee';
        }

        button_health.style.display = 'inline-block';
    }

    function hide_health() {
        button_health.style.display = 'none';
    }

    function update_estimation(seekableEnd, current, isAtLiveHead) {
        const video = video_instance();
        if (!video) {
            hide_estimation();
            return;
        }
        addWithLimit(seekableEnds, seekableEnd);
        const streamHasProbablyEnded = allElementsEqual(seekableEnds);
        const estimated_seconds = (seekableEnd - current) / (streamHasProbablyEnded ? video.playbackRate : video.playbackRate - 1.0);
        if (!isAtLiveHead && isFinite(estimated_seconds)) {
            const estimated_time = new Date(Date.now() + estimated_seconds * 1000.0).toLocaleTimeString();
            setChip(button_estimation, '(' + estimated_time + ')');
            button_estimation.style.display = 'inline-block';
        } else {
            button_estimation.style.display = 'none';
        }
    }

    function hide_estimation() {
        button_estimation.style.display = 'none';
    }

    function update_current(current, seekableEnd, isAtLiveHead, videoId) {
        const current_time = isFinite(current) ? format_time(current) : '--:--';

        if (isAtLiveHead) {
            setChip(button_current, current_time);
        } else {
            const seekableEnd_time = isFinite(seekableEnd) ? format_time(seekableEnd) : '--:--';
            setChip(button_current, current_time + ' / ' + seekableEnd_time);
        }

        if (videoId) {
            const current_time_url = addParamsToUrl('https://www.youtube.com/watch', { v: videoId, t: format_time_hms(current) });
            button_current.setAttribute('current', `${current_time_url}#\n${current_time}`);
        } else {
            button_current.removeAttribute('current'); // no video id — nothing valid to copy
        }

        button_current.style.display = 'inline-block';
    }

    function hide_current() {
        button_current.style.display = 'none';
    }

    // --- Playback-rate controller -------------------------------------------
    // IMPORTANT: modern YouTube live (SABR / "manifestless") REVERTS direct
    // `video.playbackRate` changes within ~250ms, so the only reliable way to
    // speed up is the player API `setPlaybackRate()`. We remember the rate we
    // applied; if the player's rate diverges we assume the viewer changed it and
    // yield to them, re-engaging once they go back to 1.0x.
    //
    // The live player only accepts rates on a 0.05 grid (measured on production
    // players: asking 1.0375 applies 1.0, asking 1.06 applies 1.05). So we (a)
    // quantize what we ask to the grid, and (b) adopt the player's own echo as
    // `applied_rate` right after setting — otherwise the quantized echo differs
    // from what we asked, the divergence check reads it as a viewer override,
    // and the engine locks itself out with the live stuck at e.g. 1.05x while
    // the buffer dies (the v1.2.0 "1.05x" bug).
    let applied_rate = 1.0;
    let yielded_to_user = false;

    const RATE_STEP = 0.05;   // the player's accepted playback-rate granularity
    function quantize_rate(r) { return Math.round(r / RATE_STEP) * RATE_STEP; }

    function apply_playback_rate(desired) {
        if (!player?.setPlaybackRate || !player?.getPlaybackRate) return;
        const cur = player.getPlaybackRate();
        if (Math.abs(cur - applied_rate) > 0.01) {
            if (Math.abs(cur - 1.0) < 0.01) {
                applied_rate = 1.0;      // reset to 1.0 (YouTube reset or viewer) -> re-engage
                yielded_to_user = false;
            } else {
                yielded_to_user = true;  // viewer picked a specific speed -> yield
                applied_rate = cur;
            }
        }
        if (yielded_to_user) return;
        const grid = quantize_rate(desired);
        if (Math.abs(grid - applied_rate) > 0.01) {
            player.setPlaybackRate(grid);
            // The echo is authoritative: whatever the player actually adopted
            // is what the next tick must compare against, so quantization can
            // never masquerade as a viewer override.
            applied_rate = player.getPlaybackRate();
        }
    }

    function set_playbackRate(speed, latency, health, bufferTarget, auto) {
        if (!controller) return;
        apply_playback_rate(controller.calcPlaybackRate(speed, latency, health, bufferTarget, auto));
    }

    function reset_playbackRate() {
        if (applied_rate !== 1.0 && !yielded_to_user) {
            apply_playback_rate(1.0);
        }
    }

    // Catch-up control logic + its tunables/state now live in
    // engine/controller.js (unit-tested via test/controller.test.mjs).

    // (`skipThreathold` keeps the storage key's historical typo — see common.js.)
    function skip_if_over_threshold(latency, skipThreathold) {
        if (!caps?.seekLive || !caps?.stateObject) return;
        if (player && latency >= skipThreathold) {
            if (player.getPlayerStateObject()?.isPlaying) {
                player.seekToLiveHead();
                if (caps.playVideo) player.playVideo();
            }
        }
    }

    /** Jump to the live edge on demand (keyboard shortcut / popup chip). No latency threshold — the viewer asked for it. */
    function seek_to_live() {
        if (!player || !caps?.seekLive) return;
        player.seekToLiveHead();
        if (caps.playVideo) player.playVideo();
    }

    function video_instance() {
        if (!video?.parentNode && player) {
            video = player.querySelector('video.html5-main-video');
        }
        return video;
    }

    function format_time(seconds) {
        const hs = Math.floor(seconds / 3600.0);
        const ms = Math.floor((seconds % 3600) / 60.0);
        const ss = Math.floor(seconds % 60);

        const h = hs > 0 ? `${String(hs)}:` : '';
        const m = String(ms).padStart(hs > 0 ? 2 : 1, '0');
        const s = String(ss).padStart(2, '0');

        return `${h}${m}:${s}`;
    }

    function format_time_hms(seconds) {
        const hs = Math.floor(seconds / 3600.0);
        const ms = Math.floor((seconds % 3600) / 60.0);
        const ss = Math.floor(seconds % 60);

        const h = hs > 0 ? `${String(hs)}h` : '';
        const m = String(ms).padStart(hs > 0 ? 2 : 1, '0');
        const s = String(ss).padStart(2, '0');

        return `${h}${m}m${s}s`;
    }

    function addWithLimit(arr, newElement, limit = 5) {
        arr.push(newElement);
        if (arr.length > limit) {
            arr.splice(0, arr.length - limit);
        }
        return arr;
    }

    function allElementsEqual(arr, limit = 5) {
        if (arr.length < limit) return false;
        return arr.every(el => el === arr[0]);
    }

    function addParamsToUrl(url, params) {
        const urlObj = new URL(url);
        for (const [key, value] of Object.entries(params)) {
            urlObj.searchParams.set(key, value);
        }
        return urlObj.toString();
    }

    function create_elem(elem_name, elem_classes) {
        const elem = document.createElement(elem_name);
        elem.classList.add(...elem_classes);
        elem.style.display = 'none';
        elem.style.cursor = 'default';
        elem.style.textAlign = 'center';
        elem.style.width = 'auto';
        elem.style.height = 'auto';
        elem.style.color = '#eee';
        elem.style.fontWeight = 'normal';
        elem.style.paddingLeft = '8px';
        elem.style.paddingRight = '8px';
        return elem;
    }

    const button_playbackrate = create_elem('button', ['_live_catch_up_playbackrate', 'ytp-button']);

    const button_latency = create_elem('button', ['_live_catch_up_latency', 'ytp-button']);

    const button_health = create_elem('button', ['_live_catch_up_health', 'ytp-button']);

    const button_estimation = create_elem('button', ['_live_catch_up_estimation', 'ytp-button']);

    const msg_current = create_elem('button', ['_live_catch_up_msg_current', 'ytp-button']);
    setChip(msg_current, 'Copied!');
    msg_current.style.position = 'fixed';

    const button_current = create_elem('button', ['_live_catch_up_current', 'ytp-button']);
    button_current.addEventListener('click', () => {
        const link = button_current.getAttribute('current');
        if (!link) return;
        navigator.clipboard.writeText(link);

        msg_current.style.translate = '-32px -16px';
        msg_current.style.display = 'inline-block';

        clearTimeout(msg_current_timeout);
        msg_current_timeout = setTimeout(() => {
            msg_current.style.display = 'none';
        }, 4000);
    });

    let player;
    let video;
    let interval;
    let interval_count = 0;
    let seekableEnds = [];
    let msg_current_timeout;
    let current_settings;
    let last_active_ping = 0;
    let last_meta_key = null;     // dedupes _live_catch_up_video_meta dispatches

    // --- Resilience state (R1/R2/R3) ----------------------------------------
    // The engine drives entirely off UNDOCUMENTED player methods. `caps` records
    // which ones actually exist (probed once per attach); the hot loop is guarded
    // so a YouTube-side refactor degrades gracefully instead of throwing 4x/sec.
    let caps = null;              // probed player capabilities (or null)
    let engine_degraded = false;  // gave up until the next navigation
    let tick_errors = 0;          // consecutive errors in the hot loop
    let bound_video = null;       // video element we've attached listeners to
    let detect_interval = null;   // player-detection poll (managed by start_detection)
    const MAX_TICK_ERRORS = 8;    // ~2s of failures in a row before giving up

    // --- Stall watchdog ------------------------------------------------------
    // If the live keeps buffering while the extension is enabled, the chosen
    // mode is probably too aggressive for this connection. We notify the content
    // script, which offers a one-tap switch to a calmer, more-buffered mode.
    let stall_times = [];
    let last_stall = 0;
    let stall_cooldown_until = 0;
    // Only real LIVE buffering counts. On a VOD/replay 'waiting' is just normal
    // seeking, and while an AD plays it buffers in the SAME <video> element — both
    // fire 'waiting' and are false positives, so we skip them.
    function is_live_stream() {
        try { return player?.getVideoData?.()?.isLive === true; } catch { return false; }
    }
    function is_ad_showing() {
        const cl = player?.classList;
        return !!cl && (cl.contains('ad-showing') || cl.contains('ad-interrupting'));
    }
    function on_video_waiting() {
        if (!current_settings?.enabled) return;
        if (!is_live_stream() || is_ad_showing()) return;   // live only; never during ads
        const now = Date.now();
        if (now < stall_cooldown_until || now - last_stall < 5000) return;
        last_stall = now;
        stall_times = stall_times.filter(t => now - t < 90000);
        stall_times.push(now);
        if (stall_times.length >= 2) {
            stall_times = [];
            stall_cooldown_until = now + 300000; // ~5 min before offering again
            document.dispatchEvent(new CustomEvent('_live_catch_up_stall'));
        }
    }

    // --- Resilience helpers (R1/R3) -----------------------------------------
    // Probe the private player API surface once, so a missing method is a known
    // "skip that feature" instead of a per-tick exception.
    function probe_caps(p) {
        const has = name => typeof p?.[name] === 'function';
        return {
            stats: has('getStatsForNerds'),
            progress: has('getProgressState'),
            videoData: has('getVideoData'),
            setRate: has('setPlaybackRate'),
            getRate: has('getPlaybackRate'),
            seekLive: has('seekToLiveHead'),
            playVideo: has('playVideo'),
            stateObject: has('getPlayerStateObject'),
        };
    }

    function hideAllIndicators() {
        hide_playbackRate();
        hide_latency();
        hide_health();
        hide_estimation();
        hide_current();
    }

    let a11y_labeled = false;
    /**
     * Set screen-reader labels on the player indicators (once; they're static).
     * @param {{playbackRate: string, latency: string, health: string, estimation: string, current: string}} labels - Localized strings from the settings detail (the engine has no chrome.i18n).
     */
    function apply_a11y_labels(labels) {
        if (a11y_labeled || !labels) return;
        const pairs = [
            [button_playbackrate, labels.playbackRate],
            [button_latency, labels.latency],
            [button_health, labels.health],
            [button_estimation, labels.estimation],
            [button_current, labels.current],
        ];
        for (const [el, text] of pairs) if (text) el.setAttribute('aria-label', text);
        a11y_labeled = true;
    }

    // Give up until the next navigation, once, without spamming the console. A
    // fresh (re)attach — initial load or SPA nav — clears this and retries.
    function degrade(reason) {
        if (engine_degraded) return;
        engine_degraded = true;
        clearInterval(interval);
        hideAllIndicators();
        console.warn(`[ZeroDelay] Paused: the YouTube player API looks different (${reason}). It will retry on the next video/navigation.`);
    }

    // One iteration of the hot loop, always called inside guarded_tick's
    // try/catch. Every private-API call is gated by `caps`; when the stats say
    // this isn't a catch-up-able live, indicators are hidden (never left stale).
    function run_tick(settings) {
        if (!caps || !caps.stats) { degrade('getStatsForNerds missing'); return; }

        const stats_for_nerds = player.getStatsForNerds();
        if (!stats_for_nerds || stats_for_nerds.live_latency_style !== '') {
            hideAllIndicators();
            return;
        }

        const latency = Number.parseFloat(stats_for_nerds.live_latency_secs);
        const health = Number.parseFloat(stats_for_nerds.buffer_health_seconds);
        const progress_state = caps.progress ? player.getProgressState() : null;

        // Throttled "watching a live" ping — drives usage tracking in the
        // content script (so only real live time counts).
        const active_now = Date.now();
        if (active_now - last_active_ping > 2000) {
            last_active_ping = active_now;
            document.dispatchEvent(new CustomEvent('_live_catch_up_active'));
        }

        if (caps.setRate && caps.getRate) {
            settings.enabled
                ? set_playbackRate(settings.playbackRate, latency, health, settings.bufferTarget, settings.auto)
                : reset_playbackRate();
        }

        if (settings.skip) {
            skip_if_over_threshold(latency, settings.skipThreathold);
        }

        const want_update = interval_count++ % 4 === 0;
        settings.showPlaybackRate ? update_playbackRate(settings.playbackRate) : hide_playbackRate();
        if (progress_state) {
            settings.showLatency ? (want_update && update_latency(latency, progress_state.isAtLiveHead)) : hide_latency();
            settings.showHealth ? (want_update && update_health(health)) : hide_health();
            settings.showEstimation ? (want_update && update_estimation(progress_state.seekableEnd, progress_state.current, progress_state.isAtLiveHead)) : hide_estimation();
            settings.showCurrent ? update_current(progress_state.current, progress_state.seekableEnd, progress_state.isAtLiveHead, caps.videoData ? player.getVideoData()?.video_id : undefined) : hide_current();
        } else {
            hide_latency();
            hide_health();
            hide_estimation();
            hide_current();
        }
    }

    // Guards the 4x/second loop: a single YouTube-side change can't spin
    // exceptions forever — after MAX_TICK_ERRORS in a row we stop and wait for
    // the next navigation to retry (see degrade / detect_and_attach).
    function guarded_tick() {
        if (!player || engine_degraded) return;
        const settings = current_settings;
        if (!settings) return;
        try {
            run_tick(settings);
            tick_errors = 0;
        } catch (e) {
            if (++tick_errors >= MAX_TICK_ERRORS) degrade(e?.message || 'exception');
        }
    }

    // --- Background-proof tick driver ----------------------------------------
    // Chrome throttles hidden-tab timers to 1/s, and to 1/min after 5 minutes
    // (unless audible) — on a pure setInterval the engine slept while the tab
    // was minimized: no catch-up, no skip, stale chips, and the viewer came
    // back to a DVR'd stream 20s+ behind. 'timeupdate' comes from the media
    // pipeline, not the timer queue, so it keeps firing ~4x/s while the video
    // plays even in hidden tabs. Both drivers land on one shared throttle so
    // the foreground rate stays ~4-5 ticks/s (the controller's EMAs and the
    // auto-mode cooldown are tuned for 250ms ticks).
    let last_tick_ms = 0;
    function on_engine_tick() {
        const now = Date.now();
        if (now - last_tick_ms < 200) return;
        last_tick_ms = now;
        guarded_tick();
    }

    // Coming back to the foreground: tick immediately (fresh chips, and the
    // catch-up/skip logic sees the accumulated latency right away).
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            last_tick_ms = 0;
            on_engine_tick();
        }
    });

    document.addEventListener('_live_catch_up_load_settings', e => {
        const settings = e.detail;
        if (!settings) return; // Firefox X-ray edge: detail failed to cross worlds
        current_settings = settings;
        if (settings.copiedLabel) {
            setChip(msg_current, settings.copiedLabel);
        }
        apply_a11y_labels(settings.a11yLabels);

        // Swap the controller only when the mode TYPE or the band center actually
        // changed — toggling an indicator must not reset the EMA. Switching
        // between classic and band (or moving the slider) starts a fresh EMA,
        // which is what we want for a behavior change.
        const wantBand = !!settings.band;
        if (!controller || wantBand !== controller_band || (wantBand && settings.centerBuffer !== controller_center)) {
            controller = make_controller(settings);
            controller_band = wantBand;
            controller_center = settings.centerBuffer;
        }

        clearInterval(interval);
        if (engine_degraded) return; // paused until the next navigation retries
        if (settings.enabled || settings.skip || settings.showPlaybackRate || settings.showLatency || settings.showHealth || settings.showEstimation || settings.showCurrent) {
            // Fallback driver for paused/idle states — while the video PLAYS,
            // 'timeupdate' (bound in detect_and_attach) is what actually keeps
            // the loop alive in throttled background tabs.
            interval = setInterval(on_engine_tick, 250);
        } else {
            reset_playbackRate();
            hideAllIndicators();
        }
    });

    document.addEventListener('_live_catch_up_go_live', seek_to_live);

    // --- MODO HEXA bridge ----------------------------------------------------
    // The content script (isolated world) owns the theme but cannot call the
    // private player API, so we report the current video's identity/liveness
    // to it. It parses the title for a Brazil match and toggles the theme.
    // Deduped by (video_id, isLive, title) so navigation/title changes flip the
    // theme but a stable live doesn't spam the isolated world.
    function dispatch_video_meta() {
        const p = document.getElementById('movie_player');
        let title = '', author = '', isLive = false, video_id = '', channel_id = '';
        if (p && typeof p.getVideoData === 'function') {
            let vd;
            try { vd = p.getVideoData(); } catch { vd = null; }
            if (vd) {
                title = vd.title || '';
                author = vd.author || '';
                video_id = vd.video_id || '';
                channel_id = vd.channel_id || '';   // stable per-channel key (per-channel mode memory)
                isLive = !!vd.isLive; // false for VOD/replay — blocks non-live Brazil games
            }
        }
        const key = video_id + '|' + isLive + '|' + title;
        if (key === last_meta_key) return;
        last_meta_key = key;
        document.dispatchEvent(new CustomEvent('_live_catch_up_video_meta', {
            detail: { title, author, isLive, video_id, channel_id },
        }));
    }

    // --- Player detection + (re)attach (R2) ---------------------------------
    // Runs on first load AND on every SPA navigation (YouTube reuses the tab and
    // may rebuild the player bar). Idempotent: video listeners bind once per
    // element, buttons are only re-inserted when they've been detached.
    function buttons_attached(area) {
        return button_playbackrate.isConnected && area.contains(button_playbackrate);
    }

    function detect_and_attach() {
        player = document.getElementById("movie_player");
        if (!player) return false;

        const v = video_instance();
        if (!v) return false;

        const time_display = document.getElementsByTagName('player-time-display')[0];
        let area;
        let button_live_badge;
        if (time_display) { // new-style YouTube embedded player
            area = time_display.querySelector('div.ytwPlayerTimeDisplayLiveDot');
            if (!area) return false;

            button_live_badge = time_display.querySelector('div.ytwPlayerTimeDisplayLiveDot > div');
            if (!button_live_badge) return false;
        } else {
            area = player.querySelector('div.ytp-time-display:has(button.ytp-live-badge) div.ytp-time-wrapper');
            if (!area) return false;

            button_live_badge = player.querySelector('button.ytp-live-badge');
            if (!button_live_badge) return false;
        }

        // Probe the private API surface once per attach and clear any prior
        // degraded state so a new stream/page gets a fresh chance.
        caps = probe_caps(player);
        engine_degraded = false;
        tick_errors = 0;

        // Fresh stream, fresh controller state: EMAs/hysteresis measured on the
        // previous live must not steer the first seconds of this one.
        // (applied_rate is kept — apply_playback_rate's divergence logic already
        // handles whatever rate the new player starts at.) The variant is chosen
        // from the settings we have so far; load_settings re-syncs if they change.
        controller = make_controller(current_settings);
        controller_band = !!(current_settings && current_settings.band);
        controller_center = current_settings ? current_settings.centerBuffer : null;
        seekableEnds = [];

        // The stall watchdog counts buffering events for THIS stream (a mode too
        // aggressive for this connection). Reset the count on a fresh stream, or a
        // stall on the previous live would combine with one here into a spurious
        // "switch to a calmer mode" offer. The nag cooldown (stall_cooldown_until)
        // is intentionally kept — don't re-offer while channel-surfing right after
        // a dismissal.
        stall_times = [];
        last_stall = 0;

        if (bound_video !== v) {
            // Detach the previous <video>'s listeners before binding the new one,
            // so the old element can be garbage-collected after a live→live
            // navigation instead of being pinned by the closure (PR #17). The
            // `ratechange` listener was dropped entirely — nothing consumes it.
            if (bound_video) {
                bound_video.removeEventListener('waiting', on_video_waiting);
                bound_video.removeEventListener('timeupdate', on_engine_tick);
            }
            v.addEventListener('waiting', on_video_waiting);
            v.addEventListener('timeupdate', on_engine_tick);   // background-proof tick driver
            bound_video = v;
        }

        if (!buttons_attached(area)) {
            let prev = undefined;
            for (const elem of [button_live_badge, button_playbackrate, button_latency, button_health, button_current, msg_current, button_estimation].reverse()) {
                area.insertBefore(elem, prev);
                prev = elem;
            }
        }

        dispatch_video_meta();   // player is up + getVideoData ready → tell the theme
        document.dispatchEvent(new CustomEvent('_live_catch_up_init'));
        return true;
    }

    const FAST_DETECT_MS = 500;
    const SLOW_DETECT_MS = 5000;
    const FAST_DETECT_ATTEMPTS = 40;   // ~20s of fast polling, then back off

    function stop_detection() {
        clearInterval(detect_interval);
        detect_interval = null;
    }

    // Poll fast right after (re)load/navigation, when the player bar is about
    // to appear. Most frames (VOD pages, playerless iframes) never get a live
    // player, so after FAST_DETECT_ATTEMPTS we drop to a slow probe instead of
    // polling at 500ms forever — still catching pages that only *become* a live
    // later (premieres / scheduled streams) without any navigation event.
    function start_detection(fast = true) {
        stop_detection();
        if (detect_and_attach()) return;   // ready right now
        let attempts = 0;
        detect_interval = setInterval(() => {
            // Also refresh the theme's view of the current video even when the
            // live badge isn't found (non-live pages, miniplayer) so it can
            // deactivate — or stay active while a Brazil live plays minimized.
            dispatch_video_meta();
            if (detect_and_attach()) stop_detection();
            else if (fast && ++attempts >= FAST_DETECT_ATTEMPTS) start_detection(false);
        }, fast ? FAST_DETECT_MS : SLOW_DETECT_MS);
    }

    start_detection();

    // SPA navigation: re-attach (idempotent) so indicators/catch-up survive
    // moving between lives without a full page reload.
    document.addEventListener('yt-navigate-finish', () => start_detection(true));
})();