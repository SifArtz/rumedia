// ==UserScript==
// @name         RuMedia Helper — Details, Comments, Age, Covers Zoom, Album Authors
// @namespace    https://rumedia.io/
// @version      2.0
// @description  Подробности треков, комментарии, мат, увеличение обложек и авто-подгрузка Автор/Автор инструментала в альбомах.
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
    };

    const MODERATOR_NAMES = {
        moderator3: 'Руслан',
        moderator7: 'Матвей',
        moderator: 'Илья',
    };

    /* ========================================================================
       ПОЛУЧЕНИЕ ДЕТАЛЕЙ ТРЕКА (Автор инструментала, вокал, мат)
    ======================================================================== */

    function parseDetails(htmlText) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');

        const producer = doc.querySelector('input#producer')?.value?.trim() || '—';
        const vocal = doc.querySelector('select#vocal option:checked')?.textContent?.trim() || '—';

        // age_restriction
        let age = '—';
        const ageSelect = doc.querySelector('select#age_restriction');
        if (ageSelect) age = ageSelect.value === '1' ? '18+' : '0+';

        return { producer, vocal, age };
    }

    /* ========================================================================
       ВСПОМОГАТЕЛЬНЫЕ Ф-ИИ ДАТЫ/ВРЕМЕНИ
    ======================================================================== */

    function pluralize(value, forms) {
        const abs = Math.abs(value) % 100;
        const last = abs % 10;
        if (abs > 10 && abs < 20) return forms[2];
        if (last > 1 && last < 5) return forms[1];
        if (last === 1) return forms[0];
        return forms[2];
    }

    function formatDateTime(timestampMs) {
        const d = new Date(timestampMs);
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    function formatRelative(ts) {
        const diffSec = Math.max(0, Math.round((Date.now() - ts) / 1000));

        if (diffSec < 60) return 'меньше минуты назад';
        const min = Math.round(diffSec / 60);
        if (min < 60) return `${min} ${pluralize(min, ['минута', 'минуты', 'минут'])} назад`;
        const h = Math.round(diffSec / 3600);
        if (h < 24) return `${h} ${pluralize(h, ['час', 'часа', 'часов'])} назад`;
        const d = Math.round(diffSec / 86400);
        return `${d} ${pluralize(d, ['день', 'дня', 'дней'])} назад`;
    }

    function formatTimestamp(raw, fb) {
        const tryNum = (v) => {
            const n = Number(v);
            return Number.isFinite(n) ? n : null;
        };
        const parsed = tryNum(raw) ?? tryNum(fb);
        if (parsed === null) return fb || '';

        const ts = parsed * 1000;
        return `${formatRelative(ts)} (${formatDateTime(ts)})`;
    }

    /* ========================================================================
       ПАРСИНГ КОММЕНТАРИЕВ
    ======================================================================== */

    function getLoginFromLink(link) {
        if (!link) return '';
        const href = link.getAttribute('href') || '';
        const m = href.match(/\/(?:media|profile)\/([^/?#]+)/i);
        return m?.[1] || link.textContent?.trim() || '';
    }

    function parseComments(htmlText) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');

        const items = doc.querySelectorAll('.comment_list li.comment_item');

        return Array.from(items)
            .map((it) => {
                const userLink = it.querySelector('.comment_username a');
                const login = getLoginFromLink(userLink);
                const author = MODERATOR_NAMES[login] || login || 'Неизвестно';
                const text = it.querySelector('.comment_body')?.textContent?.trim() || '';

                const timeEl = it.querySelector('.comment_published .ajax-time');
                const raw = timeEl?.getAttribute('title');
                const fb = timeEl?.textContent?.trim() || '';
                const time = formatTimestamp(raw, fb);

                return { author, text, time };
            })
            .filter((c) => c.text);
    }

    /* ========================================================================
       AJAX: DETAILS & COMMENTS
    ======================================================================== */

    async function fetchDetails(audioId) {
        if (STATE.cache.has(audioId)) return STATE.cache.get(audioId);

        const url = `https://rumedia.io/media/edit-track/${audioId}`;
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) throw new Error(`Ошибка ${r.status}`);
        const text = await r.text();
        const details = parseDetails(text);
        STATE.cache.set(audioId, details);
        return details;
    }

    async function fetchComments(audioId) {
        if (STATE.commentsCache.has(audioId)) return STATE.commentsCache.get(audioId);

        const url = `https://rumedia.io/media/track/${audioId}`;
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) throw new Error(`Ошибка ${r.status}`);
        const text = await r.text();
        const comments = parseComments(text);

        STATE.commentsCache.set(audioId, comments);
        return comments;
    }

    async function fetchAlbumComments(slug) {
        const key = `album:${slug}`;
        if (STATE.commentsCache.has(key)) return STATE.commentsCache.get(key);

        const url = `https://rumedia.io/media/album/${slug}`;
        const r = await fetch(url, { credentials: 'include' });
        if (!r.ok) throw new Error(`Ошибка ${r.status}`);
        const text = await r.text();
        const comments = parseComments(text);

        STATE.commentsCache.set(key, comments);
        return comments;
    }

    /* ========================================================================
       HTML ВСТАВКИ
    ======================================================================== */

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
            return `<div class="release-inline-comments">
                        <h4 style="margin:0 0 6px 0;">Комментарии</h4>
                        <p>Комментариев нет.</p>
                    </div>`;

        const items = comments.map((c) => `
            <li style="margin-bottom:8px;">
                <strong>${c.author}:</strong> ${c.text}
                <div style="font-size:12px;color:#555;">${c.time}</div>
            </li>
        `).join('');

        return `
            <div class="release-inline-comments">
                <h4 style="margin:0 0 6px 0;">Комментарии</h4>
                <ul style="padding-left:18px;margin:0;">${items}</ul>
            </div>
        `;
    }

    /* ========================================================================
       ВСТАВКА ПОДРОБНОСТЕЙ И КОММЕНТОВ В ТАБЛИЦУ
    ======================================================================== */

    function findRecognitionRow(row) {
        let p = row.nextElementSibling;
        while (p) {
            const t = p.querySelector('td')?.textContent || '';
            if (t.trim().startsWith('Распознание')) return p;
            if (p.querySelector('form input[name="audio_id"]')) break;
            p = p.nextElementSibling;
        }
        return null;
    }

    function renderDetails(row, details) {
        const cell = row.querySelector('td:nth-child(4)');
        if (!cell) return;

        const wrap = document.createElement('div');
        wrap.innerHTML = buildHtml(details);

        const existing = cell.querySelector('.release-inline-details');
        if (existing) existing.replaceWith(wrap.firstElementChild);
        else cell.appendChild(wrap.firstElementChild);
    }

    function renderComments(row, comments, useRecognition = true) {
        const baseRow = useRecognition ? (findRecognitionRow(row) || row) : row;

        const tr = document.createElement('tr');
        tr.className = 'release-comments-row';

        const td = document.createElement('td');
        td.colSpan = row.children.length;
        td.style.background = '#fbfbfb';
        td.style.borderTop = '1px solid #e0e0e0';
        td.innerHTML = buildCommentsHtml(comments);

        tr.appendChild(td);

        const next = baseRow.nextElementSibling;
        if (next && next.classList.contains('release-comments-row'))
            next.replaceWith(tr);
        else
            baseRow.insertAdjacentElement('afterend', tr);
    }

    async function renderReleaseInfo(form, audioId) {
        const row = form.closest('tr');
        if (!row) return;

        try {
            const [details, comments] = await Promise.all([
                fetchDetails(audioId),
                fetchComments(audioId)
            ]);

            renderDetails(row, details);
            renderComments(row, comments);

            form.dataset.detailsLoaded = '1';
        } catch (e) {
            renderDetails(row, { producer: e.message, vocal: '—', age: '—' });
        }
    }

    function processForms() {
        const forms = [...document.querySelectorAll('form')]
            .filter(f => f.querySelector('input[name="audio_id"]') &&
                         f.querySelector('input[name="add_queue"]'));

        for (const form of forms) {
            if (form.dataset.detailsLoaded) continue;

            const id = form.querySelector('input[name="audio_id"]')?.value;
            if (!id) continue;

            form.dataset.detailsLoaded = 'loading';
            renderReleaseInfo(form, id);
        }
    }

    /* ========================================================================
       ОБРАБОТКА АЛЬБОМОВ В ОЧЕРЕДИ МОДЕРАЦИИ
    ======================================================================== */

    function getAlbumSlug(row) {
        const a = row.querySelector("a[href*='/album/']");
        const href = a?.getAttribute('href') || '';
        const m = href.match(/\/album\/([^/?#]+)/);
        return m?.[1] || null;
    }

    function processAlbumRows() {
        if (!location.pathname.includes('/admin-cp/manage-albums')) return;

        const rows = document.querySelectorAll('.table-responsive1 tbody tr[id]');

        for (const row of rows) {
            if (row.dataset.albumCommentsLoaded) continue;

            const slug = getAlbumSlug(row);
            if (!slug) continue;

            row.dataset.albumCommentsLoaded = 'loading';

            fetchAlbumComments(slug)
                .then(c => {
                    renderComments(row, c, false);
                    row.dataset.albumCommentsLoaded = '1';
                })
                .catch(e => {
                    renderComments(row, [{ author: 'Ошибка', text: e.message, time: '' }], false);
                });
        }
    }

    /* ========================================================================
       УВЕЛИЧЕНИЕ ОБЛОЖЕК (ZOOM)
    ======================================================================== */

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
        img.id = 'cover-zoom-img';
        img.style = `
            max-width: 90%;
            max-height: 90%;
            border-radius: 10px;
            box-shadow: 0 0 20px rgba(0,0,0,0.5);
        `;

        overlay.appendChild(img);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', () => overlay.style.display = 'none');
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape') overlay.style.display = 'none';
        });

        function bind() {
            const imgs = document.querySelectorAll('img');

            imgs.forEach((im) => {
                if (im.dataset.zoomBound) return;
                im.dataset.zoomBound = '1';

                im.style.cursor = 'zoom-in';

                im.addEventListener('click', () => {
                    const src = im.src || im.dataset.src;
                    if (!src) return;
                    img.src = src;
                    overlay.style.display = 'flex';
                });
            });
        }

        bind();

        const obs = new MutationObserver(bind);
        obs.observe(document.body, { childList: true, subtree: true });
    }

    /* ========================================================================
       ДОБАВЛЕНИЕ "Автор" / "Автор инструментала" В РЕДАКТОРЕ АЛЬБОМА
    ======================================================================== */

    async function fetchTrackAuthors(trackId) {
        const url = `https://rumedia.io/media/edit-track/${trackId}`;
        const r = await fetch(url, { credentials: "include" });
        if (!r.ok) return null;

        const html = await r.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");

        const written = doc.querySelector("input#written")?.value?.trim() || "—";
        const producer = doc.querySelector("input#producer")?.value?.trim() || "—";

        return { written, producer };
    }

    function getTrackIdFromLink(a) {
        const href = a?.getAttribute("href");
        if (!href) return null;
        const m = href.match(/edit-track\/([A-Za-z0-9]+)/);
        return m?.[1] || null;
    }

    async function enhanceAlbumEditor() {
        if (!location.pathname.includes("/media/edit-album/")) return;

        const blocks = document.querySelectorAll(".uploaded_albm_slist");

        for (const block of blocks) {
            if (block.dataset.authorEnhanced) continue;

            const link = block.querySelector("a[data-load], a[href*='edit-track']");
            const trackId = getTrackIdFromLink(link);
            if (!trackId) continue;

            block.dataset.authorEnhanced = "1";

            const info = await fetchTrackAuthors(trackId);
            if (!info) continue;

            const p = block.querySelector("p");
            const vocalSpan = p?.querySelector("span[style*='font-size']");
            if (!vocalSpan) continue;

            const wrap = document.createElement("div");
            wrap.innerHTML = `
                <span style="font-size:12px;">
                    Автор: <b>${info.written}</b> |
                    Автор инструментала: <b>${info.producer}</b>
                </span>
                <br>
            `;

            vocalSpan.insertAdjacentElement("afterend", wrap);
        }
    }

    /* ========================================================================
       ИНИЦИАЛИЗАЦИЯ
    ======================================================================== */

    function ready(fn) {
        if (document.readyState === "loading")
            document.addEventListener("DOMContentLoaded", fn);
        else fn();
    }

    ready(() => {
        processForms();
        processAlbumRows();
        observeTable();
        enableCoverZoom();
        enhanceAlbumEditor();

        const obs = new MutationObserver(() => {
            processForms();
            processAlbumRows();
            enhanceAlbumEditor();
        });
        obs.observe(document.body, { childList: true, subtree: true });
    });

})();
