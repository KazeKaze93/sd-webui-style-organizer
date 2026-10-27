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
import { postToFrame } from "./post-message.js";

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
var _sgHostKbdInstalled = false;
var SG_HOST_OVERLAY_SEL = ".sg-editor-overlay";
var SG_FOCUSABLE_SEL = 'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

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

function restoreFocus(el) {
        if (!el || typeof el.focus !== "function") return;
        if (el.isConnected === false) return;
        try { el.focus(); } catch (_err) { /* ignore */ }
    }

function getFocusableElements(root) {
        if (!root || !root.querySelectorAll) return [];
        return Array.prototype.filter.call(root.querySelectorAll(SG_FOCUSABLE_SEL), function (node) {
            if (node.disabled) return false;
            if (node.getAttribute("aria-hidden") === "true") return false;
            var style = window.getComputedStyle(node);
            if (style.visibility === "hidden" || style.display === "none") return false;
            return true;
        });
    }

function getTopmostHostOverlay() {
        var list = document.querySelectorAll(SG_HOST_OVERLAY_SEL);
        return list.length ? list[list.length - 1] : null;
    }

function focusTriggerButton(tab) {
        restoreFocus(qs("#sg_trigger_" + tab));
    }

function getPanelTarget(tab) {
        var fr = state[tab] && state[tab].sgFrame;
        var wr = state[tab] && state[tab].sgFrameWrapper;
        if (!wr && fr && fr.parentElement && fr.parentElement.id === "sg-panel-wrapper-" + tab) {
            wr = fr.parentElement;
            state[tab].sgFrameWrapper = wr;
        }
        return wr || fr || null;
    }

function syncTriggerExpanded(tab) {
        var btn = qs("#sg_trigger_" + tab);
        if (!btn) return;
        var wr = getPanelTarget(tab);
        var expanded = !!(wr && wr.style.display === "block");
        btn.setAttribute("aria-expanded", expanded ? "true" : "false");
    }

function closeSGPanel(tab) {
        var target = getPanelTarget(tab);
        if (!target) return false;
        if (target.style.display !== "block") {
            syncTriggerExpanded(tab);
            return false;
        }
        target.style.display = "none";
        setHostPageScrollLock(anySGFrameVisible());
        syncTriggerExpanded(tab);
        focusTriggerButton(tab);
        return true;
    }

function tryCloseTopmostHostOverlay() {
        var overlay = getTopmostHostOverlay();
        if (!overlay) return false;
        if (overlay.classList.contains("sg-batch-overlay")) {
            var cancelBtn = overlay.querySelector(".sg-btn-danger");
            if (cancelBtn && !cancelBtn.disabled) {
                cancelBtn.click();
                return true;
            }
        }
        if (typeof overlay._sgCloseOverlay === "function") {
            overlay._sgCloseOverlay();
        } else {
            overlay.remove();
        }
        return true;
    }

function trapTabKey(e, overlay) {
        var modal = overlay.querySelector(".sg-editor-modal") || overlay;
        var nodes = getFocusableElements(modal);
        if (!nodes.length) {
            e.preventDefault();
            return;
        }
        var first = nodes[0];
        var last = nodes[nodes.length - 1];
        var active = document.activeElement;
        if (e.shiftKey) {
            if (active === first || !modal.contains(active)) {
                e.preventDefault();
                last.focus();
            }
        } else if (active === last || !modal.contains(active)) {
            e.preventDefault();
            first.focus();
        }
    }

function enhanceHostOverlay(overlay, opts) {
        opts = opts || {};
        if (!overlay || overlay.dataset.sgA11y === "1") return;
        overlay.dataset.sgA11y = "1";
        var prevFocus = document.activeElement;
        var modal = overlay.querySelector(".sg-editor-modal") || overlay;

        function cleanupAndRestore() {
            if (overlay._sgA11yCleaned) return;
            overlay._sgA11yCleaned = true;
            restoreFocus(prevFocus);
        }

        var nativeRemove = overlay.remove;
        overlay.remove = function () {
            cleanupAndRestore();
            return nativeRemove.call(overlay);
        };
        overlay._sgCloseOverlay = function () {
            overlay.remove();
        };

        var initial = opts.initialFocus;
        if (!initial || !modal.contains(initial)) {
            initial = getFocusableElements(modal)[0] || modal;
        }
        if (initial === modal && !modal.hasAttribute("tabindex")) {
            modal.setAttribute("tabindex", "-1");
        }
        setTimeout(function () {
            if (overlay.isConnected) restoreFocus(initial);
        }, 0);
    }

