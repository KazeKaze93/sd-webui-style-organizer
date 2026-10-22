"""
Style Grid - Grid/Gallery style selector for Stable Diffusion WebUI Forge
Replaces the clunky dropdown with a visual grid organized by categories.

Implementation lives in the `stylegrid` package; this file is the Forge script entry point.
"""

import json
import logging

import gradio as gr  # type: ignore[reportMissingImports]
from modules import script_callbacks, scripts  # type: ignore[reportMissingImports]
from modules.processing import StableDiffusionProcessing  # type: ignore[reportMissingImports]

from stylegrid.cache import get_cached_styles
from stylegrid.csv_io import categorize_styles, load_all_styles, normalize_source_path
from stylegrid.data_files import load_presets
from stylegrid.lora_scan import LORA_SOURCE
from stylegrid.prompt_ops import dedup_prompt, drop_shared_tags
from stylegrid.routes import register_api
from stylegrid.wildcards import DeckContext, dice_rng, resolve_sg_picks
from stylegrid.write_auth import WRITE_TOKEN_JS_GLOBAL, get_session_token, is_public_bind

script_callbacks.on_app_started(register_api)

logger = logging.getLogger("StyleGrid")

DECK_FALLBACK_SEED = 0
INFOTEXT_STYLES = "Style Grid styles"


def _deck_base_seed(p) -> int:
    """Prefer p.all_seeds[0]; p.seed is still -1 when AlwaysVisible process() runs."""
    if getattr(p, "all_seeds", None):
        return int(p.all_seeds[0])
    return DECK_FALLBACK_SEED


def _batch_size_of(p) -> int:
    """Forge batch size; groups of this many prompt slots share one wildcard expansion."""
    try:
        return max(1, int(getattr(p, "batch_size", 1) or 1))
    except (TypeError, ValueError):
        return 1


def _uniform(texts, start: int, end: int) -> bool:
    """True when every texts[i] for i in [start, end) equals texts[start]."""
    if start >= end:
        return True
    first = texts[start]
    return all(texts[i] == first for i in range(start + 1, end))


def _resolve_entry(text, styles_by_cat, field, deck, paired=()):
    """Resolve one prompt string; returns the deduped text and its picks."""
    rng = dice_rng(deck) if deck is not None else None
    resolved, picks = resolve_sg_picks(text, styles_by_cat, field, rng=rng, deck=deck, paired=paired)
    return dedup_prompt(resolved), picks


def _resolve_hires_prompts(
    hr_prompts,
    first_pass_raw,
    first_pass_resolved,
    styles_by_cat,
    field,
    base_seed: int | None = None,
    first_pass_picks=None,
    batch_size: int = 1,
):
    """Resolve wildcards in a hires-pass prompt list, in place; return each entry's picks.

    Forge builds the hires lists in setup_prompts(), before scripts run, and fills
    them from the first-pass prompt when the "Hires prompt" box is left empty. An
    entry that still matches the unresolved first-pass text reuses the first-pass
    result so both passes draw the same styles; a real override is resolved on its
    own, reusing ``first_pass_picks`` for the tokens it shares with the first pass.
    Uniform batches share one expansion (``group_index``); mixed slots keep HEAD
    per-index resolution with ``DeckContext(base_seed, i)``.
    """
    hr_picks = [None] * len(hr_prompts)
    batch_size = max(1, int(batch_size or 1))
    for start in range(0, len(hr_prompts), batch_size):
        end = min(start + batch_size, len(hr_prompts))
        group_index = start // batch_size
        first_pass_uniform = (
            end <= len(first_pass_raw) and _uniform(first_pass_raw, start, end)
        )
        if _uniform(hr_prompts, start, end) and first_pass_uniform:
            text = hr_prompts[start]
            paired = first_pass_picks[start] if first_pass_picks else []
            if start < len(first_pass_raw) and text == first_pass_raw[start]:
                # Raw HR matches first-pass raw: reuse each slot's own first-pass
                # result (first_pass_resolved may differ per slot when positives
                # were heterogeneous and this list stayed uniform).
                for i in range(start, end):
                    hr_prompts[i] = first_pass_resolved[i]
                    hr_picks[i] = first_pass_picks[i] if first_pass_picks else []
            else:
                deck = DeckContext(base_seed, group_index) if base_seed is not None else None
                resolved, picks = _resolve_entry(text, styles_by_cat, field, deck, paired)
                for i in range(start, end):
                    hr_prompts[i] = resolved
                    hr_picks[i] = picks
        else:
            for i in range(start, end):
                paired = first_pass_picks[i] if first_pass_picks else []
                if i < len(first_pass_raw) and hr_prompts[i] == first_pass_raw[i]:
                    hr_prompts[i] = first_pass_resolved[i]
                    hr_picks[i] = paired
                else:
                    deck = DeckContext(base_seed, i) if base_seed is not None else None
                    hr_prompts[i], picks = _resolve_entry(
                        hr_prompts[i], styles_by_cat, field, deck, paired
                    )
                    hr_picks[i] = picks
    return hr_picks


