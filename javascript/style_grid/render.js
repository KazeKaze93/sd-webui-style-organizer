/** Style Grid host — DOM helpers + editor/panel UI (moved from style_grid.js). */
"use strict";

import {
    apiPost,
    apiDelete,
    apiGet,
    assertNoApiError,
} from "./api.js";
import {
    state,
    remapStyleNameReferences,
} from "./state.js";

/** Late-bound host actions (filled by events.js to avoid cycles). */
export const hooks = {
    refreshPanel: null,
    ensureSGFramesOnce: null,
    syncWildcards: null,
    scheduleSyncForgeHostTabToV2Frames: null,
    forgeTab: {
        lastBroadcast: null,
    },
};

var _sgHostPrevBodyOverflow = "";
var _sgHostPrevDocOverflow = "";
var _sgHostScrollLocked = false;
var _sgDlgCounter = 0;

function nextDlgTitleId() {
        _sgDlgCounter += 1;
        return "sg-dlg-" + _sgDlgCounter;
    }

function decorateEditorModal(modal, titleEl) {
        var titleId = nextDlgTitleId();
        titleEl.id = titleId;
        modal.setAttribute("role", "dialog");
        modal.setAttribute("aria-modal", "true");
        modal.setAttribute("aria-labelledby", titleId);
    }

function syncTriggerExpanded(tab) {
        var btn = qs("#sg_trigger_" + tab);
        if (!btn) return;
        var wr = state[tab] && state[tab].sgFrameWrapper;
        if (!wr) {
            var fr = state[tab] && state[tab].sgFrame;
            if (fr && fr.parentElement && fr.parentElement.id === "sg-panel-wrapper-" + tab) {
                wr = fr.parentElement;
            }
        }
        var expanded = !!(wr && wr.style.display === "block");
        btn.setAttribute("aria-expanded", expanded ? "true" : "false");
    }

function postPanelToast(tabName, message) {
        var fr = state[tabName] && state[tabName].sgFrame;
        if (fr && fr.contentWindow) {
            fr.contentWindow.postMessage({
                type: "SG_TOAST",
                message: message,
                variant: "error"
            }, "*");
        }
    }

function qs(sel, root) {
        if (root) return root.querySelector(sel);
        var ga = (typeof gradioApp === "function") ? gradioApp() : null;
        return (ga || document).querySelector(sel);
    }

function el(tag, attrs, children) {
        const e = document.createElement(tag);
        if (attrs) Object.entries(attrs).forEach(function (kv) {
            const k = kv[0], v = kv[1];
            if (k === "className") e.className = v;
            else if (k === "textContent") e.textContent = v;
            else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
            else e.setAttribute(k, v);
        });
        if (children) (Array.isArray(children) ? children : [children]).forEach(function (c) {
            if (typeof c === "string") e.appendChild(document.createTextNode(c));
            else if (c) e.appendChild(c);
        });
        return e;
    }

function splitDescriptionAndCombos(raw) {
        var m = /^([\s\S]*?)\s*Combos?:\s*([^.]+)\.?\s*$/i.exec(raw || "");
        if (!m) return { text: raw || "", combos: "" };
        return { text: m[1].trim(), combos: m[2].trim() };
    }

function joinDescriptionAndCombos(text, combos) {
        var t = (text || "").trim();
        var c = (combos || "").trim();
        if (!c) return t;
        return t ? (t + (t.endsWith(".") ? " " : ". ") + "Combos: " + c + ".") : ("Combos: " + c + ".");
    }

