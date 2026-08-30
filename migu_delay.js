// ==UserScript==
// @name         Migu Live Delay Lock
// @namespace    migu-live-delay
// @version      5.4
// @description  咪咕直播固定 Delay，阻止播放器自動追返 LIVE
// @match        https://www.miguvideo.com/p/live/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    const DEFAULT_DELAY = 10.0;
    const KEY_DELAY = 'migu_delay_lock_seconds_v5';
    const KEY_ENABLED = 'migu_delay_lock_enabled_v5';

    let delaySeconds = parseFloat(
        localStorage.getItem(KEY_DELAY) ?? DEFAULT_DELAY
    );

    if (!Number.isFinite(delaySeconds)) {
        delaySeconds = DEFAULT_DELAY;
    }

    delaySeconds = Math.max(0, Math.min(3600, delaySeconds));

    let enabled = localStorage.getItem(KEY_ENABLED) !== 'false';

    const currentTimeDescriptor = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        'currentTime'
    );

    const playbackRateDescriptor = Object.getOwnPropertyDescriptor(
        HTMLMediaElement.prototype,
        'playbackRate'
    );

    const nativeFastSeek = HTMLMediaElement.prototype.fastSeek;

    let lockedVideo = null;
    let lastCorrectionTime = 0;

    function round1(value) {
        return Math.round((value + Number.EPSILON) * 10) / 10;
    }

    function nativeCurrentTime(video) {
        try {
            return currentTimeDescriptor.get.call(video);
        } catch {
            return video.currentTime;
        }
    }

    function nativeSetCurrentTime(video, value) {
        try {
            currentTimeDescriptor.set.call(video, value);
            return true;
        } catch (error) {
            console.warn('[Migu Delay] native seek failed', error);
            return false;
        }
    }

    function getMainVideo() {
        const videos = [...document.querySelectorAll('video')];

        if (!videos.length) {
            return null;
        }

        return videos
            .slice()
            .sort((a, b) => {
                const areaA = a.clientWidth * a.clientHeight;
                const areaB = b.clientWidth * b.clientHeight;
                return areaB - areaA;
            })[0];
    }

    function getSeekRange(video) {
        try {
            if (!video || !video.seekable || video.seekable.length === 0) {
                return null;
            }

            const last = video.seekable.length - 1;

            return {
                start: video.seekable.start(0),
                end: video.seekable.end(last)
            };
        } catch {
            return null;
        }
    }

    function getEffectiveDelay(range) {
        if (!range) {
            return 0;
        }

        const available = Math.max(
            0,
            range.end - range.start - 0.05
        );

        return Math.min(delaySeconds, available);
    }

    function shouldBlockSeek(video, requestedTime) {
        if (!enabled || video !== lockedVideo) {
            return false;
        }

        const range = getSeekRange(video);

        if (!range) {
            return false;
        }

        const effectiveDelay = getEffectiveDelay(range);

        if (effectiveDelay < 0.10) {
            return false;
        }

        const requestedBehindLive = range.end - Number(requestedTime);
        const minimumAllowedDelay = Math.max(0, effectiveDelay - 0.20);

        if (requestedBehindLive < minimumAllowedDelay) {
            console.debug('[Migu Delay] BLOCKED forward seek', {
                requestedTime,
                requestedBehindLive,
                protectedDelay: effectiveDelay
            });

            return true;
        }

        return false;
    }

    function patchVideo(video) {
        if (!video || video.__miguDelayLockPatched) {
            return;
        }

        video.__miguDelayLockPatched = true;

        try {
            Object.defineProperty(video, 'currentTime', {
                configurable: true,
                enumerable: true,

                get() {
                    return currentTimeDescriptor.get.call(this);
                },

                set(value) {
                    if (shouldBlockSeek(this, value)) {
                        return;
                    }

                    return currentTimeDescriptor.set.call(this, value);
                }
            });
        } catch (error) {
            console.warn('[Migu Delay] currentTime patch failed', error);
        }

        if (playbackRateDescriptor) {
            try {
                Object.defineProperty(video, 'playbackRate', {
                    configurable: true,
                    enumerable: true,

                    get() {
                        return playbackRateDescriptor.get.call(this);
                    },

                    set(value) {
                        const rate = Number(value);

                        if (
                            enabled &&
                            this === lockedVideo &&
                            Number.isFinite(rate) &&
                            rate > 1.001
                        ) {
                            console.debug(
                                '[Migu Delay] BLOCKED catch-up playbackRate:',
                                rate
                            );

                            return playbackRateDescriptor.set.call(this, 1.0);
                        }

                        return playbackRateDescriptor.set.call(this, value);
                    }
                });
            } catch (error) {
                console.warn('[Migu Delay] playbackRate patch failed', error);
            }
        }

        if (typeof nativeFastSeek === 'function') {
            try {
                Object.defineProperty(video, 'fastSeek', {
                    configurable: true,

                    value: function (time) {
                        if (shouldBlockSeek(this, time)) {
                            console.debug('[Migu Delay] BLOCKED fastSeek', time);
                            return;
                        }

                        return nativeFastSeek.call(this, time);
                    }
                });
            } catch (error) {
                console.warn('[Migu Delay] fastSeek patch failed', error);
            }
        }

        console.log('[Migu Delay] video patched');
    }

    function applyDelay() {
        if (!enabled) {
            return false;
        }

        const video = getMainVideo();

        if (!video) {
            return false;
        }

        const range = getSeekRange(video);

        if (!range) {
            return false;
        }

        patchVideo(video);
        lockedVideo = video;

        const effectiveDelay = getEffectiveDelay(range);
        let target;

        if (effectiveDelay <= 0.05) {
            target = range.end - 0.05;
        } else {
            target = range.end - effectiveDelay;
        }

        target = Math.max(
            range.start + 0.01,
            Math.min(range.end - 0.01, target)
        );

        const success = nativeSetCurrentTime(video, target);

        if (success) {
            try {
                if (playbackRateDescriptor) {
                    playbackRateDescriptor.set.call(video, 1.0);
                }
            } catch {}

            lastCorrectionTime = Date.now();

            console.log('[Migu Delay] applied', {
                requestedDelay: delaySeconds.toFixed(1),
                effectiveDelay: effectiveDelay.toFixed(1),
                liveEdge: range.end,
                target,
                buffer: (range.end - range.start).toFixed(2)
            });
        }

        return success;
    }

    function watchdog() {
        if (!enabled) {
            return;
        }

        const video = getMainVideo();

        if (!video) {
            return;
        }

        if (video !== lockedVideo) {
            applyDelay();
            return;
        }

        const range = getSeekRange(video);

        if (!range) {
            return;
        }

        const effectiveDelay = getEffectiveDelay(range);

        if (effectiveDelay < 0.20) {
            return;
        }

        const current = nativeCurrentTime(video);
        const actualDelay = range.end - current;

        const collapseTolerance = Math.max(
            0.40,
            Math.min(2.50, effectiveDelay * 0.25)
        );

        const collapsed = actualDelay < (effectiveDelay - collapseTolerance);
        const cooldownPassed = Date.now() - lastCorrectionTime > 3000;

        if (collapsed && cooldownPassed) {
            console.warn('[Migu Delay] LIVE catch-up detected', {
                desired: effectiveDelay.toFixed(1),
                actual: actualDelay.toFixed(1)
            });

            applyDelay();
        }
    }

    function createUI() {
        if (!document.body) {
            return;
        }

        if (document.getElementById('migu-delay-lock-ui')) {
            return;
        }

        const box = document.createElement('div');
        box.id = 'migu-delay-lock-ui';

        box.innerHTML = `
            <div class="mdl-main-row">
                <span class="mdl-label">Delay</span>

                <input
                    id="mdl-delay"
                    type="number"
                    min="0"
                    max="3600"
                    step="0.1"
                >

                <span class="mdl-sec">s</span>

                <button id="mdl-toggle" type="button"></button>
            </div>

            <div class="mdl-adjust-row">
                <div class="mdl-step-group">
                    <span class="mdl-step-label">0.1</span>
                    <button class="mdl-adjust" data-delta="-0.1" type="button">−</button>
                    <button class="mdl-adjust" data-delta="0.1" type="button">+</button>
                </div>

                <div class="mdl-step-group">
                    <span class="mdl-step-label">0.5</span>
                    <button class="mdl-adjust" data-delta="-0.5" type="button">−</button>
                    <button class="mdl-adjust" data-delta="0.5" type="button">+</button>
                </div>

                <div class="mdl-step-group">
                    <span class="mdl-step-label">1</span>
                    <button class="mdl-adjust" data-delta="-1" type="button">−</button>
                    <button class="mdl-adjust" data-delta="1" type="button">+</button>
                </div>

                <div class="mdl-step-group">
                    <span class="mdl-step-label">5</span>
                    <button class="mdl-adjust" data-delta="-5" type="button">−</button>
                    <button class="mdl-adjust" data-delta="5" type="button">+</button>
                </div>
            </div>
        `;

        document.body.appendChild(box);
        addCSS();

        const input = document.getElementById('mdl-delay');
        const toggleButton = document.getElementById('mdl-toggle');

        delaySeconds = round1(delaySeconds);
        input.value = delaySeconds.toFixed(1);

        function saveDelayValue(value) {
            if (!Number.isFinite(value)) {
                input.value = delaySeconds.toFixed(1);
                return;
            }

            delaySeconds = round1(
                Math.max(0, Math.min(3600, value))
            );

            input.value = delaySeconds.toFixed(1);

            localStorage.setItem(
                KEY_DELAY,
                delaySeconds.toFixed(1)
            );

            if (enabled) {
                applyDelay();
            }
        }

        function saveDelayFromInput() {
            saveDelayValue(parseFloat(input.value));
        }

        input.addEventListener('change', saveDelayFromInput);

        input.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                saveDelayFromInput();
                input.blur();
            }
        });

        box.querySelectorAll('.mdl-adjust').forEach(adjustButton => {
            adjustButton.addEventListener('click', () => {
                const delta = Number(adjustButton.dataset.delta);

                if (!Number.isFinite(delta)) {
                    return;
                }

                saveDelayValue(delaySeconds + delta);
            });
        });

        toggleButton.addEventListener('click', () => {
            enabled = !enabled;

            localStorage.setItem(
                KEY_ENABLED,
                String(enabled)
            );

            updateToggle();

            if (enabled) {
                applyDelay();
            } else {
                console.log('[Migu Delay] OFF');
            }
        });

        makeDraggable(box);
        updateToggle();
    }

    function updateToggle() {
        const button = document.getElementById('mdl-toggle');

        if (!button) {
            return;
        }

        button.textContent = enabled ? 'ON' : 'OFF';
        button.classList.toggle('on', enabled);
        button.classList.toggle('off', !enabled);
    }

    function addCSS() {
        if (document.getElementById('migu-delay-lock-css')) {
            return;
        }

        const style = document.createElement('style');
        style.id = 'migu-delay-lock-css';

        style.textContent = `
            #migu-delay-lock-ui {
                position: fixed;
                top: 110px;
                right: 18px;
                z-index: 2147483647;

                display: flex;
                flex-direction: column;
                gap: 10px;

                padding: 14px 18px;

                background: rgba(18, 18, 22, .94);
                border: 2px solid rgba(255,255,255,.16);
                border-radius: 16px;
                box-shadow: 0 8px 32px rgba(0,0,0,.42);

                color: #fff;
                font-family: Arial, "Microsoft YaHei", sans-serif;
                font-size: 26px;

                user-select: none;
                cursor: move;
            }

            .mdl-main-row {
                display: flex;
                align-items: center;
                gap: 12px;
            }

            #mdl-delay {
                box-sizing: border-box;
                width: 152px;
                padding: 10px;

                border: 2px solid #555;
                border-radius: 10px;
                outline: none;

                background: #29292e;
                color: #fff;

                font-size: 28px;
                font-weight: 600;
                text-align: center;
                cursor: text;
            }

            #mdl-delay:focus {
                border-color: #888;
            }

            .mdl-sec {
                color: #aaa;
            }

            #mdl-toggle {
                min-width: 92px;
                padding: 12px 18px;
                border: 0;
                border-radius: 10px;

                color: #fff;
                font-size: 26px;
                font-weight: bold;
                cursor: pointer;
            }

            #mdl-toggle.on {
                background: #209d55;
            }

            #mdl-toggle.off {
                background: #9c3636;
            }

            .mdl-adjust-row {
                display: flex;
                align-items: center;
                gap: 12px;
                white-space: nowrap;
            }

            .mdl-step-group {
                display: flex;
                align-items: center;
                gap: 4px;
            }

            .mdl-step-label {
                min-width: 46px;
                color: #fff;
                font-size: 22px;
                font-weight: bold;
                text-align: right;
            }

            .mdl-adjust {
                width: 46px;
                height: 46px;
                padding: 0;

                border: 0;
                border-radius: 8px;
                background: #3a3a42;
                color: #fff;

                font-size: 26px;
                font-weight: bold;
                line-height: 46px;
                text-align: center;
                cursor: pointer;
            }

            .mdl-adjust:hover {
                background: #53535d;
            }
        `;

        document.head.appendChild(style);
    }

    function makeDraggable(box) {
        let dragging = false;
        let startX = 0;
        let startY = 0;
        let originalX = 0;
        let originalY = 0;

        box.addEventListener('mousedown', event => {
            if (event.target.closest('input, button')) {
                return;
            }

            dragging = true;
            startX = event.clientX;
            startY = event.clientY;

            const rect = box.getBoundingClientRect();
            originalX = rect.left;
            originalY = rect.top;

            box.style.right = 'auto';
            event.preventDefault();
        });

        document.addEventListener('mousemove', event => {
            if (!dragging) {
                return;
            }

            let x = originalX + event.clientX - startX;
            let y = originalY + event.clientY - startY;

            x = Math.max(
                0,
                Math.min(window.innerWidth - box.offsetWidth, x)
            );

            y = Math.max(
                0,
                Math.min(window.innerHeight - box.offsetHeight, y)
            );

            box.style.left = x + 'px';
            box.style.top = y + 'px';
        });

        document.addEventListener('mouseup', () => {
            dragging = false;
        });
    }

    function start() {
        createUI();

        let initialApplied = false;

        setInterval(() => {
            createUI();

            if (enabled && !initialApplied) {
                initialApplied = applyDelay();
            }
        }, 500);

        setInterval(watchdog, 1000);

        const observer = new MutationObserver(() => {
            createUI();
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }

    if (document.body) {
        start();
    } else {
        const bodyObserver = new MutationObserver(() => {
            if (document.body) {
                bodyObserver.disconnect();
                start();
            }
        });

        bodyObserver.observe(document.documentElement, {
            childList: true,
            subtree: true
        });
    }
})();