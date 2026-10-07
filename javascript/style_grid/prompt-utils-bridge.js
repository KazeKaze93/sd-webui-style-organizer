/**
 * Install shared prompt helpers on globalThis for legacy browser/vitest callers.
 * Single implementation: ./prompt-utils.js
 */
import {
    splitTopLevelCommas,
    stripParenLayers,
    parseSegmentToTagged,
    parseStylePromptTags,
    formatScaledWeight,
    scalePromptWeights,
} from "./prompt-utils.js";

const g = typeof globalThis !== "undefined" ? globalThis : window;
g.splitTopLevelCommas = splitTopLevelCommas;
g.stripParenLayers = stripParenLayers;
g.parseSegmentToTagged = parseSegmentToTagged;
g.parseStylePromptTags = parseStylePromptTags;
g.formatScaledWeight = formatScaledWeight;
g.scalePromptWeights = scalePromptWeights;
