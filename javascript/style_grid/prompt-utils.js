/**
 * Style Grid host — prompt helpers (single source for host + tests).
 */
"use strict";

function removeSubstringFromPrompt(val, sub) {
        if (!sub || !val) return val;
        const idx = val.indexOf(sub);
        if (idx === -1) return val;
        const before = val.substring(0, idx).replace(/,\s*$/, "");
        const after = val.substring(idx + sub.length).replace(/^,\s*/, "");
        if (before.trim() && after.trim()) return before.trimEnd() + ", " + after.trimStart();
        return (before + after).trim();
    }

function stripWrapOrTagsFromText(text, wrapTemplate, tagDelta) {
        if (text === null || text === undefined) return "";
        if (wrapTemplate) {
            const parts = wrapTemplate.split("{prompt}");
            const prefix = (parts[0] || "").replace(/,\s*$/, "").trim();
            const suffix = (parts[1] || "").replace(/^,\s*/, "").trim();
            let current = String(text).trim();
            if (prefix && current.indexOf(prefix) === 0) {
                current = current.slice(prefix.length).replace(/^,\s*/, "").trim();
            }
            if (suffix && current.length >= suffix.length &&
                current.lastIndexOf(suffix) === current.length - suffix.length) {
                current = current.slice(0, current.length - suffix.length).replace(/,\s*$/, "").trim();
            }
            return current;
        }
        if (tagDelta) {
            return removeSubstringFromPrompt(text, tagDelta);
        }
        return text;
    }

function splitTopLevelCommas(s) {
        if (!s || !String(s).trim()) return [];
        var str = String(s);
        var parts = [];
        var parenDepth = 0;
        var braceDepth = 0;
        var cur = "";
        for (var i = 0; i < str.length; i++) {
            var c = str[i];
            if (c === "(") parenDepth++;
            else if (c === ")") parenDepth = Math.max(0, parenDepth - 1);
            else if (c === "{") braceDepth++;
            else if (c === "}") braceDepth = Math.max(0, braceDepth - 1);
            if (c === "," && parenDepth === 0 && braceDepth === 0) {
                if (cur.trim()) parts.push(cur.trim());
                cur = "";
            } else {
                cur += c;
            }
        }
        if (cur.trim()) parts.push(cur.trim());
        return parts;
    }

function stripParenLayers(s) {
        var t = String(s || "").trim();
        var changed = true;
        while (changed) {
            changed = false;
            if (t.length < 2 || t.charAt(0) !== "(" || t.charAt(t.length - 1) !== ")") break;
            var depth = 0;
            var wrapsWhole = true;
            for (var i = 0; i < t.length; i++) {
                var c = t.charAt(i);
                if (c === "(") depth++;
                else if (c === ")") {
                    depth--;
                    if (depth === 0 && i !== t.length - 1) {
                        wrapsWhole = false;
                        break;
                    }
                }
            }
            if (wrapsWhole && depth === 0) {
                t = t.slice(1, -1).trim();
                changed = true;
            }
        }
        return t;
    }

function parseSegmentToTagged(seg) {
        var t = (seg || "").trim();
        if (!t) return null;
        var m = /^\(([\s\S]+?):([\d.]+)\)$/.exec(t);
        if (m) return { tag: m[1].trim(), weight: parseFloat(m[2]) };
        return { tag: t, weight: 1 };
    }

function parseStylePromptTags(prompt) {
        return splitTopLevelCommas(prompt)
            .map(parseSegmentToTagged)
            .filter(function (x) { return x !== null; });
    }

function formatScaledWeight(w, scale) {
        var nw = 1 + (w - 1) * scale;
        return String(+nw.toPrecision(10));
    }

function scalePromptWeights(text, scale) {
        if (scale === 1) return text;
        var parts = splitTopLevelCommas(text);
        var out = [];
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i].trim();
            if (!p) continue;
            if (p === "{prompt}") {
                out.push(p);
                continue;
            }
            var m = /^\(([\s\S]+?):([\d.]+)\)$/.exec(p);
            if (m) {
                if (scale === 0) continue;
                var w = parseFloat(m[2]);
                var nw = formatScaledWeight(w, scale);
                out.push("(" + m[1].trim() + ":" + nw + ")");
                continue;
            }
            if (scale === 0) continue;
            out.push("(" + p + ":" + scale + ")");
        }
        return out.join(", ");
    }

function setPromptValue(el, value) {
        if (!el) return;
        // Use native setter to bypass framework interception
        var nativeSet = Object.getOwnPropertyDescriptor(
            window.HTMLTextAreaElement.prototype, "value"
        );
        if (nativeSet && nativeSet.set) {
            nativeSet.set.call(el, value);
        } else {
            el.value = value;
        }
        el.dispatchEvent(new InputEvent("input", {
            bubbles: true,
            inputType: "insertText",
            data: value
        }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
    }

export {
    removeSubstringFromPrompt,
    stripWrapOrTagsFromText,
    splitTopLevelCommas,
    stripParenLayers,
    parseSegmentToTagged,
    parseStylePromptTags,
    formatScaledWeight,
    scalePromptWeights,
    setPromptValue,
};