def _add_style_negatives(negatives, picks_by_index):
    """Append the picked styles' negative_prompt after the user's text, in token order."""
    for i, picks in enumerate(picks_by_index):
        parts = [negatives[i], *(pick.style.get("negative_prompt") or "" for pick in picks)]
        negatives[i] = ", ".join(part for part in parts if part)


def _drop_positive_tags(negatives, positives, picks_by_index):
    """A negative tag equal to a tag of the expanded positive would cancel it: drop it."""
    for i, picks in enumerate(picks_by_index):
        if not picks:
            continue
        negatives[i], dropped = drop_shared_tags(negatives[i], positives[i])
        if dropped:
            logger.info(
                "[Style Grid] image %d: dropped from negative, also in positive: %s",
                i,
                ", ".join(dropped),
            )


def _styles_infotext(picks):
    names = [f"{pick.style.get('name', '')} ({pick.style.get('source', '')})" for pick in picks]
    return ", ".join(names) or None


class StyleGridScript(scripts.Script):
    def title(self):
        return "Style Grid"

    def show(self, is_img2img):
        return scripts.AlwaysVisible

    def ui(self, is_img2img):
        tab_prefix = "img2img" if is_img2img else "txt2img"
        styles = load_all_styles()
        categories = categorize_styles(styles)
        styles_json = json.dumps({
            "categories": categories,
            "presets": load_presets(),
        }, ensure_ascii=False)
        write_token = get_session_token() if is_public_bind() else ""
        with gr.Group(elem_id=f"style_grid_wrapper_{tab_prefix}", visible=False):
            # JS-only bridge: Gradio must construct this for elem_id; Python never reads it.
            gr.Textbox(value=styles_json, visible=False, elem_id=f"style_grid_data_{tab_prefix}")
            source_filter = gr.Textbox(value="", visible=False, elem_id=f"style_grid_source_{tab_prefix}")
            # Per-session write token for --listen/--share (empty on localhost-only).
            gr.HTML(
                f"<script>window.{WRITE_TOKEN_JS_GLOBAL}={json.dumps(write_token)};</script>",
                visible=False,
                elem_id=f"style_grid_write_token_{tab_prefix}",
            )
        return [source_filter]

    def process(self, p: StableDiffusionProcessing, *args):
        """Resolve {sg:...} wildcards at generation time and add the picked styles' negatives."""
        all_styles = list(get_cached_styles())
        categorize_styles(all_styles)

        # args[0] = active source filter passed from UI ("" means All Sources)
        active_source = (args[0] if len(args) >= 1 else "") or ""
        if active_source:
            wildcard_pool = [
                s for s in all_styles
                if normalize_source_path(s.get("source_file") or "") == normalize_source_path(active_source)
            ]
            if not wildcard_pool:           # unknown source — fall back to all
                wildcard_pool = all_styles
        else:
            wildcard_pool = all_styles      # All Sources selected

        styles_by_cat = {}
        for s in wildcard_pool:
            if s.get("source_file") == LORA_SOURCE:
                continue  # LoRA is source-independent — handled below from all_styles
            key = (s.get("category") or "").lower()
            styles_by_cat.setdefault(key, []).append(s)

        # LoRA: always source-independent. Root-level files use category "LoRA";
        # subfoldered files use their subfolder name as category (set at scan
        # time in lora_scan.py). Both get bucketed here from the full library,
        # plus a "lora" aggregate covering every LoRA regardless of subfolder.
        lora_styles = [s for s in all_styles if s.get("source_file") == LORA_SOURCE]
        for s in lora_styles:
            key = (s.get("category") or "").lower()
            styles_by_cat.setdefault(key, []).append(s)
        if lora_styles:
            styles_by_cat["lora"] = lora_styles

        base_seed = _deck_base_seed(p)
        batch_size = _batch_size_of(p)

        first_pass_raw = list(p.all_prompts)
        first_pass_picks = [None] * len(first_pass_raw)
        collapsed_groups: set[int] = set()
        for start in range(0, len(first_pass_raw), batch_size):
            end = min(start + batch_size, len(first_pass_raw))
            group_index = start // batch_size
            if _uniform(first_pass_raw, start, end):
                collapsed_groups.add(start)
                resolved, picks = _resolve_entry(
                    first_pass_raw[start],
                    styles_by_cat,
                    "prompt",
                    DeckContext(base_seed, group_index),
                )
                for i in range(start, end):
                    p.all_prompts[i] = resolved
                    first_pass_picks[i] = picks
            else:
                for i in range(start, end):
                    p.all_prompts[i], first_pass_picks[i] = _resolve_entry(
                        first_pass_raw[i], styles_by_cat, "prompt", DeckContext(base_seed, i)
                    )

        _add_style_negatives(p.all_negative_prompts, first_pass_picks)
        first_pass_raw_negative = list(p.all_negative_prompts)
        for start in range(0, len(first_pass_raw_negative), batch_size):
            end = min(start + batch_size, len(first_pass_raw_negative))
            group_index = start // batch_size
            if start in collapsed_groups and _uniform(first_pass_raw_negative, start, end):
                resolved, _ = _resolve_entry(
                    first_pass_raw_negative[start],
                    styles_by_cat,
                    "negative_prompt",
                    DeckContext(base_seed, group_index),
                    first_pass_picks[start],
                )
                for i in range(start, end):
                    p.all_negative_prompts[i] = resolved
            else:
                for i in range(start, end):
                    p.all_negative_prompts[i], _ = _resolve_entry(
                        first_pass_raw_negative[i],
                        styles_by_cat,
                        "negative_prompt",
                        DeckContext(base_seed, i),
                        first_pass_picks[i],
                    )
        _drop_positive_tags(p.all_negative_prompts, p.all_prompts, first_pass_picks)

        # Hires fix samples its second pass from all_hr_prompts / all_hr_negative_prompts;
        # without this the {sg:...} tokens reach the model as literal text. Both lists are
        # None unless hires fix is on (and absent entirely in img2img).
        hr_prompts = getattr(p, "all_hr_prompts", None)
        hr_picks = first_pass_picks
        if hr_prompts:
            hr_picks = _resolve_hires_prompts(
                hr_prompts,
                first_pass_raw,
                p.all_prompts,
                styles_by_cat,
                "prompt",
                base_seed,
                first_pass_picks,
                batch_size,
            )
        hr_negative_prompts = getattr(p, "all_hr_negative_prompts", None)
        if hr_negative_prompts:
            _add_style_negatives(hr_negative_prompts, hr_picks)
            _resolve_hires_prompts(
                hr_negative_prompts,
                first_pass_raw_negative,
                p.all_negative_prompts,
                styles_by_cat,
                "negative_prompt",
                base_seed,
                hr_picks,
                batch_size,
            )
            _drop_positive_tags(hr_negative_prompts, hr_prompts or p.all_prompts, hr_picks)

        extra_params = getattr(p, "extra_generation_params", None)
        if extra_params is not None and any(first_pass_picks):
            extra_params[INFOTEXT_STYLES] = [_styles_infotext(picks) for picks in first_pass_picks]
