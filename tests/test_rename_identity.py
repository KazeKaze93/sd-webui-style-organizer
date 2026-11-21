"""A style rename carries its favorites.json and recent.json entries.

Keys are the client's styleRowKey: ``"<source id>\\0<name>"``. Legacy entries
are bare names without a file.
"""

from __future__ import annotations

import json

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from stylegrid.data_files import remap_identity_key, rename_identity_items
from stylegrid.routes import register_api

SEP = "\0"
CSV_HEADER = "name,prompt,negative_prompt,description,category\n"


def key(source_id: str, name: str) -> str:
    return f"{source_id}{SEP}{name}"


@pytest.fixture
def identity_files(tmp_path, monkeypatch):
    """favorites.json / recent.json under tmp_path, wired into data_files."""
    from stylegrid import config as sg_config
    from stylegrid import data_files as sg_data

    fav = tmp_path / "favorites.json"
    recent = tmp_path / "recent.json"
    monkeypatch.setattr(sg_data, "FAVORITES_FILE", str(fav))
    monkeypatch.setattr(sg_data, "RECENT_FILE", str(recent))
    monkeypatch.setattr(sg_config, "FAVORITES_FILE", str(fav))
    monkeypatch.setattr(sg_config, "RECENT_FILE", str(recent))

    def write(path, items):
        path.write_text(json.dumps({"items": items}), encoding="utf-8")

    def read(path):
        return json.loads(path.read_text(encoding="utf-8"))["items"]

    return fav, recent, write, read


@pytest.fixture
def two_packs(tmp_ext, monkeypatch):
    """Two CSVs under <EXT_DIR>/styles: a.csv and b.csv, both holding BODY_Shared."""
    a = tmp_ext / "styles" / "a.csv"
    b = tmp_ext / "styles" / "b.csv"
    a.write_text(
        CSV_HEADER
        + "BODY_Tall,tall,,,\n"
        + "BODY_Shared,shared a,,,\n"
        + "BODY_Only_A,only a,,,\n",
        encoding="utf-8",
    )
    b.write_text(
        CSV_HEADER
        + "BODY_Tall_B,tall b,,,\n"
        + "BODY_Shared,shared b,,,\n",
        encoding="utf-8",
    )
    paths = [str(a), str(b)]

    from stylegrid import cache as sg_cache
    from stylegrid import config as sg_config
    from stylegrid import csv_io as sg_csv_io
    from stylegrid import thumbnails as sg_thumbs

    styles_dir = str(tmp_ext / "styles")
    monkeypatch.setattr(sg_config, "get_styles_dirs", lambda: [styles_dir])
    monkeypatch.setattr(sg_thumbs, "get_styles_dirs", lambda: [styles_dir])
    monkeypatch.setattr(sg_config, "get_all_styles_file_paths", lambda: paths)
    monkeypatch.setattr(sg_csv_io, "get_all_styles_file_paths", lambda: paths)
    monkeypatch.setattr(sg_cache, "get_all_styles_file_paths", lambda: paths)

    from stylegrid.cache import invalidate_styles_cache

    invalidate_styles_cache()
    return a, b


@pytest.fixture
def client(two_packs, identity_files, tmp_path, monkeypatch):
    from stylegrid import config as sg_config
    from stylegrid import data_files as sg_data

    presets = tmp_path / "presets.json"
    monkeypatch.setattr(sg_data, "PRESETS_FILE", str(presets))
    monkeypatch.setattr(sg_config, "PRESETS_FILE", str(presets))
    from stylegrid import routes as sg_routes

    monkeypatch.setattr(sg_routes, "PRESETS_FILE", str(presets))

    app = FastAPI()
    register_api(None, app)
    with TestClient(app, base_url="http://127.0.0.1:7860") as c:
        yield c


