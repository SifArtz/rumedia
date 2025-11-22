// ==UserScript==
// @name         RuMedia Helper — Details, Comments, Age, Zoom, Album Authors
// @namespace    https://rumedia.io/
// @version      2.1
// @description  Подробности треков, комментарии, мат, zoom обложек + авторы в edit-album.
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

/* ============================================================
   ПАРСИНГ ДЕТАЛЕЙ ТРЕКА
============================================================ */

function parseDetails(htmlText) {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');

    const producer = doc.querySelector('#producer')?.value?.trim() || '—';
    const vocal = doc.querySelector('#vocal option:checked')?.textContent?.trim() || '—';

    let age = '—';
    const ageSel = doc.querySelector('#age_restriction');
    if (ageSel) age = ageSel.value === '1' ? '18+' : '0+';

    return { producer, vocal, age };
}

/* ============================================================
   ПАРСИНГ КОММЕНТАРИЕВ
============================================================ */

function parseComments(htmlText) {
    const doc = new DOMParser().parseFromString(htmlText, 'text/html');
    const items = doc.querySelectorAll('.comment_item');

    return Array.from(items)
        .map((it) => {
            const login = it.querySelector('.comment_username a')?.textContent?.trim() || 'Неизвестно';
            const author = MODERATOR_NAMES[login] || login;

            const text = it.querySelector('.comment_body')?.textContent?.trim() || '';

            const timeEl = it.querySelector('.ajax-time');
            const raw = timeEl?.getAttribute('title');
            const fallback = timeEl?.textContent?.trim() || '';
            const parsed = Number(raw) || Number(fallback);

            let when = fallback;
            if (parsed) {
                const ts = parsed * 1000;
                const date = new Date(ts);
                when = date.toLocaleString();
            }

            return { author, text, time: when };
        })
        .filter(c => c.text);
}

/* ============================================================
    FETCH
============================================================ */

async function fetchDetails(id) {
    if (STATE.cache.has(id)) return STATE.cache.get(id);

    const r = await fetch(`https://rumedia.io/media/edit-track/${id}`, { credentials: "include" });
    if (!r.ok) throw new Error("Ошибка " + r.status);

    const html = await r.text();
    const details = parseDetails(html);
    STATE.cache.set(id, details);
    return details;
}

async function fetchComments(id) {
    if (STATE.commentsCache.has(id)) return STATE.commentsCache.get(id);

    const r = await fetch(`https://rumedia.io/media/track/${id}`, { credentials: "include" });
    if (!r.ok) throw new Error("Ошибка " + r.status);

    const html = await r.text();
    const data = parseComments(html);
    STATE.commentsCache.set(id, data);
    return data;
}

/* ============================================================
   HTML ВСТАВКИ
============================================================ */

function buildHtml(details) {
    return `
        <div class="release-inline-details"
            style="margin-top:10px;padding:8px;background:#f5f5f5;border-radius:6px;">
            <div><b>Автор инструментала:</b> ${details.producer}</div>
            <div><b>Вокал:</b> ${details.vocal}</div>
            <div><b>Мат:</b> ${
                details.age === '18+'
                ? '<span style="color:red;font-weight:bold;">Есть</span>'
                : 'Нет'
            }</div>
        </div>`;
}

function buildCommentsHtml(arr) {
    if (!arr.length)
        return `<p style="margin:5px 0;">Комментариев нет.</p>`;

    return `
        <ul style="padding-left:18px;margin:0;">
        ${arr.map(c => `
            <li style="margin-bottom:6px;">
                <b>${c.author}:</b> ${c.text}
                <div style="font-size:12px;color:#555;">${c.time}</div>
            </li>
        `).join('')}
        </ul>`;
}

/* ============================================================
   МОДЕРАЦИЯ — ВСТАВКА
============================================================ */

