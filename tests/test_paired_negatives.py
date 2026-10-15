"""Placeholders bring the picked style's negative prompt along (process() + resolver)."""
from __future__ import annotations

import logging
import random
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from stylegrid.prompt_ops import drop_shared_tags
from stylegrid.wildcards import DeckContext, Pick, resolve_sg_picks

# --- style_grid import stubs (same pattern as test_hires_prompts) ---
sys.modules.setdefault("gradio", MagicMock())
_scripts_stub = types.ModuleType("modules.scripts")
_scripts_stub.AlwaysVisible = "AlwaysVisible"


class _Script:
    pass


_scripts_stub.Script = _Script
sys.modules["modules"].scripts = _scripts_stub
_processing_stub = types.ModuleType("modules.processing")
_processing_stub.StableDiffusionProcessing = object
sys.modules.setdefault("modules.processing", _processing_stub)

import style_grid  # noqa: E402

SEEDS = range(40)


def _style(name, prompt, negative, source="a.csv"):
    return {
        "name": name,
        "prompt": prompt,
        "negative_prompt": negative,
        "category_explicit": "",
        "source": source,
        "source_file": f"/packs/{source}",
    }


BODY = [
    _style("BODY_Tanned", "tanned skin", "pale skin"),
    _style("BODY_Pale", "pale skin", "tanned skin"),
    _style("BODY_Tall", "tall", "short"),
]
POSE = [_style("POSE_Lean", "leaning forward", "standing straight")]
HAIR = [
    _style("HAIR_Red", "red hair", "blue hair"),
    _style("HAIR_Long", "long hair", "short hair"),
    _style("HAIR_Bald", "bald", "hair"),
]


def _script(monkeypatch, styles):
    monkeypatch.setattr(style_grid, "get_cached_styles", lambda: [dict(s) for s in styles])
    return style_grid.StyleGridScript()


def _p(prompts, negatives, seed=0, hr_prompts=None, hr_negatives=None):
    return SimpleNamespace(
        all_prompts=list(prompts),
        all_negative_prompts=list(negatives),
        all_seeds=[seed + i for i in range(len(prompts))],
        all_hr_prompts=hr_prompts,
        all_hr_negative_prompts=hr_negatives,
        extra_generation_params={},
    )


def _picked(p, index=0):
    return p.extra_generation_params[style_grid.INFOTEXT_STYLES][index]


def _negative_of(styles, picked):
    by_label = {f"{s['name']} ({s['source']})": s["negative_prompt"] for s in styles}
    return by_label[picked]


@pytest.fixture
def negatives_off(monkeypatch):
    monkeypatch.setattr(style_grid.shared.opts, "data", {style_grid.OPT_STYLE_NEGATIVES: False})


def test_positive_only_placeholder_fills_empty_negative(monkeypatch):
    script = _script(monkeypatch, BODY[:1])
    p = _p(["1girl, {sg:body}"], [""])
    script.process(p, "")

    assert p.all_prompts == ["1girl, tanned skin"]
    assert p.all_negative_prompts == ["pale skin"]


def test_negative_order_user_text_then_styles_in_placeholder_order(monkeypatch):
    script = _script(monkeypatch, BODY[:1] + POSE)
    p = _p(["{sg:pose}, {sg:body}"], ["lowres"])
    script.process(p, "")

    assert p.all_negative_prompts == ["lowres, standing straight, pale skin"]


def test_nested_placeholder_negative_is_added(monkeypatch):
    outer = _style("OUTFIT_Set", "dress, {sg:pose}", "pants")
    script = _script(monkeypatch, [outer] + POSE)
    p = _p(["{sg:outfit}"], [""])
    script.process(p, "")

    assert p.all_prompts == ["dress, leaning forward"]
    assert p.all_negative_prompts == ["pants, standing straight"]


@pytest.mark.parametrize("kind", ["sg", "sgd"])
def test_negative_placeholder_pairs_with_positive_pick(monkeypatch, negatives_off, kind):
    script = _script(monkeypatch, BODY)
    for seed in SEEDS:
        p = _p([f"{{{kind}:body}}"], [f"{{{kind}:body}}, lowres"], seed=seed)
        script.process(p, "")
        assert p.all_negative_prompts == [f"{_negative_of(BODY, _picked(p))}, lowres"]


