// ==UserScript==
// @name         RuMedia Release Details Helper
// @namespace    https://rumedia.io/
// @version      1.0.0
// @description  Показывает подробности релиза (Автор инструментала, вокал) прямо в списке очереди модерации.
// @author       Custom
// @match        https://rumedia.io/media/admin-cp/manage-songs*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const STATE = {
        cache: new Map(),
        popup: null,
        overlay: null,
    };

    function createOverlay() {
        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100%';
        overlay.style.height = '100%';
        overlay.style.background = 'rgba(0,0,0,0.4)';
        overlay.style.zIndex = '9998';
        overlay.style.display = 'none';
        overlay.addEventListener('click', hidePopup);
        document.body.appendChild(overlay);
        STATE.overlay = overlay;
    }

    function createPopup() {
        const popup = document.createElement('div');
        popup.style.position = 'fixed';
        popup.style.top = '50%';
        popup.style.left = '50%';
        popup.style.transform = 'translate(-50%, -50%)';
        popup.style.background = '#fff';
        popup.style.borderRadius = '8px';
        popup.style.padding = '16px 20px';
        popup.style.boxShadow = '0 4px 12px rgba(0, 0, 0, 0.25)';
        popup.style.zIndex = '9999';
        popup.style.minWidth = '260px';
        popup.style.display = 'none';

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

    function buildHtml(details) {
        return `
            <h4 style="margin-top:0;">Детали релиза</h4>
            <p><strong>Автор инструментала:</strong> ${details.producer}</p>
            <p><strong>Вокал:</strong> ${details.vocal}</p>
        `;
    }

    function createInfoButton(form, audioId) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = 'Посмотреть детали';
        btn.style.marginTop = '8px';
        btn.style.marginLeft = '4px';
        btn.className = 'btn btn-info';

        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.textContent = 'Загрузка...';
            try {
                const details = await fetchDetails(audioId);
                showPopup(buildHtml(details));
            } catch (error) {
                showPopup(`<p style="color:red;">${error.message}</p>`);
            } finally {
                btn.disabled = false;
                btn.textContent = 'Посмотреть детали';
            }
        });

        const queueBtn = form.querySelector('input[name="add_queue"]');
        if (queueBtn && queueBtn.parentNode) {
            queueBtn.parentNode.insertBefore(document.createElement('br'), queueBtn.nextSibling);
            queueBtn.parentNode.insertBefore(btn, queueBtn.nextSibling.nextSibling);
        } else {
            form.appendChild(btn);
        }
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

