"""process() must resolve {sg:...} in the hires-fix prompt lists.

scripts/style_grid.py is the Forge entry point, so importing it needs `gradio` and
the parts of the `modules` namespace that only exist inside a running WebUI:
`modules.scripts.Script` must be a real class (the conftest MagicMock cannot be
subclassed into a usable class) and `modules.processing` must be importable.

Forge fills p.all_hr_prompts / p.all_hr_negative_prompts in setup_prompts(), which
runs before scripts.process(), copying the first-pass prompt in when the "Hires
prompt" box is empty (modules/processing.py, StableDiffusionProcessingTxt2Img).
"""
import sys
import types
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

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

CHARACTER_TAG = "1girl, long hair"
DETAIL_TAG = "intricate details"

STYLES = [
    {
        "name": "CHARACTER_Heroine",
        "prompt": CHARACTER_TAG,
        "negative_prompt": "bad anatomy",
        "category_explicit": "",
        "source": "styles.csv",
    },
    {
        "name": "DETAIL_Sharp",
        "prompt": DETAIL_TAG,
        "negative_prompt": "blurry",
        "category_explicit": "",
        "source": "styles.csv",
    },
]


@pytest.fixture
def script(monkeypatch):
    """StyleGridScript with a fixed two-style library (no CSV / no LoRA scan)."""
    monkeypatch.setattr(style_grid, "get_cached_styles", lambda: [dict(s) for s in STYLES])
    return style_grid.StyleGridScript()


def _mock_p(prompt, negative_prompt="", hr_prompt=None, hr_negative_prompt=None):
    """Mock processing object shaped like Forge's state at scripts.process() time."""
    return SimpleNamespace(
        all_prompts=[prompt],
        all_negative_prompts=[negative_prompt],
        all_hr_prompts=None if hr_prompt is None else [hr_prompt],
        all_hr_negative_prompts=None if hr_negative_prompt is None else [hr_negative_prompt],
    )


def test_hires_override_resolves_wildcards(script):
    p = _mock_p("masterpiece, {sg:character}", hr_prompt="{sg:detail}, upscaled")
    script.process(p, "")

    assert p.all_hr_prompts == [f"{DETAIL_TAG}, upscaled"]
    assert "{sg:" not in p.all_hr_prompts[0]


def test_hires_override_negative_resolves_wildcards(script):
    p = _mock_p(
        "masterpiece",
        negative_prompt="{sg:character}",
        hr_prompt="upscaled",
        hr_negative_prompt="{sg:detail}, worst quality",
    )
    script.process(p, "")

    assert p.all_hr_negative_prompts == ["blurry, worst quality"]


def test_hires_override_is_deduped(script):
    p = _mock_p("masterpiece", hr_prompt=f"{DETAIL_TAG}, {{sg:detail}}")
    script.process(p, "")

    assert p.all_hr_prompts == [DETAIL_TAG]


def test_empty_hires_override_mirrors_first_pass(script):
    """Forge copies the first-pass prompt in, so both passes must get the same picks."""
    prompt = "masterpiece, {sg:character}, {sg:detail}"
    p = _mock_p(prompt, negative_prompt="{sg:character}", hr_prompt=prompt, hr_negative_prompt="{sg:character}")
    script.process(p, "")

    assert p.all_hr_prompts == p.all_prompts
    assert p.all_hr_negative_prompts == p.all_negative_prompts
    assert "{sg:" not in p.all_hr_prompts[0]


def test_hires_disabled_leaves_lists_untouched(script):
    p = _mock_p("masterpiece, {sg:character}")
    script.process(p, "")

    assert p.all_prompts == [f"masterpiece, {CHARACTER_TAG}"]
    assert p.all_hr_prompts is None
    assert p.all_hr_negative_prompts is None


def test_img2img_without_hires_attributes(script):
    """img2img processing objects have no hires prompt fields at all."""
    p = SimpleNamespace(all_prompts=["{sg:character}"], all_negative_prompts=["{sg:detail}"])
    script.process(p, "")

    assert p.all_prompts == [CHARACTER_TAG]
    assert not hasattr(p, "all_hr_prompts")


def test_hires_batch_lists_resolved_per_entry(script):
    p = SimpleNamespace(
        all_prompts=["{sg:character}", "{sg:character}"],
        all_negative_prompts=["", ""],
        all_hr_prompts=["{sg:detail}", "{sg:detail}"],
        all_hr_negative_prompts=["", ""],
    )
    script.process(p, "")

    assert p.all_hr_prompts == [DETAIL_TAG, DETAIL_TAG]
