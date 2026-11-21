"""Preview generation resolves the style by (source, name), never by name alone."""

from __future__ import annotations

import pytest

from stylegrid import config as sg_config
from stylegrid import routes as sg_routes
from stylegrid import source_ids
from stylegrid import thumbnails as sg_thumbs
from stylegrid.lora_scan import LORA_SOURCE
from stylegrid.thumbnails import ThumbnailGenerationManager, find_style_for_generation

NAME = "ACCESSORY_Arm_Warmers"


@pytest.fixture
def packs(tmp_path, monkeypatch):
    """Three WebUI packs share NAME; dup.csv exists in webui/ and styles/ (ambiguous leaf)."""
    ext = tmp_path / "ext"
    styles_dir = ext / "styles"
    (styles_dir).mkdir(parents=True)
    (ext / "samples").mkdir(parents=True)
    webui = tmp_path / "webui_data"
    webui.mkdir()
    monkeypatch.setattr(sg_config, "EXT_DIR", str(ext))
    monkeypatch.setattr(source_ids, "webui_styles_root", lambda: str(webui))
    monkeypatch.setattr(sg_config, "_get_webui_data_path", lambda: str(webui))

    files = {}
    for leaf in ("styles_nsfw_core.csv", "styles_solo.csv", "styles_yuri.csv", "dup.csv"):
        p = webui / leaf
        p.write_text("name,prompt\n", encoding="utf-8")
        files[leaf] = p
    dup_styles = styles_dir / "dup.csv"
    dup_styles.write_text("name,prompt\n", encoding="utf-8")
    all_paths = [str(p) for p in files.values()] + [str(dup_styles)]
    monkeypatch.setattr(sg_config, "get_all_styles_file_paths", lambda: list(all_paths))

    def row(source_file, prompt, name=NAME):
        leaf = source_file.split("/")[-1]
        return {"name": name, "prompt": prompt, "source": leaf, "_source": leaf, "source_file": source_file}

    rows = [
        row("webui/styles_nsfw_core.csv", "core"),
        row("webui/styles_solo.csv", "solo"),
        row("webui/styles_yuri.csv", "yuri"),
        row("webui/dup.csv", "dup-webui"),
        row("styles/dup.csv", "dup-styles"),
        row("webui/styles_solo.csv", "only-solo", name="BODY_Only_Solo"),
        {"name": "detail", "prompt": "", "source": LORA_SOURCE, "source_file": LORA_SOURCE},
        row("webui/styles_solo.csv", "lora-named", name="LORA_detail"),
    ]
    return {"rows": rows, "files": files, "dup_styles": dup_styles}


@pytest.mark.parametrize("leaf,prompt", [
    ("styles_nsfw_core.csv", "core"),
    ("styles_solo.csv", "solo"),
    ("styles_yuri.csv", "yuri"),
])
def test_each_source_form_finds_that_packs_row(packs, leaf, prompt):
    forms = [str(packs["files"][leaf]), "webui/" + leaf, leaf]
    for form in forms:
        found = find_style_for_generation(packs["rows"], NAME, form)
        assert found is not None, form
        assert found["prompt"] == prompt, form
        assert found["source_file"] == "webui/" + leaf, form


@pytest.mark.parametrize("leaf,prompt", [
    ("styles_nsfw_core.csv", "core"),
    ("styles_solo.csv", "solo"),
    ("styles_yuri.csv", "yuri"),
])
def test_route_enqueue_argument_resolves_to_the_requested_pack(packs, leaf, prompt):
    """The generate route enqueues _resolve_thumb_source(request.source): an absolute path."""
    for form in (str(packs["files"][leaf]), "webui/" + leaf, leaf):
        enqueued = sg_routes._resolve_thumb_source(form)
        assert enqueued == str(packs["files"][leaf]), form
        found = find_style_for_generation(packs["rows"], NAME, enqueued)
        assert found is not None and found["prompt"] == prompt, form


def test_ambiguous_basename_never_resolves_to_a_foreign_pack(packs):
    assert find_style_for_generation(packs["rows"], NAME, "dup.csv") is None
    assert sg_routes._resolve_thumb_source("dup.csv") is None
    # Each copy is still reachable by id or absolute path.
    assert find_style_for_generation(packs["rows"], NAME, "webui/dup.csv")["prompt"] == "dup-webui"
    assert find_style_for_generation(packs["rows"], NAME, str(packs["dup_styles"]))["prompt"] == "dup-styles"


def test_name_in_another_pack_only_returns_none(packs):
    assert find_style_for_generation(packs["rows"], "BODY_Only_Solo", "webui/styles_solo.csv")["prompt"] == "only-solo"
    for form in ("webui/styles_yuri.csv", str(packs["files"]["styles_yuri.csv"]), "styles_yuri.csv"):
        assert find_style_for_generation(packs["rows"], "BODY_Only_Solo", form) is None


@pytest.mark.parametrize("source", ["", "   ", "All", "webui/missing.csv", "missing.csv", "C:/nowhere/x.csv", None])
def test_empty_all_or_unknown_source_returns_none(packs, source):
    assert find_style_for_generation(packs["rows"], NAME, source) is None


def test_lora_rows_are_never_returned(packs):
    assert find_style_for_generation(packs["rows"], "detail", LORA_SOURCE) is None
    assert find_style_for_generation(packs["rows"], "LORA_detail", "webui/styles_solo.csv") is None


def test_run_generation_raises_when_lookup_misses(monkeypatch):
    calls = []

    def fake_lookup(styles, name, source):
        calls.append((name, source))
        return None

    monkeypatch.setattr(sg_thumbs, "get_cached_styles", lambda: [{"name": NAME, "source_file": "webui/x.csv"}])
    monkeypatch.setattr(sg_thumbs, "find_style_for_generation", fake_lookup)
    mgr = ThumbnailGenerationManager()
    with pytest.raises(ValueError, match=r"^Style not found in the requested source$"):
        mgr._run_generation(NAME, "/abs/webui/styles_nsfw_core.csv")
    assert calls == [(NAME, "/abs/webui/styles_nsfw_core.csv")]


class _StopBeforeProcessing(Exception):
    pass


def test_run_generation_saves_under_the_requested_pack(packs, monkeypatch):
    """The enqueued absolute path picks that pack's row for the prompt and the file path."""
    seen = []

    def capture_path(name, source):
        seen.append((name, source))
        raise _StopBeforeProcessing()

    monkeypatch.setattr(sg_thumbs, "get_cached_styles", lambda: packs["rows"])
    monkeypatch.setattr(sg_thumbs, "get_thumbnail_path", capture_path)
    mgr = ThumbnailGenerationManager()
    for leaf in ("styles_nsfw_core.csv", "styles_solo.csv", "styles_yuri.csv"):
        enqueued = sg_routes._resolve_thumb_source("webui/" + leaf)
        with pytest.raises(_StopBeforeProcessing):
            mgr._run_generation(NAME, enqueued)
    assert seen == [
        (NAME, "webui/styles_nsfw_core.csv"),
        (NAME, "webui/styles_solo.csv"),
        (NAME, "webui/styles_yuri.csv"),
    ]