function openStyleEditor(tabName, existingStyle, sourceFile) {
        const isNew = !existingStyle;
        const overlay = el("div", { className: "sg-editor-overlay" });
        const modal = el("div", { className: "sg-editor-modal" });

        const title = el("h3", { textContent: isNew ? "Create New Style" : "Edit Style: " + (existingStyle ? existingStyle.name : ""), className: "sg-editor-title" });
        decorateEditorModal(modal, title);
        modal.appendChild(title);

        const nameInput = el("input", { className: "sg-editor-input", type: "text", placeholder: "Style name (e.g. BODY_Thicc)", value: existingStyle ? existingStyle.name : "" });
        const promptInput = el("textarea", { className: "sg-editor-textarea", placeholder: "Prompt (use {prompt} as placeholder)", rows: "4" });
        promptInput.value = existingStyle ? (existingStyle.prompt || "") : "";
        const negInput = el("textarea", { className: "sg-editor-textarea", placeholder: "Negative prompt", rows: "3" });
        negInput.value = existingStyle ? (existingStyle.negative_prompt || "") : "";

        modal.appendChild(el("label", { className: "sg-editor-label", textContent: "Name" }));
        modal.appendChild(nameInput);
        modal.appendChild(el("label", { className: "sg-editor-label", textContent: "Prompt" }));
        modal.appendChild(promptInput);
        modal.appendChild(el("label", { className: "sg-editor-label", textContent: "Negative Prompt" }));
        modal.appendChild(negInput);

        var parsed = splitDescriptionAndCombos(existingStyle ? existingStyle.description : "");
        var descInput = el("textarea", {
            className: "sg-editor-textarea",
            placeholder: "What this style does.",
            rows: "3"
        });
        descInput.value = parsed.text;

        var combosInput = el("input", {
            className: "sg-editor-input",
            type: "text",
            placeholder: "Combos: e.g. STYLE_X; CATEGORY_*"
        });
        combosInput.value = parsed.combos;

        modal.appendChild(el("label", { className: "sg-editor-label", textContent: "Description" }));
        modal.appendChild(descInput);
        modal.appendChild(el("label", { className: "sg-editor-label", textContent: "Combos (optional)" }));
        modal.appendChild(combosInput);

        const btnRow = el("div", { className: "sg-editor-btns" });
        btnRow.appendChild(el("button", {
            className: "sg-btn sg-btn-primary", textContent: "💾 Save",
            onClick: function () {
                const name = nameInput.value.trim();
                if (!name) { nameInput.style.borderColor = "#f87171"; return; }
                var isRename = !!(existingStyle && name !== existingStyle.name);
                var endpoint = isRename ? "/style_grid/style/rename" : "/style_grid/style/save";
                var payload = isRename
                    ? {
                        old_name: existingStyle.name,
                        new_name: name,
                        source: existingStyle.source,
                        prompt: promptInput.value,
                        negative_prompt: negInput.value,
                        description: joinDescriptionAndCombos(descInput.value, combosInput.value),
                    }
                    : {
                        name: name,
                        prompt: promptInput.value,
                        negative_prompt: negInput.value,
                        description: joinDescriptionAndCombos(descInput.value, combosInput.value),
                        source: existingStyle ? existingStyle.source : (sourceFile || null),
                    };
                apiPost(endpoint, payload).then(assertNoApiError).then(function () {
                    if (isRename) {
                        remapStyleNameReferences(
                            tabName,
                            existingStyle.name,
                            name,
                            existingStyle.source_file || existingStyle.source || ""
                        );
                    }
                    overlay.remove();
                    hooks.refreshPanel(tabName);
                    var notify = state[tabName] && state[tabName].refreshAndNotifyFrame;
                    if (typeof notify === "function") notify();
                }).catch(function (err) {
                    var msg = (err && err.message) ? err.message : "Save failed";
                    var frSave = state[tabName] && state[tabName].sgFrame;
                    if (frSave && frSave.contentWindow) {
                        frSave.contentWindow.postMessage({
                            type: "SG_TOAST",
                            message: msg,
                            variant: "error"
                        }, "*");
                    }
                });
            }
        }));
        btnRow.appendChild(el("button", {
            className: "sg-btn sg-btn-secondary", textContent: "Cancel",
            onClick: function () { overlay.remove(); }
        }));
        modal.appendChild(btnRow);
        overlay.appendChild(modal);
        var editorOverlayMouseDownTarget = null;
        overlay.addEventListener("mousedown", function (e) {
            editorOverlayMouseDownTarget = e.target;
        });
        overlay.addEventListener("click", function (e) {
            if (editorOverlayMouseDownTarget === overlay || editorOverlayMouseDownTarget === e.currentTarget) {
                overlay.remove();
            }
            editorOverlayMouseDownTarget = null;
        });
        document.body.appendChild(overlay);
        nameInput.focus();
    }

