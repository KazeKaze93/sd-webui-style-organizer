"""Batch groups share one {sg}/{sgd} expansion (process() + DeckContext group_index)."""
from __future__ import annotations

import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from stylegrid.csv_io import enrich_style
from stylegrid.prompt_ops import dedup_prompt
from stylegrid.wildcards import DeckContext, dice_rng, resolve_sg_picks

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

BODY = [
    {
        "name": "BODY_A",
        "prompt": "tag_a",
        "negative_prompt": "neg_a",
        "category_explicit": "",
        "source": "styles.csv",
        "source_file": "/packs/styles.csv",
    },
    {
        "name": "BODY_B",
        "prompt": "tag_b",
        "negative_prompt": "neg_b",
        "category_explicit": "",
        "source": "styles.csv",
        "source_file": "/packs/styles.csv",
    },
    {
        "name": "BODY_C",
        "prompt": "tag_c",
        "negative_prompt": "neg_c",
        "category_explicit": "",
        "source": "styles.csv",
        "source_file": "/packs/styles.csv",
    },
]

CAT = [
    {
        "name": "CAT_One",
        "prompt": "cat_one",
        "negative_prompt": "anti_one",
        "category_explicit": "",
        "source": "styles.csv",
        "source_file": "/packs/styles.csv",
    },
    {
        "name": "CAT_Two",
        "prompt": "cat_two",
        "negative_prompt": "anti_two",
        "category_explicit": "",
        "source": "styles.csv",
        "source_file": "/packs/styles.csv",
    },
    {
        "name": "CAT_Three",
        "prompt": "cat_three",
        "negative_prompt": "anti_three",
        "category_explicit": "",
        "source": "styles.csv",
        "source_file": "/packs/styles.csv",
    },
]


def _script(monkeypatch, styles):
    monkeypatch.setattr(style_grid, "get_cached_styles", lambda: [dict(s) for s in styles])
    return style_grid.StyleGridScript()


