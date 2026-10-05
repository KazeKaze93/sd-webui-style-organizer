"""Deterministic without-replacement deck positions for wildcard draws."""

from __future__ import annotations

import hashlib
import random

SEED_DIGEST_BYTES = 16
FIELD_SEPARATOR = "\x1f"
SEED_BYTEORDER = "big"


def _epoch_seed(base_seed: int, deck_id: str, epoch: int) -> int:
    material = (
        f"{base_seed}{FIELD_SEPARATOR}{deck_id}{FIELD_SEPARATOR}{epoch}"
    ).encode("utf-8")
    digest = hashlib.sha256(material).digest()
    return int.from_bytes(digest[:SEED_DIGEST_BYTES], SEED_BYTEORDER)


def _fisher_yates(n: int, rng: random.Random) -> list[int]:
    perm = list(range(n))
    for i in range(n - 1, 0, -1):
        j = int(rng.random() * (i + 1))
        perm[i], perm[j] = perm[j], perm[i]
    return perm


def _epoch_permutation(n: int, base_seed: int, deck_id: str, epoch: int) -> list[int]:
    """Build the seam-fixed permutation for ``epoch`` (0-based)."""
    previous: list[int] | None = None
    current: list[int] = []
    for e in range(epoch + 1):
        rng = random.Random(_epoch_seed(base_seed, deck_id, e))
        current = _fisher_yates(n, rng)
        if n > 1 and e > 0 and previous is not None and current[0] == previous[-1]:
            current[0], current[1] = current[1], current[0]
        previous = current
    return current


def deck_position(n: int, base_seed: int, deck_id: str, index: int) -> int:
    """Return a deck position in ``range(n)`` for image ``index``.

    Positions within each epoch of length ``n`` form a permutation of
    ``range(n)``. Adjacent epochs never start with the previous epoch's
    last position when ``n > 1``.
    """
    if n <= 0:
        raise ValueError(f"deck size n must be positive, got {n}")
    if index < 0:
        raise ValueError(f"index must be non-negative, got {index}")
    if n == 1:
        return 0

    epoch = index // n
    offset = index % n
    perm = _epoch_permutation(n, base_seed, deck_id, epoch)
    return perm[offset]
