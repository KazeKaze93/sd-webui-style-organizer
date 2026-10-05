"""normalize_wildcard_entry / normalize_presets keep optional deck kind."""

from __future__ import annotations

from stylegrid.data_files import normalize_presets, normalize_wildcard_entry
from stylegrid.wildcards import TOKEN_SGD


def test_kind_sgd_kept_and_normalized() -> None:
    assert normalize_wildcard_entry(
        {"category": "POSE", "spec": "", "kind": "sgd"}
    ) == {"category": "POSE", "spec": "", "kind": TOKEN_SGD}
    assert normalize_wildcard_entry(
        {"category": "POSE", "spec": "A,B", "kind": " SGD "}
    ) == {"category": "POSE", "spec": "A,B", "kind": TOKEN_SGD}


def test_non_deck_kinds_omit_kind_key() -> None:
    for kind in ("sg", "", None, 5, "bogus"):
        out = normalize_wildcard_entry(
            {"category": "BODY", "spec": "Tanned", "kind": kind}
        )
        assert out == {"category": "BODY", "spec": "Tanned"}
        assert "kind" not in out


def test_entry_without_kind_matches_pre_change_shape() -> None:
    assert normalize_wildcard_entry({"category": "ACCESSORY", "spec": "Item0"}) == {
        "category": "ACCESSORY",
        "spec": "Item0",
    }


def test_normalize_presets_round_trip_keeps_dice_and_deck() -> None:
    presets = {
        "Mix": {
            "styles": [],
            "wildcards": [
                {"category": "POSE", "spec": ""},
                {"category": "BODY", "spec": "Male_*", "kind": "sgd"},
            ],
            "note": "",
            "created": "2026-01-01T00:00:00",
        }
    }
    out = normalize_presets(presets)
    assert out["Mix"]["wildcards"] == [
        {"category": "POSE", "spec": ""},
        {"category": "BODY", "spec": "Male_*", "kind": TOKEN_SGD},
    ]


def test_invalid_entries_still_dropped() -> None:
    assert normalize_wildcard_entry("POSE") is None
    assert normalize_wildcard_entry({"category": "", "spec": "", "kind": "sgd"}) is None
    assert normalize_wildcard_entry({"category": "   ", "spec": "x"}) is None