def rename(client, old, new, source, **extra):
    r = client.post(
        "/style_grid/style/rename",
        json={"old_name": old, "new_name": new, "source": source, **extra},
    )
    assert r.status_code == 200, r.text
    assert r.json().get("ok") is True
    return r


# --- remap_identity_key (pure) ---


def test_remap_key_only_for_the_same_file_and_name():
    entry = key("styles/a.csv", "BODY_Shared")
    assert remap_identity_key(entry, "BODY_Shared", "POSE_Shared", "styles/a.csv") == key(
        "styles/a.csv", "POSE_Shared"
    )
    other_file = key("styles/b.csv", "BODY_Shared")
    assert remap_identity_key(other_file, "BODY_Shared", "POSE_Shared", "styles/a.csv") == other_file
    other_name = key("styles/a.csv", "BODY_Tall")
    assert remap_identity_key(other_name, "BODY_Shared", "POSE_Shared", "styles/a.csv") == other_name


def test_remap_key_legacy_bare_name_only_when_unique():
    assert remap_identity_key("BODY_Tall", "BODY_Tall", "POSE_Tall", "styles/a.csv") == "BODY_Tall"
    assert remap_identity_key(
        "BODY_Tall", "BODY_Tall", "POSE_Tall", "styles/a.csv", legacy_unique=True
    ) == key("styles/a.csv", "POSE_Tall")
    # A bare name of another style is never touched.
    assert remap_identity_key(
        "BODY_Other", "BODY_Tall", "POSE_Tall", "styles/a.csv", legacy_unique=True
    ) == "BODY_Other"


def test_rename_identity_items_noops():
    assert rename_identity_items("A", "A", "styles/a.csv") == {"favorites": False, "recent": False}
    assert rename_identity_items("", "B", "styles/a.csv") == {"favorites": False, "recent": False}
    assert rename_identity_items("A", "B", "") == {"favorites": False, "recent": False}


def test_missing_or_corrupt_files_are_left_alone(identity_files):
    fav, recent, _write, _read = identity_files
    assert rename_identity_items("A", "B", "styles/a.csv") == {"favorites": False, "recent": False}
    assert not fav.exists() and not recent.exists()

    fav.write_text("{not json", encoding="utf-8")
    assert rename_identity_items("A", "B", "styles/a.csv")["favorites"] is False
    assert fav.read_text(encoding="utf-8") == "{not json"


# --- through the rename route ---


def test_rename_migrates_favorites_and_recent(client, identity_files):
    fav, recent, write, read = identity_files
    write(fav, [key("styles/a.csv", "BODY_Tall"), key("styles/b.csv", "BODY_Tall_B")])
    write(recent, [key("styles/b.csv", "BODY_Tall_B"), key("styles/a.csv", "BODY_Tall")])

    rename(client, "BODY_Tall", "POSE_Tall", "styles/a.csv")

    assert read(fav) == [key("styles/a.csv", "POSE_Tall"), key("styles/b.csv", "BODY_Tall_B")]
    # Recent keeps its order (position of the renamed entry unchanged).
    assert read(recent) == [key("styles/b.csv", "BODY_Tall_B"), key("styles/a.csv", "POSE_Tall")]

    r = client.get("/style_grid/favorites")
    assert key("styles/a.csv", "POSE_Tall") in r.json()["items"]


def test_same_name_in_another_file_untouched(client, identity_files):
    fav, recent, write, read = identity_files
    a_key = key("styles/a.csv", "BODY_Shared")
    b_key = key("styles/b.csv", "BODY_Shared")
    write(fav, [b_key, a_key])
    write(recent, [a_key, b_key])

    rename(client, "BODY_Shared", "POSE_Shared", "styles/a.csv")

    assert read(fav) == [b_key, key("styles/a.csv", "POSE_Shared")]
    assert read(recent) == [key("styles/a.csv", "POSE_Shared"), b_key]


