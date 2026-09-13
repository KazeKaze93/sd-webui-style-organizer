"""Parity: stylegrid.wildcards.select_slice vs tests/fixtures/slice_grammar.json."""
import json
from pathlib import Path

import pytest

from stylegrid.wildcards import select_slice

_FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "slice_grammar.json"


def _load_fixture():
    with _FIXTURE_PATH.open(encoding="utf-8") as f:
        return json.load(f)


FIXTURE = _load_fixture()


@pytest.fixture
def candidates():
    return [{"name": n, "prompt": "p::" + n} for n in FIXTURE["names"]]


@pytest.mark.parametrize(
    "spec,expected",
    [(case["spec"], case["expected"]) for case in FIXTURE["cases"]],
    ids=[case["spec"] or "empty spec" for case in FIXTURE["cases"]],
)
def test_select_slice_matches_fixture(candidates, spec, expected):
    pool = select_slice(candidates, FIXTURE["category"], spec) if spec else list(candidates)
    if not pool:
        pool = list(candidates)
    assert [c["name"] for c in pool] == expected


def test_slice_grammar_fixture_is_well_formed():
    names = set(FIXTURE["names"])
    assert FIXTURE["cases"]
    for case in FIXTURE["cases"]:
        for name in case["expected"]:
            assert name in names