function findRecognitionRow(row) {
    let p = row.nextElementSibling;
    while (p) {
        const txt = p.querySelector('td')?.textContent?.trim() || '';
        if (txt.startsWith("Распознание")) return p;
        if (p.querySelector('input[name="audio_id"]')) break;
        p = p.nextElementSibling;
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

function renderComments(row, comments, useRec = true) {
    const base = useRec ? (findRecognitionRow(row) || row) : row;

    const tr = document.createElement('tr');
    tr.className = 'release-comments-row';

    const td = document.createElement('td');
    td.colSpan = row.children.length;
    td.style.background = "#fbfbfb";
    td.style.borderTop = "1px solid #e0e0e0";
    td.innerHTML = `
        <div class="release-inline-comments">
            <h4 style="margin:0 0 6px 0;">Комментарии</h4>
            ${buildCommentsHtml(comments)}
        </div>
    `;

    tr.appendChild(td);

    const next = base.nextElementSibling;
    if (next?.classList.contains('release-comments-row')) next.replaceWith(tr);
    else base.insertAdjacentElement("afterend", tr);
}

async function renderReleaseInfo(form, id) {
    const row = form.closest("tr");
    if (!row) return;

    try {
        const [details, comments] = await Promise.all([
            fetchDetails(id),
            fetchComments(id)
        ]);

        renderDetails(row, details);
        renderComments(row, comments);
        form.dataset.detailsLoaded = "1";
    } catch (e) {
        renderDetails(row, { producer: e.message, vocal: '—', age: '—' });
    }
}

function processForms() {
    const forms = [...document.querySelectorAll("form")]
        .filter(f => f.querySelector('input[name="audio_id"]') &&
                     f.querySelector('input[name="add_queue"]'));

    forms.forEach(f => {
        if (f.dataset.detailsLoaded) return;
        const id = f.querySelector('input[name="audio_id"]')?.value;
        if (!id) return;
        f.dataset.detailsLoaded = "loading";
        renderReleaseInfo(f, id);
    });
}

/* ============================================================
   ZOOM КАРТИНОК
============================================================ */

function enableCoverZoom() {
    const overlay = document.createElement("div");
    overlay.style = `
        position:fixed;inset:0;display:none;
        justify-content:center;align-items:center;
        background:rgba(0,0,0,0.85);
        z-index:999999;cursor:zoom-out;
    `;
    const img = document.createElement("img");
    img.style = "max-width:90%;max-height:90%;border-radius:10px;";

    overlay.appendChild(img);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", () => overlay.style.display = "none");
    document.addEventListener("keydown", e => {
        if (e.key === "Escape") overlay.style.display = "none";
    });

    function bind() {
        document.querySelectorAll("img").forEach(i => {
            if (i.dataset.zoomBound) return;
            i.dataset.zoomBound = "1";
            i.style.cursor = "zoom-in";
            i.addEventListener("click", () => {
                img.src = i.src;
                overlay.style.display = "flex";
            });
        });
    }

    bind();
    new MutationObserver(bind).observe(document.body, { childList:true, subtree:true });
}

/* ============================================================
   AUTHORS в edit-album (исправлено)
============================================================ */

async function fetchTrackAuthors(id) {
    const r = await fetch(`https://rumedia.io/media/edit-track/${id}`, { credentials:"include" });
    if (!r.ok) return null;

    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    return {
        written: doc.querySelector("#written")?.value?.trim() || "—",
        producer: doc.querySelector("#producer")?.value?.trim() || "—"
    };
}

function getTrackIdFromLink(a) {
    const href = a?.href || "";
    const m = href.match(/edit-track\/([A-Za-z0-9]+)/);
    return m ? m[1] : null;
}

async function enhanceAlbumEditor() {
    if (!location.pathname.includes("/media/edit-album/")) return;

    const blocks = document.querySelectorAll(".uploaded_albm_slist");

    for (const block of blocks) {
        if (block.dataset.authorsLoaded) continue;
        block.dataset.authorsLoaded = "1";

        const p = block.querySelector("p");
        if (!p) continue;

        const link = block.querySelector("a[data-load], a[href*='edit-track']");
        const id = getTrackIdFromLink(link);
        if (!id) continue;

        const info = await fetchTrackAuthors(id);
        if (!info) continue;

        // найдём строку Вокал: ...
        const vocalLine = [...p.querySelectorAll("span")]
            .find(sp => sp.textContent.trim().startsWith("Вокал"));

        if (!vocalLine) continue;

        const div = document.createElement("div");
        div.style.fontSize = "12px";
        div.innerHTML = `
    <div>Автор: <b>${info.written}</b></div>
    <div>Автор инструментала: <b>${info.producer}</b></div>
`;
        vocalLine.insertAdjacentElement("afterend", div);

    }
}

/* ============================================================
   ИНИЦИАЛИЗАЦИЯ
============================================================ */

function observeTable() {
    const t = document.querySelector(".table-responsive1, table.table");
    if (!t) return;
    new MutationObserver(() => {
        processForms();
        enhanceAlbumEditor();
    }).observe(t, { childList:true, subtree:true });
}

function ready(fn) {
    if (document.readyState === "loading")
        document.addEventListener("DOMContentLoaded", fn);
    else fn();
}

ready(() => {
    processForms();
    enhanceAlbumEditor();
    observeTable();
    enableCoverZoom();
});

})();
