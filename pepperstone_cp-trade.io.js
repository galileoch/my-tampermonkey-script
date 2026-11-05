// ==UserScript==
// @name         Pepperstone CopyTrading - Loss Rate
// @namespace    https://github.com/galileoch/my-tampermonkey-script
// @version      1.0.0
// @description  Show the losing-trade percentage in the strategy's Trading summary.
// @author       galileoch
// @match        https://pepperstone.copy-trade.io/strategy/*
// @run-at       document-idle
// @grant        none
// @updateURL    https://raw.githubusercontent.com/galileoch/my-tampermonkey-script/main/pepperstone_cp-trade.io.js
// @downloadURL  https://raw.githubusercontent.com/galileoch/my-tampermonkey-script/main/pepperstone_cp-trade.io.js
// ==/UserScript==

(() => {
    'use strict';

    const RESULT_ID = 'tm-pepperstone-loss-rate';
    const WIN_LABELS = new Set(['贏利交易', '盈利交易', '獲利交易', '获利交易', 'winningtrades', 'profitabletrades']);
    const LOSS_LABELS = new Set(['虧損交易', '亏损交易', 'losingtrades', 'losstrades']);

    function normalizeLabel(text) {
        return (text || '').replace(/\s+/g, '').toLowerCase();
    }

    function parseCount(text) {
        const value = (text || '').replace(/[,，\s\u00a0]/g, '');
        return /^\d+$/.test(value) ? Number(value) : null;
    }

    function findStat(card, names) {
        for (const label of card.querySelectorAll('.profile-section-body label')) {
            if (!names.has(normalizeLabel(label.textContent))) continue;
            const valueElement = label.parentElement?.querySelector('span.d-block');
            if (!valueElement) continue;
            return { label, count: parseCount(valueElement.textContent) };
        }
        return null;
    }

    function updateLossRate() {
        // Avoid showing a stale figure on sub-pages such as /strategy/123/copiers.
        if (!/^\/strategy\/[^/]+\/?$/.test(location.pathname)) return;

        for (const card of document.querySelectorAll('.glass-card')) {
            const heading = card.querySelector('.profile-section-header h5');
            if (!heading || !['交易', 'trades', 'trading'].includes(normalizeLabel(heading.textContent))) continue;

            const wins = findStat(card, WIN_LABELS);
            const losses = findStat(card, LOSS_LABELS);
            if (!wins || !losses || wins.count === null || losses.count === null) continue;

            const winRow = wins.label.closest('.row');
            const lossRow = losses.label.closest('.row');
            if (!lossRow || winRow !== lossRow) continue;

            let result = lossRow.querySelector('#' + RESULT_ID);
            if (!result) {
                result = document.createElement('div');
                result.id = RESULT_ID;
                result.className = 'col-4';

                const label = document.createElement('label');
                label.textContent = '虧損比率';

                const number = document.createElement('span');
                number.className = 'd-block text-danger fw-semibold';
                number.title = '虧損交易 ÷ (贏利交易 + 虧損交易)';

                result.append(label, number);
                lossRow.appendChild(result);
            }

            const total = wins.count + losses.count;
            const percentage = total > 0 ? (losses.count / total * 100).toFixed(2) + '%' : '—';
            const number = result.querySelector('span');
            if (number && number.textContent !== percentage) number.textContent = percentage;
            return;
        }
    }

    // Blazor loads the content asynchronously and can replace the stats on navigation.
    let scheduled = false;
    const observer = new MutationObserver(() => {
        if (scheduled) return;
        scheduled = true;
        setTimeout(() => {
            scheduled = false;
            updateLossRate();
        }, 100);
    });

    observer.observe(document.body, { childList: true, characterData: true, subtree: true });
    updateLossRate();
})();
