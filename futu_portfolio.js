// ==UserScript==
// @name         Futunn Portfolio Amount Column ($) + Safe Width
// @namespace    hk.tools.futunn.amountcol
// @version      1.3.3
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

    let isManualOverride = false;

    // ▼ 闊度微調
    const WIDTH_RATIO = 84;
    const WIDTH_AMOUNT = 145;

    let isUpdating = false, debounceTimer = null, observer = null;

    const pid = () => (location.pathname.match(/portfolio\/(\d+)/) || [])[1] || 'default';
    const key = () => LS_KEY_PREFIX + pid();
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

    function showFloatingModal() {
        if (document.getElementById('ft-floating-modal')) return;
        const modal = document.createElement('div');
        modal.id = 'ft-floating-modal';
        modal.style.cssText = `
            position: fixed; top: 60px; left: 50%; transform: translateX(-50%);
            background: rgba(244, 67, 54, 0.95); color: #fff; padding: 10px 16px;
            border-radius: 8px; z-index: 99999; font-size: 14px; display: flex;
            align-items: center; gap: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            white-space: nowrap;
        `;
        const text = document.createElement('span');
        text.textContent = '倉位比例或股票有變動，請更新持股！';

        const btn = document.createElement('button');
        btn.textContent = '我已更新';
        btn.style.cssText = 'background: #fff; color: #f44336; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-weight: bold;';
        btn.onclick = () => {
            saveLastRatios();
            modal.remove();
            safeRender();
        };
        modal.appendChild(text); modal.appendChild(btn);
        document.body.appendChild(modal);
    }

    function hideFloatingModal() {
        const modal = document.getElementById('ft-floating-modal');
        if (modal) modal.remove();
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
                    const input = prompt(`輸入 ${code} 的實際持股：`, String(getActualShares(code)));
                    if (input !== null) {
                        const v = parseInt(input.replace(/[, ]/g, ''));
                        setActualShares(code, isNaN(v) ? 0 : v);

                        let tempTotal = 0;
                        document.querySelectorAll('.position .stocks .stock-item').forEach(r => {
                            const cEl = r.querySelector('.code');
                            if (!cEl) return;
                            const p = getPrice(r);
                            const s = getActualShares(cEl.textContent.trim());
                            if (p > 0 && s > 0) tempTotal += p * s;
                        });
                        if (tempTotal > 0) {
                            setTotal(tempTotal);
                            isManualOverride = false;
                        }
                        safeRender();
                    }
                };

                const sepSpan = document.createElement('span');
                sepSpan.textContent = ' | ';

                const costSpan = document.createElement('span');
                costSpan.className = 'cost-btn';
                costSpan.style.cursor = 'pointer';
                costSpan.onclick = (e) => {
                    e.stopPropagation();
                    const defaultCost = getActualCost(code) !== null ? getActualCost(code) : +(getPrice(row).toFixed(4));
                    const input = prompt(`輸入 ${code} 的平均成本：\n（留空以清除）`, String(defaultCost));
                    if (input !== null) {
                        if (input.trim() === '') {
                            setActualCost(code, null);
                        } else {
                            const v = parseFloat(input.replace(/[, ]/g, ''));
                            setActualCost(code, isNaN(v) ? null : v);
                        }

                        let tempTotal = 0;
                        document.querySelectorAll('.position .stocks .stock-item').forEach(r => {
                            const cEl = r.querySelector('.code');
                            if (!cEl) return;
                            const p = getPrice(r);
                            const s = getActualShares(cEl.textContent.trim());
                            if (p > 0 && s > 0) tempTotal += p * s;
                        });
                        if (tempTotal > 0) {
                            setTotal(tempTotal);
                            isManualOverride = false;
                        }
                        safeRender();
                    }
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
            if (shareSpan.textContent !== shareText) shareSpan.textContent = shareText;
            if (costSpan.textContent !== costText) costSpan.textContent = costText;
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
        if (!lastRatios) {
            hasChange = true;
        } else {
            const lastCodes = Object.keys(lastRatios);
            if (lastCodes.sort().join(',') !== currentStocks.sort().join(',')) {
                hasChange = true;
            } else {
                for (let code of currentStocks) {
                    if (Math.abs(currentRatios[code] - (lastRatios[code] || 0)) > 5) {
                        hasChange = true;
                        break;
                    }
                }
            }
        }

        let finalTotal = oldTotal;

        if (hasChange) {
            showFloatingModal();
        } else {
            hideFloatingModal();
            if (!isManualOverride && hasShares && newTotal > 0) {
                finalTotal = newTotal;
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