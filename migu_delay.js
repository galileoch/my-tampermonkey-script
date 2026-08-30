// ==UserScript==
// @name         Migu Live Delay Lock
// @namespace    migu-live-delay
// @version      5.0
// @description  咪咕直播固定 Delay，阻止播放器自動追返 LIVE
// @match        https://www.miguvideo.com/p/live/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
    'use strict';

    // =========================================================
    // Config
    // =========================================================

    const DEFAULT_DELAY = 10.00;

    const KEY_DELAY =
        'migu_delay_lock_seconds_v5';

    const KEY_ENABLED =
        'migu_delay_lock_enabled_v5';

    let delaySeconds =
        parseFloat(
            localStorage.getItem(KEY_DELAY)
            ?? DEFAULT_DELAY
        );

    if (!Number.isFinite(delaySeconds)) {
        delaySeconds = DEFAULT_DELAY;
    }

    delaySeconds =
        Math.max(
            0,
            Math.min(3600, delaySeconds)
        );


    let enabled =
        localStorage.getItem(KEY_ENABLED)
        !== 'false';


    // =========================================================
    // Native video accessors
    //
    // 保存原生 setter/getter。
    // 之後即使我哋攔截 Migu，
    // 自己仍然可以直接 call native setter。
    // =========================================================

    const currentTimeDescriptor =
        Object.getOwnPropertyDescriptor(
            HTMLMediaElement.prototype,
            'currentTime'
        );


    const playbackRateDescriptor =
        Object.getOwnPropertyDescriptor(
            HTMLMediaElement.prototype,
            'playbackRate'
        );


    const nativeFastSeek =
        HTMLMediaElement.prototype.fastSeek;


    let lockedVideo = null;

    let lastCorrectionTime = 0;


    // =========================================================
    // Helpers
    // =========================================================

    function round2(value) {
        return (
            Math.round(
                (value + Number.EPSILON)
                * 100
            ) / 100
        );
    }


    function nativeCurrentTime(video) {
        try {
            return currentTimeDescriptor
                .get
                .call(video);
        } catch {
            return video.currentTime;
        }
    }


    function nativeSetCurrentTime(
        video,
        value
    ) {
        try {
            currentTimeDescriptor
                .set
                .call(
                    video,
                    value
                );

            return true;

        } catch (error) {

            console.warn(
                '[Migu Delay] native seek failed',
                error
            );

            return false;
        }
    }


    // =========================================================
    // Main video
    // =========================================================

    function getMainVideo() {

        const videos =
            [...document.querySelectorAll('video')];

        if (!videos.length)
            return null;


        return videos
            .slice()
            .sort(
                (a, b) => {

                    const areaA =
                        a.clientWidth *
                        a.clientHeight;

                    const areaB =
                        b.clientWidth *
                        b.clientHeight;

                    return areaB - areaA;
                }
            )[0];
    }


    // =========================================================
    // Seekable range
    // =========================================================

    function getSeekRange(video) {

        try {

            if (
                !video ||
                !video.seekable ||
                video.seekable.length === 0
            ) {
                return null;
            }


            const last =
                video.seekable.length - 1;


            return {

                start:
                    video.seekable.start(0),

                end:
                    video.seekable.end(last)

            };

        } catch {

            return null;

        }
    }


    // =========================================================
    // Effective Delay
    //
    // 例如：
    //
    // request = 10.25 sec
    //
    // 但 Migu DVR buffer 只有 8 sec，
    // 咁最多只可以 delay ~8 sec。
    // =========================================================

    function getEffectiveDelay(range) {

        if (!range)
            return 0;


        const available =
            Math.max(
                0,
                range.end -
                range.start -
                0.05
            );


        return Math.min(
            delaySeconds,
            available
        );
    }


    // =========================================================
    // 判斷 Migu 是否正在嘗試追返 LIVE
    // =========================================================

    function shouldBlockSeek(
        video,
        requestedTime
    ) {

        if (
            !enabled ||
            video !== lockedVideo
        ) {
            return false;
        }


        const range =
            getSeekRange(video);


        if (!range)
            return false;


        const effectiveDelay =
            getEffectiveDelay(range);


        /*
         * Delay 幾乎 = 0，
         * 就無需要阻止 LIVE。
         */

        if (effectiveDelay < 0.10)
            return false;


        /*
         * 如果 requestedTime 距離 Live edge
         * 少過我哋設定嘅 Delay，
         * 即係有人想向前追。
         */

        const requestedBehindLive =
            range.end -
            Number(requestedTime);


        /*
         * 留 0.20 秒 tolerance，
         * 避免播放器正常微調被誤殺。
         */

        const minimumAllowedDelay =
            Math.max(
                0,
                effectiveDelay - 0.20
            );


        if (
            requestedBehindLive <
            minimumAllowedDelay
        ) {

            console.debug(
                '[Migu Delay] BLOCKED forward seek',
                {
                    requestedTime:
                        requestedTime,

                    requestedBehindLive:
                        requestedBehindLive,

                    protectedDelay:
                        effectiveDelay
                }
            );


            return true;
        }


        return false;
    }


    // =========================================================
    // Patch individual video
    //
    // 唔改全站 HTMLMediaElement prototype，
    // 只 patch 真正播放嗰個 video。
    // =========================================================

    function patchVideo(video) {

        if (!video)
            return;


        if (
            video.__miguDelayLockPatched
        ) {
            return;
        }


        video.__miguDelayLockPatched = true;


        // -----------------------------------------------------
        // currentTime
        // -----------------------------------------------------

        try {

            Object.defineProperty(
                video,
                'currentTime',
                {

                    configurable: true,

                    enumerable: true,


                    get() {

                        return currentTimeDescriptor
                            .get
                            .call(this);

                    },


                    set(value) {

                        /*
                         * Migu Javascript：
                         *
                         * video.currentTime = LIVE
                         *
                         * 會喺呢度被攔截。
                         */

                        if (
                            shouldBlockSeek(
                                this,
                                value
                            )
                        ) {
                            return;
                        }


                        return currentTimeDescriptor
                            .set
                            .call(
                                this,
                                value
                            );
                    }
                }
            );

        } catch (error) {

            console.warn(
                '[Migu Delay] currentTime patch failed',
                error
            );

        }


        // -----------------------------------------------------
        // playbackRate
        //
        // 有啲 live player 唔直接 seek，
        // 而係用 1.05x / 1.1x 慢慢追返 LIVE。
        // -----------------------------------------------------

        if (playbackRateDescriptor) {

            try {

                Object.defineProperty(
                    video,
                    'playbackRate',
                    {

                        configurable: true,

                        enumerable: true,


                        get() {

                            return playbackRateDescriptor
                                .get
                                .call(this);

                        },


                        set(value) {

                            const rate =
                                Number(value);


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


                                return playbackRateDescriptor
                                    .set
                                    .call(
                                        this,
                                        1.0
                                    );
                            }


                            return playbackRateDescriptor
                                .set
                                .call(
                                    this,
                                    value
                                );
                        }
                    }
                );

            } catch (error) {

                console.warn(
                    '[Migu Delay] playbackRate patch failed',
                    error
                );

            }
        }


        // -----------------------------------------------------
        // fastSeek
        // -----------------------------------------------------

        if (
            typeof nativeFastSeek ===
            'function'
        ) {

            try {

                Object.defineProperty(
                    video,
                    'fastSeek',
                    {

                        configurable: true,

                        value: function (time) {

                            if (
                                shouldBlockSeek(
                                    this,
                                    time
                                )
                            ) {

                                console.debug(
                                    '[Migu Delay] BLOCKED fastSeek',
                                    time
                                );

                                return;
                            }


                            return nativeFastSeek
                                .call(
                                    this,
                                    time
                                );
                        }
                    }
                );

            } catch (error) {

                console.warn(
                    '[Migu Delay] fastSeek patch failed',
                    error
                );

            }
        }


        console.log(
            '[Migu Delay] video patched'
        );
    }


    // =========================================================
    // Apply delay
    // =========================================================

    function applyDelay() {

        if (!enabled)
            return false;


        const video =
            getMainVideo();


        if (!video)
            return false;


        const range =
            getSeekRange(video);


        if (!range)
            return false;


        patchVideo(video);


        /*
         * 先 lock 呢個 video。
         */

        lockedVideo = video;


        const effectiveDelay =
            getEffectiveDelay(range);


        let target;


        if (effectiveDelay <= 0.05) {

            target =
                range.end - 0.05;

        } else {

            /*
             * 唔 round target。
             *
             * 例如：
             *
             * Live edge = 1050.387
             * Delay     = 10.25
             *
             * target =
             * 1040.137
             *
             * 咁數學上先真正相差 10.25 秒。
             */

            target =
                range.end -
                effectiveDelay;

        }


        target =
            Math.max(
                range.start + 0.01,
                Math.min(
                    range.end - 0.01,
                    target
                )
            );


        /*
         * 直接 call browser native setter，
         * bypass 我哋自己嘅 blocker。
         */

        const success =
            nativeSetCurrentTime(
                video,
                target
            );


        if (success) {

            /*
             * 如果 Migu 曾經將 playbackRate
             * 改高，reset 返 1x。
             */

            try {

                if (
                    playbackRateDescriptor
                ) {

                    playbackRateDescriptor
                        .set
                        .call(
                            video,
                            1.0
                        );
                }

            } catch {}


            lastCorrectionTime =
                Date.now();


            console.log(
                '[Migu Delay] applied',
                {

                    requestedDelay:
                        delaySeconds
                            .toFixed(2),

                    effectiveDelay:
                        effectiveDelay
                            .toFixed(2),

                    liveEdge:
                        range.end,

                    target:
                        target,

                    buffer:
                        (
                            range.end -
                            range.start
                        ).toFixed(2)

                }
            );
        }


        return success;
    }


    // =========================================================
    // Watchdog
    //
    // 正常情況完全唔 seek。
    //
    // 只有 Migu 用某種 native 方法
    // bypass 咗 currentTime blocker，
    // 真係跌返近 LIVE，
    // 先至補一次。
    // =========================================================

    function watchdog() {

        if (!enabled)
            return;


        const video =
            getMainVideo();


        if (!video)
            return;


        /*
         * Migu SPA 換咗 video element
         */

        if (video !== lockedVideo) {

            applyDelay();

            return;
        }


        const range =
            getSeekRange(video);


        if (!range)
            return;


        const effectiveDelay =
            getEffectiveDelay(range);


        if (effectiveDelay < 0.20)
            return;


        const current =
            nativeCurrentTime(video);


        const actualDelay =
            range.end -
            current;


        /*
         * Seekable.end() 本身會 segment 式跳，
         * 所以唔可以要求 actual 永遠
         * 精準 = 10.25。
         *
         * 呢個 tolerance 只係用嚟判斷：
         *
         * 「佢係咪真係走咗返 realtime」
         */

        const collapseTolerance =
            Math.max(
                0.40,
                Math.min(
                    2.50,
                    effectiveDelay * 0.25
                )
            );


        const collapsed =
            actualDelay <
            (
                effectiveDelay -
                collapseTolerance
            );


        /*
         * 最少隔 3 秒先可以補一次，
         * 防止任何 loop。
         */

        const cooldownPassed =
            Date.now() -
            lastCorrectionTime >
            3000;


        if (
            collapsed &&
            cooldownPassed
        ) {

            console.warn(
                '[Migu Delay] LIVE catch-up detected',
                {
                    desired:
                        effectiveDelay
                            .toFixed(2),

                    actual:
                        actualDelay
                            .toFixed(2)
                }
            );


            applyDelay();
        }
    }


    // =========================================================
    // Minimal GUI
    // =========================================================

    function createUI() {

        if (!document.body)
            return;


        if (
            document.getElementById(
                'migu-delay-lock-ui'
            )
        ) {
            return;
        }


        const box =
            document.createElement('div');


        box.id =
            'migu-delay-lock-ui';


        box.innerHTML = `

            <span class="mdl-label">
                Delay
            </span>

            <input
                id="mdl-delay"
                type="number"
                min="0"
                max="3600"
                step="0.01"
            >

            <span class="mdl-sec">
                s
            </span>

            <button
                id="mdl-toggle"
                type="button"
            ></button>

        `;


        document.body.appendChild(box);


        addCSS();


        const input =
            document.getElementById(
                'mdl-delay'
            );


        const button =
            document.getElementById(
                'mdl-toggle'
            );


        input.value =
            round2(
                delaySeconds
            ).toFixed(2);


        // -----------------------------------------------------
        // Delay input
        // -----------------------------------------------------

        function saveDelay() {

            let value =
                parseFloat(
                    input.value
                );


            if (
                !Number.isFinite(value)
            ) {

                input.value =
                    delaySeconds
                        .toFixed(2);

                return;
            }


            value =
                Math.max(
                    0,
                    Math.min(
                        3600,
                        value
                    )
                );


            delaySeconds =
                round2(value);


            input.value =
                delaySeconds
                    .toFixed(2);


            localStorage.setItem(
                KEY_DELAY,
                delaySeconds
                    .toFixed(2)
            );


            if (enabled) {

                /*
                 * 改 Delay：
                 * 只重新 seek 一次。
                 */

                applyDelay();

            }
        }


        input.addEventListener(
            'change',
            saveDelay
        );


        input.addEventListener(
            'keydown',
            event => {

                if (
                    event.key ===
                    'Enter'
                ) {

                    saveDelay();

                    input.blur();

                }
            }
        );


        // -----------------------------------------------------
        // ON/OFF
        // -----------------------------------------------------

        button.addEventListener(
            'click',
            () => {

                enabled =
                    !enabled;


                localStorage.setItem(
                    KEY_ENABLED,
                    String(enabled)
                );


                updateToggle();


                if (enabled) {

                    /*
                     * 重新開啟時
                     * apply 一次。
                     */

                    applyDelay();

                } else {

                    /*
                     * OFF：
                     * blocker 自動 pass-through。
                     *
                     * 唔主動將你推返 LIVE。
                     */

                    console.log(
                        '[Migu Delay] OFF'
                    );
                }
            }
        );


        makeDraggable(box);


        updateToggle();
    }


    // =========================================================
    // Toggle display
    // =========================================================

    function updateToggle() {

        const button =
            document.getElementById(
                'mdl-toggle'
            );


        if (!button)
            return;


        button.textContent =
            enabled
                ? 'ON'
                : 'OFF';


        button.classList.toggle(
            'on',
            enabled
        );


        button.classList.toggle(
            'off',
            !enabled
        );
    }


    // =========================================================
    // CSS
    // =========================================================

    function addCSS() {

        if (
            document.getElementById(
                'migu-delay-lock-css'
            )
        ) {
            return;
        }


        const style =
            document.createElement('style');


        style.id =
            'migu-delay-lock-css';


        style.textContent = `

            #migu-delay-lock-ui {

                position: fixed;

                top: 110px;
                right: 18px;

                z-index: 2147483647;

                display: flex;
                align-items: center;

                gap: 6px;

                padding: 7px 9px;

                background:
                    rgba(18, 18, 22, .94);

                border:
                    1px solid
                    rgba(255,255,255,.16);

                border-radius: 8px;

                box-shadow:
                    0 4px 16px
                    rgba(0,0,0,.42);

                color: #fff;

                font-family:
                    Arial,
                    "Microsoft YaHei",
                    sans-serif;

                font-size: 13px;

                user-select: none;

                cursor: move;
            }


            #mdl-delay {

                box-sizing: border-box;

                width: 76px;

                padding: 5px;

                border:
                    1px solid #555;

                border-radius: 5px;

                outline: none;

                background: #29292e;

                color: #fff;

                font-size: 14px;

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

                min-width: 46px;

                padding: 6px 9px;

                border: 0;

                border-radius: 5px;

                color: #fff;

                font-weight: bold;

                cursor: pointer;
            }


            #mdl-toggle.on {

                background: #209d55;

            }


            #mdl-toggle.off {

                background: #9c3636;

            }

        `;


        document.head
            .appendChild(style);
    }


    // =========================================================
    // Drag
    // =========================================================

    function makeDraggable(box) {

        let dragging = false;

        let startX = 0;
        let startY = 0;

        let originalX = 0;
        let originalY = 0;


        box.addEventListener(
            'mousedown',
            event => {

                if (
                    event.target.closest(
                        'input, button'
                    )
                ) {
                    return;
                }


                dragging = true;


                startX =
                    event.clientX;

                startY =
                    event.clientY;


                const rect =
                    box.getBoundingClientRect();


                originalX =
                    rect.left;

                originalY =
                    rect.top;


                box.style.right =
                    'auto';


                event.preventDefault();
            }
        );


        document.addEventListener(
            'mousemove',
            event => {

                if (!dragging)
                    return;


                let x =
                    originalX +
                    event.clientX -
                    startX;


                let y =
                    originalY +
                    event.clientY -
                    startY;


                x =
                    Math.max(
                        0,
                        Math.min(
                            window.innerWidth -
                            box.offsetWidth,
                            x
                        )
                    );


                y =
                    Math.max(
                        0,
                        Math.min(
                            window.innerHeight -
                            box.offsetHeight,
                            y
                        )
                    );


                box.style.left =
                    x + 'px';

                box.style.top =
                    y + 'px';
            }
        );


        document.addEventListener(
            'mouseup',
            () => {

                dragging = false;

            }
        );
    }


    // =========================================================
    // Start
    // =========================================================

    function start() {

        createUI();


        /*
         * 等 Migu 建立 video + DVR range。
         *
         * 未成功之前會 retry；
         * 成功後唔會不停 seek。
         */

        let initialApplied = false;


        const initialTimer =
            setInterval(
                () => {

                    createUI();


                    if (
                        enabled &&
                        !initialApplied
                    ) {

                        initialApplied =
                            applyDelay();

                    }


                    /*
                     * SPA 如果換 video，
                     * watchdog 會處理。
                     */

                },
                500
            );


        /*
         * Watchdog 每秒只「檢查」。
         *
         * 唔係每秒 seek。
         */

        setInterval(
            watchdog,
            1000
        );


        const observer =
            new MutationObserver(
                () => {

                    createUI();

                }
            );


        observer.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true
            }
        );
    }


    if (document.body) {

        start();

    } else {

        const bodyObserver =
            new MutationObserver(
                () => {

                    if (
                        document.body
                    ) {

                        bodyObserver
                            .disconnect();

                        start();
                    }
                }
            );


        bodyObserver.observe(
            document.documentElement,
            {
                childList: true,
                subtree: true
            }
        );
    }

})();