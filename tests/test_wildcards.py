"""Tests for stylegrid.wildcards.resolve_sg_wildcards (generation-time {sg:...} tokens).

Also covers parse_sg_token and select_slice for optional {sg:category:spec} slice specs,
plus the shared Comfy/WebUI golden fixture.
"""
from __future__ import annotations

import json
import logging
import random
from pathlib import Path
from unittest.mock import patch

import pytest

from stylegrid.wildcards import (
    _MAX_PASSES,
    DeckContext,
    parse_sg_token,
    resolve_sg_picks,
    resolve_sg_wildcards,
    select_slice,
)

_BODY_CASE_FIXTURE = {
    "body": [
        {
            "name": "BODY_A",
            "prompt": "tag_a",
            "negative_prompt": "neg_a",
        },
        {
            "name": "BODY_B",
            "prompt": "tag_b",
            "negative_prompt": "neg_b",
        },
        {
            "name": "BODY_C",
            "prompt": "tag_c",
            "negative_prompt": "neg_c",
        },
    ],
}

_GOLDEN_PATH = Path(__file__).resolve().parent / "fixtures" / "sg_wildcard_golden.json"
_FIELD_BY_CASE = {"pos": "prompt", "neg": "negative_prompt"}


def _load_golden():
    with _GOLDEN_PATH.open(encoding="utf-8") as f:
        return json.load(f)


GOLDEN = _load_golden()


def _styles_from_names(names):
    return [{"name": n, "prompt": "p::" + n} for n in names]


def test_replaces_with_random_style_prompt():
    styles_by = {
        "accessory": [
            {"prompt": "picked_prompt"},
            {"prompt": "other"},
        ]
    }
    with patch("stylegrid.wildcards.random.choice", lambda seq: seq[0]):
        assert resolve_sg_wildcards("prefix {sg:accessory} suffix", styles_by) == (
            "prefix picked_prompt suffix"
        )


def test_unknown_category_strips_token_after_max_passes_with_warning(caplog):
    styles_by = {"animal": [{"prompt": "x"}]}
    with caplog.at_level(logging.WARNING, logger="StyleGrid"):
        assert resolve_sg_wildcards("{sg:missing}", styles_by) == ""
    assert any(
        "nested {sg:} unresolved after" in rec.message and "stripping leftovers" in rec.message
        for rec in caplog.records
    )


def test_category_match_is_case_insensitive():
    styles_by = {"accessory": [{"prompt": "low"}]}
    with patch("stylegrid.wildcards.random.choice", lambda seq: seq[0]):
        assert resolve_sg_wildcards("{sg:ACCESSORY}", styles_by) == "low"


def test_empty_prompt_resolves_to_empty_string():
    styles_by = {"x": [{"prompt": ""}]}
    with patch("stylegrid.wildcards.random.choice", lambda seq: seq[0]):
        assert resolve_sg_wildcards("{sg:x}", styles_by) == ""


def test_parse_sg_token_plain_category_returns_no_spec():
    assert parse_sg_token("body") == ("body", None)


def test_parse_sg_token_splits_on_first_colon_and_lowercases_category():
    assert parse_sg_token("BODY:Tanned,Shortstack") == ("body", "Tanned,Shortstack")


def test_parse_sg_token_spec_may_contain_a_colon():
    assert parse_sg_token("body:Tanned:extra") == ("body", "Tanned:extra")


def test_select_slice_include_list_selects_named_styles():
    candidates = _styles_from_names(["BODY_Tanned", "BODY_Shortstack", "BODY_Pale"])
    result = select_slice(candidates, "body", "Tanned,Shortstack")
    assert [s["name"] for s in result] == ["BODY_Tanned", "BODY_Shortstack"]


def test_select_slice_exclude_entries_subtract_from_full_category():
    candidates = _styles_from_names(["BODY_Tanned", "BODY_Shortstack", "BODY_Pale"])
    result = select_slice(candidates, "body", "-Tanned")
    assert [s["name"] for s in result] == ["BODY_Shortstack", "BODY_Pale"]


def test_select_slice_glob_include_selects_every_name_under_root():
    candidates = _styles_from_names(["BODY_Male_A", "BODY_Male_BBC", "BODY_Female_A"])
    result = select_slice(candidates, "body", "Male_*")
    assert [s["name"] for s in result] == ["BODY_Male_A", "BODY_Male_BBC"]


def test_select_slice_glob_exclude_removes_every_name_under_root():
    candidates = _styles_from_names(["BODY_Male_A", "BODY_Male_BBC", "BODY_Female_A"])
    result = select_slice(candidates, "body", "-Male_*")
    assert [s["name"] for s in result] == ["BODY_Female_A"]


def test_select_slice_include_and_exclude_combined():
    candidates = _styles_from_names(
        ["BODY_Male_A", "BODY_Male_BBC", "BODY_Male_B", "BODY_Female_A"]
    )
    result = select_slice(candidates, "body", "Male_*,-Male_BBC")
    assert [s["name"] for s in result] == ["BODY_Male_A", "BODY_Male_B"]


def test_select_slice_matches_names_case_insensitively_without_category_prefix():
    candidates = _styles_from_names(["BODY_Tanned"])
    result = select_slice(candidates, "body", "tanned")
    assert [s["name"] for s in result] == ["BODY_Tanned"]