def test_pairing_holds_when_token_layout_differs(monkeypatch, negatives_off):
    script = _script(monkeypatch, BODY + HAIR)
    for seed in SEEDS:
        p = _p(["{sg:hair}, {sg:body}, {sgd:body}, {sgd:body}"] * 3, ["{sg:body}, {sgd:body}"] * 3, seed=seed)
        script.process(p, "")
        for i in range(3):
            _, sg_body, sgd_body, _ = _picked(p, i).split(", ")
            assert p.all_negative_prompts[i] == ", ".join(
                dict.fromkeys([_negative_of(BODY, sg_body), _negative_of(BODY, sgd_body)])
            )


@pytest.mark.parametrize("kind", ["sg", "sgd"])
def test_paired_placeholder_and_style_negative_collapse(monkeypatch, kind):
    script = _script(monkeypatch, BODY)
    for seed in SEEDS:
        p = _p([f"{{{kind}:body}}"], [f"{{{kind}:body}}"], seed=seed)
        script.process(p, "")
        assert p.all_negative_prompts == [_negative_of(BODY, _picked(p))]


def test_batch_negatives_follow_each_image_pick(monkeypatch):
    script = _script(monkeypatch, BODY)
    p = _p(["{sgd:body}"] * 6, ["lowres"] * 6, seed=100)
    script.process(p, "")

    picked = p.extra_generation_params[style_grid.INFOTEXT_STYLES]
    assert len(set(picked[:3])) == 3
    for i in range(6):
        assert p.all_negative_prompts[i] == f"lowres, {_negative_of(BODY, picked[i])}"


def test_hires_mirrored_prompts_reuse_pick_and_negative(monkeypatch):
    script = _script(monkeypatch, BODY)
    for seed in SEEDS:
        p = _p(["{sg:body}"], [""], seed=seed, hr_prompts=["{sg:body}"], hr_negatives=[""])
        script.process(p, "")
        assert p.all_hr_prompts == p.all_prompts
        assert p.all_hr_negative_prompts == p.all_negative_prompts == [_negative_of(BODY, _picked(p))]


def test_hires_prompt_override_reuses_first_pass_pick(monkeypatch):
    script = _script(monkeypatch, BODY)
    for seed in SEEDS:
        p = _p(["{sg:body}"], [""], seed=seed, hr_prompts=["{sg:body}, upscaled"], hr_negatives=[""])
        script.process(p, "")
        assert p.all_hr_prompts == [f"{p.all_prompts[0]}, upscaled"]
        assert p.all_hr_negative_prompts == p.all_negative_prompts


def test_hires_override_with_extra_token_keeps_pick_and_adds_its_negative(monkeypatch):
    script = _script(monkeypatch, BODY + HAIR)
    for seed in SEEDS:
        p = _p(["{sg:body}"], [""], seed=seed, hr_prompts=["{sg:hair}, {sg:body}"], hr_negatives=[""])
        script.process(p, "")
        body = p.all_prompts[0]
        hair = p.all_hr_prompts[0].removesuffix(f", {body}")
        assert p.all_hr_prompts[0] == f"{hair}, {body}"
        hair_negative = next(s["negative_prompt"] for s in HAIR if s["prompt"] == hair)
        assert p.all_hr_negative_prompts == [f"{hair_negative}, {p.all_negative_prompts[0]}"]


def test_hires_negative_override_gets_style_negatives(monkeypatch):
    script = _script(monkeypatch, BODY)
    p = _p(["{sg:body}"], [""], seed=3, hr_prompts=["{sg:body}"], hr_negatives=["worst quality"])
    script.process(p, "")

    assert p.all_hr_negative_prompts == [f"worst quality, {_negative_of(BODY, _picked(p))}"]


def test_all_sources_ambiguous_name_uses_negative_of_the_picked_source(monkeypatch):
    styles = [
        _style("BODY_Tanned", "tanned skin", "neg-a", source="a.csv"),
        _style("BODY_Tanned", "tanned skin", "neg-b", source="b.csv"),
    ]
    script = _script(monkeypatch, styles)
    seen = set()
    for seed in SEEDS:
        p = _p(["{sg:body:Tanned}"], [""], seed=seed)
        script.process(p, "")
        picked = _picked(p)
        seen.add(picked)
        assert p.all_negative_prompts == [_negative_of(styles, picked)]
    assert seen == {"BODY_Tanned (a.csv)", "BODY_Tanned (b.csv)"}