function duplicateStyle(tabName, style, onDone) {
        const newName = style.name + "_copy";
        apiPost("/style_grid/style/save", {
            name: newName, prompt: style.prompt || "", negative_prompt: style.negative_prompt || "", source: style.source,
        }).then(assertNoApiError).then(function () {
            hooks.refreshPanel(tabName);
            var notify = state[tabName] && state[tabName].refreshAndNotifyFrame;
            if (typeof notify === "function") notify();
            if (typeof onDone === "function") onDone();
        }).catch(function (err) {
            var msg = "Duplicate failed";
            if (err && err.message) msg += ": " + err.message;
            postPanelToast(tabName, msg);
        });
    }

function deleteStyle(tabName, styleName, source, onDeleted) {
        const overlay = el("div", { className: "sg-editor-overlay" });
        const modal = el("div", { className: "sg-editor-modal" });
        var deleteTitle = el("h3", {
            className: "sg-editor-title",
            textContent: "Delete style?"
        });
        decorateEditorModal(modal, deleteTitle);
        modal.appendChild(deleteTitle);
        modal.appendChild(el("p", {
            className: "sg-editor-text-subdued",
            textContent: "\"" + styleName + "\" will be permanently removed from the CSV.",
        }));
        const btns = el("div", { className: "sg-editor-btns" });
        btns.appendChild(el("button", {
            className: "sg-btn sg-btn-danger",
            textContent: "🗑️ Delete",
            onClick: function () {
                overlay.remove();
                apiPost("/style_grid/style/delete", { name: styleName, source: source })
                    .then(assertNoApiError)
                    .then(function () {
                        apiDelete("/style_grid/thumbnail?name=" + encodeURIComponent(styleName) + "&source=" + encodeURIComponent(source || "")).catch(function () { /* best-effort, style delete already succeeded */ });
                        hooks.refreshPanel(tabName, { quietVanishedToast: true });
                        var notify = state[tabName] && state[tabName].refreshAndNotifyFrame;
                        if (typeof notify === "function") notify();
                        if (typeof onDeleted === "function") onDeleted();
                    })
                    .catch(function () {
                        var frDel = state[tabName] && state[tabName].sgFrame;
                        if (frDel && frDel.contentWindow) {
                            frDel.contentWindow.postMessage({
                                type: "SG_TOAST",
                                message: "Delete failed",
                                variant: "error"
                            }, "*");
                        }
                    });
            }
        }));
        btns.appendChild(el("button", {
            className: "sg-btn sg-btn-secondary",
            textContent: "Cancel",
            onClick: function () { overlay.remove(); }
        }));
        modal.appendChild(btns);
        overlay.appendChild(modal);
        var deleteOverlayMouseDownTarget = null;
        overlay.addEventListener("mousedown", function (e) {
            deleteOverlayMouseDownTarget = e.target;
        });
        overlay.addEventListener("click", function (e) {
            if (deleteOverlayMouseDownTarget === overlay || deleteOverlayMouseDownTarget === e.currentTarget) {
                overlay.remove();
            }
            deleteOverlayMouseDownTarget = null;
        });
        document.body.appendChild(overlay);
    }

