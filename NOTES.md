# Investigation: reorder prompt loss

Branch: `investigate/reorder-prompt-loss`  
Repo: `sd-webui-style-organizer` (WebUI)  
Date: 2026-09-12  

Scope: diagnostic only — no functional code changes.  
Compared against pre-wildcard master commit `994084e` (worktree) and current HEAD (wildcard already merged via #72).

---

## Symptom A — mid-session textarea inserts vanish after reorder

### Verdict: CONFIRMED (pre-existing on master / `994084e`)

### Root cause: `userPromptBase` captured once, never re-synced

`applyStyleImmediate` snapshots the live textareas into `userPromptBase` / `userPromptBaseNeg` **only when `applied.size === 0`** (first live apply of the session):

```767:771:javascript/style_grid.js
        if (!restoreOnly) {
            if (state[tabName].applied.size === 0) {
                state[tabName].userPromptBase = promptEl.value;
                state[tabName].userPromptBaseNeg = negEl.value;
            }
        }
```

### Every `userPromptBase` reference in `javascript/style_grid.js`

| Line | Role |
|------|------|
| 30–31 | Init to `""` in tab state |
| **769–770** | **WRITE** — first-apply snapshot only (`applied.size === 0`) |
| 2377–2378 | READ — silent restore simulation copies base |
| 3537–3540 | READ then **CLEAR** — `clearAll` restores base into textareas, then empties base |
| **3699–3700** | **READ** — `rebuildPromptFromOrder` starts rebuild from stale base |

There is **no** `input`/`change` listener (or any other path) that updates `userPromptBase` from the live textarea after the first style apply. Hand edits, `SG_WILDCARD_CATEGORY` DOM inserts, and any other post-first-apply mutations are invisible to reorder rebuild.

### Reorder path

```4478:4484:javascript/style_grid.js
            if (msg.type === "SG_REORDER_STYLES") {
                var ids = Array.isArray(msg.styleIds) ? msg.styleIds : [];
                state[tab].selectedOrder = ids;
                if (typeof rebuildPromptFromOrder === "function") {
                    rebuildPromptFromOrder(tab);
                }
            }
```

```3689:3716:javascript/style_grid.js
    function rebuildPromptFromOrder(tabName) {
        ...
        let p = (state[tabName].userPromptBase || "").trim();
        let n = (state[tabName].userPromptBaseNeg || "").trim();
        orderedApplied.forEach(function (name) {
            const r = state[tabName].applied.get(name);
            ...
            } else if (r.prompt) {
                p = p + (p ? ", " : "") + r.prompt;
            }
            ...
        });
        setPromptValue(promptEl, p);
        setPromptValue(negEl, n);
```

Rebuild = stale base + stored per-style deltas. Anything not in that equation is wiped.

### STEP 1 repro (no wildcards) — expected before/after

Simulated with the same rebuild rules as host code (no UI automation required for determinism):

1. Base / first-apply snapshot: `very awa`  
2. Apply style A → store delta `masterpiece, best quality`  
   Live: `very awa, masterpiece, best quality`  
3. Manually type `, HAND_EDIT`  
   Live: `very awa, masterpiece, best quality, HAND_EDIT`  
   (`userPromptBase` still `very awa`)  
4. Apply style B → store delta `intricate details`  
   Live: `very awa, masterpiece, best quality, HAND_EDIT, intricate details`  
5. Reorder chips (either order)

| | Prompt text |
|--|--|
| **Before reorder** | `very awa, masterpiece, best quality, HAND_EDIT, intricate details` |
| **After reorder** | `very awa, masterpiece, best quality, intricate details` *(or swapped style order)* |
| **`HAND_EDIT` survives?** | **NO — silently dropped** |

Same class of loss for `{sg:body}` inserted via `SG_WILDCARD_CATEGORY` after a style is already applied.

### Master vs wildcard branch

Identical capture + rebuild logic at `994084e` (pre-#72). Wildcard work only added `syncWildcards(...)` after rebuild and unrelated helpers — **did not introduce A**.  
**A reproduces on plain pre-wildcard master.**

---

## Symptom B — applied style missing from rebuilt prompt text

### Verdict: CONFIRMED as a separate, also pre-existing mechanism (not “removed from `applied`”)

### What B is *not*

`rebuildPromptFromOrder` does **not** delete entries from `state[tabName].applied`. After reorder, `applied.keys()` still contains every previously applied style name. Grid `sg-applied` dots (driven by that map / classList) can remain correct while prompt text disagrees.

### Root cause B1 (primary, code-proven): empty / falsy stored delta skipped

On apply, host stores only tags **not already present** in the live textarea:

```798:804:javascript/style_grid.js
                const existingNorm = {};
                (prompt.split(",").map(...)).forEach(...);
                const toAdd = [];
                (style.prompt.split(",").map(...)).forEach(function (t) {
                    if (!existingNorm[t.toLowerCase()]) { toAdd.push(t); ... }
                });
                addedPrompt = toAdd.length ? toAdd.join(", ") : "";
```

Recorded as:

```833:835:javascript/style_grid.js
        state[tabName].applied.set(styleName, {
            prompt: isPromptWrap ? null : addedPrompt,
            negative: isNegWrap ? null : addedNeg,
```

Rebuild appends only when truthy:

```3704:3707:javascript/style_grid.js
            if (r.wrapTemplate) {
                p = r.wrapTemplate.split("{prompt}").join(p);
            } else if (r.prompt) {
                p = p + (p ? ", " : "") + r.prompt;
```

If `addedPrompt === ""` (style fully overlapped by base or by tags already contributed by an earlier style), the style stays in `applied` (dot on) but contributes **nothing** on rebuild → prompt “loses” that style’s content relative to user expectation.

Simulation:

- `applied`: `{ NoobAI: {prompt:'a, b, c'}, Enhance: {prompt:''} }`  
- Rebuild → `"a, b, c"`  
- Both keys still in `applied`; Enhance invisible in prompt text.

### Root cause B2 (secondary): rebuild union is `selectedOrder ∩ applied`

```3697:3698:javascript/style_grid.js
        const order = state[tabName].selectedOrder || [];
        const orderedApplied = order.filter(function (n) { return state[tabName].applied.has(n); });
```

`SG_REORDER_STYLES` **replaces** `selectedOrder` with React’s chip list. Any name in `applied` but absent from that list is omitted from the rebuilt prompt while remaining applied on the host/grid. (Less likely in the clean “two chips, both visible” path; relevant if host/React selection ever diverges.)

### STEP 2 clean repro (two styles, no hand-edit, no wildcards)

- If both styles have **non-empty, non-overlapping** stored deltas: both survive reorder; `applied` keeps both; grid and prompt **agree**.  
- If the second style’s tags are **fully covered** by the first (or by base): both remain in `applied` / dots; rebuilt prompt may show **only** the first style’s delta → grid and prompt **disagree**. That matches live symptom B without requiring a Map deletion.

Temporary `console.log` of `applied.keys()` / `orderedApplied` was **not** left in the tree (diagnostic-only constraint). Conclusion drawn from the same control flow those logs would dump.

### Master vs wildcard branch

Same `addedPrompt` dedupe + `else if (r.prompt)` skip at `994084e`.  
**B reproduces on plain pre-wildcard master.** Wildcard branch did not introduce B.

---

## Scope summary

| Symptom | Confirmed? | Root cause | On master (`994084e`)? | Only on wildcard branch? |
|---------|------------|------------|------------------------|---------------------------|
| **A** | YES | `userPromptBase` one-shot snapshot; rebuild ignores later textarea mutations | YES | NO |
| **B** | YES (disagree grid vs prompt) | Falsy/empty stored delta skipped on rebuild; optionally `selectedOrder ∩ applied` | YES | NO |

Wildcard feature (#72) **exposes A more often** (programmatic `{sg:…}` insert after styles are applied), but the reorder rebuild design is older and unchanged aside from a trailing `syncWildcards(tabName)` call.

---

## Worktree used

- `../sd-webui-style-organizer-pre-wildcard` @ `994084e` for pre-#72 comparison.
