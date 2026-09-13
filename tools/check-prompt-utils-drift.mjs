/**
 * Fail CI when the duplicated prompt helpers in
 * javascript/sg_prompt_utils.js and javascript/style_grid.js drift apart.
 *
 * Extraction: for each name, find exactly one `function <name>(...)` declaration,
 * then brace-match from its opening `{` to the matching `}` while skipping
 * strings, comments, and regex literals. The full declaration text is compared.
 *
 * If any name is missing, duplicated, or cannot be brace-closed in either file,
 * exit non-zero — silent "found nothing, OK" is not allowed.
 *
 * Usage:
 *   node tools/check-prompt-utils-drift.mjs
 *   node tools/check-prompt-utils-drift.mjs --utils <path> --grid <path>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Must stay in sync with both source files; checker fails if any is absent. */
const FUNCTION_NAMES = [
    "splitTopLevelCommas",
    "stripParenLayers",
    "parseSegmentToTagged",
    "parseStylePromptTags",
    "scalePromptWeights",
    "formatScaledWeight",
];

function parseArgs(argv) {
    let utils = path.join(ROOT, "javascript", "sg_prompt_utils.js");
    let grid = path.join(ROOT, "javascript", "style_grid.js");
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--utils" && argv[i + 1]) {
            utils = path.resolve(argv[++i]);
        } else if (argv[i] === "--grid" && argv[i + 1]) {
            grid = path.resolve(argv[++i]);
        } else if (argv[i] === "--help" || argv[i] === "-h") {
            console.log(
                "Usage: node tools/check-prompt-utils-drift.mjs [--utils path] [--grid path]"
            );
            process.exit(0);
        } else {
            fail(`Unknown argument: ${argv[i]}`);
        }
    }
    return { utils, grid };
}

function fail(message) {
    console.error(`prompt-utils drift check FAILED: ${message}`);
    process.exit(1);
}

function prevNonWs(source, index) {
    let i = index;
    while (i >= 0 && /\s/.test(source[i])) i--;
    return i >= 0 ? source[i] : "";
}

/** `/` starts a regex after punctuation/operators; after ident/number it is division. */
function canStartRegex(prev) {
    if (prev === "") return true;
    if (/[A-Za-z0-9_$)\]"]/.test(prev)) return false;
    return true;
}

/**
 * Return the index of the `}` matching `{` at `from`, or -1.
 * Skips line/block comments, quotes/templates, and regex literals so braces
 * inside those do not affect depth.
 */
function findMatchingBrace(source, from) {
    if (source[from] !== "{") return -1;
    let depth = 0;
    let i = from;
    const n = source.length;

    while (i < n) {
        const c = source[i];

        if (c === "/" && source[i + 1] === "/") {
            i += 2;
            while (i < n && source[i] !== "\n") i++;
            continue;
        }
        if (c === "/" && source[i + 1] === "*") {
            i += 2;
            while (i < n && !(source[i] === "*" && source[i + 1] === "/")) i++;
            i += 2;
            continue;
        }

        if (c === "'" || c === '"' || c === "`") {
            const quote = c;
            i++;
            while (i < n) {
                if (source[i] === "\\") {
                    i += 2;
                    continue;
                }
                if (source[i] === quote) {
                    i++;
                    break;
                }
                if (quote === "`" && source[i] === "$" && source[i + 1] === "{") {
                    i += 2;
                    let embed = 1;
                    while (i < n && embed > 0) {
                        const ch = source[i];
                        if (ch === "\\") {
                            i += 2;
                            continue;
                        }
                        if (ch === "{") embed++;
                        else if (ch === "}") embed--;
                        i++;
                    }
                    continue;
                }
                i++;
            }
            continue;
        }

        if (c === "/") {
            const prev = prevNonWs(source, i - 1);
            if (canStartRegex(prev)) {
                i++;
                while (i < n) {
                    if (source[i] === "\\") {
                        i += 2;
                        continue;
                    }
                    if (source[i] === "/") {
                        i++;
                        while (i < n && /[a-z]/i.test(source[i])) i++;
                        break;
                    }
                    if (source[i] === "\n") break;
                    i++;
                }
                continue;
            }
        }

        if (c === "{") {
            depth++;
            i++;
            continue;
        }
        if (c === "}") {
            depth--;
            if (depth === 0) return i;
            i++;
            continue;
        }
        i++;
    }
    return -1;
}