function moveToCategory(tabName, style, onDone) {
        const overlay = el("div", { className: "sg-editor-overlay" });
        const modal = el("div", { className: "sg-editor-modal" });

        var moveTitle = el("h3", {
            className: "sg-editor-title",
            textContent: "Move to category"
        });
        decorateEditorModal(modal, moveTitle);
        modal.appendChild(moveTitle);
        modal.appendChild(el("label", {
            className: "sg-editor-label",
            textContent: "New category name"
        }));
        const input = el("input", {
            className: "sg-editor-input",
            type: "text",
            value: style.category || "",
            placeholder: "New category name"
        });
        modal.appendChild(input);

        const btns = el("div", { className: "sg-editor-btns" });
        btns.appendChild(el("button", {
            className: "sg-btn sg-btn-primary",
            textContent: "Move",
            onClick: function () {
                const newCat = (input.value || "").trim();
                if (!newCat) { input.style.borderColor = "#f87171"; return; }
                const oldName = style.name;
                const rest = oldName.includes("_") ? oldName.split("_").slice(1).join("_") : oldName;
                const newName = newCat.toUpperCase() + "_" + rest;
                apiPost("/style_grid/style/rename", {
                    old_name: oldName,
                    new_name: newName,
                    source: style.source,
                    // Align category column with the new prefix. Display prefers
                    // category_explicit over the name prefix when the column is set.
                    category: newCat.toUpperCase(),
                }).then(assertNoApiError).then(function () {
                    remapStyleNameReferences(
                        tabName,
                        oldName,
                        newName,
                        style.source_file || style.source || ""
                    );
                    overlay.remove();
                    hooks.refreshPanel(tabName);
                    var notify = state[tabName] && state[tabName].refreshAndNotifyFrame;
                    if (typeof notify === "function") notify();
                    if (typeof onDone === "function") onDone();
                }).catch(function (err) {
                    var msg = (err && err.message) ? err.message : "Move failed";
                    var frMove = state[tabName] && state[tabName].sgFrame;
                    if (frMove && frMove.contentWindow) {
                        frMove.contentWindow.postMessage({
                            type: "SG_TOAST",
                            message: msg,
                            variant: "error"
                        }, "*");
                    }
                });
            }
        }));
        btns.appendChild(el("button", {
            className: "sg-btn sg-btn-secondary",
            textContent: "Cancel",
            onClick: function () { overlay.remove(); }
        }));

        modal.appendChild(btns);
        overlay.appendChild(modal);
        var moveOverlayMouseDownTarget = null;
        overlay.addEventListener("mousedown", function (e) {
            moveOverlayMouseDownTarget = e.target;
        });
        overlay.addEventListener("click", function (e) {
            if (moveOverlayMouseDownTarget === overlay || moveOverlayMouseDownTarget === e.currentTarget) {
                overlay.remove();
            }
            moveOverlayMouseDownTarget = null;
        });
        document.body.appendChild(overlay);
    }

function showExportImport(tabName) {
        const overlay = el("div", { className: "sg-editor-overlay" });
        const modal = el("div", { className: "sg-editor-modal" });
        var ieTitle = el("h3", { className: "sg-editor-title", textContent: "📥 Import / Export" });
        decorateEditorModal(modal, ieTitle);
        modal.appendChild(ieTitle);

        const btnExport = el("button", {
            className: "sg-btn sg-btn-primary", textContent: "⬇️ Export all (JSON)",
            onClick: function () {
                apiGet("/style_grid/export").then(function (data) {
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = "style_grid_export_" + new Date().toISOString().slice(0, 10) + ".json";
                    a.click();
                }).catch(function (err) {
                    var msg = "Export failed";
                    if (err && err.message) msg += ": " + err.message;
                    postPanelToast(tabName, msg);
                });
            }
        });
        modal.appendChild(btnExport);

        const importLabel = el("label", { className: "sg-editor-label", textContent: "Import JSON file:" });
        const importInput = el("input", { type: "file", accept: ".json" });
        const importError = el("p", {
            className: "sg-editor-error",
            role: "alert",
            hidden: "true",
        });
        function showImportError(text) {
            importError.textContent = text;
            importError.removeAttribute("hidden");
        }
        function clearImportError() {
            importError.textContent = "";
            importError.setAttribute("hidden", "true");
        }
        importInput.addEventListener("change", function () {
            clearImportError();
            const file = importInput.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function () {
                try {
                    const data = JSON.parse(reader.result);
                    apiPost("/style_grid/import", data)
                        .then(function (body) {
                            if (body && body.error) {
                                var msg = body.error;
                                if (Array.isArray(body.collisions) && body.collisions.length) {
                                    msg += "\n\nColliding names: " + body.collisions.join(", ");
                                }
                                return Promise.reject(new Error(msg));
                            }
                            return body;
                        })
                        .then(function () {
                            overlay.remove();
                            hooks.refreshPanel(tabName);
                            var notify = state[tabName] && state[tabName].refreshAndNotifyFrame;
                            if (typeof notify === "function") notify();
                        }).catch(function (err) {
                            showImportError((err && err.message) ? err.message : "Import failed");
                        });
                } catch (_e) { showImportError("Invalid JSON file"); }
            };
            reader.readAsText(file);
        });
        modal.appendChild(importLabel);
        modal.appendChild(importInput);
        modal.appendChild(importError);

        modal.appendChild(el("button", { className: "sg-btn sg-btn-secondary", textContent: "Close", onClick: function () { overlay.remove(); } }));
        overlay.appendChild(modal);
        var importExportOverlayMouseDownTarget = null;
        overlay.addEventListener("mousedown", function (e) {
            importExportOverlayMouseDownTarget = e.target;
        });
        overlay.addEventListener("click", function (e) {
            if (importExportOverlayMouseDownTarget === overlay || importExportOverlayMouseDownTarget === e.currentTarget) {
                overlay.remove();
            }
            importExportOverlayMouseDownTarget = null;
        });
        document.body.appendChild(overlay);
    }