def test_select_slice_unknown_name_matches_nothing_and_does_not_raise():
    candidates = _styles_from_names(["BODY_Tanned"])
    result = select_slice(candidates, "body", "NoSuchStyle")
    assert result == []


def test_resolve_sg_wildcards_with_spec_picks_only_from_sliced_pool():
    candidates = _styles_from_names(["BODY_Tanned", "BODY_Shortstack", "BODY_Pale"])
    styles_by = {"body": candidates}
    seen = {}

    def choose_first(seq):
        seen["pool"] = list(seq)
        return seq[0]

    with patch("stylegrid.wildcards.random.choice", choose_first):
        result = resolve_sg_wildcards("{sg:body:Tanned,Shortstack}", styles_by)

    assert [s["name"] for s in seen["pool"]] == ["BODY_Tanned", "BODY_Shortstack"]
    assert result == "p::BODY_Tanned"


def test_resolve_sg_wildcards_empty_slice_resolves_to_empty_with_warning(caplog):
    candidates = _styles_from_names(["BODY_Tanned", "BODY_Pale"])
    styles_by = {"body": candidates}

    with caplog.at_level(logging.WARNING, logger="StyleGrid"):
        with patch("stylegrid.wildcards.random.choice") as choice:
            result = resolve_sg_wildcards("{sg:body:Ghost,Missing}", styles_by)
            choice.assert_not_called()

    assert result == ""
    assert any(
        "{sg:body:Ghost,Missing} matches no styles; resolved to empty" in rec.message
        for rec in caplog.records
    )


def test_plain_sg_token_behaves_as_before():
    styles_by = {
        "accessory": [
            {"prompt": "picked_prompt"},
            {"prompt": "other"},
        ]
    }
    seen = {}

    def choose_first(seq):
        seen["pool"] = seq
        return seq[0]

    with patch("stylegrid.wildcards.random.choice", choose_first):
        result = resolve_sg_wildcards("prefix {sg:accessory} suffix", styles_by)

    assert seen["pool"] is styles_by["accessory"]
    assert result == "prefix picked_prompt suffix"


def test_sg_prefix_case_insensitive_slice_resolves_like_lowercase():
    styles_by = _BODY_CASE_FIXTURE
    assert resolve_sg_wildcards("{SG:BODY:A}", styles_by) == "tag_a"
    assert resolve_sg_wildcards("{Sg:body:a}", styles_by) == "tag_a"


def test_sgd_prefix_case_insensitive_deck_matches_lowercase():
    styles_by = _BODY_CASE_FIXTURE
    base_seed = 12345
    for image_index in range(6):
        deck = DeckContext(base_seed=base_seed, image_index=image_index)
        lower, _ = resolve_sg_picks("{sgd:BODY}", styles_by, deck=deck)
        upper, _ = resolve_sg_picks("{SGD:BODY}", styles_by, deck=deck)
        assert upper == lower


def test_sg_prefix_case_insensitive_pairing_identity():
    styles_by = _BODY_CASE_FIXTURE
    allowed = {("tag_a", "neg_a"), ("tag_b", "neg_b")}
    for seed in range(80):
        rng = random.Random(seed)
        pos, picks = resolve_sg_picks(
            "{SG:BODY:A,B}", styles_by, rng=rng
        )
        neg, _ = resolve_sg_picks(
            "{sg:BODY:A,B}",
            styles_by,
            field="negative_prompt",
            paired=picks,
            rng=random.Random(seed),
        )
        assert (pos, neg) in allowed

        rng = random.Random(seed)
        pos, picks = resolve_sg_picks(
            "{sg:BODY:A,B}", styles_by, rng=rng
        )
        neg, _ = resolve_sg_picks(
            "{SG:BODY:A,B}",
            styles_by,
            field="negative_prompt",
            paired=picks,
            rng=random.Random(seed),
        )
        assert (pos, neg) in allowed


# --- Golden fixture (shared R2/R3 resolver contract) ---------------------------


def test_max_passes_is_three():
    assert _MAX_PASSES == 3


def test_sg_wildcard_golden_fixture_is_well_formed():
    assert GOLDEN["cases"]
    required = {
        "id",
        "input",
        "field",
        "styles_fixture",
        "seed",
        "expected_output",
        "expected_warnings",
    }
    ids = []
    for case in GOLDEN["cases"]:
        assert required <= set(case)
        assert case["field"] in _FIELD_BY_CASE
        assert isinstance(case["styles_fixture"], dict)
        assert isinstance(case["seed"], int)
        assert isinstance(case["expected_output"], str)
        assert isinstance(case["expected_warnings"], list)
        ids.append(case["id"])
    assert len(ids) == len(set(ids))


@pytest.mark.parametrize(
    "case",
    GOLDEN["cases"],
    ids=[case["id"] for case in GOLDEN["cases"]],
)
def test_sg_wildcard_golden_case(case, caplog):
    field = _FIELD_BY_CASE[case["field"]]
    with caplog.at_level(logging.WARNING, logger="StyleGrid"):
        result = resolve_sg_wildcards(
            case["input"],
            case["styles_fixture"],
            field=field,
            rng=random.Random(case["seed"]),
        )
    assert result == case["expected_output"]
    warnings = [rec.getMessage() for rec in caplog.records if rec.name == "StyleGrid"]
    assert warnings == case["expected_warnings"]
