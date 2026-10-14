"""WebUI data-dir root resolution and legacy migration (copy-only)."""

from __future__ import annotations

import os
from pathlib import Path

from stylegrid import config as sg_config


def test_resolve_user_data_dir_under_webui_data_path(tmp_path):
    """Fresh install: resolve under shared.cmd_opts.data_path / style_grid."""
    webui_data = tmp_path / "webui_user"
    webui_data.mkdir()
    resolved = sg_config.resolve_user_data_dir(str(webui_data))
    assert Path(resolved) == webui_data / sg_config.USER_DATA_DIRNAME
    assert sg_config.USER_DATA_DIRNAME in resolved
    assert str(webui_data) in resolved


def test_resolve_user_data_dir_fallback_when_host_api_missing():
    """When cmd_opts.data_path is unset, resolve to legacy extension data/."""
    assert sg_config.resolve_user_data_dir(None) == sg_config.LEGACY_DATA_DIR


def test_migrate_copies_when_dest_empty(tmp_path):
    legacy = tmp_path / "legacy"
    dest = tmp_path / "dest"
    legacy.mkdir()
    (legacy / "presets.json").write_text('{"a":{}}', encoding="utf-8")
    (legacy / "favorites.json").write_text('{"items":[]}', encoding="utf-8")
    thumbs = legacy / "thumbnails"
    thumbs.mkdir()
    (thumbs / "abc.webp").write_bytes(b"webp-bytes")
    # Present on disk but must NOT be migrated.
    (legacy / "usage.json").write_text('{"skip":{"count":1}}', encoding="utf-8")

    assert sg_config.migrate_legacy_user_data(str(dest), str(legacy)) is True

    assert (dest / "presets.json").read_text(encoding="utf-8") == '{"a":{}}'
    assert (dest / "favorites.json").is_file()
    assert (dest / "thumbnails" / "abc.webp").read_bytes() == b"webp-bytes"
    assert not (dest / "usage.json").exists()
    marker = dest / sg_config.MIGRATION_MARKER_NAME
    assert marker.is_file()
    marker_text = marker.read_text(encoding="utf-8")
    assert "copied_from=" in marker_text
    # Legacy untouched (copy, not move), including usage.json.
    assert (legacy / "presets.json").is_file()
    assert (legacy / "usage.json").is_file()


def test_migrate_skips_when_dest_has_data(tmp_path):
    legacy = tmp_path / "legacy"
    dest = tmp_path / "dest"
    legacy.mkdir()
    dest.mkdir()
    (legacy / "presets.json").write_text('{"legacy":{}}', encoding="utf-8")
    (dest / "presets.json").write_text('{"new":{}}', encoding="utf-8")

    assert sg_config.migrate_legacy_user_data(str(dest), str(legacy)) is False
    assert (dest / "presets.json").read_text(encoding="utf-8") == '{"new":{}}'
    assert not (dest / sg_config.MIGRATION_MARKER_NAME).exists()


def test_migrate_skips_when_same_path(tmp_path):
    root = tmp_path / "data"
    root.mkdir()
    (root / "presets.json").write_text("{}", encoding="utf-8")
    assert sg_config.migrate_legacy_user_data(str(root), str(root)) is False


def test_migrate_marker_prevents_double_migration(tmp_path):
    legacy = tmp_path / "legacy"
    dest = tmp_path / "dest"
    legacy.mkdir()
    (legacy / "presets.json").write_text('{"n":{}}', encoding="utf-8")

    assert sg_config.migrate_legacy_user_data(str(dest), str(legacy)) is True
    assert (dest / sg_config.MIGRATION_MARKER_NAME).is_file()
    # Second call is a no-op (marker present).
    (legacy / "extra.csv").write_text("name\nZ\n", encoding="utf-8")
    assert sg_config.migrate_legacy_user_data(str(dest), str(legacy)) is False
    assert not (dest / "extra.csv").exists()


def test_usage_only_legacy_is_not_migratable(tmp_path):
    """Legacy data/ with only usage.json must not migrate or write a marker."""
    legacy = tmp_path / "legacy"
    dest = tmp_path / "dest"
    legacy.mkdir()
    (legacy / "usage.json").write_text('{"x":{"count":1}}', encoding="utf-8")

    assert sg_config.has_user_data(str(legacy)) is False
    assert sg_config.migrate_legacy_user_data(str(dest), str(legacy)) is False
    assert not (dest / sg_config.MIGRATION_MARKER_NAME).exists()
    assert not (dest / "usage.json").exists()


def test_module_paths_use_resolver_constants():
    """Production constants are derived from DATA_DIR (single resolver)."""
    assert sg_config.PRESETS_FILE == os.path.join(sg_config.DATA_DIR, "presets.json")
    assert sg_config.CATEGORY_ORDER_FILE == os.path.join(
        sg_config.DATA_DIR, "category_order.json"
    )
    assert sg_config.FAVORITES_FILE == os.path.join(sg_config.DATA_DIR, "favorites.json")
    assert sg_config.RECENT_FILE == os.path.join(sg_config.DATA_DIR, "recent.json")
    assert sg_config.BACKUP_DIR == os.path.join(sg_config.DATA_DIR, "backups")
    assert sg_config.THUMBNAILS_DIR == os.path.join(sg_config.DATA_DIR, "thumbnails")
    assert sg_config.LEGACY_DATA_DIR == os.path.join(sg_config.EXT_DIR, "data")
