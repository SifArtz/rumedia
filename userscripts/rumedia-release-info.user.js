// ==UserScript==
// @name         RuMedia Helper — Details, Comments, Zoom, Album Authors (v2.3)
// @namespace    https://rumedia.io/
// @version      2.3
// @description  Подробности треков, комментарии, мат, zoom обложек и авторы в edit-album + комментарии альбома восстановлены.
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
   PARSE DETAILS
======================================================================== */

function parseDetails(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');

    const producer = doc.querySelector('#producer')?.value?.trim() || '—';
    const vocal = doc.querySelector('#vocal option:checked')?.textContent?.trim() || '—';

    let age = '—';
    const ageSel = doc.querySelector('#age_restriction');
    if (ageSel) age = ageSel.value === "1" ? "18+" : "0+";

    return { producer, vocal, age };
}

/* ========================================================================
   PARSE COMMENTS
======================================================================== */

function parseComments(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const items = doc.querySelectorAll('.comment_item');

    return [...items].map(i => {
        const login = i.querySelector('.comment_username a')?.textContent?.trim() || 'Неизвестно';
        const normalized = login.toLowerCase();
        const author = MODERATOR_NAMES[normalized] || MODERATOR_NAMES[login] || login;

        const text = i.querySelector('.comment_body')?.textContent?.trim() || '';

        const t = i.querySelector('.ajax-time');
        const raw = t?.getAttribute('title');
        const fb = t?.textContent?.trim() || '';

        let time = fb;
        const num = Number(raw) || Number(fb);
        if (num) time = new Date(num * 1000).toLocaleString();

        return { author, text, time };
    }).filter(x => x.text);
}

/* ========================================================================
   FETCH
======================================================================== */

function fetchWithTimeout(url, opts = {}, timeout = 10000) {
    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), timeout);
    const options = { ...opts, signal: controller.signal };

    return fetch(url, options).finally(() => clearTimeout(t));
}

async function fetchDetails(id) {
    if (STATE.cache.has(id)) return STATE.cache.get(id);

    const r = await fetchWithTimeout(`https://rumedia.io/media/edit-track/${id}`, { credentials:"include" });
    if (!r.ok) throw new Error("Ошибка " + r.status);

    const html = await r.text();
    const data = parseDetails(html);
    STATE.cache.set(id, data);
    return data;
}

async function fetchCommentsTrack(id) {
    if (STATE.commentsCache.has(id)) return STATE.commentsCache.get(id);

    const r = await fetchWithTimeout(`https://rumedia.io/media/track/${id}`, { credentials:"include" });
    if (!r.ok) throw new Error("Ошибка " + r.status);

    const html = await r.text();
    const data = parseComments(html);
    STATE.commentsCache.set(id, data);
    return data;
}

async function fetchAlbumComments(slug) {
    const key = "album:" + slug;
    if (STATE.commentsCache.has(key)) return STATE.commentsCache.get(key);

    const r = await fetchWithTimeout(`https://rumedia.io/media/album/${slug}`, { credentials:"include" });
    if (!r.ok) throw new Error("Ошибка " + r.status);

    const html = await r.text();
    const data = parseComments(html);
    STATE.commentsCache.set(key, data);
    return data;
}

/* ========================================================================
   HTML TEMPLATES
======================================================================== */

