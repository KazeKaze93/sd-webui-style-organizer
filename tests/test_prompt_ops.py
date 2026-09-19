"""Tests for stylegrid.prompt_ops.dedup_prompt (weight-aware tag dedup)."""
import pytest

from stylegrid.prompt_ops import dedup_prompt


@pytest.mark.parametrize(
    "prompt,expected",
    [
        ("a, b, a", "a, b"),
        ("(a:1.3), a", "(a:1.3)"),
        ("a, b, (a:1.4)", "(a:1.4), b"),
        ("(a:1.2), (a:1.5)", "(a:1.5)"),
        ("(a:0.7), a", "(a:0.7)"),
        ("a, (a:0.7)", "a"),
        ("Huge Breasts, (huge breasts:1.4)", "(Huge Breasts:1.4)"),
        ("(a:1.50), b", "(a:1.50), b"),
        ("a, BREAK, b, BREAK", "a, BREAK, b, BREAK"),
        ("<lora:x:1>, <lora:x:1>, <lora:x:0.5>", "<lora:x:1>, <lora:x:0.5>"),
        ("(red hair, blue eyes:1.2), red hair", "(red hair, blue eyes:1.2), red hair"),
        ("((a)), a", "((a)), a"),
        (
            "(intricate details:1.1), (high detail:1.2), intricate details",
            "(intricate details:1.1), (high detail:1.2)",
        ),
        ("", ""),
        (" , ,a, ", "a"),
    ],
)
def test_dedup_prompt(prompt, expected):
    assert dedup_prompt(prompt) == expected