def _p(prompts, negatives=None, *, batch_size=1, seed=0, hr_prompts=None, hr_negatives=None):
    n = len(prompts)
    if negatives is None:
        negatives = [""] * n
    return SimpleNamespace(
        all_prompts=list(prompts),
        all_negative_prompts=list(negatives),
        all_seeds=[seed] * n,
        batch_size=batch_size,
        n_iter=max(1, (n + max(1, batch_size) - 1) // max(1, batch_size)),
        iteration=0,
        all_hr_prompts=None if hr_prompts is None else list(hr_prompts),
        all_hr_negative_prompts=None if hr_negatives is None else list(hr_negatives),
        extra_generation_params={},
    )


def _infotext_name(p, index, *, all_prompts=None):
    """Resolve INFOTEXT_STYLES callable the way create_infotext would."""
    param = p.extra_generation_params[style_grid.INFOTEXT_STYLES]
    assert callable(param)
    return param(p=p, index=index, all_prompts=p.all_prompts if all_prompts is None else all_prompts)


def _styles_by_cat(styles):
    rows = [enrich_style(dict(s)) for s in styles]
    by_cat: dict[str, list] = {}
    for s in rows:
        key = (s.get("category") or "").lower()
        by_cat.setdefault(key, []).append(s)
    return by_cat


def test_same_batch_same_expansion(monkeypatch):
    script = _script(monkeypatch, BODY)
    token = "{sg:BODY:A,B,C}"
    p = _p([token, token, token], ["", "", ""], batch_size=3, seed=7)
    script.process(p, "")

    assert p.all_prompts[0] == p.all_prompts[1] == p.all_prompts[2]
    assert p.all_negative_prompts[0] == p.all_negative_prompts[1] == p.all_negative_prompts[2]
    assert p.all_prompts[0] in ("tag_a", "tag_b", "tag_c")


def test_different_batches_may_differ(monkeypatch):
    script = _script(monkeypatch, BODY)
    token = "{sg:BODY:A,B,C}"
    prompts = [token, token, token, token]
    found = False
    for seed in range(80):
        p = _p(prompts, [""] * 4, batch_size=2, seed=seed)
        script.process(p, "")
        assert p.all_prompts[0] == p.all_prompts[1]
        assert p.all_prompts[2] == p.all_prompts[3]
        if p.all_prompts[0] != p.all_prompts[2]:
            found = True
            break
    assert found, "expected at least one seed where batch group 0 differs from group 1"


def test_same_seed_reproducible(monkeypatch):
    script = _script(monkeypatch, BODY)
    token = "{sg:BODY:A,B,C}"
    prompts = [token, token, token, token]
    p1 = _p(prompts, [""] * 4, batch_size=2, seed=11)
    p2 = _p(prompts, [""] * 4, batch_size=2, seed=11)
    script.process(p1, "")
    script.process(p2, "")
    assert p1.all_prompts == p2.all_prompts
    assert p1.all_negative_prompts == p2.all_negative_prompts


def test_batch_size_1_equals_per_index_resolve(monkeypatch):
    script = _script(monkeypatch, BODY)
    prompts = ["prefix {sg:BODY:A,B,C}", "other {sg:BODY:A,B,C}", "{sg:BODY:A,B,C} end"]
    seed = 19
    p = _p(prompts, [""] * 3, batch_size=1, seed=seed)
    script.process(p, "")

    by_cat = _styles_by_cat(BODY)
    base_seed = seed
    expected = []
    for i, text in enumerate(prompts):
        deck = DeckContext(base_seed, i)
        resolved, _ = resolve_sg_picks(
            text, by_cat, "prompt", rng=dice_rng(deck), deck=deck
        )
        expected.append(dedup_prompt(resolved))
    assert p.all_prompts == expected


def test_sgd_three_batches_pairwise_distinct(monkeypatch):
    """batch_size=2, n_iter=3 → 6 slots; deck walk makes all three groups distinct every seed."""
    script = _script(monkeypatch, CAT)
    token = "{sgd:cat}"
    prompts = [token] * 6
    for seed in range(20):
        p = _p(prompts, [""] * 6, batch_size=2, seed=seed)
        script.process(p, "")
        assert p.all_prompts[0] == p.all_prompts[1]
        assert p.all_prompts[2] == p.all_prompts[3]
        assert p.all_prompts[4] == p.all_prompts[5]
        g0, g1, g2 = p.all_prompts[0], p.all_prompts[2], p.all_prompts[4]
        assert len({g0, g1, g2}) == 3, f"seed={seed}: expected pairwise-distinct groups, got {g0!r}, {g1!r}, {g2!r}"


def test_hires_mirrors_first_pass_within_batch(monkeypatch):
    """HR text equal to raw first-pass → HR resolved equals first-pass for both images of the group."""
    script = _script(monkeypatch, BODY)
    token = "{sg:BODY:A,B,C}"
    raw = [token, token]
    p = _p(raw, ["", ""], batch_size=2, seed=5, hr_prompts=list(raw), hr_negatives=["", ""])
    script.process(p, "")

    assert p.all_prompts[0] == p.all_prompts[1]
    assert p.all_hr_prompts == p.all_prompts
    assert p.all_hr_negative_prompts == p.all_negative_prompts


def test_hires_override_same_within_batch_may_differ_across(monkeypatch):
    """HR override with {sg:…}: equal inside a group; search seeds for a cross-group difference."""
    script = _script(monkeypatch, BODY)
    token = "{sg:BODY:A,B,C}"
    prompts = ["masterpiece", "masterpiece", "masterpiece", "masterpiece"]
    hr = [token, token, token, token]
    found = False
    for seed in range(80):
        p = _p(prompts, [""] * 4, batch_size=2, seed=seed, hr_prompts=hr, hr_negatives=[""] * 4)
        script.process(p, "")
        assert p.all_hr_prompts[0] == p.all_hr_prompts[1]
        assert p.all_hr_prompts[2] == p.all_hr_prompts[3]
        if p.all_hr_prompts[0] != p.all_hr_prompts[2]:
            found = True
            break
    assert found, "expected at least one seed where HR group 0 differs from group 1"


def test_partial_last_group(monkeypatch):
    script = _script(monkeypatch, BODY)
    token = "{sg:BODY:A,B,C}"
    p = _p([token, token, token], [""] * 3, batch_size=2, seed=13)
    script.process(p, "")

    assert p.all_prompts[0] == p.all_prompts[1]
    assert p.all_prompts[2] in ("tag_a", "tag_b", "tag_c")
    names = [_infotext_name(p, i) for i in range(len(p.all_prompts))]
    assert len(names) == 3
    assert all(names)


def test_negative_token_equal_inside_batch(monkeypatch):
    """Token in the negative with paired positives: negatives match within each group."""
    script = _script(monkeypatch, BODY)
    token = "{sg:BODY:A,B,C}"
    prompts = [token, token, token, token]
    negatives = [token, token, token, token]
    p = _p(prompts, negatives, batch_size=2, seed=17)
    script.process(p, "")

    assert p.all_negative_prompts[0] == p.all_negative_prompts[1]
    assert p.all_negative_prompts[2] == p.all_negative_prompts[3]
    assert p.all_prompts[0] == p.all_prompts[1]
    assert p.all_prompts[2] == p.all_prompts[3]


def test_heterogeneous_batch_keeps_per_slot_text(monkeypatch):
    """Differing raw prompts in one batch must not collapse onto slot 0 (HEAD per-index)."""
    script = _script(monkeypatch, BODY)
    token = "{sg:BODY:A,B,C}"
    prompts = [f"a {token}", f"b {token}"]
    seed = 23
    p = _p(prompts, ["", ""], batch_size=2, seed=seed)
    script.process(p, "")

    assert p.all_prompts[0].startswith("a ")
    assert p.all_prompts[1].startswith("b ")
    by_cat = _styles_by_cat(BODY)
    expected = []
    for i, text in enumerate(prompts):
        deck = DeckContext(seed, i)
        resolved, _ = resolve_sg_picks(text, by_cat, "prompt", rng=dice_rng(deck), deck=deck)
        expected.append(dedup_prompt(resolved))
    assert p.all_prompts == expected


def test_heterogeneous_negatives_keep_prefix(monkeypatch):
    """Identical positives + differing negatives: each negative keeps its own prefix."""
    script = _script(monkeypatch, BODY)
    token = "{sg:BODY:A,B,C}"
    prompts = [token, token]
    negatives = [f"x {token}", f"y {token}"]
    p = _p(prompts, negatives, batch_size=2, seed=29)
    script.process(p, "")

    assert p.all_prompts[0] == p.all_prompts[1]
    assert p.all_negative_prompts[0].startswith("x ")
    assert p.all_negative_prompts[1].startswith("y ")


def test_heterogeneous_hires_keeps_prefix(monkeypatch):
    """Differing HR overrides in one batch keep their own prefixes (no collapse onto slot 0)."""
    script = _script(monkeypatch, BODY)
    token = "{sg:BODY:A,B,C}"
    prompts = ["masterpiece", "masterpiece"]
    hr = [f"left {token}", f"right {token}"]
    p = _p(prompts, ["", ""], batch_size=2, seed=31, hr_prompts=hr, hr_negatives=["", ""])
    script.process(p, "")

    assert p.all_hr_prompts[0].startswith("left ")
    assert p.all_hr_prompts[1].startswith("right ")
    assert "{sg:" not in p.all_hr_prompts[0]
    assert "{sg:" not in p.all_hr_prompts[1]


def test_hires_mirrors_per_slot_when_positives_heterogeneous_unpaired_neg(monkeypatch):
    """Hetero positives (no tokens) + uniform unpaired neg token: hires must mirror each slot.

    Positives not collapsed → negatives resolve per slot with DeckContext(base_seed, i).
    Raw/HR negatives stay uniform, so the collapsed hires branch must copy per-slot
    first_pass_resolved, not broadcast slot 0.
    """
    script = _script(monkeypatch, BODY)
    token = "{sg:BODY:A,B,C}"
    raw_pos = ["a", "b"]
    raw_neg = [token, token]
    found_seed = None
    for seed in range(80):
        p = _p(
            raw_pos,
            raw_neg,
            batch_size=2,
            seed=seed,
            hr_prompts=list(raw_pos),
            hr_negatives=list(raw_neg),
        )
        script.process(p, "")
        if p.all_negative_prompts[0] != p.all_negative_prompts[1]:
            found_seed = seed
            assert p.all_hr_prompts[0] == p.all_prompts[0]
            assert p.all_hr_prompts[1] == p.all_prompts[1]
            assert p.all_hr_negative_prompts[0] == p.all_negative_prompts[0]
            assert p.all_hr_negative_prompts[1] == p.all_negative_prompts[1]
            break
    assert found_seed is not None, (
        "expected a seed where first-pass negatives of slot 0 and 1 differ "
        "(otherwise the scenario is vacuous)"
    )


def _save_path_name(p, iteration, index=0):
    """Simulate Forge PNG save: batch-sliced prompts + batch-local index."""
    bs = p.batch_size
    start = iteration * bs
    batch_prompts = p.all_prompts[start : start + bs]
    p.iteration = iteration
    return _infotext_name(p, index, all_prompts=batch_prompts)


@pytest.mark.parametrize("kind", ["sg", "sgd"])
def test_infotext_save_path_uses_iteration_not_slot0(monkeypatch, kind):
    """batch_size=1, n_iter=25: save-path index=0 must return names[N], not names[0]."""
    styles = [
        {
            "name": f"BODY_{i:02d}",
            "prompt": f"tag_{i:02d}",
            "negative_prompt": f"neg_{i:02d}",
            "category_explicit": "",
            "source": "styles.csv",
            "source_file": "/packs/styles.csv",
        }
        for i in range(25)
    ]
    script = _script(monkeypatch, styles)
    token = f"{{{kind}:body}}"
    p = _p([token] * 25, [""] * 25, batch_size=1, seed=7)
    script.process(p, "")

    gallery = [_infotext_name(p, i) for i in range(25)]
    if kind == "sgd":
        assert len(set(gallery)) == 25, f"expected 25 distinct deck picks, got {len(set(gallery))}"
    differ = [n for n in range(1, 25) if gallery[n] != gallery[0]]
    assert differ, "need at least one image whose pick differs from image 0"
    for n in (0, differ[0], 24):
        assert _save_path_name(p, iteration=n, index=0) == gallery[n]


def test_styles_infotext_param_25_distinct_names_save_and_gallery():
    """Callable with 25 distinct names: gallery (global index) and PNG save path."""
    names = [f"BODY_{i:02d} (styles.csv)" for i in range(25)]
    param = style_grid._styles_infotext_param(names)
    p = SimpleNamespace(batch_size=1, iteration=0)
    for i in range(25):
        assert param(p=p, index=i, all_prompts=["x"] * 25) == names[i]
    for n in range(25):
        p.iteration = n
        assert param(p=p, index=0, all_prompts=["batch"]) == names[n]
    p.iteration = 0
    assert param(p=p, index=99, all_prompts=["x"] * 25) is None
    assert param(p=p, index=0, all_prompts=["batch"]) == names[0]


def test_infotext_save_path_batch_size_4_iteration_2_index_3(monkeypatch):
    """batch_size=4, n_iter=3: iteration=2, index=3 → global slot 11."""
    styles = [
        {
            "name": f"BODY_{i:02d}",
            "prompt": f"tag_{i:02d}",
            "negative_prompt": f"neg_{i:02d}",
            "category_explicit": "",
            "source": "styles.csv",
            "source_file": "/packs/styles.csv",
        }
        for i in range(12)
    ]
    script = _script(monkeypatch, styles)
    # Heterogeneous prompts so each slot keeps its own draw (no batch collapse).
    prompts = [f"slot{i} {{sgd:body}}" for i in range(12)]
    p = _p(prompts, [""] * 12, batch_size=4, seed=11)
    script.process(p, "")

    gallery = [_infotext_name(p, i) for i in range(12)]
    assert _save_path_name(p, iteration=2, index=3) == gallery[11]
    assert _save_path_name(p, iteration=2, index=3) != gallery[0]


def test_infotext_gallery_path_global_index(monkeypatch):
    """Processed.infotext path: full all_prompts + global index."""
    script = _script(monkeypatch, BODY)
    p = _p(["{sgd:BODY:A,B,C}"] * 3, [""] * 3, batch_size=1, seed=5)
    script.process(p, "")

    gallery = [_infotext_name(p, i) for i in range(3)]
    assert len(set(gallery)) == 3
    for i in range(3):
        assert _infotext_name(p, i, all_prompts=p.all_prompts) == gallery[i]


def test_infotext_single_image(monkeypatch):
    script = _script(monkeypatch, BODY)
    p = _p(["{sg:BODY:A,B,C}"], [""], batch_size=1, seed=2)
    script.process(p, "")
    name = _infotext_name(p, 0)
    assert name in (
        "BODY_A (styles.csv)",
        "BODY_B (styles.csv)",
        "BODY_C (styles.csv)",
    )
    assert _save_path_name(p, iteration=0, index=0) == name
