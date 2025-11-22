// ==UserScript==
// @name         RuMedia Release Details Helper
// @namespace    https://rumedia.io/
// @version      1.8.0
// @description  Подробности релиза + комменты + Мат + увеличение обложек по клику прямо в очереди модерации на RuMedia.io.
// @author       Ruslan
// @match        https://rumedia.io/media/admin-cp/manage-songs?check*
// @match        https://rumedia.io/media/admin-cp/manage-albums?check*
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

    function parseDetails(htmlText) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');

        const producer = doc.querySelector('input#producer')?.value?.trim() || '—';
        const author = doc.querySelector('input#author')?.value?.trim() || '—';
        const vocal = doc.querySelector('select#vocal option:checked')?.textContent?.trim() || '—';

        // === AGE / Мат ===
        let age = '—';
        const ageSelect = doc.querySelector('select#age_restriction');
        if (ageSelect) {
            const val = ageSelect.value.trim();
            age = (val === '1') ? '18+' : '0+';
        }

        return { producer, vocal, age, author };
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
        if (minutes < 60) return `${minutes} ${pluralize(minutes, ['минута', 'минуты', 'минут'])} назад`;

        const hours = Math.round(diffSec / 3600);
        if (hours < 24) return `${hours} ${pluralize(hours, ['час', 'часа', 'часов'])} назад`;

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

    function getLoginFromLink(link) {
        if (!link) return '';
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/(?:media|profile)\/([^/?#]+)/i);
        return match?.[1] || link.textContent?.trim() || '';
    }

    function parseComments(htmlText) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, 'text/html');
        const items = doc.querySelectorAll('.comment_list li.comment_item');

        return Array.from(items)
            .map((item) => {
                const userLink = item.querySelector('.comment_username a');
                const login = getLoginFromLink(userLink) || 'Неизвестно';
                const author = MODERATOR_NAMES[login] || login;
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
        if (STATE.cache.has(audioId)) return STATE.cache.get(audioId);

        const url = `https://rumedia.io/media/edit-track/${audioId}`;
        const response = await fetch(url, { credentials: 'include' });

        if (!response.ok) throw new Error(`Не удалось получить данные (${response.status})`);

        const text = await response.text();
        const details = parseDetails(text);
        STATE.cache.set(audioId, details);
        return details;
    }

    async function fetchComments(audioId) {
        if (STATE.commentsCache.has(audioId)) return STATE.commentsCache.get(audioId);

        const url = `https://rumedia.io/media/track/${audioId}`;
        const response = await fetch(url, { credentials: 'include' });

        if (!response.ok) throw new Error(`Не удалось получить комментарии (${response.status})`);

        const text = await response.text();
        const comments = parseComments(text);
        STATE.commentsCache.set(audioId, comments);
        return comments;
    }

    async function fetchAlbumComments(albumSlug) {
        const cacheKey = `album:${albumSlug}`;
        if (STATE.commentsCache.has(cacheKey)) return STATE.commentsCache.get(cacheKey);

        const url = `https://rumedia.io/media/album/${albumSlug}`;
        const response = await fetch(url, { credentials: 'include' });

        if (!response.ok) throw new Error(`Не удалось получить комментарии (${response.status})`);

        const text = await response.text();
        const comments = parseComments(text);
        STATE.commentsCache.set(cacheKey, comments);
        return comments;
    }

    function buildHtml(details) {
        return `
            <div class="release-inline-details" style="margin-top:10px; padding:8px; background:#f5f5f5; border-radius:6px;">
                <div style="margin:2px 0;"><strong>Автор инструментала:</strong> ${details.producer}</div>
                <div style="margin:2px 0;"><strong>Вокал:</strong> ${details.vocal}</div>

                <div style="margin:2px 0;">
                    <strong>Мат:</strong>
                    ${
                        details.age === '18+'
                            ? '<span style="color:red; font-weight:bold;">Есть</span>'
                            : '<span>Нет</span>'
                    }
                </div>
            </div>
        `;
    }

    function buildCommentsHtml(comments) {
        if (!comments || comments.length === 0) {
            return '<div class="release-inline-comments"><h4 style="margin:0 0 6px 0;">Комментарии</h4><p style="margin:2px 0;">Комментариев нет.</p></div>';
        }

        const items = comments
            .map((c) => {
                const when = c.time ? `<div style="color:#555; font-size:12px; margin-top:2px;">${c.time}</div>` : '';
                return `<li style="margin-bottom:8px; line-height:1.4;"><strong>${c.author}:</strong> <span>${c.text}</span>${when}</li>`;
            })
            .join('');

        return `
            <div class="release-inline-comments">
                <h4 style="margin:0 0 6px 0;">Комментарии</h4>
                <ul style="padding-left:18px; margin:0;">${items}</ul>
            </div>
        `;
    }

    function findRecognitionRow(row) {
        let pointer = row.nextElementSibling;
        while (pointer) {
            const firstCellText = pointer.querySelector('td')?.textContent?.trim();
            if (firstCellText && firstCellText.startsWith('Распознание')) return pointer;
            const hasForm = pointer.querySelector('form input[name="audio_id"]');
            if (hasForm) break;
            pointer = pointer.nextElementSibling;
        }
        return null;
    }

    function getAlbumSlug(row) {
        const link = row.querySelector('a[href*="/album/"]');
        const href = link?.getAttribute('href') || '';
        const match = href.match(/\/album\/([^/?#]+)/i);
        return match?.[1] || null;
    }

    function renderDetails(row, details) {
        const infoCell = row.querySelector('td:nth-child(4)');
        if (!infoCell) return;

        const existing = infoCell.querySelector('.release-inline-details');
        const wrapper = document.createElement('div');
        wrapper.innerHTML = buildHtml(details);
        const content = wrapper.firstElementChild;

        if (existing) existing.replaceWith(content);
        else infoCell.appendChild(content);
    }

    function renderComments(row, comments, useRecognitionRow = true) {
        const recognitionRow = useRecognitionRow ? findRecognitionRow(row) || row : row;
        const commentsRow = document.createElement('tr');
        const columnsCount = row.children.length || 1;

        const commentsCell = document.createElement('td');
        commentsCell.colSpan = columnsCount;
        commentsCell.style.background = '#fbfbfb';
        commentsCell.style.borderTop = '1px solid #e0e0e0';
        commentsCell.innerHTML = buildCommentsHtml(comments);

        commentsRow.className = 'release-comments-row';
        commentsRow.appendChild(commentsCell);

        const existing = recognitionRow.nextElementSibling;
        if (existing && existing.classList.contains('release-comments-row')) {
            existing.replaceWith(commentsRow);
        } else {
            recognitionRow.insertAdjacentElement('afterend', commentsRow);
        }
    }

    async function renderReleaseInfo(form, audioId) {
        const row = form.closest('tr');
        if (!row) return;

        try {
            const [details, comments] = await Promise.all([fetchDetails(audioId), fetchComments(audioId)]);
            renderDetails(row, details);
            renderComments(row, comments);
            form.dataset.detailsLoaded = '1';
        } catch (error) {
            renderDetails(row, { producer: error.message, vocal: '—', age: '—' });
        }
    }

    function processForms() {
        const forms = Array.from(document.querySelectorAll('form')).filter((form) =>
            form.querySelector('input[name="audio_id"]') && form.querySelector('input[name="add_queue"]')
        );

        forms.forEach((form) => {
            if (form.dataset.detailsLoaded) return;
            const audioInput = form.querySelector('input[name="audio_id"]');
            if (!audioInput?.value) return;

            form.dataset.detailsLoaded = 'loading';
            renderReleaseInfo(form, audioInput.value);
        });
    }

    function processAlbumRows() {
        if (!location.pathname.includes('/admin-cp/manage-albums')) return;

        const rows = Array.from(document.querySelectorAll('.table-responsive1 tbody tr[id]'));

        rows.forEach((row) => {
            if (row.dataset.albumCommentsLoaded) return;

            const albumSlug = getAlbumSlug(row);
            if (!albumSlug) return;

            row.dataset.albumCommentsLoaded = 'loading';

            fetchAlbumComments(albumSlug)
                .then((comments) => {
                    renderComments(row, comments, false);
                    row.dataset.albumCommentsLoaded = '1';
                })
                .catch((error) => {
                    renderComments(row, [{ author: 'Ошибка', text: error.message, time: '' }], false);
                });
        });
    }

    function observeTable() {
        const table = document.querySelector('.table-responsive1, table.table');
        if (!table) return;

        const observer = new MutationObserver(() => {
            processForms();
            processAlbumRows();
        });

        observer.observe(table, { childList: true, subtree: true });
    }

    function observeAlbumEditPage() {
        if (!location.pathname.includes('/media/edit-album/')) return;

        const songsContainer = document.querySelector('#songs') || document.body;

        const observer = new MutationObserver(() => {
            processAlbumEditPage();
        });

        observer.observe(songsContainer, { childList: true, subtree: true });
    }

    function ready(callback) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', callback);
        } else callback();
    }

    // =====================================================
    //           ПОДРОБНОСТИ ТРЕКОВ НА СТРАНИЦЕ АЛЬБОМА
    // =====================================================

    function findVocalSpan(container) {
        return Array.from(container.querySelectorAll('span')).find((span) => span.textContent?.includes('Вокал'));
    }

    function renderAlbumTrackDetails(container, details) {
        const vocalSpan = findVocalSpan(container);
        if (!vocalSpan) return;

        const wrapper = document.createElement('div');
        wrapper.className = 'album-inline-details';
        wrapper.style = 'margin-top:4px; font-size:12px; line-height:1.4;';
        wrapper.innerHTML = `
            <div><strong>Автор:</strong> ${details.author}</div>
            <div><strong>Автор инструментала:</strong> ${details.producer}</div>
        `;

        const existing = container.querySelector('.album-inline-details');
        if (existing) existing.replaceWith(wrapper);
        else vocalSpan.insertAdjacentElement('afterend', wrapper);
    }

    function getTrackSlugFromAlbumSong(container) {
        const editLink = container.querySelector('a[href*="/media/edit-track/"]');
        const href = editLink?.getAttribute('href') || '';
        const match = href.match(/\/edit-track\/([^/?#]+)/i);
        return match?.[1] || null;
    }

    async function enhanceAlbumSong(container) {
        if (container.dataset.albumTrackDetailsLoaded) return;

        const trackSlug = getTrackSlugFromAlbumSong(container);
        if (!trackSlug) return;

        container.dataset.albumTrackDetailsLoaded = 'loading';

        try {
            const details = await fetchDetails(trackSlug);
            renderAlbumTrackDetails(container, details);
            container.dataset.albumTrackDetailsLoaded = '1';
        } catch (error) {
            renderAlbumTrackDetails(container, { author: 'Ошибка загрузки', producer: error.message });
        }
    }

    function processAlbumEditPage() {
        if (!location.pathname.includes('/media/edit-album/')) return;

        const songs = document.querySelectorAll('.uploaded_albm_slist');
        songs.forEach(enhanceAlbumSong);
    }

    // =====================================================
    //              УВЕЛИЧЕНИЕ ОБЛОЖЕК ПО КЛИКУ
    // =====================================================

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
            border-radius: 8px;
            box-shadow: 0 0 20px rgba(0,0,0,0.5);
        `;

        overlay.appendChild(img);
        document.body.appendChild(overlay);

        overlay.addEventListener('click', () => {
            overlay.style.display = 'none';
        });

        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') overlay.style.display = 'none';
        });

        function bindCovers() {
            const covers = document.querySelectorAll('img');

            covers.forEach((imgEl) => {
                if (imgEl.dataset.zoomBound) return;
                imgEl.dataset.zoomBound = '1';

                imgEl.style.cursor = 'zoom-in';

                imgEl.addEventListener('click', () => {
                    const src = imgEl.src || imgEl.getAttribute('data-src');
                    if (!src) return;

                    img.src = src;
                    overlay.style.display = 'flex';
                });
            });
        }

        bindCovers();

        const obs = new MutationObserver(bindCovers);
        obs.observe(document.body, { childList: true, subtree: true });
    }

    // =====================================================

    ready(() => {
        processForms();
        processAlbumRows();
        processAlbumEditPage();
        observeTable();
        observeAlbumEditPage();
        enableCoverZoom();
    });

})();
