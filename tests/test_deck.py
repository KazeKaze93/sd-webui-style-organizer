"""Behavior tests for stylegrid.deck.deck_position."""

from __future__ import annotations

import random

import pytest

from stylegrid.deck import deck_position

EPOCH0_PIN_N6 = [2, 0, 3, 5, 1, 4]


@pytest.mark.parametrize("n", [2, 3, 6, 20])
def test_epoch0_is_full_permutation(n: int) -> None:
    positions = [deck_position(n, 99, "deck-a", i) for i in range(n)]
    assert sorted(positions) == list(range(n))
    assert len(set(positions)) == n


def test_determinism_and_input_sensitivity() -> None:
    n = 20
    a = [deck_position(n, 7, "alpha", i) for i in range(n)]
    b = [deck_position(n, 7, "alpha", i) for i in range(n)]
    assert a == b

    by_seed = [deck_position(n, 8, "alpha", i) for i in range(n)]
    by_id = [deck_position(n, 7, "beta", i) for i in range(n)]
    assert by_seed != a
    assert by_id != a


@pytest.mark.parametrize("n", [2, 3, 5])
def test_seam_never_repeats_across_epochs(n: int) -> None:
    base_seed = 4242
    deck_id = "seam"
    for epoch in range(51):
        last_of_k = deck_position(n, base_seed, deck_id, epoch * n + (n - 1))
        first_of_next = deck_position(n, base_seed, deck_id, (epoch + 1) * n)
        assert last_of_k != first_of_next


def test_does_not_touch_global_random_state() -> None:
    before = random.getstate()
    for i in range(200):
        deck_position(7, 1000 + i, f"id-{i % 5}", i)
    assert random.getstate() == before


def test_result_depends_only_on_four_arguments() -> None:
    n = 8
    base_seed = 55
    deck_id = "pure"
    indices = list(range(n * 3))
    sequential = {i: deck_position(n, base_seed, deck_id, i) for i in indices}
    shuffled = list(indices)
    random.Random(0).shuffle(shuffled)
    for i in shuffled:
        assert deck_position(n, base_seed, deck_id, i) == sequential[i]


def test_n_one_always_zero() -> None:
    for index in (0, 1, 99, 1000):
        assert deck_position(1, 0, "x", index) == 0


@pytest.mark.parametrize("n", [0, -1, -10])
def test_non_positive_n_raises(n: int) -> None:
    with pytest.raises(ValueError, match="positive"):
        deck_position(n, 1, "x", 0)


def test_negative_index_raises() -> None:
    with pytest.raises(ValueError, match="non-negative"):
        deck_position(3, 1, "x", -1)


def test_stability_pin_epoch0() -> None:
    assert [deck_position(6, 12345, "cat|spec", i) for i in range(6)] == EPOCH0_PIN_N6
