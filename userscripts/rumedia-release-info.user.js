// ==UserScript==
// @name         RuMedia Release Details Helper + Album Authors
// @namespace    https://rumedia.io/
// @version      3.0.0
// @description  Подробности релиза + комментарии + Мат + увеличение обложек + отображение автора и автора инструментала в edit-album на RuMedia.io.
// @author       Ruslan
// @match        https://rumedia.io/media/admin-cp/manage-songs?check*
// @match        https://rumedia.io/media/admin-cp/manage-albums?check*
// @match        https://rumedia.io/media/edit-album/*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STATE = {
        cache: new Map(),
        commentsCache: new Map(),
        authorsCache: new Map(),
    };

    const MODERATOR_NAMES = {
        moderator3: 'Руслан',
        moderator7: 'Матвей',
        moderator: 'Илья',
    };

    /* =====================================================
                        ПАРСИНГ ДЕТАЛЕЙ
    ===================================================== */

    function parseDetails(htmlText) {
        const doc = new DOMParser().parseFromString(htmlText, 'text/html');

        const producer = doc.querySelector('input#producer')?.value?.trim() || '—';
        const vocal = doc.querySelector('select#vocal option:checked')?.textContent?.trim() || '—';

        let age = '—';
        const ageSelect = doc.querySelector('select#age_restriction');
        if (ageSelect) age = ageSelect.value === '1' ? '18+' : '0+';

        return { producer, vocal, age };
    }

    /* =====================================================
                    ПЛЮРАЛИЗАЦИЯ + ДАТЫ
    ===================================================== */

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
        if (minutes < 60)
            return `${minutes} ${pluralize(minutes, ['минута', 'минуты', 'минут'])} назад`;

        const hours = Math.round(diffSec / 3600);
        if (hours < 24)
            return `${hours} ${pluralize(hours, ['час', 'часа', 'часов'])} назад`;

        const days = Math.round(diffSec / 86400);
        return `${days} ${pluralize(days, ['день', 'дня', 'дней'])} назад`;
    }

    function formatTimestamp(rawTimestamp, fallbackText) {
        const tryParse = (value) => {
            const num = Number(value);
            return Number.isFinite(num) ? num : null;
        };

        const parsed = tryParse(rawTimestamp) ?? tryParse(fallbackText);
        if (parsed === null) return fallbackText || '';

        const timestampMs = parsed * 1000;
        return `${formatRelative(timestampMs)} (${formatDateTime(timestampMs)})`;
    }

    /* =====================================================
                        ПАРСИНГ КОММЕНТОВ
    ===================================================== */

    function getLoginFromLink(link) {
        if (!link) return '';
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/(?:media|profile)\/([^/?#]+)/i);
        return match?.[1] || link.textContent?.trim() || '';
    }

    function parseComments(htmlText) {
        const doc = new DOMParser().parseFromString(htmlText, 'text/html');
        const items = doc.querySelectorAll('.comment_list li.comment_item');

        return Array.from(items)
            .map((item) => {
                const userLink = item.querySelector('.comment_username a');
                const login = getLoginFromLink(userLink) || 'Неизвестно';
                const author = MODERATOR_NAMES[login] || login;
                const text = item.querySelector('.comment_body')?.textContent?.trim() || '';
                const timeEl = item.querySelector('.comment_published .ajax-time');
                const raw = timeEl?.getAttribute('title');
                const fallback = timeEl?.textContent?.trim() || '';
                const time = formatTimestamp(raw, fallback);

                return { author, text, time };
            })
            .filter((c) => c.text);
    }

    /* =====================================================
                        FETCH
    ===================================================== */

    async function fetchDetails(id) {
        if (STATE.cache.has(id)) return STATE.cache.get(id);

        const url = `https://rumedia.io/media/edit-track/${id}`;
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) throw new Error(`Ошибка ${r.status}`);

        const html = await r.text();
        const data = parseDetails(html);
        STATE.cache.set(id, data);
        return data;
    }

    async function fetchComments(id) {
        if (STATE.commentsCache.has(id)) return STATE.commentsCache.get(id);

        const url = `https://rumedia.io/media/track/${id}`;
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) throw new Error(`Ошибка ${r.status}`);

        const html = await r.text();
        const data = parseComments(html);
        STATE.commentsCache.set(id, data);
        return data;
    }

    /* =====================================================
                HTML → ВСТРАИВАНИЕ ДЕТАЛЕЙ И КОММЕНТОВ
    ===================================================== */

    function buildHtml(details) {
        return `
            <div class="release-inline-details"
                style="margin-top:10px; padding:8px; background:#f5f5f5; border-radius:6px;">
                <div><strong>Автор инструментала:</strong> ${details.producer}</div>
                <div><strong>Вокал:</strong> ${details.vocal}</div>
                <div><strong>Мат:</strong> ${
                    details.age === '18+'
                        ? '<span style="color:red;font-weight:bold;">Есть</span>'
                        : 'Нет'
                }</div>
            </div>`;
    }

    function buildCommentsHtml(comments) {
        if (!comments.length)
            return `<div class="release-inline-comments"><h4 style="margin:0 0 6px 0;">Комментарии</h4><p>Комментариев нет.</p></div>`;

        const items = comments
            .map(
                (c) => `
            <li style="margin-bottom:8px; line-height:1.4;">
                <strong>${c.author}:</strong> ${c.text}
                <div style="color:#555; font-size:12px;">${c.time}</div>
            </li>
        `
            )
            .join('');

        return `
            <div class="release-inline-comments">
                <h4 style="margin:0 0 6px 0;">Комментарии</h4>
                <ul style="padding-left:18px; margin:0;">${items}</ul>
            </div>`;
    }

    function findRecognitionRow(row) {
        let pointer = row.nextElementSibling;
        while (pointer) {
            const txt = pointer.querySelector('td')?.textContent?.trim();
            if (txt && txt.startsWith('Распознание')) return pointer;
            if (pointer.querySelector('form input[name="audio_id"]')) break;
            pointer = pointer.nextElementSibling;
        }
        return null;
    }

    function renderDetails(row, details) {
        const cell = row.querySelector('td:nth-child(4)');
        if (!cell) return;

        const wrap = document.createElement('div');
        wrap.innerHTML = buildHtml(details);

        const old = cell.querySelector('.release-inline-details');
        if (old) old.replaceWith(wrap.firstElementChild);
        else cell.appendChild(wrap.firstElementChild);
    }

    function renderComments(row, comments, useRecognitionRow = true) {
        const base = useRecognitionRow ? findRecognitionRow(row) || row : row;

        const tr = document.createElement('tr');
        tr.className = 'release-comments-row';

        const td = document.createElement('td');
        td.colSpan = row.children.length;
        td.style.background = '#fbfbfb';
        td.style.borderTop = '1px solid #e0e0e0';
        td.innerHTML = buildCommentsHtml(comments);

        tr.appendChild(td);

        const next = base.nextElementSibling;
        if (next?.classList.contains('release-comments-row')) next.replaceWith(tr);
        else base.insertAdjacentElement('afterend', tr);
    }

    async function renderReleaseInfo(form, id) {
        const row = form.closest('tr');
        if (!row) return;

        try {
            const [details, comments] = await Promise.all([
                fetchDetails(id),
                fetchComments(id),
            ]);

            renderDetails(row, details);
            renderComments(row, comments);

            form.dataset.detailsLoaded = '1';
        } catch (e) {
            renderDetails(row, { producer: e.message, vocal: '—', age: '—' });
        }
    }

    function processForms() {
        const forms = Array.from(document.querySelectorAll('form')).filter(
            (f) => f.querySelector('input[name="audio_id"]') && f.querySelector('input[name="add_queue"]')
        );

        forms.forEach((f) => {
            if (f.dataset.detailsLoaded) return;
            const id = f.querySelector('input[name="audio_id"]')?.value;
            if (!id) return;

            f.dataset.detailsLoaded = 'loading';
            renderReleaseInfo(f, id);
        });
    }

    /* =====================================================
                        АЛЬБОМЫ → КОММЕНТАРИИ
    ===================================================== */

    async function fetchAlbumComments(slug) {
        const key = `album:${slug}`;
        if (STATE.commentsCache.has(key)) return STATE.commentsCache.get(key);

        const r = await fetch(`https://rumedia.io/media/album/${slug}`, { credentials: 'include' });
        if (!r.ok) throw new Error(`Ошибка ${r.status}`);

        const html = await r.text();
        const data = parseComments(html);
        STATE.commentsCache.set(key, data);
        return data;
    }

    function getAlbumSlug(row) {
        const link = row.querySelector('a[href*="/album/"]');
        const href = link?.getAttribute('href') || '';
        const match = href.match(/\/album\/([^/?#]+)/i);
        return match?.[1] || null;
    }

    function processAlbumRows() {
        if (!location.pathname.includes('/admin-cp/manage-albums')) return;

        const rows = Array.from(document.querySelectorAll('.table-responsive1 tbody tr[id]'));

        rows.forEach((row) => {
            if (row.dataset.albumCommentsLoaded) return;

            const slug = getAlbumSlug(row);
            if (!slug) return;

            row.dataset.albumCommentsLoaded = 'loading';

            fetchAlbumComments(slug)
                .then((comments) => {
                    renderComments(row, comments, false);
                    row.dataset.albumCommentsLoaded = '1';
                })
                .catch((e) => {
                    renderComments(row, [{ author: 'Ошибка', text: e.message, time: '' }], false);
                });
        });
    }

    /* =====================================================
                        ZOOM COVER
    ===================================================== */

    function enableCoverZoom() {
        const overlay = document.createElement('div');
        overlay.id = 'cover-zoom-overlay';
        overlay.style = `
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.85);
            display: none;
            justify-content: center;
            align-items: center;
            z-index: 999999;
            cursor: zoom-out;
        `;

        const img = document.createElement('img');
        img.style = `
            max-width: 90%;
            max-height: 90%;
            border-radius: 8px;
            box-shadow: 0 0 20px rgba(0,0,0,0.5);
        `;

        overlay.appendChild(img);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', () => (overlay.style.display = 'none'));
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') overlay.style.display = 'none';
        });

        function bindCovers() {
            document.querySelectorAll('img').forEach((i) => {
                if (i.dataset.zoomBound) return;
                i.dataset.zoomBound = '1';
                i.style.cursor = 'zoom-in';

                i.addEventListener('click', () => {
                    const src = i.src || i.getAttribute('data-src');
                    if (!src) return;
                    img.src = src;
                    overlay.style.display = 'flex';
                });
            });
        }

        bindCovers();
        new MutationObserver(bindCovers).observe(document.body, {
            childList: true,
            subtree: true,
        });
    }

    /* =====================================================
               ДОБАВЛЕНИЕ АВТОРА И ПРОДЮСЕРА В EDIT-ALBUM
    ===================================================== */

    function getTrackIdFromLink(a) {
        if (!a) return null;
        const href = a.getAttribute('href') || '';
        const m = href.match(/edit-track\/([A-Za-z0-9]+)/);
        return m ? m[1] : null;
    }

    async function fetchTrackAuthors(id) {
        if (STATE.authorsCache.has(id)) return STATE.authorsCache.get(id);

        const r = await fetch(`https://rumedia.io/media/edit-track/${id}`, { credentials: 'include' });
        if (!r.ok) return null;

        const html = await r.text();
        const doc = new DOMParser().parseFromString(html, 'text/html');

        const info = {
            written: doc.querySelector('#written')?.value?.trim() || '—',
            producer: doc.querySelector('#producer')?.value?.trim() || '—',
        };

        STATE.authorsCache.set(id, info);
        return info;
    }

    async function enhanceAlbumEditor() {
        if (!location.pathname.includes('/media/edit-album/')) return;

        const blocks = document.querySelectorAll('.uploaded_albm_slist');

        for (const block of blocks) {
            if (block.dataset.authorsLoaded) continue;
            block.dataset.authorsLoaded = '1';

            const p = block.querySelector('p');
            if (!p) continue;

            const link =
                block.querySelector('a[data-load]') ||
                block.querySelector('a[href*="edit-track"]');

            const id = getTrackIdFromLink(link);
            if (!id) continue;

            const info = await fetchTrackAuthors(id);
            if (!info) continue;

            const vocalSpan = [...p.querySelectorAll('span')].find((sp) =>
                sp.textContent.trim().startsWith('Вокал')
            );

            if (!vocalSpan) continue;

            const div = document.createElement('div');
            div.style.cssText = 'font-size:12px; margin-top:4px;';
            div.innerHTML = `
                <div>Автор: <b>${info.written}</b></div>
                <div>Автор инструментала: <b>${info.producer}</b></div>
            `;

            vocalSpan.insertAdjacentElement('afterend', div);
        }
    }

    /* =====================================================
                        OBSERVER
    ===================================================== */

    function observeTable() {
        const table = document.querySelector('.table-responsive1, table.table');
        if (!table) return;

        new MutationObserver(() => {
            processForms();
            processAlbumRows();
            enhanceAlbumEditor();
        }).observe(table, { childList: true, subtree: true });
    }

    /* =====================================================
                        READY
    ===================================================== */

    function ready(fn) {
        if (document.readyState === 'loading')
            document.addEventListener('DOMContentLoaded', fn);
        else fn();
    }

    /* =====================================================
                        INIT
    ===================================================== */

    ready(() => {
        processForms();
        processAlbumRows();
        enhanceAlbumEditor();
        observeTable();
        enableCoverZoom();
    });
})();
