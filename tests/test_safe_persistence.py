"""Safe persistence: corrupt presets must not be overwritten; bak rotation."""

from __future__ import annotations

import hashlib
from pathlib import Path

import pytest

SIBLINGS = [
    Path(__file__).resolve().parents[1] / "stylegrid" / "safe_persistence.py",
    Path(r"D:\SD\Packages\ComfyUI\custom_nodes\sd-comfyui-style-organizer\stylegrid\safe_persistence.py"),
    Path(r"C:\Users\user\Documents\App\csv script\tools\dict\safe_persistence.py"),
]


@pytest.fixture
def presets_env(tmp_path, monkeypatch):
    from stylegrid import data_files as sg_data
    from stylegrid import config as sg_config

    presets_path = tmp_path / "presets.json"
    monkeypatch.setattr(sg_data, "PRESETS_FILE", str(presets_path))
    monkeypatch.setattr(sg_config, "PRESETS_FILE", str(presets_path))
    monkeypatch.setattr(sg_data, "load_all_styles", lambda: [])
    return sg_data, presets_path


def test_corrupt_presets_json_then_save_refuses(presets_env):
    """Corrupt on-disk presets must not be replaced by a subsequent save."""
    sg_data, presets_path = presets_env
    corrupt_blob = "{not valid json"
    presets_path.write_text(corrupt_blob, encoding="utf-8")

    load_error = None
    try:
        loaded = sg_data.load_presets()
    except Exception as exc:  # noqa: BLE001
        load_error = exc
        loaded = None

    save_error = None
    try:
        sg_data.save_presets(
            {
                "Hijack": {
                    "styles": [],
                    "wildcards": [],
                    "note": "",
                    "created": "2026-01-01T00:00:00",
                }
            }
        )
    except Exception as exc:  # noqa: BLE001
        save_error = exc

    on_disk = presets_path.read_text(encoding="utf-8")
    assert on_disk == corrupt_blob, (
        "corrupt presets.json was overwritten — save must refuse when the "
        f"existing file is unreadable (load_error={load_error!r}, "
        f"save_error={save_error!r}, loaded={loaded!r})"
    )
    assert load_error is not None or save_error is not None


def test_write_atomic_rotates_backups(tmp_path):
    from stylegrid.safe_persistence import write_atomic

    path = tmp_path / "x.json"
    write_atomic(path, b"a")
    write_atomic(path, b"b")
    write_atomic(path, b"c")
    write_atomic(path, b"d")
    assert path.read_bytes() == b"d"
    assert (tmp_path / "x.json.bak").read_bytes() == b"c"
    assert (tmp_path / "x.json.bak.2").read_bytes() == b"b"
    assert (tmp_path / "x.json.bak.3").read_bytes() == b"a"


def test_safe_persistence_sha256_parity():
    present = [p for p in SIBLINGS if p.is_file()]
    assert len(present) >= 2
    hashes = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in present}
    unique = set(hashes.values())
    assert len(unique) == 1, f"safe_persistence drift: {hashes}"
