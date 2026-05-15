// ==UserScript==
// @name         Futunn Portfolio Amount Column ($) + Safe Width
// @namespace    hk.tools.futunn.amountcol
// @version      1.4.0
// @match        https://portfolio.futunn.com/portfolio/*
// @grant        GM_addStyle
// ==/UserScript==

GM_addStyle(`
  .base-card .profit.hairLineBottomBefore {
    display: none !important;
  }
`);

(function () {
    'use strict';

    // ▼ 你要的 URL → 預設金額
    const DEFAULT_TOTAL_MAP = { '108131': 10000, '154216': 6000 };
    const FALLBACK_TOTAL = 6000;
    const LS_KEY_PREFIX = 'futunn_amount_total_';
    const LS_SHARES_PREFIX = 'futunn_shares_';
    const LS_COST_PREFIX = 'futunn_cost_';
    const LS_LAST_RATIOS = 'futunn_last_ratios_';
    const LS_REFRESH_INTERVAL = 'futunn_refresh_interval_';

    let isManualOverride = false;

    // ▼ 闊度微調
    const WIDTH_RATIO = 84;
    const WIDTH_AMOUNT = 145;

    let isUpdating = false, debounceTimer = null, observer = null;
    let hasAlerted = false; // 防止重複 alert
    let refreshTimer = null;

    const pid = () => (location.pathname.match(/portfolio\/(\d+)/) || [])[1] || 'default';
    const key = () => LS_KEY_PREFIX + pid();

    const getRefreshInterval = () => { const v = parseInt(localStorage.getItem(LS_REFRESH_INTERVAL + pid())); return isNaN(v) ? 15 : v; };
    const setRefreshInterval = (v) => { localStorage.setItem(LS_REFRESH_INTERVAL + pid(), String(v)); applyRefreshTimer(); };
    const applyRefreshTimer = () => {
        if (refreshTimer) clearTimeout(refreshTimer);
        const mins = getRefreshInterval();
        if (mins > 0) {
            refreshTimer = setTimeout(() => location.reload(), mins * 60 * 1000);
        }
    };
    applyRefreshTimer();

    function initRefreshControl() {
        if (document.getElementById('ft-refresh-control')) return;

        const wrap = document.createElement('div');
        wrap.id = 'ft-refresh-control';
        wrap.style.cssText = [
            'position:fixed', 'top:15px', 'right:15px', 'z-index:9998',
            'background:rgba(18,18,28,0.88)', 'backdrop-filter:blur(8px)',
            'color:#fff', 'border-radius:12px', 'font-size:12px',
            'box-shadow:0 4px 20px rgba(0,0,0,0.5)',
            'border:1px solid rgba(255,255,255,0.12)',
            'min-width:230px', 'min-height:56px', 'max-width:420px', 'max-height:70vh',
            'resize:both', 'overflow:auto',
            'display:flex', 'flex-direction:column',
        ].join(';');

        // ── Header (drag handle) ──
        const header = document.createElement('div');
        header.id = 'ft-panel-header';
        header.style.cssText = [
            'cursor:move', 'padding:7px 10px',
            'background:rgba(255,255,255,0.07)',
            'border-radius:12px 12px 0 0',
            'display:flex', 'align-items:center', 'justify-content:space-between',
            'user-select:none',
            'border-bottom:1px solid rgba(255,255,255,0.1)',
            'flex-shrink:0',
        ].join(';');
        header.innerHTML = '<span style="font-weight:bold;font-size:11px;opacity:0.75;">📊 富途組合助手</span>';

        // ── Refresh controls row ──
        const refreshRow = document.createElement('div');
        refreshRow.style.cssText = 'padding:6px 10px;display:flex;align-items:center;gap:8px;border-bottom:1px solid rgba(255,255,255,0.08);flex-shrink:0;';

        const rLabel = document.createElement('span');
        rLabel.textContent = '自動刷新:';
        rLabel.style.opacity = '0.65';
        refreshRow.appendChild(rLabel);

        const options = [{ v: 1, t: '1m' }, { v: 5, t: '5m' }, { v: 15, t: '15m' }, { v: 0, t: '關閉' }];
        const currentMins = getRefreshInterval();
        options.forEach(opt => {
            const optLabel = document.createElement('label');
            optLabel.style.cssText = 'display:flex;align-items:center;gap:3px;cursor:pointer;margin:0;user-select:none;';
            const radio = document.createElement('input');
            radio.type = 'radio';
            radio.name = 'ft-refresh-radio';
            radio.id = 'ft-radio-' + opt.v;
            radio.value = opt.v;
            radio.style.cssText = 'margin:0;cursor:pointer;';
            if (opt.v === currentMins) radio.checked = true;
            radio.onchange = e => { if (e.target.checked) setRefreshInterval(parseInt(e.target.value)); };
            const text = document.createElement('span');
            text.textContent = opt.t;
            optLabel.appendChild(radio);
            optLabel.appendChild(text);
            refreshRow.appendChild(optLabel);
        });

        // ── Log section ──
        const logSection = document.createElement('div');
        logSection.id = 'ft-panel-log';
        logSection.style.cssText = 'display:none;padding:8px 10px;flex:1;overflow-y:auto;font-size:12px;line-height:1.7;';

        wrap.appendChild(header);
        wrap.appendChild(refreshRow);
        wrap.appendChild(logSection);
        document.body.appendChild(wrap);

        // ── Draggable ──
        let isDragging = false, dragOffX = 0, dragOffY = 0;
        header.addEventListener('mousedown', e => {
            isDragging = true;
            const rect = wrap.getBoundingClientRect();
            dragOffX = e.clientX - rect.left;
            dragOffY = e.clientY - rect.top;
            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('mouseup', onDragUp);
        });
        function onDragMove(e) {
            if (!isDragging) return;
            wrap.style.right = 'auto';
            wrap.style.left = (e.clientX - dragOffX) + 'px';
            wrap.style.top = (e.clientY - dragOffY) + 'px';
        }
        function onDragUp() {
            isDragging = false;
            document.removeEventListener('mousemove', onDragMove);
            document.removeEventListener('mouseup', onDragUp);
        }
    }
    const fmtAmount = (n) => `$${Number(n).toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const parsePercent = (t) => { const m = String(t || '').replace(',', '').match(/-?\d+(\.\d+)?/); return m ? parseFloat(m[0]) : 0; }
    const getTotal = () => { const v = parseFloat(localStorage.getItem(key())); if (isFinite(v) && v > 0) return v; return DEFAULT_TOTAL_MAP[pid()] || FALLBACK_TOTAL; }
    const setTotal = (v) => localStorage.setItem(key(), String(v));
    const getActualShares = (code) => { const v = parseInt(localStorage.getItem(LS_SHARES_PREFIX + pid() + '_' + code)); return isNaN(v) ? 0 : v; };
    const setActualShares = (code, v) => localStorage.setItem(LS_SHARES_PREFIX + pid() + '_' + code, String(v));
    const getActualCost = (code) => { const v = parseFloat(localStorage.getItem(LS_COST_PREFIX + pid() + '_' + code)); return isNaN(v) ? null : v; };
    const setActualCost = (code, v) => { if (v === null) localStorage.removeItem(LS_COST_PREFIX + pid() + '_' + code); else localStorage.setItem(LS_COST_PREFIX + pid() + '_' + code, String(v)); };

    const getPrice = (row) => {
        const costEl = row.querySelector('.with2 .cost');
        const ratioEl = row.querySelector('.with3');
        if (!costEl) return 0;
        const cost = parseFloat(costEl.textContent.replace(/,/g, ''));
        if (!isFinite(cost)) return 0;
        if (!ratioEl) return cost;
        const ratio = parsePercent(ratioEl.textContent) / 100;
        return cost * (1 + ratio);
    };

    const saveLastRatios = () => {
        const rows = document.querySelectorAll('.position .stocks .stock-item');
        let ratios = {};
        rows.forEach(row => {
            const codeEl = row.querySelector('.code');
            if (!codeEl) return;
            const code = codeEl.textContent.trim();
            const ratioEl = row.querySelector('.with4.position-ratio');
            ratios[code] = ratioEl ? parsePercent(ratioEl.textContent) : 0;
        });
        localStorage.setItem(LS_LAST_RATIOS + pid(), JSON.stringify(ratios));
    };

    const recalcTotalAndRender = () => {
        let stockTotal = 0, ratioSum = 0;
        document.querySelectorAll('.position .stocks .stock-item').forEach(r => {
            const cEl = r.querySelector('.code');
            if (!cEl) return;
            const p = getPrice(r);
            const s = getActualShares(cEl.textContent.trim());
            if (p > 0 && s > 0) stockTotal += p * s;
            const ratioEl = r.querySelector('.with4.position-ratio');
            if (ratioEl) ratioSum += parsePercent(ratioEl.textContent);
        });
        if (stockTotal > 0) {
            // 若比例總和 < 100，代表有現金持倉，推算全倉總額
            const adjustedTotal = (ratioSum > 0 && ratioSum < 99.9)
                ? stockTotal / (ratioSum / 100)
                : stockTotal;
            setTotal(adjustedTotal);
            isManualOverride = false;
        }
        safeRender();
    };

    function showFloatingModal(deletedStocks = [], newStocks = [], changedStocks = []) {
        // 有變動 → 停止自動刷新
        const offRadio = document.getElementById('ft-radio-0');
        if (offRadio && !offRadio.checked) {
            offRadio.checked = true;
            setRefreshInterval(0);
        }

        const logSection = document.getElementById('ft-panel-log');
        if (!logSection) return;
        logSection.style.display = 'block';

        let html = '<div style="font-weight:bold;font-size:13px;margin-bottom:6px;color:#ffab40;">⚠️ 倉位變動提醒</div>';
        if (deletedStocks.length > 0)
            html += `<div><span style="color:#ef9a9a;">✕ 已刪除：</span>${deletedStocks.join(', ')}</div>`;
        if (newStocks.length > 0)
            html += `<div><span style="color:#a5d6a7;">✚ 新加入：</span>${newStocks.join(', ')}</div>`;
        if (changedStocks.length > 0)
            html += `<div><span style="color:#fff59d;">≈ 比例變動(&gt;5%)：</span><br>${changedStocks.join('<br>')}</div>`;
        if (!deletedStocks.length && !newStocks.length && !changedStocks.length)
            html += '<div>請檢查並更新最新持股量！</div>';
        html += `<div style="text-align:right;margin-top:8px;"><button id="ft-panel-log-btn" style="background:#ffab40;color:#111;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-weight:bold;font-size:11px;">我已更新</button></div>`;

        logSection.innerHTML = html;
        document.getElementById('ft-panel-log-btn')?.addEventListener('click', () => {
            saveLastRatios();
            hideFloatingModal();
            hasAlerted = false;
            safeRender();
        });
    }

    function hideFloatingModal() {
        const logSection = document.getElementById('ft-panel-log');
        if (logSection) { logSection.style.display = 'none'; logSection.innerHTML = ''; }
    }

    function notifyChange() {
        if (window.Notification && Notification.permission === "default") {
            Notification.requestPermission().catch(() => { });
        }
        if (window.Notification && Notification.permission === "granted") {
            new Notification('富途投資組合', { body: '倉位比例或股票有變動，請檢查並更新持股！' });
        }

        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'sine';
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.5, ctx.currentTime);
            osc.start();
            osc.stop(ctx.currentTime + 0.3);
        } catch (e) { }
    }

    // 注入一段 CSS，統一控制欄位收縮 & 寬度，避免推出畫面
    function injectStyle() {
        if (document.getElementById('ft-amount-style')) return;
        const css = `
      .position .stocks .stock-head,
      .position .stocks .stock-item > div { display:flex; }
      .position .stocks .stock-item > div > * { min-width:0; } /* 允許收縮 */

      /* 名稱欄：可縮放（避免擠爆） */
      .position .stocks .stock-head .with1,
      .position .stocks .stock-item .with1 { flex:1 1 auto; }

      /* 成本/盈虧比例：固定但可微縮 */
      .position .stocks .stock-head .with2,
      .position .stocks .stock-item .with2 { flex:0 1 72px; text-align:right; box-sizing:border-box; }
      .position .stocks .stock-head .with3,
      .position .stocks .stock-item .with3 { flex:0 1 88px; text-align:right; box-sizing:border-box; }

      /* 倉位比例 */
      .position .stocks .stock-head .with4,
      .position .stocks .stock-item .with4.position-ratio {
        flex:0 0 ${WIDTH_RATIO}px;
        text-align:right; padding-right:8px; box-sizing:border-box; white-space:nowrap;
      }

      /* 金額欄（新加） */
      .position .stocks .stock-head .with-amount,
      .position .stocks .stock-item .with-amount {
        flex:0 0 ${WIDTH_AMOUNT}px;
        text-align:right; padding-left:8px; box-sizing:border-box; white-space:nowrap;
      }

      /* 細屏時再收窄少少 */
      @media (max-width: 430px) {
        .position .stocks .stock-head .with4,
        .position .stocks .stock-item .with4.position-ratio { flex-basis:${Math.max(WIDTH_RATIO - 8, 68)}px; }
        .position .stocks .stock-head .with-amount,
        .position .stocks .stock-item .with-amount { flex-basis:${Math.max(WIDTH_AMOUNT - 10, 110)}px; }
      }
    `;
        const style = document.createElement('style');
        style.id = 'ft-amount-style';
        style.textContent = css;
        document.head.appendChild(style);
    }

    function ensureHeader() {
        const head = document.querySelector('.position .stocks .stock-head');
        if (!head) return;
        if (!head.querySelector('.with-amount')) {
            const ref = head.querySelector('.with4') || head.lastElementChild;
            const col = ref.cloneNode(true);
            col.textContent = '金額 (股數)';
            col.classList.remove('with4');
            col.classList.add('with-amount');
            head.appendChild(col);
        }
    }

    function renderRows(total) {
        const rows = document.querySelectorAll('.position .stocks .stock-item');
        rows.forEach((row) => {
            const ratioEl = row.querySelector('.with4.position-ratio');
            if (!ratioEl) return;

            const pct = parsePercent(ratioEl.textContent);
            const price = getPrice(row);
            const amt = (total * pct) / 100;

            let amtEl = row.querySelector('.with-amount');
            if (!amtEl) {
                amtEl = document.createElement('div');
                amtEl.className = 'with-amount';
                amtEl.style.display = 'flex';
                amtEl.style.flexDirection = 'column';
                amtEl.style.justifyContent = 'center';
                (row.firstElementChild || row).appendChild(amtEl);
            }

            const codeEl = row.querySelector('.code');
            const code = codeEl ? codeEl.textContent.trim() : '';
            const actualShares = getActualShares(code);

            const LS_RATIO_PREFIX = 'futunn_ratio_';
            const ratioKey = LS_RATIO_PREFIX + pid() + '_' + code;
            const storedRatioStr = localStorage.getItem(ratioKey);
            let shouldHighlight = false;

            if (storedRatioStr === null) {
                if (actualShares === 0) {
                    shouldHighlight = true;
                } else {
                    localStorage.setItem(ratioKey, String(pct));
                }
            } else {
                const storedRatio = parseFloat(storedRatioStr);
                if (Math.abs(pct - storedRatio) >= 10) {
                    shouldHighlight = true;
                }
            }

            if (shouldHighlight) {
                row.style.backgroundColor = 'rgba(255, 152, 0, 0.15)';
                row.title = '倉位變動大於 10% 或新增股票，請更新持股量！';
            } else {
                row.style.backgroundColor = '';
                row.title = '';
            }

            let sharesText = '';
            if (price > 0) {
                const targetShares = Math.round(amt / price);
                sharesText = ` (~${targetShares}股)`;
            }

            const mainText = fmtAmount(amt) + sharesText;

            let subEl = amtEl.querySelector('.amt-sub');
            if (subEl && !subEl.querySelector('.share-btn')) {
                subEl.remove();
                subEl = null;
            }

            let mainEl = amtEl.querySelector('.amt-main');
            if (!mainEl) {
                mainEl = document.createElement('div');
                mainEl.className = 'amt-main';
                amtEl.appendChild(mainEl);
            }
            if (!subEl) {
                subEl = document.createElement('div');
                subEl.className = 'amt-sub';
                subEl.style.fontSize = '10px';
                subEl.style.opacity = '0.6';

                const shareSpan = document.createElement('span');
                shareSpan.className = 'share-btn';
                shareSpan.style.cursor = 'pointer';
                shareSpan.onclick = (e) => {
                    e.stopPropagation();
                    if (shareSpan.querySelector('input')) return;

                    const currentVal = getActualShares(code);
                    const input = document.createElement('input');
                    input.type = 'number';
                    input.value = currentVal === 0 ? '' : currentVal;
                    input.placeholder = '股數';
                    input.style.cssText = 'width: 45px; font-size: 10px; padding: 0 2px; margin: 0; text-align: center; border: 1px solid #ff9800; border-radius: 3px; background: #fff; color: #333; outline: none;';

                    const saveValue = () => {
                        const valStr = input.value;
                        const v = parseInt(valStr.replace(/[, ]/g, ''));
                        setActualShares(code, isNaN(v) ? 0 : v);
                        recalcTotalAndRender();
                    };

                    input.onblur = saveValue;
                    input.onkeydown = (ev) => {
                        if (ev.key === 'Enter') {
                            input.blur();
                        } else if (ev.key === 'Escape') {
                            input.onblur = null;
                            safeRender();
                        }
                    };

                    shareSpan.innerHTML = '持股: ';
                    shareSpan.appendChild(input);
                    input.focus();
                    input.select();
                };

                const sepSpan = document.createElement('span');
                sepSpan.textContent = ' | ';

                const costSpan = document.createElement('span');
                costSpan.className = 'cost-btn';
                costSpan.style.cursor = 'pointer';
                costSpan.onclick = (e) => {
                    e.stopPropagation();
                    if (costSpan.querySelector('input')) return;

                    const currentCost = getActualCost(code);
                    const defaultCost = currentCost !== null ? currentCost : +(getPrice(row).toFixed(4));

                    const input = document.createElement('input');
                    input.type = 'number';
                    input.step = '0.0001';
                    input.value = currentCost !== null ? currentCost : defaultCost;
                    input.placeholder = '成本';
                    input.style.cssText = 'width: 55px; font-size: 10px; padding: 0 2px; margin: 0; text-align: center; border: 1px solid #ff9800; border-radius: 3px; background: #fff; color: #333; outline: none;';

                    const saveValue = () => {
                        const valStr = input.value;
                        if (valStr.trim() === '') {
                            setActualCost(code, null);
                        } else {
                            const v = parseFloat(valStr.replace(/[, ]/g, ''));
                            setActualCost(code, isNaN(v) ? null : v);
                        }
                        recalcTotalAndRender();
                    };

                    input.onblur = saveValue;
                    input.onkeydown = (ev) => {
                        if (ev.key === 'Enter') {
                            input.blur();
                        } else if (ev.key === 'Escape') {
                            input.onblur = null;
                            safeRender();
                        }
                    };

                    costSpan.innerHTML = '成本: ';
                    costSpan.appendChild(input);
                    input.focus();
                    input.select();
                };

                subEl.appendChild(shareSpan);
                subEl.appendChild(sepSpan);
                subEl.appendChild(costSpan);
                amtEl.appendChild(subEl);
            }

            const actualCost = getActualCost(code);
            const shareSpan = subEl.querySelector('.share-btn');
            const costSpan = subEl.querySelector('.cost-btn');

            const shareText = actualShares > 0 ? `持股: ${actualShares}` : '設持股';
            const costText = actualCost !== null ? `成本: ${actualCost}` : '設成本';

            if (mainEl.textContent !== mainText) mainEl.textContent = mainText;
            if (!shareSpan.querySelector('input') && shareSpan.textContent !== shareText) shareSpan.textContent = shareText;
            if (!costSpan.querySelector('input') && costSpan.textContent !== costText) costSpan.textContent = costText;
        });
    }

    function ensureControl(total) {
        const title = document.querySelector('.position.section .title');
        if (!title || title.parentElement.querySelector('.amount-control')) return;
        const wrap = document.createElement('span');
        wrap.className = 'amount-control';
        wrap.style.marginLeft = '10px';
        wrap.style.fontSize = '12px';

        const label = document.createElement('span');
        label.textContent = `總額：${fmtAmount(total)} `;
        label.style.opacity = '0.8';

        const btn = document.createElement('a');
        btn.href = 'javascript:';
        btn.textContent = '手動設定總額';
        btn.style.marginLeft = '6px';
        btn.style.textDecoration = 'underline';
        btn.onclick = () => {
            const cur = getTotal();
            const input = prompt('輸入總額（$）：', String(cur));
            if (input === null) return;
            const v = parseFloat(input.replace(/[, ]/g, ''));
            if (!isFinite(v) || v <= 0) return alert('請輸入有效金額');
            setTotal(v);
            isManualOverride = true;
            label.textContent = `總額：${fmtAmount(v)} `;
            safeRender();
        };

        wrap.appendChild(label);
        wrap.appendChild(btn);
        title.parentElement.insertBefore(wrap, title.nextSibling);
    }

    let hasCheckedChanges = false;
    let lastCheckedPid = null;

    function checkMissingStocks(rows) {
        const currentPid = pid();
        if (hasCheckedChanges && lastCheckedPid === currentPid) return;

        hasCheckedChanges = true;
        lastCheckedPid = currentPid;

        const currentStocks = {};
        rows.forEach(row => {
            const codeEl = row.querySelector('.code');
            if (codeEl) currentStocks[codeEl.textContent.trim()] = true;
        });

        const prefix = LS_SHARES_PREFIX + currentPid + '_';
        const costPrefix = LS_COST_PREFIX + currentPid + '_';
        const ratioPrefix = 'futunn_ratio_' + currentPid + '_';
        const keysToRemove = [];

        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith(prefix)) {
                const code = key.substring(prefix.length);
                if (!currentStocks.hasOwnProperty(code)) {
                    keysToRemove.push({ code, shareKey: key, ratioKey: ratioPrefix + code, costKey: costPrefix + code });
                }
            }
        }

        if (keysToRemove.length > 0) {
            setTimeout(() => {
                keysToRemove.forEach(item => {
                    if (confirm(`發現股票 ${item.code} 已不在組合中，是否清除其持股記錄？`)) {
                        localStorage.removeItem(item.shareKey);
                        localStorage.removeItem(item.ratioKey);
                        localStorage.removeItem(item.costKey);
                    }
                });
            }, 500);
        }
    }



    function tryRender() {
        injectStyle();
        initRefreshControl();
        const ready = document.querySelector('.position .stocks .stock-item .with4.position-ratio');
        if (!ready) return;
        isUpdating = true;

        const rows = document.querySelectorAll('.position .stocks .stock-item');
        checkMissingStocks(rows);

        let oldTotal = getTotal();
        let currentRatios = {};
        let currentStocks = [];
        let newTotal = 0;
        let hasShares = false;

        rows.forEach(row => {
            const codeEl = row.querySelector('.code');
            if (!codeEl) return;
            const code = codeEl.textContent.trim();
            currentStocks.push(code);

            const ratioEl = row.querySelector('.with4.position-ratio');
            const pct = ratioEl ? parsePercent(ratioEl.textContent) : 0;
            currentRatios[code] = pct;

            const price = getPrice(row);
            const actualShares = getActualShares(code);
            if (actualShares > 0) hasShares = true;
            if (price > 0 && actualShares > 0) newTotal += price * actualShares;
        });

        const lastStateStr = localStorage.getItem(LS_LAST_RATIOS + pid());
        let lastRatios = null;
        if (lastStateStr) {
            try { lastRatios = JSON.parse(lastStateStr); } catch (e) { }
        }

        let hasChange = false;
        let deletedStocks = [];
        let newStocks = [];
        let changedStocks = [];

        if (!lastRatios) {
            hasChange = true;
        } else {
            const lastCodes = Object.keys(lastRatios);
            for (let code of lastCodes) {
                if (!currentStocks.includes(code)) {
                    deletedStocks.push(code);
                    hasChange = true;
                }
            }
            for (let code of currentStocks) {
                if (!lastCodes.includes(code)) {
                    newStocks.push(code);
                    hasChange = true;
                } else if (Math.abs(currentRatios[code] - (lastRatios[code] || 0)) > 5) {
                    changedStocks.push(`${code} (${(lastRatios[code] || 0)}% → ${currentRatios[code]}%)`);
                    hasChange = true;
                }
            }
        }

        let finalTotal = oldTotal;

        if (hasChange) {
            showFloatingModal(deletedStocks, newStocks, changedStocks);
            if (!hasAlerted) {
                hasAlerted = true;
                notifyChange();
            }
        } else {
            hideFloatingModal();
            if (!isManualOverride && hasShares && newTotal > 0) {
                // 若比例總和 < 100，代表有現金持倉，推算全倉總額
                const ratioSum = Object.values(currentRatios).reduce((a, b) => a + b, 0);
                finalTotal = (ratioSum > 0 && ratioSum < 99.9)
                    ? newTotal / (ratioSum / 100)
                    : newTotal;
                setTotal(finalTotal);
                saveLastRatios();
            }
        }

        ensureHeader();
        ensureControl(finalTotal);

        const label = document.querySelector('.amount-control span:first-child');
        if (label) {
            label.textContent = `總額：${fmtAmount(finalTotal)} `;
        }

        renderRows(finalTotal);
        setTimeout(() => { isUpdating = false; }, 0);
    }

    function safeRender() {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            observer && observer.disconnect();
            tryRender();
            removeElements();
            observer && observer.observe(document.body, { childList: true, subtree: true });
        }, 120);
    }

    // 等 DOM load 完再執行
    function removeElements() {
        document.querySelector("div.private-modal")?.remove();
        // 移除 body 嘅 overflow hidden
        if (document.body.style.overflow === "hidden") {
            document.body.style.overflow = "";
        }
    }
    // 初始執行一次
    removeElements();

    const boot = setInterval(() => safeRender(), 500);
    setTimeout(() => clearInterval(boot), 10000);

    observer = new MutationObserver(() => { if (!isUpdating) safeRender(); });
    observer.observe(document.body, { childList: true, subtree: true });
})();