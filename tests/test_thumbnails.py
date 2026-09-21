"""Unit tests for thumbnail identity (name + source) and legacy migration."""

from __future__ import annotations

from pathlib import Path

import pytest

from stylegrid import thumbnails as sg_thumbs


@pytest.fixture
def thumbs_dir(tmp_path, monkeypatch):
    d = tmp_path / "thumbnails"
    d.mkdir()
    monkeypatch.setattr(sg_thumbs, "THUMBNAILS_DIR", str(d))
    monkeypatch.setattr(sg_thumbs, "get_styles_dirs", lambda: [str(tmp_path)])
    return d


def test_hash_keys_differ_across_source_files(thumbs_dir, tmp_path):
    a = str(tmp_path / "pony.csv")
    b = str(tmp_path / "illustrious.csv")
    name = "BASE_Anti_Futa"
    assert sg_thumbs.thumbnail_hash_key(name, a) != sg_thumbs.thumbnail_hash_key(name, b)
    assert sg_thumbs.thumbnail_hash_key(name, a) != sg_thumbs.legacy_thumbnail_stem(name)


def test_furry_futa_labeled_styles_are_independent(thumbs_dir, tmp_path):
    src = str(tmp_path / "pack.csv")
    keys = {
        sg_thumbs.thumbnail_hash_key("BODY_Ears", src),
        sg_thumbs.thumbnail_hash_key("BODY_FURRY_Ears", src),
        sg_thumbs.thumbnail_hash_key("BODY_FUTA_Ears", src),
    }
    assert len(keys) == 3


def test_migrate_unique_name_moves_legacy_file(thumbs_dir, tmp_path):
    src = str(tmp_path / "only.csv")
    name = "CAMERA_Closeup"
    legacy = thumbs_dir / f"{sg_thumbs.legacy_thumbnail_stem(name)}.webp"
    legacy.write_bytes(b"LEGACY")
    styles = [{"name": name, "source_file": src}]
    result = sg_thumbs.migrate_legacy_thumbnails(styles)
    assert result["migrated"] == 1
    assert result["ambiguous"] == 0
    assert not legacy.exists()
    new_path = Path(sg_thumbs.get_thumbnail_path(name, src))
    assert new_path.exists()
    assert new_path.read_bytes() == b"LEGACY"


def test_migrate_ambiguous_name_does_not_guess(thumbs_dir, tmp_path):
    a = str(tmp_path / "pony.csv")
    b = str(tmp_path / "illustrious.csv")
    name = "LIGHTING_Rim"
    legacy = thumbs_dir / f"{sg_thumbs.legacy_thumbnail_stem(name)}.webp"
    legacy.write_bytes(b"SHARED")
    styles = [
        {"name": name, "source_file": a},
        {"name": name, "source_file": b},
    ]
    result = sg_thumbs.migrate_legacy_thumbnails(styles)
    assert result["migrated"] == 0
    assert result["ambiguous"] == 1
    assert legacy.exists()
    assert not Path(sg_thumbs.get_thumbnail_path(name, a)).exists()
    assert not Path(sg_thumbs.get_thumbnail_path(name, b)).exists()


def test_list_thumbnails_is_source_aware(thumbs_dir, tmp_path, monkeypatch):
    a = str(tmp_path / "pony.csv")
    b = str(tmp_path / "illustrious.csv")
    name = "POSE_Standing"
    Path(sg_thumbs.get_thumbnail_path(name, a)).write_bytes(b"A")
    styles = [
        {"name": name, "source_file": a},
        {"name": name, "source_file": b},
    ]
    monkeypatch.setattr(sg_thumbs, "get_cached_styles", lambda: styles)
    listed = sg_thumbs.list_thumbnails()
    assert listed == [{"name": name, "source_file": a}]