def test_negative_tag_already_in_positive_is_dropped_and_logged(monkeypatch, caplog):
    styles = [
        _style("SKIN_Tan", "tanned skin, (freckles:1.2)", "pale skin"),
        _style("DETAIL_Clean", "smooth skin", "Freckles, blurry"),
    ]
    script = _script(monkeypatch, styles)
    p = _p(["{sg:skin}, {sg:detail}"], ["lowres, smooth skin"])
    with caplog.at_level(logging.INFO, logger="StyleGrid"):
        script.process(p, "")

    assert p.all_negative_prompts == ["lowres, pale skin, blurry"]
    dropped = [rec.getMessage() for rec in caplog.records if "dropped from negative" in rec.getMessage()]
    assert dropped == ["[Style Grid] image 0: dropped from negative, also in positive: smooth skin, Freckles"]


def test_prompt_without_placeholders_is_not_filtered(monkeypatch):
    script = _script(monkeypatch, BODY)
    p = _p(["red hair"], ["red hair"])
    script.process(p, "")

    assert p.all_negative_prompts == ["red hair"]
    assert p.extra_generation_params == {}


def test_setting_off_keeps_negative_as_typed(monkeypatch, negatives_off):
    styles = [_style("SKIN_Tan", "tanned skin", "pale skin")]
    script = _script(monkeypatch, styles)
    p = _p(["{sg:skin}"], ["lowres, tanned skin"])
    script.process(p, "")

    assert p.all_negative_prompts == ["lowres, tanned skin"]
    assert p.extra_generation_params[style_grid.INFOTEXT_STYLE_NEGATIVES] is False


def test_sg_picks_are_deterministic_by_seed(monkeypatch):
    script = _script(monkeypatch, BODY)

    def run(seed):
        p = _p(["{sg:body}, {sg:body}"], [""], seed=seed)
        script.process(p, "")
        return p.all_prompts, p.all_negative_prompts

    random.seed(1)
    first = [run(seed) for seed in SEEDS]
    random.seed(2)
    second = [run(seed) for seed in SEEDS]
    assert first == second
    assert len({prompts[0] for prompts, _ in first}) > 1


def test_infotext_lists_picked_styles_per_image(monkeypatch):
    script = _script(monkeypatch, BODY[:1] + POSE)
    p = _p(["{sg:body}, {sg:pose}", "plain"], ["", ""])
    script.process(p, "")

    assert p.extra_generation_params == {
        style_grid.INFOTEXT_STYLES: ["BODY_Tanned (a.csv), POSE_Lean (a.csv)", None],
        style_grid.INFOTEXT_STYLE_NEGATIVES: True,
    }


def test_setting_is_registered_off_by_default(monkeypatch):
    shared = SimpleNamespace(opts=MagicMock(), OptionInfo=lambda default, label, **kw: (default, kw))
    monkeypatch.setattr(style_grid, "shared", shared)
    style_grid._on_ui_settings()

    key, (default, kw) = shared.opts.add_option.call_args.args
    assert key == style_grid.OPT_STYLE_NEGATIVES
    assert default is False
    assert kw["infotext"] == style_grid.INFOTEXT_STYLE_NEGATIVES


def test_default_off_skips_style_negatives_and_records_false(monkeypatch):
    """When the option is missing from opts.data, the fallback is False (same as the registered default)."""
    monkeypatch.setattr(style_grid.shared.opts, "data", {})
    styles = [_style("SKIN_Tan", "tanned skin", "pale skin")]
    script = _script(monkeypatch, styles)
    p = _p(["{sg:skin}"], ["lowres"])
    script.process(p, "")

    assert p.all_negative_prompts == ["lowres"]
    assert p.extra_generation_params[style_grid.INFOTEXT_STYLE_NEGATIVES] is False


def test_resolve_sg_picks_reuses_paired_picks_then_draws():
    styles = {"cat": [{"name": f"CAT_{i}", "prompt": f"p{i}", "negative_prompt": f"n{i}"} for i in range(4)]}
    deck = DeckContext(9, 0)
    text, picks = resolve_sg_picks("{sgd:cat}", styles, deck=deck)
    assert [pick.key for pick in picks] == [("sgd", "cat", "")]

    neg, neg_picks = resolve_sg_picks(
        "{sgd:cat} {sgd:cat}", styles, "negative_prompt", deck=deck, paired=picks
    )
    first, second = neg.split()
    assert first == picks[0].style["negative_prompt"]
    assert second != first
    assert neg_picks[0] == Pick(picks[0].key, picks[0].style)


def test_drop_shared_tags_uses_dedup_identity():
    kept, dropped = drop_shared_tags(
        "Blurry, (pale skin:0.8), BREAK, <lora:x:1>, lowres", "blurry, pale skin, break, <LORA:x:1>"
    )
    assert kept == "BREAK, lowres"
    assert dropped == ["Blurry", "(pale skin:0.8)", "<lora:x:1>"]
