// ==UserScript==
// @name         MoneyTab YouTube Link Extractor
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  從 MoneyTab 的 /youtube-embed?k=... iframe 抽出真正 YouTube watch 連結 (支援 SPA 跳頁更新)
// @match        https://www.money-tab.com/channel/3pm-premium
// @match        https://www.money-tab.com/channel/3pm-premium/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

(function () {
    'use strict';

    const PANEL_ID = 'tm-youtube-link-extractor-panel';
    let lastProcessedId = null; // 紀錄上次處理嘅 Video ID

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

            const decoded = safeBase64Decode(k);
            if (!decoded) return null;

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
        closeBtn.addEventListener('click', () => {
            panel.remove();
            // 點擊關閉後，除非 ID 變咗，如果唔係唔再彈出
        });

        panel.appendChild(title);
        panel.appendChild(link);
        panel.appendChild(copyBtn);
        panel.appendChild(closeBtn);

        document.body.appendChild(panel);
    }

    function extractFromPage() {
        const iframe = document.querySelector('iframe[src*="/youtube-embed?"]');
        if (!iframe) {
            // 如果頁面無 iframe，可以選擇唔理或者清走舊 panel
            // lastProcessedId = null;
            return false;
        }

        const src = iframe.getAttribute('src');
        if (!src) return false;

        const videoId = decodeVideoIdFromIframeSrc(src);
        if (!videoId) return false;

        // 如果 ID 冇變，就唔重複處理
        if (videoId === lastProcessedId) return true;

        lastProcessedId = videoId;
        const watchUrl = buildWatchUrl(videoId);

        console.log('[YT Extractor] New video detected:', videoId);
        renderPanel(watchUrl, src);
        return true;
    }

    function init() {
        // 1. 初次啟動
        extractFromPage();

        // 2. 利用 MutationObserver 監控 DOM 變化 (處理 SPA 跳頁)
        const observer = new MutationObserver(() => {
            extractFromPage();
        });

        observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true, // 有時 iframe 係原地換 src
            attributeFilter: ['src']
        });

        // 3. 保險：setInterval 檢查 (防止有啲 route change 唔郁 DOM)
        setInterval(extractFromPage, 2000);
    }

    init();
})();
