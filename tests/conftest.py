# pip install pytest
import os
import sys
from unittest.mock import MagicMock

# Stub Forge `modules.shared` before stylegrid.config (and thus csv_io) loads.
_mock_shared = MagicMock()
_mock_shared.cmd_opts = MagicMock()
_mock_shared.cmd_opts.data_path = None
_mod = MagicMock()
_mod.shared = _mock_shared
sys.modules.setdefault("modules", _mod)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

# Must follow sys.path / modules stub setup above so stylegrid imports resolve in tests.
import pytest  # noqa: E402


@pytest.fixture
def tmp_csv(tmp_path):
    """Minimal valid 5-column CSV; category column is stored as category_explicit by parse_styles_csv."""
    content = (
        "name,prompt,negative_prompt,description,category\n"
        "Test Style A,(tag_a:1.2),bad_tag_a,Desc A,BASE\n"
        "Test Style B,tag_b,,Desc B,BODY\n"
        "Style With Spaces,tag_c,bad_c,,\n"
    )
    path = tmp_path / "styles.csv"
    path.write_text(content, encoding="utf-8")
    return path


@pytest.fixture
def patch_styles_dirs(monkeypatch, tmp_path):
    """Make get_all_styles_file_paths() return the test CSV so save/delete use it."""
    from stylegrid import csv_io as sg_csv_io

    monkeypatch.setattr(
        sg_csv_io, "get_all_styles_file_paths", lambda: [str(tmp_path / "styles.csv")]
    )