function installHostKeyboardA11y() {
        if (_sgHostKbdInstalled) return;
        _sgHostKbdInstalled = true;

        document.addEventListener("keydown", function (e) {
            var overlay = getTopmostHostOverlay();
            if (overlay && e.key === "Tab") {
                trapTabKey(e, overlay);
                return;
            }
            if (e.key !== "Escape") return;
            if (tryCloseTopmostHostOverlay()) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
                return;
            }
            var closed = false;
            ["txt2img", "img2img"].forEach(function (t) {
                if (closeSGPanel(t)) closed = true;
            });
            if (closed) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
            }
        }, true);

        function watchOverlays() {
            if (!document.body || typeof MutationObserver !== "function") return;
            var obs = new MutationObserver(function (mutations) {
                mutations.forEach(function (m) {
                    Array.prototype.forEach.call(m.addedNodes || [], function (node) {
                        if (!node || node.nodeType !== 1) return;
                        if (node.classList && node.classList.contains("sg-editor-overlay")) {
                            enhanceHostOverlay(node);
                        }
                        if (node.querySelectorAll) {
                            Array.prototype.forEach.call(
                                node.querySelectorAll(SG_HOST_OVERLAY_SEL),
                                function (el) { enhanceHostOverlay(el); }
                            );
                        }
                    });
                });
            });
            obs.observe(document.body, { childList: true, subtree: true });
        }
        if (document.body) watchOverlays();
        else document.addEventListener("DOMContentLoaded", watchOverlays);
    }

function postPanelToast(tabName, message, variant) {
        var fr = state[tabName] && state[tabName].sgFrame;
        if (fr && fr.contentWindow) {
            postToFrame(fr, {
                type: "SG_TOAST",
                message: message,
                variant: variant || "error"
            });
        }
    }

export const IMPORT_SUMMARY_MAX_NAMES = 10;

