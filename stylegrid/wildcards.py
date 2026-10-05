"""{sg:...} / {sgd:...} wildcard resolution in prompts."""

from __future__ import annotations

import random
import re
from collections.abc import Sequence
from dataclasses import dataclass

from stylegrid.deck import deck_position

TOKEN_SG = "sg"
TOKEN_SGD = "sgd"
TOKEN_PATTERN = re.compile(r"\{(sgd?):([^}]+)\}")
SPEC_ENTRY_SEPARATOR = ","
DECK_ID_SEPARATOR = "|"


@dataclass(frozen=True)
class DeckContext:
    base_seed: int
    image_index: int


def parse_sg_token(inner):
    """Parse text between ``{sg:`` / ``{sgd:`` and ``}`` into ``(category, spec)``.

    Split on the first ``:`` only. Category is lowercased and stripped.
    Spec is the remainder stripped, or ``None`` when absent/empty.
    """
    left, sep, right = inner.partition(":")
    category = left.strip().lower()
    if not sep:
        return category, None
    spec = right.strip()
    return category, spec or None


def normalize_deck_spec(spec: str | None) -> str:
    if spec is None:
        return ""
    parts = [p.strip() for p in spec.lower().split(SPEC_ENTRY_SEPARATOR)]
    parts = [p for p in parts if p]
    parts.sort()
    return SPEC_ENTRY_SEPARATOR.join(parts)


def build_deck_pool(pool: Sequence[dict]) -> list[dict]:
    """Dedupe by (prompt, negative_prompt), keep first, then sort by that key."""
    seen: set[tuple[str, str]] = set()
    unique: list[dict] = []
    for entry in pool:
        key = (entry.get("prompt") or "", entry.get("negative_prompt") or "")
        if key in seen:
            continue
        seen.add(key)
        unique.append(entry)
    unique.sort(key=lambda e: (e.get("prompt") or "", e.get("negative_prompt") or ""))
    return unique


def _full_name(category, suffix):
    return f"{category.upper()}_{suffix}"


def _name_matches(candidate_name, pattern, is_glob):
    name = (candidate_name or "").lower()
    pat = pattern.lower()
    if is_glob:
        return name.startswith(pat)
    return name == pat


def select_slice(candidates, category, spec):
    """Filter ``candidates`` by a comma-separated include/exclude/glob ``spec``.

    Names in the spec omit the category prefix; comparison uses
    ``category.upper() + "_" + suffix`` (case-insensitive).

    If any include entries exist, start from their union; otherwise start from
    all candidates. Then remove everything matched by exclude entries.
    """
    if not spec:
        return list(candidates)

    includes = []
    excludes = []
    for raw in spec.split(SPEC_ENTRY_SEPARATOR):
        entry = raw.strip()
        if not entry:
            continue
        is_exclude = entry.startswith("-")
        body = entry[1:].strip() if is_exclude else entry
        if not body:
            continue
        is_glob = body.endswith("*")
        suffix = body[:-1] if is_glob else body
        pattern = _full_name(category, suffix)
        bucket = excludes if is_exclude else includes
        bucket.append((pattern, is_glob))

    if includes:
        selected = []
        seen = set()
        for c in candidates:
            cname = c.get("name", "")
            for pattern, is_glob in includes:
                if _name_matches(cname, pattern, is_glob):
                    ident = id(c)
                    if ident not in seen:
                        seen.add(ident)
                        selected.append(c)
                    break
    else:
        selected = list(candidates)

    if not excludes:
        return selected

    result = []
    for c in selected:
        cname = c.get("name", "")
        if any(_name_matches(cname, pattern, is_glob) for pattern, is_glob in excludes):
            continue
        result.append(c)
    return result


def _count_sgd_occurrences(prompt: str) -> dict[tuple[str, str], int]:
    totals: dict[tuple[str, str], int] = {}
    for m in TOKEN_PATTERN.finditer(prompt):
        if m.group(1) != TOKEN_SGD:
            continue
        category, spec = parse_sg_token(m.group(2))
        key = (category, normalize_deck_spec(spec))
        totals[key] = totals.get(key, 0) + 1
    return totals


def _field_value(style: dict, field: str, raw_token: str) -> str:
    value = style.get(field, "")
    if value:
        return value
    # Empty negative field is a successful resolve to nothing — do not leave the
    # raw token sitting in the negative prompt. Positive behaviour is unchanged.
    return raw_token if field == "prompt" else ""


def resolve_sg_wildcards(
    prompt,
    styles_by_category,
    field="prompt",
    *,
    deck: DeckContext | None = None,
):
    """Replace `{sg:CATEGORY}` / `{sgd:CATEGORY}` tokens with style fields.

    ``field`` selects which side of the picked style is used (e.g. ``"prompt"``
    or ``"negative_prompt"``).

    Optional slice: ``{sg:CATEGORY:spec}`` / ``{sgd:CATEGORY:spec}`` where
    ``spec`` is a comma-separated include/exclude/glob list (see
    ``select_slice``). Empty slices fall back to the full category. Unknown
    categories leave the raw token unchanged.

    When ``deck`` is provided, ``{sgd:...}`` draws without replacement via
    ``deck_position``. ``{sg:...}`` always uses ``random.choice``.
    """
    sgd_totals = _count_sgd_occurrences(prompt)
    sgd_running: dict[tuple[str, str], int] = {}

    def replacer(m):
        kind = m.group(1)
        inner = m.group(2)
        category, spec = parse_sg_token(inner)
        candidates = styles_by_category.get(category)

        if kind == TOKEN_SG:
            if not candidates:
                return m.group(0)
            pool = select_slice(candidates, category, spec) if spec else candidates
            if not pool:
                pool = candidates
            style = random.choice(pool)
            return _field_value(style, field, m.group(0))

        # Deck branch (sgd)
        if deck is None or not candidates:
            return m.group(0)
        pool = select_slice(candidates, category, spec) if spec else candidates
        if not pool:
            pool = candidates
        deck_pool = build_deck_pool(pool)
        deck_id = f"{category}{DECK_ID_SEPARATOR}{normalize_deck_spec(spec)}"
        key = (category, normalize_deck_spec(spec))
        occurrence_m = sgd_totals[key]
        k = sgd_running.get(key, 0)
        sgd_running[key] = k + 1
        counter = deck.image_index * occurrence_m + k
        style = deck_pool[deck_position(len(deck_pool), deck.base_seed, deck_id, counter)]
        return _field_value(style, field, m.group(0))

    return TOKEN_PATTERN.sub(replacer, prompt)
