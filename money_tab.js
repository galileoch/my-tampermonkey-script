// ==UserScript==
// @name         MoneyTab YouTube Link Extractor
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  從 MoneyTab 的 /youtube-embed?k=... iframe 抽出真正 YouTube watch 連結
// @match        https://www.money-tab.com/channel/3pm-premium
// @match        https://www.money-tab.com/channel/3pm-premium/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const PANEL_ID = 'tm-youtube-link-extractor-panel';

    function safeBase64Decode(input) {
        try {
            return atob(input);
        } catch (err) {
            console.warn('[YT Extractor] Base64 decode failed:', err);
            return null;
        }
    }

    function decodeVideoIdFromIframeSrc(src) {
        try {
            const url = new URL(src, location.origin);
            const k = url.searchParams.get('k');
            if (!k) return null;

            // URLSearchParams 已經會自動 decode %3D 呢類 encoding
            const decoded = safeBase64Decode(k);
            if (!decoded) return null;

            // YouTube video id 一般 11 chars，但先寬鬆少少
            if (!/^[A-Za-z0-9_-]{6,}$/.test(decoded)) {
                console.warn('[YT Extractor] Decoded value looks suspicious:', decoded);
            }

            return decoded;
        } catch (err) {
            console.warn('[YT Extractor] Failed to parse iframe src:', err);
            return null;
        }
    }

    function buildWatchUrl(videoId) {
        return `https://www.youtube.com/watch?v=${videoId}`;
    }

    function removeOldPanel() {
        const old = document.getElementById(PANEL_ID);
        if (old) old.remove();
    }

    function renderPanel(watchUrl, iframeSrc) {
        removeOldPanel();

        const panel = document.createElement('div');
        panel.id = PANEL_ID;
        panel.style.position = 'fixed';
        panel.style.right = '16px';
        panel.style.bottom = '16px';
        panel.style.zIndex = '999999';
        panel.style.maxWidth = '420px';
        panel.style.padding = '12px';
        panel.style.background = 'rgba(0,0,0,0.88)';
        panel.style.color = '#fff';
        panel.style.border = '1px solid rgba(255,255,255,0.18)';
        panel.style.borderRadius = '10px';
        panel.style.boxShadow = '0 8px 24px rgba(0,0,0,0.35)';
        panel.style.fontSize = '13px';
        panel.style.lineHeight = '1.5';
        panel.style.wordBreak = 'break-all';

        const title = document.createElement('div');
        title.textContent = '已抽出 YouTube 連結';
        title.style.fontWeight = '700';
        title.style.marginBottom = '8px';

        const link = document.createElement('a');
        link.href = watchUrl;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = watchUrl;
        link.style.color = '#7cc4ff';
        link.style.textDecoration = 'underline';
        link.style.display = 'block';
        link.style.marginBottom = '10px';

        const copyBtn = document.createElement('button');
        copyBtn.textContent = '複製連結';
        copyBtn.style.marginRight = '8px';
        copyBtn.style.padding = '6px 10px';
        copyBtn.style.cursor = 'pointer';

        copyBtn.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(watchUrl);
                copyBtn.textContent = '已複製';
                setTimeout(() => {
                    copyBtn.textContent = '複製連結';
                }, 1200);
            } catch (err) {
                console.warn('[YT Extractor] Copy failed:', err);
                prompt('手動複製以下連結：', watchUrl);
            }
        });

        const closeBtn = document.createElement('button');
        closeBtn.textContent = '關閉';
        closeBtn.style.padding = '6px 10px';
        closeBtn.style.cursor = 'pointer';
        closeBtn.addEventListener('click', () => panel.remove());

        panel.appendChild(title);
        panel.appendChild(link);
        panel.appendChild(copyBtn);
        panel.appendChild(closeBtn);

        document.body.appendChild(panel);
    }

    function extractFromPage() {
        const iframe = document.querySelector('iframe[src*="/youtube-embed?"]');
        if (!iframe) return false;

        const src = iframe.getAttribute('src');
        if (!src) return false;

        const videoId = decodeVideoIdFromIframeSrc(src);
        if (!videoId) return false;

        const watchUrl = buildWatchUrl(videoId);

        console.log('[YT Extractor] iframe src =', src);
        console.log('[YT Extractor] videoId =', videoId);
        console.log('[YT Extractor] watchUrl =', watchUrl);

        renderPanel(watchUrl, src);
        return true;
    }

    function init() {
        // 先即時試一次
        if (extractFromPage()) return;

        // 再監察動態載入
        const observer = new MutationObserver(() => {
            if (extractFromPage()) {
                observer.disconnect();
            }
        });

        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
        });

        // 保險：10秒後停止
        setTimeout(() => observer.disconnect(), 10000);
    }

    init();
})();