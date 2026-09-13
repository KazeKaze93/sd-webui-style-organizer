"""Tests for stylegrid.wildcards.resolve_sg_wildcards (generation-time {sg:...} tokens).

Also covers parse_sg_token and select_slice for optional {sg:category:spec} slice specs.
"""
from unittest.mock import patch

from stylegrid.wildcards import parse_sg_token, resolve_sg_wildcards, select_slice


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


def test_unknown_category_leaves_token():
    styles_by = {"animal": [{"prompt": "x"}]}
    assert resolve_sg_wildcards("{sg:missing}", styles_by) == "{sg:missing}"


def test_category_match_is_case_insensitive():
    styles_by = {"accessory": [{"prompt": "low"}]}
    with patch("stylegrid.wildcards.random.choice", lambda seq: seq[0]):
        assert resolve_sg_wildcards("{sg:ACCESSORY}", styles_by) == "low"


def test_empty_prompt_falls_back_to_original_token():
    styles_by = {"x": [{"prompt": ""}]}
    with patch("stylegrid.wildcards.random.choice", lambda seq: seq[0]):
        assert resolve_sg_wildcards("{sg:x}", styles_by) == "{sg:x}"


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


def test_resolve_sg_wildcards_stale_slice_falls_back_to_full_category():
    candidates = _styles_from_names(["BODY_Tanned", "BODY_Pale"])
    styles_by = {"body": candidates}
    seen = {}

    def choose_first(seq):
        seen["pool"] = seq
        return seq[0]

    with patch("stylegrid.wildcards.random.choice", choose_first):
        result = resolve_sg_wildcards("{sg:body:Ghost,Missing}", styles_by)

    assert seen["pool"] is candidates
    assert result == "p::BODY_Tanned"


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
