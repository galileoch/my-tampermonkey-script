// ==UserScript==
// @name         YYZB LiveRoom - Video Full Window No Chat Keep Controls
// @namespace    https://tampermonkey.net/
// @version      1.1
// @description  Hide chat box, make video use full window, keep DPlayer controls
// @author       You
// @match        *://*.yyzb1.live/*
// @match        *://*.yyzb2.live/*
// @match        *://*.yyzb3.live/*
// @match        *://*.yyzb4.live/*
// @match        *://*.yyzb5.live/*
// @match        *://*.yyzb7.live/*
// @match        *://*.yyzb8.live/*
// @match        *://*.yyzb9.live/*
// @match        *://*.yyzb1.vip/*
// @match        *://*.yyzb2.vip/*
// @match        *://*.yyzb3.vip/*
// @match        *://*.yyzb4.vip/*
// @match        *://*.yyzb5.vip/*
// @match        *://*.yyzb7.vip/*
// @match        *://*.yyzb8.vip/*
// @match        *://*.yyzb9.vip/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const STYLE_ID = 'tm-video-full-window-keep-controls';

    function addStyleOnce() {
        if (document.getElementById(STYLE_ID)) return;

        const css = `
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        overflow: hidden !important;
        background: #000 !important;
      }

      /* 只隱藏頁面雜項，唔郁 DPlayer 內部 controls */
      .header-wrapper,
      footer,
      .footer,
      .chat,
      .chat-wrapper,
      .private-chat,
      .live-list,
      .recommend,
      .room-recommend,
      .gift,
      .gift-box {
        display: none !important;
      }

      /* 放大直播主區 */
      .liveRoom-wrapper,
      .live-room,
      .live-room-box,
      .live-room-box.inner,
      .media,
      .center-block,
      .video-player {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        max-width: none !important;
        min-width: 0 !important;
        max-height: none !important;
        min-height: 0 !important;
        margin: 0 !important;
        padding: 0 !important;
        border: 0 !important;
        background: #000 !important;
        z-index: 999990 !important;
      }

      /* DPlayer 本體 */
      #dplayer {
        position: fixed !important;
        inset: 0 !important;
        width: 100vw !important;
        height: 100vh !important;
        margin: 0 !important;
        padding: 0 !important;
        background: #000 !important;
        z-index: 999991 !important;
        overflow: hidden !important;
      }

      /* Video layer 放底啲 */
      #dplayer .dplayer-video-wrap,
      #dplayerVideo,
      #dplayer video,
      video[name="videoElement"],
      video.centeredVideo {
        position: relative !important;
        z-index: 1 !important;
        width: 100% !important;
        height: 100% !important;
        object-fit: contain !important;
        background: #000 !important;
      }

      /* 關鍵：保留 onscreen controls，放到最上層 */
      #dplayer .dplayer-controller-mask {
        display: block !important;
        position: absolute !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        z-index: 999998 !important;
        pointer-events: none !important;
      }

      #dplayer .dplayer-controller {
        display: block !important;
        position: absolute !important;
        left: 0 !important;
        right: 0 !important;
        bottom: 0 !important;
        z-index: 999999 !important;
        pointer-events: auto !important;
      }

      #dplayer .dplayer-icons,
      #dplayer .dplayer-icon,
      #dplayer .dplayer-full,
      #dplayer .dplayer-setting,
      #dplayer .dplayer-quality,
      #dplayer .dplayer-volume {
        visibility: visible !important;
        pointer-events: auto !important;
      }

      /* 中間播放/暫停提示都保留 */
      #dplayer .dplayer-bezel,
      #dplayer .dplayer-mobile-play,
      #dplayer .dplayer-notice {
        z-index: 999997 !important;
      }

      /* 唔好畀其他浮層蓋住 controls */
      .min-screen-mark,
      .vplayer-recommend {
        display: none !important;
      }

      /* 帶返 bottomCtrl 出嚟 */
      #bottomCtrl {
        position: fixed !important;
        z-index: 999999 !important;
        bottom: 45px !important; /* 避開 DPlayer 控制列 */
        left: 0 !important;
        right: 0 !important;
        display: block !important; /* 覆蓋原本可能嘅 display: none */
        visibility: visible !important;
        opacity: 1;
        transition: opacity 0.3s ease !important;
        pointer-events: auto !important;
      }

      /* 滑鼠閒置時隱藏 */
      #bottomCtrl.tm-hide {
        opacity: 0 !important;
        pointer-events: none !important;
      }
      
      /* 確保 bottomCtrl 嘅彈出選單（例如高清度）唔會被遮擋或向下彈出畫面外 */
      #bottomCtrl .select-opt,
      #bottomCtrl .emoji-panel,
      #bottomCtrl .gift-block {
        bottom: 100% !important;
        top: auto !important;
      }
    `;

        const style = document.createElement('style');
        style.id = STYLE_ID;
        style.textContent = css;
        document.documentElement.appendChild(style);
    }

    function applyLayout() {
        const player = document.querySelector('#dplayer');
        const video = document.querySelector('#dplayerVideo, #dplayer video, video[name="videoElement"], video.centeredVideo');

        if (!player || !video) return false;

        addStyleOnce();

        // 避免 DPlayer 進入 hide-controller 後整條控制列消失太耐
        player.classList.remove('dplayer-hide-controller');

        window.dispatchEvent(new Event('resize'));
        return true;
    }

    function waitAndApply() {
        let tries = 0;

        const timer = setInterval(() => {
            tries++;

            if (applyLayout() || tries > 60) {
                clearInterval(timer);
            }
        }, 500);
    }

    waitAndApply();

    const observer = new MutationObserver(() => {
        applyLayout();
    });

    observer.observe(document.documentElement, {
        childList: true,
        subtree: true
    });

    // 滑鼠郁動時強制叫返 control bar 出嚟
    document.addEventListener('mousemove', () => {
        const player = document.querySelector('#dplayer');
        const bottomCtrl = document.querySelector('#bottomCtrl');

        if (player) {
            player.classList.remove('dplayer-hide-controller');
            player.classList.add('dplayer-show-controller');
        }

        if (bottomCtrl) {
            bottomCtrl.classList.remove('tm-hide');
        }

        clearTimeout(window.__tmDplayerControlTimer);
        window.__tmDplayerControlTimer = setTimeout(() => {
            if (player) player.classList.remove('dplayer-show-controller');
            if (bottomCtrl) bottomCtrl.classList.add('tm-hide');
        }, 2500);
    });

    // F8 toggle
    document.addEventListener('keydown', (e) => {
        if (e.key === 'F8') {
            const style = document.getElementById(STYLE_ID);

            if (style) {
                style.remove();
                document.documentElement.style.overflow = '';
                document.body.style.overflow = '';
            } else {
                addStyleOnce();
                applyLayout();
            }
        }
    });
})();