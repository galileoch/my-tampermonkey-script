// ==UserScript==
// @name         HOY TV Full Width Video
// @namespace    hoy-tv-full-width
// @version      1.2.0
// @description  隱藏右邊節目表，直播畫面真正用盡瀏覽器寬度
// @match        https://hoy.tv/live*
// @match        https://www.hoy.tv/live*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const STORAGE_KEY = 'hoyFullWidthMode';

    // 第一次使用預設 ON
    let enabled = localStorage.getItem(STORAGE_KEY) !== 'false';

    let observerTimer;


    // =========================================================
    // CSS
    // =========================================================

    const style = document.createElement('style');

    style.textContent = `

        /* =========================================
           FULL WIDTH MODE
           ========================================= */

        body.hoy-full-width-mode {
            overflow-x: hidden !important;
        }


        /*
         * HOY 最外層 content container 原本有：
         *
         * sm:pl-[5vw]
         * md:pl-[4.7vw]
         * lg:pl-[11vw]
         *
         * 呢個就係之前左邊成大條虛位來源。
         */
        body.hoy-full-width-mode .hoy-content-container {
            padding-left: 0 !important;
            padding-right: 0 !important;

            width: 100vw !important;
            max-width: 100vw !important;

            margin-left: 0 !important;
            margin-right: 0 !important;
        }


        /*
         * 左右 panel 個 row
         */
        body.hoy-full-width-mode .hoy-video-row {
            display: block !important;

            width: 100vw !important;
            max-width: 100vw !important;

            margin-left: 0 !important;
            margin-right: 0 !important;
        }


        /*
         * 左邊：
         * video + channel selector
         */
        body.hoy-full-width-mode .hoy-left-column {
            width: 100vw !important;
            max-width: 100vw !important;

            margin: 0 !important;
            padding: 0 !important;
        }


        /*
         * 真正 video wrapper
         */
        body.hoy-full-width-mode .hoy-video-wrapper {
            width: 100vw !important;
            max-width: 100vw !important;

            height: auto !important;

            margin: 0 !important;
            padding: 0 !important;

            aspect-ratio: 16 / 9 !important;
        }


        /*
         * Shaka player
         */
        body.hoy-full-width-mode
        .hoy-video-wrapper [data-shaka-player-container] {

            width: 100% !important;
            height: 100% !important;

            max-width: none !important;
        }


        body.hoy-full-width-mode
        .hoy-video-wrapper video {

            width: 100% !important;
            height: 100% !important;

            max-width: none !important;

            object-fit: contain !important;
        }


        /*
         * 右邊節目表
         */
        body.hoy-full-width-mode .hoy-right-panel {
            display: none !important;
        }


        /*
         * 下面 76 / 77 / 78 selector
         */
        body.hoy-full-width-mode .hoy-channel-list {

            width: 100vw !important;
            max-width: 100vw !important;

            margin-left: 0 !important;
            margin-right: 0 !important;
        }


        /*
         * 「直播頻道」標題留返少少空間，
         * 唔想個字黐實 browser 左邊。
         */
        body.hoy-full-width-mode .hoy-live-title {
            padding-left: 16px !important;
        }



        /* =========================================
           BUTTON
           ========================================= */

        #hoy-full-width-toggle {

            position: fixed;

            top: 90px;
            right: 20px;

            z-index: 999999;

            padding: 9px 14px;

            border: 1px solid rgba(255,255,255,.25);
            border-radius: 8px;

            color: white;

            font-family:
                -apple-system,
                BlinkMacSystemFont,
                "Segoe UI",
                Arial,
                sans-serif;

            font-size: 13px;
            font-weight: 700;

            cursor: pointer;

            box-shadow:
                0 4px 15px rgba(0,0,0,.4);

            backdrop-filter: blur(8px);

            transition:
                transform .15s ease,
                background .15s ease;
        }


        #hoy-full-width-toggle:hover {
            transform: translateY(-1px);
        }


        #hoy-full-width-toggle.on {
            background: rgba(255,62,0,.95);
        }


        #hoy-full-width-toggle.off {
            background: rgba(30,30,30,.90);
        }

    `;


    document.head.appendChild(style);



    // =========================================================
    // Detect HOY DOM
    // =========================================================

    function detectLayout() {

        const video =
            document.querySelector('.shaka-video');

        if (!video) {
            return false;
        }


        // -----------------------------------------
        // Video wrapper
        // <div class="bg-[black] aspect-video ...">
        // -----------------------------------------

        const videoWrapper =
            video.closest('[class*="aspect-video"]');

        if (!videoWrapper) {
            return false;
        }


        // -----------------------------------------
        // 左 column
        // -----------------------------------------

        const leftColumn =
            videoWrapper.parentElement;

        if (!leftColumn) {
            return false;
        }


        // -----------------------------------------
        // row = 左 column + right panel
        // -----------------------------------------

        const videoRow =
            leftColumn.parentElement;

        if (!videoRow) {
            return false;
        }


        // -----------------------------------------
        // right panel
        // -----------------------------------------

        const rightPanel =
            Array
                .from(videoRow.children)
                .find(el => el !== leftColumn);


        // -----------------------------------------
        // channel selector
        // -----------------------------------------

        const channelList =
            videoWrapper.nextElementSibling;


        // -----------------------------------------
        // 最重要：
        //
        // HOY 個 main 下面第一層 container
        //
        // class:
        //
        // w-[100vw]
        // min-h-[100vh]
        // ...
        // lg:pl-[11vw]
        //
        // 就係左邊空白來源
        // -----------------------------------------

        const main =
            video.closest('main');


        let contentContainer = null;


        if (main) {

            contentContainer =
                main.firstElementChild;

        }


        // -----------------------------------------
        // 直播頻道 title
        // -----------------------------------------

        let liveTitle = null;

        if (contentContainer) {

            liveTitle =
                Array
                    .from(contentContainer.children)
                    .find(el =>
                        el.textContent.trim() === '直播頻道'
                    );

        }


        // -----------------------------------------
        // 加自己 class
        // -----------------------------------------

        videoWrapper.classList.add(
            'hoy-video-wrapper'
        );


        leftColumn.classList.add(
            'hoy-left-column'
        );


        videoRow.classList.add(
            'hoy-video-row'
        );


        if (rightPanel) {

            rightPanel.classList.add(
                'hoy-right-panel'
            );

        }


        if (channelList) {

            channelList.classList.add(
                'hoy-channel-list'
            );

        }


        if (contentContainer) {

            contentContainer.classList.add(
                'hoy-content-container'
            );

        }


        if (liveTitle) {

            liveTitle.classList.add(
                'hoy-live-title'
            );

        }


        return true;
    }



    // =========================================================
    // Apply
    // =========================================================

    function applyMode() {

        detectLayout();


        document.body.classList.toggle(
            'hoy-full-width-mode',
            enabled
        );


        localStorage.setItem(
            STORAGE_KEY,
            enabled
        );


        updateButton();
    }



    // =========================================================
    // Button
    // =========================================================

    function createButton() {

        if (
            document.querySelector(
                '#hoy-full-width-toggle'
            )
        ) {
            return;
        }


        const button =
            document.createElement('button');


        button.id =
            'hoy-full-width-toggle';


        button.type =
            'button';


        button.addEventListener(
            'click',
            () => {

                enabled =
                    !enabled;

                applyMode();

            }
        );


        document.body.appendChild(
            button
        );


        updateButton();
    }



    function updateButton() {

        const button =
            document.querySelector(
                '#hoy-full-width-toggle'
            );


        if (!button) {
            return;
        }


        button.textContent =
            enabled
                ? 'Wide Mode: ON'
                : 'Wide Mode: OFF';


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
    // Init
    // =========================================================

    function init() {

        createButton();

        detectLayout();

        applyMode();

    }


    init();



    // =========================================================
    // Next.js / React re-render
    // =========================================================

    const observer =
        new MutationObserver(() => {

            clearTimeout(observerTimer);


            observerTimer =
                setTimeout(
                    () => {

                        createButton();

                        const found =
                            detectLayout();


                        if (found) {

                            document.body.classList.toggle(
                                'hoy-full-width-mode',
                                enabled
                            );

                        }

                    },
                    100
                );

        });


    observer.observe(
        document.body,
        {
            childList: true,
            subtree: true
        }
    );

})();