function syncSelectionChrome(tabName) {
        let order = state[tabName].selectedOrder || [];
        order = order.filter(function (n) { return state[tabName].selected.has(n); });
        state[tabName].selected.forEach(function (n) {
            if (order.indexOf(n) === -1) order.push(n);
        });
        state[tabName].selectedOrder = order;

        const count = state[tabName].selected.size;
        const badge = qs("#sg_btn_badge_" + tabName);
        if (badge) {
            badge.textContent = count > 0 ? count : "";
            badge.style.display = count > 0 ? "flex" : "none";
        }
    }

function postSGInitToFrame(tabName) {
        var fr = state[tabName].sgFrame;
        if (!fr || !fr.contentWindow) return;
        fetch("/style_grid/styles")
            .then(function (r) { return r.json(); })
            .then(function (data) {
                var styles = Array.isArray(data)
                    ? data
                    : Object.values(data.categories || {}).flat();
                fr.contentWindow.postMessage({
                    type: "SG_INIT",
                    tab: tabName,
                    styles: styles,
                }, "*");
                state[tabName].sgV2HostInitSent = true;
            })
            .catch(function () {});
    }

function anySGFrameVisible() {
        return ["txt2img", "img2img"].some(function (t) {
            var fr = state[t] && state[t].sgFrame;
            var wr = state[t] && state[t].sgFrameWrapper;
            var target = wr || fr;
            return !!(target && target.style.display === "block");
        });
    }

function setHostPageScrollLock(lock) {
        if (lock && !_sgHostScrollLocked) {
            _sgHostPrevBodyOverflow = document.body ? document.body.style.overflow : "";
            _sgHostPrevDocOverflow = document.documentElement ? document.documentElement.style.overflow : "";
            if (document.body) document.body.style.overflow = "hidden";
            if (document.documentElement) document.documentElement.style.overflow = "hidden";
            _sgHostScrollLocked = true;
            return;
        }
        if (!lock && _sgHostScrollLocked) {
            if (document.body) document.body.style.overflow = _sgHostPrevBodyOverflow || "";
            if (document.documentElement) document.documentElement.style.overflow = _sgHostPrevDocOverflow || "";
            _sgHostScrollLocked = false;
        }
    }

function togglePanel(tabName, show) {
        if (!state[tabName].sgFrame) hooks.ensureSGFramesOnce();
        var fr = state[tabName].sgFrame;
        var wr = state[tabName].sgFrameWrapper;
        if (!fr) {
            return;
        }
        if (!wr && fr.parentElement && fr.parentElement.id === "sg-panel-wrapper-" + tabName) {
            wr = fr.parentElement;
            state[tabName].sgFrameWrapper = wr;
        }
        var target = wr || fr;
        if (typeof show === "undefined") show = target.style.display !== "block";
        if (!show) {
            target.style.display = "none";
            setHostPageScrollLock(anySGFrameVisible());
            syncTriggerExpanded(tabName);
            return;
        }
        target.style.display = "block";
        setHostPageScrollLock(true);
        syncTriggerExpanded(tabName);
        hooks.syncWildcards(tabName);
        if (!state[tabName].sgV2HostInitSent) postSGInitToFrame(tabName);
        hooks.forgeTab.lastBroadcast = null;
        hooks.scheduleSyncForgeHostTabToV2Frames();
    }

