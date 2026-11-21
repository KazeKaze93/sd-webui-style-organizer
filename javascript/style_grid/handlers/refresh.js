/**
 * Style Grid host — reaction to SG_REFRESH from the iframe.
 * Kept free of DOM and Gradio imports so the flag forwarding can be unit-tested.
 */
"use strict";

/**
 * The iframe changed the library (save, delete, import, restore…). Reload the
 * host state and the iframe catalog. A selected style that is gone from the
 * catalog has its text stripped from the prompt; the toast that reports it is
 * silenced when the iframe deleted that style on purpose (quiet_vanished).
 *
 * @param {string} tab
 * @param {{quiet_vanished: boolean}} msg validated SG_REFRESH
 * @param {{refresh: function(string, {quietVanishedToast: boolean}): void}} deps
 */
function applyRefresh(tab, msg, deps) {
    deps.refresh(tab, { quietVanishedToast: msg.quiet_vanished === true });
}

export {
    applyRefresh,
};
