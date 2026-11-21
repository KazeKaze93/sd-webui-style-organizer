/**
 * Style Grid host — reaction to SG_STYLE_RENAMED from the iframe.
 * Kept free of DOM and Gradio imports so the ordering can be unit-tested.
 */
"use strict";

/**
 * A style was renamed on the server by the iframe. Order matters:
 *  1. remap — move the host's references (selection, applied records,
 *     favorites) from the old (source file, name) to the new one;
 *  2. refresh — reload the catalog and replay the selection.
 * Refreshing first would find the old name gone from the catalog, treat the
 * style as removed and cut its text out of the prompt fields.
 *
 * @param {string} tab
 * @param {{old_name: string, new_name: string, source_file: string}} msg validated SG_STYLE_RENAMED
 * @param {{remap: function(string, string, string, string): void, refresh: function(string): void}} deps
 */
function applyStyleRenamed(tab, msg, deps) {
    deps.remap(tab, msg.old_name, msg.new_name, msg.source_file);
    deps.refresh(tab);
}

export {
    applyStyleRenamed,
};