def test_legacy_bare_name_migrated_when_name_was_in_one_file(client, identity_files):
    fav, recent, write, read = identity_files
    write(fav, ["BODY_Only_A"])
    write(recent, ["BODY_Only_A", key("styles/b.csv", "BODY_Tall_B")])

    rename(client, "BODY_Only_A", "POSE_Only_A", "styles/a.csv")

    assert read(fav) == [key("styles/a.csv", "POSE_Only_A")]
    assert read(recent) == [key("styles/a.csv", "POSE_Only_A"), key("styles/b.csv", "BODY_Tall_B")]


def test_legacy_bare_name_left_alone_when_name_was_in_several_files(client, identity_files):
    fav, recent, write, read = identity_files
    write(fav, ["BODY_Shared"])
    write(recent, ["BODY_Shared"])

    rename(client, "BODY_Shared", "POSE_Shared", "styles/a.csv")

    assert read(fav) == ["BODY_Shared"]
    assert read(recent) == ["BODY_Shared"]


def test_collision_collapses_to_the_earlier_entry(client, identity_files):
    fav, recent, write, read = identity_files
    new_key = key("styles/a.csv", "POSE_Tall")
    old_key = key("styles/a.csv", "BODY_Tall")
    other = key("styles/b.csv", "BODY_Tall_B")
    # A stale entry for the new name already exists (e.g. from an earlier style
    # with that name). Recent is most-recent-first: the earlier position wins.
    write(recent, [other, new_key, old_key])
    write(fav, [old_key, other, new_key])

    rename(client, "BODY_Tall", "POSE_Tall", "styles/a.csv")

    assert read(recent) == [other, new_key]
    assert read(fav) == [new_key, other]


def test_stored_source_form_is_kept_byte_for_byte(identity_files):
    """Only the name part changes; the stored source part is never re-encoded."""
    fav, _recent, write, read = identity_files
    write(fav, [key("styles/a.csv", "BODY_Tall")])
    rename_identity_items("BODY_Tall", "POSE_Tall", "styles/a.csv")
    assert read(fav) == [key("styles/a.csv", "POSE_Tall")]


def test_recent_cap_respected(identity_files):
    _fav, recent, write, read = identity_files
    items = [key("styles/a.csv", f"X_{i}") for i in range(10)]
    write(recent, items)
    rename_identity_items("X_3", "Y_3", "styles/a.csv")
    out = read(recent)
    assert len(out) == 10
    assert out[3] == key("styles/a.csv", "Y_3")
    assert out[:3] == items[:3] and out[4:] == items[4:]


def test_move_to_category_carries_favorites_and_presets(client, identity_files, tmp_path):
    """Move is a rename with a category column; presets still migrate too."""
    fav, _recent, write, read = identity_files
    write(fav, [key("styles/a.csv", "BODY_Tall")])
    presets = tmp_path / "presets.json"
    presets.write_text(
        json.dumps(
            {
                "Set": {
                    "styles": [{"name": "BODY_Tall", "source_file": "styles/a.csv", "weight": 1.0}],
                    "created": "2026-11-21T00:00:00",
                }
            }
        ),
        encoding="utf-8",
    )

    rename(client, "BODY_Tall", "POSE_Tall", "styles/a.csv", category="POSE")

    assert read(fav) == [key("styles/a.csv", "POSE_Tall")]
    stored = json.loads(presets.read_text(encoding="utf-8"))
    assert stored["Set"]["styles"][0]["name"] == "POSE_Tall"


def test_failed_rename_changes_nothing(client, identity_files):
    fav, recent, write, read = identity_files
    entry = key("styles/a.csv", "BODY_Tall")
    write(fav, [entry])
    write(recent, [entry])
    r = client.post(
        "/style_grid/style/rename",
        json={"old_name": "BODY_Tall", "new_name": "BODY_Only_A", "source": "styles/a.csv"},
    )
    assert r.status_code == 400
    assert read(fav) == [entry]
    assert read(recent) == [entry]
