// ==UserScript==
// @name         RuMedia Release Details Helper
// @namespace    https://rumedia.io/
// @version      1.3.1
// @description  Показывает подробности релиза (Автор инструментала, вокал) и наличие модераторских комментариев прямо в списке очереди модерации.
// @author       Custom
// @match        https://rumedia.io/media/admin-cp/manage-songs*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STATE = {
        cache: new Map(),
        commentsCache: new Map(),
        popup: null,
        overlay: null,
    };

    function createOverlay() {
        const overlay = document.createElement('div');
        Object.assign(overlay.style, {
            position: 'fixed',
            top: '0',
            left: '0',
            width: '100%',
            height: '100%',
            background: 'rgba(0,0,0,0.4)',
            zIndex: '9998',
            display: 'none',
        });
        overlay.addEventListener('click', hidePopup);
        document.body.appendChild(overlay);
        STATE.overlay = overlay;
    }

    function createPopup() {
        const popup = document.createElement('div');
        Object.assign(popup.style, {
            position: 'fixed',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            background: '#fff',
            borderRadius: '8px',
            padding: '16px 20px 20px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.25)',
            zIndex: '9999',
            minWidth: '300px',
            maxWidth: '520px',
            display: 'none',
        });

        const closeBtn = document.createElement('button');
        closeBtn.textContent = 'Закрыть';
        closeBtn.style.cssText = 'float:right; margin:-8px -8px 0 0;';
        closeBtn.addEventListener('click', hidePopup);

        const content = document.createElement('div');
        content.id = 'release-details-content';

        popup.appendChild(closeBtn);
        popup.appendChild(content);
        document.body.appendChild(popup);

        STATE.popup = popup;
    }

    function ensureUi() {
        if (!STATE.overlay) {
            createOverlay();
        }
        if (!STATE.popup) {
            createPopup();
        }
    }

    function hidePopup() {
        if (STATE.popup) {
            STATE.popup.style.display = 'none';
        }
        if (STATE.overlay) {
            STATE.overlay.style.display = 'none';
        }
    }

    function showPopup(html) {
        ensureUi();
        const content = document.getElementById('release-details-content');
        if (content) {
            content.innerHTML = html;
        }
        STATE.overlay.style.display = 'block';
        STATE.popup.style.display = 'block';
    }

    function parseDetails(htmlText) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const producer = doc.querySelector('input#producer')?.value?.trim() || '—';
        const vocal = doc.querySelector('select#vocal option:checked')?.textContent?.trim() || '—';
        return { producer, vocal };
    }

    function pluralize(value, forms) {
        const abs = Math.abs(value) % 100;
        const last = abs % 10;
        if (abs > 10 && abs < 20) return forms[2];
        if (last > 1 && last < 5) return forms[1];
        if (last === 1) return forms[0];
        return forms[2];
    }

    function formatDateTime(timestampMs) {
        const date = new Date(timestampMs);
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    function formatRelative(timestampMs) {
        const diffSec = Math.max(0, Math.round((Date.now() - timestampMs) / 1000));
        if (diffSec < 60) return 'меньше минуты назад';

        const minutes = Math.round(diffSec / 60);
        if (minutes < 60) {
            return `${minutes} ${pluralize(minutes, ['минута', 'минуты', 'минут'])} назад`;
        }

        const hours = Math.round(diffSec / 3600);
        if (hours < 24) {
            return `${hours} ${pluralize(hours, ['час', 'часа', 'часов'])} назад`;
        }

        const days = Math.round(diffSec / 86400);
        return `${days} ${pluralize(days, ['день', 'дня', 'дней'])} назад`;
    }

    function formatTimestamp(rawTimestamp, fallbackText) {
        const tryParse = (value) => {
            const num = Number(value);
            return Number.isFinite(num) ? num : null;
        };

        const parsed = tryParse(rawTimestamp) ?? tryParse(fallbackText);
        if (parsed === null) {
            return fallbackText || '';
        }

        const timestampMs = parsed * 1000;
        const relative = formatRelative(timestampMs);
        const absolute = formatDateTime(timestampMs);
        return `${relative} (${absolute})`;
    }

    function parseComments(htmlText) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const items = doc.querySelectorAll('.comment_list li.comment_item');
        return Array.from(items)
            .map((item) => {
                const author = item.querySelector('.comment_username a')?.textContent?.trim() || 'Неизвестно';
                const text = item.querySelector('.comment_body')?.textContent?.trim() || '';
                const timeEl = item.querySelector('.comment_published .ajax-time');
                const timeRaw = timeEl?.getAttribute('title');
                const timeFallback = timeEl?.textContent?.trim() || '';
                const time = formatTimestamp(timeRaw, timeFallback);
                return { author, text, time };
            })
            .filter((c) => c.text);
    }

    async function fetchDetails(audioId) {
        if (STATE.cache.has(audioId)) {
            return STATE.cache.get(audioId);
        }

        const url = `https://rumedia.io/media/edit-track/${audioId}`;
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
            throw new Error(`Не удалось получить данные (${response.status})`);
        }

        const text = await response.text();
        const details = parseDetails(text);
        STATE.cache.set(audioId, details);
        return details;
    }

    async function fetchComments(audioId) {
        if (STATE.commentsCache.has(audioId)) {
            return STATE.commentsCache.get(audioId);
        }

        const url = `https://rumedia.io/media/track/${audioId}`;
        const response = await fetch(url, { credentials: 'include' });
        if (!response.ok) {
            throw new Error(`Не удалось получить комментарии (${response.status})`);
        }

        const text = await response.text();
        const comments = parseComments(text);
        STATE.commentsCache.set(audioId, comments);
        return comments;
    }

    function buildHtml(details) {
        return `
            <h4 style="margin:0 0 8px 0;">Детали релиза</h4>
            <p style="margin:4px 0;"><strong>Автор инструментала:</strong> ${details.producer}</p>
            <p style="margin:4px 0;"><strong>Вокал:</strong> ${details.vocal}</p>
        `;
    }

    function buildCommentsHtml(comments) {
        if (!comments || comments.length === 0) {
            return '<h4 style="margin:0 0 8px 0;">Комментарии</h4><p style="margin:4px 0;">Комментариев нет.</p>';
        }

        const items = comments
            .map((c) => {
                const when = c.time ? `<div style="color:#555; font-size:12px; margin-top:2px;">${c.time}</div>` : '';
                return `<li style="margin-bottom:8px; line-height:1.4;"><strong>${c.author}:</strong> <span>${c.text}</span>${when}</li>`;
            })
            .join('');

        return `
            <h4 style="margin:0 0 8px 0;">Комментарии</h4>
            <ul style="padding-left:18px; margin:0;">${items}</ul>
        `;
    }

    function getButtonsContainer(form) {
        let container = form.querySelector('.release-helper-buttons');
        if (container) {
            return container;
        }

        container = document.createElement('div');
        container.className = 'release-helper-buttons';
        container.style.marginTop = '8px';
        container.style.display = 'flex';
        container.style.flexWrap = 'wrap';
        container.style.gap = '6px';

        const queueBtn = form.querySelector('input[name="add_queue"]');
        if (queueBtn && queueBtn.parentNode) {
            queueBtn.parentNode.insertBefore(container, queueBtn.nextSibling);
        } else {
            form.appendChild(container);
        }

        return container;
    }

    function createInfoButton(form, audioId) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Посмотреть детали';
        btn.className = 'btn btn-info';

        btn.addEventListener('click', async () => {
            btn.disabled = true;
            const previous = btn.textContent;
            btn.textContent = 'Загрузка...';
            try {
                const details = await fetchDetails(audioId);
                showPopup(buildHtml(details));
            } catch (error) {
                showPopup(`<p style="color:red; margin:0;">${error.message}</p>`);
            } finally {
                btn.disabled = false;
                btn.textContent = previous;
            }
        });

        const container = getButtonsContainer(form);
        container.appendChild(btn);
    }

    function createCommentsButton(form, audioId) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Наличие комментов';
        btn.className = 'btn btn-warning';

        btn.addEventListener('click', async () => {
            btn.disabled = true;
            const previous = btn.textContent;
            btn.textContent = 'Загрузка...';
            try {
                const comments = await fetchComments(audioId);
                showPopup(buildCommentsHtml(comments));
            } catch (error) {
                showPopup(`<p style="color:red; margin:0;">${error.message}</p>`);
            } finally {
                btn.disabled = false;
                btn.textContent = previous;
            }
        });

        const container = getButtonsContainer(form);
        container.appendChild(btn);
    }

    function initButtons() {
        const forms = Array.from(document.querySelectorAll('form')).filter((form) =>
            form.querySelector('input[name="audio_id"]') && form.querySelector('input[name="add_queue"]')
        );

        forms.forEach((form) => {
            if (form.dataset.detailsButtonAdded) {
                return;
            }
            const audioInput = form.querySelector('input[name="audio_id"]');
            if (!audioInput || !audioInput.value) {
                return;
            }
            form.dataset.detailsButtonAdded = '1';
            createInfoButton(form, audioInput.value);
            createCommentsButton(form, audioInput.value);
        });
    }

    function observeTable() {
        const table = document.querySelector('.table-responsive1, table.table');
        if (!table) {
            return;
        }

        const observer = new MutationObserver(() => initButtons());
        observer.observe(table, { childList: true, subtree: true });
    }

    function ready(callback) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback);
        } else {
            callback();
        }
    }

    ready(() => {
        ensureUi();
        initButtons();
        observeTable();
    });
})();