/**
 * Locate exactly one declaration of `function <name>(...) { ... }` and return
 * its full source slice. Throws a descriptive Error on ambiguity or parse failure.
 */
function extractFunction(source, name, fileLabel) {
    const re = new RegExp(
        `(?:^|[\\n;{}])\\s*(function\\s+${name}\\s*\\()`,
        "g"
    );
    const hits = [];
    let m;
    while ((m = re.exec(source)) !== null) {
        const fnKeywordIndex = m.index + m[0].lastIndexOf("function");
        hits.push(fnKeywordIndex);
    }

    if (hits.length === 0) {
        throw new Error(
            `could not find function ${name}() in ${fileLabel} ` +
                `(renamed, deleted, or not a function declaration?)`
        );
    }
    if (hits.length > 1) {
        throw new Error(
            `found ${hits.length} declarations of function ${name}() in ${fileLabel}; expected exactly one`
        );
    }

    const start = hits[0];
    const openParen = source.indexOf("(", start);
    if (openParen < 0) {
        throw new Error(`function ${name} in ${fileLabel}: missing parameter list`);
    }

    let i = openParen;
    let parenDepth = 0;
    let foundParamsEnd = false;
    while (i < source.length) {
        const c = source[i];
        if (c === "(") parenDepth++;
        else if (c === ")") {
            parenDepth--;
            if (parenDepth === 0) {
                foundParamsEnd = true;
                i++;
                break;
            }
        }
        i++;
    }
    if (!foundParamsEnd) {
        throw new Error(`function ${name} in ${fileLabel}: unclosed parameter list`);
    }
    while (i < source.length && /\s/.test(source[i])) i++;
    if (source[i] !== "{") {
        throw new Error(
            `function ${name} in ${fileLabel}: expected '{' after parameters, found ${JSON.stringify(source.slice(i, i + 20))}`
        );
    }

    const end = findMatchingBrace(source, i);
    if (end < 0) {
        throw new Error(
            `function ${name} in ${fileLabel}: could not brace-match body ` +
                `(reformat/syntax broke the scanner, or body is unclosed)`
        );
    }

    return source.slice(start, end + 1);
}

function extractAll(source, fileLabel) {
    const out = Object.create(null);
    const errors = [];
    for (const name of FUNCTION_NAMES) {
        try {
            out[name] = extractFunction(source, name, fileLabel);
        } catch (err) {
            errors.push(err.message);
        }
    }
    if (errors.length) {
        fail(
            `extraction failed for ${fileLabel}:\n  - ${errors.join("\n  - ")}`
        );
    }
    return out;
}

function main() {
    const { utils: utilsPath, grid: gridPath } = parseArgs(process.argv.slice(2));

    if (!fs.existsSync(utilsPath)) fail(`missing file: ${utilsPath}`);
    if (!fs.existsSync(gridPath)) fail(`missing file: ${gridPath}`);

    const utilsSrc = fs.readFileSync(utilsPath, "utf8");
    const gridSrc = fs.readFileSync(gridPath, "utf8");

    const utilsLabel = path.relative(ROOT, utilsPath) || utilsPath;
    const gridLabel = path.relative(ROOT, gridPath) || gridPath;

    const utilsFns = extractAll(utilsSrc, utilsLabel);
    const gridFns = extractAll(gridSrc, gridLabel);

    const drifted = [];
    for (const name of FUNCTION_NAMES) {
        if (utilsFns[name] !== gridFns[name]) {
            drifted.push(name);
        }
    }

    if (drifted.length) {
        fail(
            `duplicated prompt helper(s) drifted between ` +
                `${utilsLabel} and ${gridLabel}:\n` +
                drifted.map((n) => `  - ${n}`).join("\n") +
                `\nKeep both copies identical (tests load sg_prompt_utils.js; live UI uses style_grid.js).`
        );
    }

    console.log(
        `prompt-utils drift check OK: ${FUNCTION_NAMES.length} functions identical ` +
            `(${FUNCTION_NAMES.join(", ")})`
    );
}

main();