function createTriggerButton(tabName) {
        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttributeNS(null, "viewBox", "0 0 24 24");
        svg.setAttributeNS(null, "fill", "none");
        svg.setAttributeNS(null, "stroke", "currentColor");
        svg.setAttributeNS(null, "stroke-width", "2");
        svg.setAttributeNS(null, "stroke-linecap", "round");
        svg.setAttributeNS(null, "stroke-linejoin", "round");
        svg.setAttributeNS(null, "width", "16");
        svg.setAttributeNS(null, "height", "16");
        [[3, 3, 7, 7], [14, 3, 7, 7], [3, 14, 7, 7], [14, 14, 7, 7]].forEach(function (xywh) {
            const rect = document.createElementNS(ns, "rect");
            rect.setAttributeNS(null, "x", String(xywh[0]));
            rect.setAttributeNS(null, "y", String(xywh[1]));
            rect.setAttributeNS(null, "width", String(xywh[2]));
            rect.setAttributeNS(null, "height", String(xywh[3]));
            svg.appendChild(rect);
        });
        const btn = el("button", {
            className: "sg-trigger-btn lg secondary gradio-button tool svelte-cmf5ev",
            id: "sg_trigger_" + tabName,
            title: "Open Style Grid",
            "aria-controls": "sg-panel-wrapper-" + tabName,
            "aria-expanded": "false",
        });
        btn.appendChild(svg);
        const badge = el("span", { className: "sg-btn-badge", id: "sg_btn_badge_" + tabName });
        badge.style.display = "none";
        btn.appendChild(badge);
        btn.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); togglePanel(tabName); });
        return btn;
    }

function getStyleGridToolbarHost() {
        var root = (typeof gradioApp === "function" ? gradioApp() : null) || document;
        return root.querySelector(".forge-toolbar-container")
            || root.querySelector("#quicksettings")
            || root.querySelector(".gradio-container .top-row")
            || null;
    }

function injectButton(tabName) {
        const selectors = [
            "#" + tabName + "_tools",
            "#" + tabName + "_styles_row",
            "#" + tabName + "_actions_column .style_create_row",
            "#" + tabName + "_actions_column",
        ];
        let target = null;
        for (let i = 0; i < selectors.length; i++) { target = qs(selectors[i]); if (target) break; }
        if (!target) {
            const dd = qs("#" + tabName + "_styles_row") || qs("#" + tabName + "_styles");
            if (dd) target = dd.parentElement;
        }
        if (!target) {
            const tab = qs("#tab_" + tabName);
            if (tab) { const btns = tab.querySelectorAll(".tool"); if (btns.length > 0) target = btns[btns.length - 1].parentElement; }
        }
        if (!target) {
            var toolbarHost = getStyleGridToolbarHost();
            if (!toolbarHost) return false;
            const btnToolbar = createTriggerButton(tabName);
            btnToolbar.classList.add("sg-trigger-btn--toolbar-host");
            toolbarHost.appendChild(btnToolbar);
            return true;
        }
        const btn = createTriggerButton(tabName);
        if (target.id && target.id.includes("tools")) {
            var toolsEl = target;
            var formEl = toolsEl.querySelector(":scope > div.form, :scope > div[style*='flex']");
            (formEl || toolsEl).appendChild(btn);
        } else if (target.classList.contains("style_create_row")) target.appendChild(btn);
        else if (target.parentNode) {
            target.parentNode.insertBefore(btn, target.nextSibling);
        } else {
            var toolbarHostFallback = getStyleGridToolbarHost();
            if (!toolbarHostFallback) return false;
            btn.classList.add("sg-trigger-btn--toolbar-host");
            toolbarHostFallback.appendChild(btn);
        }
        return true;
    }

export {
    qs,
    el,
    splitDescriptionAndCombos,
    joinDescriptionAndCombos,
    openStyleEditor,
    duplicateStyle,
    deleteStyle,
    moveToCategory,
    showExportImport,
    syncSelectionChrome,
    postSGInitToFrame,
    anySGFrameVisible,
    setHostPageScrollLock,
    syncTriggerExpanded,
    togglePanel,
    createTriggerButton,
    getStyleGridToolbarHost,
    injectButton,
};