function buildDetails(details) {
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
        </div>
    `;
}

function buildCommentsBlock(arr) {
    if (!arr.length) return `<p style="margin:5px 0;">Комментариев нет.</p>`;

    return `
        <ul style="padding-left:18px;margin:0;">
            ${arr.map(c => `
                <li style="margin-bottom:6px;">
                    <b>${c.author}:</b> ${c.text}
                    <div style="font-size:12px;color:#555;">${c.time}</div>
                </li>
            `).join("")}
        </ul>
    `;
}

/* ========================================================================
   RENDER DETAILS/COMMENTS (moderation)
======================================================================== */

function findRecognitionRow(row) {
    let p = row.nextElementSibling;
    while (p) {
        const txt = p.querySelector("td")?.textContent?.trim() || "";
        if (txt.startsWith("Распознание")) return p;
        if (p.querySelector('input[name="audio_id"]')) break;
        p = p.nextElementSibling;
    }
    return null;
}

function renderDetailsRow(row, details) {
    const cell = row.querySelector("td:nth-child(4)");
    if (!cell) return;

    const wrap = document.createElement("div");
    wrap.innerHTML = buildDetails(details);

    const old = cell.querySelector(".release-inline-details");
    if (old) old.replaceWith(wrap.firstElementChild);
    else cell.appendChild(wrap.firstElementChild);
}

function renderCommentsRow(row, comments, useRec = true) {
    const base = useRec ? (findRecognitionRow(row) || row) : row;

    const tr = document.createElement("tr");
    tr.className = "release-comments-row";

    const td = document.createElement("td");
    td.colSpan = row.children.length;
    td.style.background = "#fbfbfb";
    td.style.borderTop = "1px solid #e0e0e0";
    td.innerHTML = `
        <div class="release-inline-comments">
            <h4 style="margin:0 0 6px 0;">Комментарии</h4>
            ${buildCommentsBlock(comments)}
        </div>
    `;

    tr.appendChild(td);

    const nxt = base.nextElementSibling;
    if (nxt?.classList.contains("release-comments-row")) nxt.replaceWith(tr);
    else base.insertAdjacentElement("afterend", tr);
}

async function renderTrackInfo(form, id) {
    const row = form.closest("tr");
    if (!row) return;

    try {
        const [details, comments] = await Promise.all([
            fetchDetails(id),
            fetchCommentsTrack(id)
        ]);

        renderDetailsRow(row, details);
        renderCommentsRow(row, comments);

        form.dataset.detailsLoaded = "1";
    } catch (e) {
        renderDetailsRow(row, { producer: e.message, vocal:"—", age:"—" });
        form.dataset.detailsLoaded = "error";
        setTimeout(() => {
            delete form.dataset.detailsLoaded;
            processForms();
        }, 2000);
    }
}

function processForms() {
    const forms = [...document.querySelectorAll("form")]
        .filter(f => f.querySelector('input[name="audio_id"]') &&
                     f.querySelector('input[name="add_queue"]'));

    for (const f of forms) {
        if (f.dataset.detailsLoaded) continue;
        const id = f.querySelector('input[name="audio_id"]')?.value;
        if (!id) continue;
        f.dataset.detailsLoaded = "loading";
        renderTrackInfo(f, id);
    }
}

/* ========================================================================
   PROCESS ALBUM ROWS (restored)
======================================================================== */

function getAlbumSlug(row) {
    const a = row.querySelector("a[href*='/album/']");
    const href = a?.getAttribute("href") || "";
    const m = href.match(/\/album\/([^/?#]+)/);
    return m ? m[1] : null;
}

async function processAlbumRows() {
    if (!location.pathname.includes("/manage-albums")) return;

    const rows = document.querySelectorAll(".table-responsive1 tbody tr[id]");

    for (const row of rows) {
        if (row.dataset.albumCommentsLoaded) continue;

        const slug = getAlbumSlug(row);
        if (!slug) continue;

        row.dataset.albumCommentsLoaded = "loading";

        try {
            const comments = await fetchAlbumComments(slug);
            renderCommentsRow(row, comments, false);
            row.dataset.albumCommentsLoaded = "1";
        } catch (e) {
            renderCommentsRow(row, [{ author:"Ошибка", text:e.message, time:"" }], false);
            row.dataset.albumCommentsLoaded = "error";
            setTimeout(() => {
                delete row.dataset.albumCommentsLoaded;
                processAlbumRows();
            }, 2000);
        }
    }
}

/* ========================================================================
   COVER ZOOM
======================================================================== */

function enableCoverZoom() {
    const overlay = document.createElement("div");
    overlay.style = `
        position:fixed;inset:0;display:none;
        justify-content:center;align-items:center;
        background:rgba(0,0,0,0.85);cursor:zoom-out;
        z-index:999999;
    `;

    const img = document.createElement("img");
    img.style = `
        max-width:90%;max-height:90%;
        border-radius:10px;box-shadow:0 0 20px rgba(0,0,0,0.5);
    `;

    overlay.appendChild(img);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", () => overlay.style.display="none");
    document.addEventListener("keydown", e => { if (e.key === "Escape") overlay.style.display="none"; });

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

/* ========================================================================
   EDIT-ALBUM: AUTHORS
======================================================================== */

async function fetchTrackAuthors(id) {
    const r = await fetchWithTimeout(`https://rumedia.io/media/edit-track/${id}`, { credentials:"include" });
    if (!r.ok) return null;

    const html = await r.text();
    const doc = new DOMParser().parseFromString(html, "text/html");

    return {
        written: doc.querySelector("#written")?.value?.trim() || "—",
        producer: doc.querySelector("#producer")?.value?.trim() || "—"
    };
}

function extractTrackId(link) {
    const href = link?.href || "";
    const m = href.match(/edit-track\/([A-Za-z0-9]+)/);
    return m ? m[1] : null;
}

async function enhanceAlbumEditor() {
    if (!location.pathname.includes("/edit-album/")) return;

    const blocks = document.querySelectorAll(".uploaded_albm_slist");

    for (const block of blocks) {
        if (block.dataset.authorsLoaded) continue;
        block.dataset.authorsLoaded = "1";

        const p = block.querySelector("p");
        if (!p) continue;

        const link = block.querySelector("a[data-load], a[href*='edit-track']");
        const id = extractTrackId(link);
        if (!id) continue;

        const info = await fetchTrackAuthors(id);
        if (!info) continue;

        const vocalLine = [...p.querySelectorAll("span")]
            .find(s => s.textContent.trim().startsWith("Вокал"));

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

/* ========================================================================
   INIT
======================================================================== */

function observeTable() {
    const table = document.querySelector(".table-responsive1, table.table");
    if (!table) return;

    new MutationObserver(() => {
        processForms();
        processAlbumRows();
        enhanceAlbumEditor();
    }).observe(table, { childList:true, subtree:true });
}

function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
}

ready(() => {
    processForms();
    processAlbumRows();
    enhanceAlbumEditor();
    observeTable();
    enableCoverZoom();
});

})();