/** Build the post-import toast. Returns null when the body carries no style counters. */
export function formatImportSummary(body) {
    if (!body || typeof body.imported !== "number") return null;
    const collisions = Array.isArray(body.collisions) ? body.collisions : [];
    const invalid = typeof body.invalid === "number" ? body.invalid : 0;
    const parts = [];
    parts.push(body.imported === 1 ? "Imported 1 style." : "Imported " + body.imported + " styles.");
    if (collisions.length) {
        const shown = collisions.slice(0, IMPORT_SUMMARY_MAX_NAMES).join(", ");
        const extra = collisions.length - IMPORT_SUMMARY_MAX_NAMES;
        parts.push("Skipped " + collisions.length + " already in the library: " + shown + (extra > 0 ? " (+" + extra + " more)" : "") + ".");
    }
    if (invalid > 0) {
        parts.push("Skipped " + invalid + " invalid " + (invalid === 1 ? "entry" : "entries") + " (missing name).");
    }
    const variant = collisions.length || invalid > 0 ? "info" : "success";
    return { message: parts.join(" "), variant: variant };
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
                        postToFrame(frSave, {
                            type: "SG_TOAST",
                            message: msg,
                            variant: "error"
                        });
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
        enhanceHostOverlay(overlay, { initialFocus: nameInput });
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
                            postToFrame(frDel, {
                                type: "SG_TOAST",
                                message: "Delete failed",
                                variant: "error"
                            });
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
        enhanceHostOverlay(overlay);
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
                        postToFrame(frMove, {
                            type: "SG_TOAST",
                            message: msg,
                            variant: "error"
                        });
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
        enhanceHostOverlay(overlay, { initialFocus: input });
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
                        .then(function (body) {
                            overlay.remove();
                            hooks.refreshPanel(tabName);
                            var notify = state[tabName] && state[tabName].refreshAndNotifyFrame;
                            if (typeof notify === "function") notify();
                            var summary = formatImportSummary(body);
                            if (summary) postPanelToast(tabName, summary.message, summary.variant);
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
        enhanceHostOverlay(overlay);
    }

function formatBytes(n) {
        var num = Number(n) || 0;
        if (num < 1024) return num + " B";
        if (num < 1024 * 1024) return (num / 1024).toFixed(1) + " KB";
        return (num / (1024 * 1024)).toFixed(1) + " MB";
    }

function showBackupRestore(tabName) {
        const overlay = el("div", { className: "sg-editor-overlay" });
        const modal = el("div", { className: "sg-editor-modal" });
        var brTitle = el("h3", { className: "sg-editor-title", textContent: "💾 Backup / Restore" });
        decorateEditorModal(modal, brTitle);
        modal.appendChild(brTitle);

        const statusEl = el("p", { className: "sg-editor-label", textContent: "Loading snapshots…" });
        const listEl = el("div", { className: "sg-editor-list" });
        const thumbsLabel = el("label", {
            className: "sg-editor-label",
            textContent: "Include thumbnails (large)",
        });
        const thumbsCheck = el("input", { type: "checkbox" });
        thumbsLabel.insertBefore(thumbsCheck, thumbsLabel.firstChild);
        const thumbsSizeEl = el("span", {
            className: "sg-editor-label",
            textContent: "",
            style: "margin-left:8px;opacity:0.8;",
        });
        thumbsLabel.appendChild(thumbsSizeEl);

        function setStatus(text) {
            statusEl.textContent = text || "";
        }

        function reloadList() {
            setStatus("Loading snapshots…");
            listEl.innerHTML = "";
            return apiGet("/style_grid/backups")
                .then(function (data) {
                    var bytes = data && data.thumbnails_bytes;
                    thumbsSizeEl.textContent = bytes
                        ? " (~" + formatBytes(bytes) + ")"
                        : " (empty)";
                    var backups = (data && data.backups) || [];
                    if (!backups.length) {
                        setStatus("No backups yet.");
                        return;
                    }
                    setStatus(backups.length + " snapshot(s):");
                    backups.forEach(function (b) {
                        var row = el("div", {
                            className: "sg-editor-label",
                            style: "display:flex;align-items:center;gap:8px;margin:6px 0;flex-wrap:wrap;",
                        });
                        var meta = b.name
                            + " · " + formatBytes(b.size || 0)
                            + (b.has_thumbnails ? " · thumbs" : "");
                        row.appendChild(el("span", { textContent: meta, style: "flex:1;min-width:12rem;" }));
                        row.appendChild(el("button", {
                            className: "sg-btn sg-btn-secondary",
                            textContent: "Restore",
                            onClick: function () {
                                if (!window.confirm(
                                    "Restore snapshot " + b.name + "?\n"
                                    + "A safety backup of the current state is created first."
                                )) return;
                                setStatus("Restoring " + b.name + "…");
                                apiPost("/style_grid/restore", { snapshot: b.name })
                                    .then(function (body) {
                                        if (body && body.error) {
                                            return Promise.reject(new Error(body.error));
                                        }
                                        setStatus(
                                            "Restored " + b.name
                                            + (body.safety_snapshot
                                                ? (" (safety: " + body.safety_snapshot + ")")
                                                : "")
                                        );
                                        hooks.refreshPanel(tabName);
                                        var notify = state[tabName] && state[tabName].refreshAndNotifyFrame;
                                        if (typeof notify === "function") notify();
                                        return reloadList();
                                    })
                                    .catch(function (err) {
                                        setStatus("Restore failed: " + ((err && err.message) || String(err)));
                                    });
                            },
                        }));
                        listEl.appendChild(row);
                    });
                })
                .catch(function (err) {
                    setStatus("Could not list backups: " + ((err && err.message) || String(err)));
                });
        }

        const btnCreate = el("button", {
            className: "sg-btn sg-btn-primary",
            textContent: "Create backup now",
            onClick: function () {
                setStatus("Creating backup…");
                apiPost("/style_grid/backup", { include_thumbnails: !!thumbsCheck.checked })
                    .then(function (data) {
                        if (data && data.error) {
                            return Promise.reject(new Error(data.error));
                        }
                        if (data && data.ok === false) {
                            setStatus("Nothing to backup (no files found)");
                            postPanelToast(tabName, "Nothing to backup (no files found)");
                            return reloadList();
                        }
                        setStatus("Backup created" + (data.snapshot ? (": " + data.snapshot) : ""));
                        postPanelToast(tabName, "💾 Backup created");
                        return reloadList();
                    })
                    .catch(function (err) {
                        var msg = "Backup failed: " + ((err && err.message) || String(err));
                        setStatus(msg);
                        postPanelToast(tabName, msg);
                    });
            },
        });

        modal.appendChild(btnCreate);
        modal.appendChild(thumbsLabel);
        modal.appendChild(statusEl);
        modal.appendChild(listEl);
        modal.appendChild(el("button", {
            className: "sg-btn sg-btn-secondary",
            textContent: "Close",
            onClick: function () { overlay.remove(); },
        }));
        overlay.appendChild(modal);
        var backupOverlayMouseDownTarget = null;
        overlay.addEventListener("mousedown", function (e) {
            backupOverlayMouseDownTarget = e.target;
        });
        overlay.addEventListener("click", function (e) {
            if (backupOverlayMouseDownTarget === overlay || backupOverlayMouseDownTarget === e.currentTarget) {
                overlay.remove();
            }
            backupOverlayMouseDownTarget = null;
        });
        document.body.appendChild(overlay);
        enhanceHostOverlay(overlay);
        reloadList();
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
                postToFrame(fr, {
                    type: "SG_INIT",
                    tab: tabName,
                    styles: styles,
                });
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
        if (!fr) {
            return;
        }
        var target = getPanelTarget(tabName);
        if (!target) return;
        if (typeof show === "undefined") show = target.style.display !== "block";
        if (!show) {
            closeSGPanel(tabName);
            return;
        }
        target.style.display = "block";
        setHostPageScrollLock(true);
        syncTriggerExpanded(tabName);
        hooks.syncWildcards(tabName);
        if (!state[tabName].sgV2HostInitSent) postSGInitToFrame(tabName);
        hooks.forgeTab.lastBroadcast = null;
        hooks.scheduleSyncForgeHostTabToV2Frames();
        try { fr.focus(); } catch (_err) { /* ignore */ }
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
    showBackupRestore,
    syncSelectionChrome,
    postSGInitToFrame,
    anySGFrameVisible,
    setHostPageScrollLock,
    syncTriggerExpanded,
    focusTriggerButton,
    getTopmostHostOverlay,
    getPanelTarget,
    closeSGPanel,
    tryCloseTopmostHostOverlay,
    enhanceHostOverlay,
    installHostKeyboardA11y,
    togglePanel,
    createTriggerButton,
    getStyleGridToolbarHost,
    injectButton,
};
