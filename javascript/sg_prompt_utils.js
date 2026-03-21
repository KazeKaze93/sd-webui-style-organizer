/**
 * Prompt parsing and weight scaling helpers (browser globals).
 * Duplicated inside style_grid.js — keep in sync (see comment there).
 */
(function (g) {
    "use strict";

    function splitTopLevelCommas(s) {
        if (!s || !String(s).trim()) return [];
        var str = String(s);
        var parts = [];
        var depth = 0;
        var cur = "";
        for (var i = 0; i < str.length; i++) {
            var c = str[i];
            if (c === "(") depth++;
            else if (c === ")") depth = Math.max(0, depth - 1);
            if (c === "," && depth === 0) {
                if (cur.trim()) parts.push(cur.trim());
                cur = "";
            } else {
                cur += c;
            }
        }
        if (cur.trim()) parts.push(cur.trim());
        return parts;
    }

    /** Remove outer layers of balanced parentheses, e.g. "((foo))" → "foo". */
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

    g.splitTopLevelCommas = splitTopLevelCommas;
    g.stripParenLayers = stripParenLayers;
    g.parseSegmentToTagged = parseSegmentToTagged;
    g.parseStylePromptTags = parseStylePromptTags;
    g.scalePromptWeights = scalePromptWeights;
})(typeof window !== "undefined" ? window : globalThis);
