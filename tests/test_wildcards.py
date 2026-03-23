"""Tests for stylegrid.wildcards.resolve_sg_wildcards (generation-time {sg:...} tokens)."""
from unittest.mock import patch

from stylegrid.wildcards import resolve_sg_wildcards


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
