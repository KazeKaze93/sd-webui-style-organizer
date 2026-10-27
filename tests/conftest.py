# pip install pytest
import os
import sys
from unittest.mock import MagicMock

# Stub Forge `modules.shared` before stylegrid.config (and thus csv_io) loads.
_mock_shared = MagicMock()
_mock_shared.cmd_opts = MagicMock()
_mock_shared.cmd_opts.data_path = None
# Explicit bools — MagicMock attributes are truthy and would fake --listen.
_mock_shared.cmd_opts.listen = False
_mock_shared.cmd_opts.share = False
_mock_shared.cmd_opts.ngrok = None
_mock_shared.cmd_opts.server_name = None
_mock_shared.cmd_opts.port = 7860
_mock_shared.cmd_opts.gradio_auth = None
_mock_shared.cmd_opts.gradio_auth_path = None
_mock_shared.prompt_styles = MagicMock()
_mock_shared.prompt_styles.all_styles_files = []
_mock_shared.prompt_styles.reload = MagicMock()
_mod = MagicMock()
_mod.shared = _mock_shared
sys.modules.setdefault("modules", _mod)

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "scripts"))

# Must follow sys.path / modules stub setup above so stylegrid imports resolve in tests.
import pytest  # noqa: E402

_CSV_BODY = (
    "name,prompt,negative_prompt,description,category\n"
    "Test Style A,(tag_a:1.2),bad_tag_a,Desc A,BASE\n"
    "Test Style B,tag_b,,Desc B,BODY\n"
    "Style With Spaces,tag_c,bad_c,,\n"
)


@pytest.fixture
def tmp_ext(tmp_path, monkeypatch):
    """Isolated extension root with styles/ and samples/ under a temp EXT_DIR."""
    from stylegrid import config as sg_config
    from stylegrid import csv_io as sg_csv_io

    ext = tmp_path / "ext"
    (ext / "styles").mkdir(parents=True)
    (ext / "samples").mkdir(parents=True)
    monkeypatch.setattr(sg_config, "EXT_DIR", str(ext))
    monkeypatch.setattr(sg_csv_io, "EXT_DIR", str(ext))
    return ext


@pytest.fixture
def tmp_csv(tmp_ext):
    """Minimal valid 5-column CSV under <EXT_DIR>/styles/styles.csv."""
    path = tmp_ext / "styles" / "styles.csv"
    path.write_text(_CSV_BODY, encoding="utf-8")
    return path


@pytest.fixture
def patch_styles_dirs(monkeypatch, tmp_csv):
    """Make get_all_styles_file_paths() return the test CSV so save/delete use it.

    Also patches config so resolve_client_source sees the same discovery list.
    """
    from stylegrid import config as sg_config
    from stylegrid import csv_io as sg_csv_io

    paths = [str(tmp_csv)]

    monkeypatch.setattr(sg_csv_io, "get_all_styles_file_paths", lambda: paths)
    monkeypatch.setattr(sg_config, "get_all_styles_file_paths", lambda: paths)
