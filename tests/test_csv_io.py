"""
Tests for stylegrid.csv_io parse/save/delete behavior.

Duplicate names (save): save_style_to_csv updates the first matching row by name and stops;
remaining duplicate rows are left unchanged (see test_save_updates_first_duplicate_only).
"""
from pathlib import Path

import pytest

from stylegrid import csv_io


def test_parse_returns_expected_fields(tmp_csv):
    styles = csv_io.parse_styles_csv(str(tmp_csv))
    assert len(styles) == 3
    by_name = {s["name"]: s for s in styles}
    assert set(by_name["Test Style A"].keys()) >= {
        "name",
        "prompt",
        "negative_prompt",
        "description",
        "category_explicit",
        "source",
        "source_file",
    }
    # CSV column "category" is stored as category_explicit; "category" is added by categorize_styles().
    assert "category" not in by_name["Test Style A"]
    assert by_name["Test Style A"]["category_explicit"] == "BASE"
    assert by_name["Test Style B"]["category_explicit"] == "BODY"
    assert by_name["Style With Spaces"]["category_explicit"] == ""


def test_parse_empty_prompt_and_negative_are_empty_strings(tmp_csv):
    styles = csv_io.parse_styles_csv(str(tmp_csv))
    spaces = next(s for s in styles if s["name"] == "Style With Spaces")
    b = next(s for s in styles if s["name"] == "Test Style B")
    assert spaces["prompt"] == "tag_c"
    assert spaces["negative_prompt"] == "bad_c"
    assert spaces["description"] == ""
    assert spaces["category_explicit"] == ""
    assert b["negative_prompt"] == ""
    assert isinstance(b["negative_prompt"], str)
    assert isinstance(spaces["description"], str)


def test_parse_row_count_matches_data_rows(tmp_path):
    p = tmp_path / "x.csv"
    p.write_text(
        "name,prompt,negative_prompt,description,category\n"
        "One,a,,,\n"
        "Two,b,,,\n",
        encoding="utf-8",
    )
    assert len(csv_io.parse_styles_csv(str(p))) == 2


def test_parse_strips_name_whitespace(tmp_path):
    p = tmp_path / "w.csv"
    p.write_text(
        "name,prompt,negative_prompt,description,category\n"
        '  Trimmed Name  ,p,,,\n',
        encoding="utf-8",
    )
    styles = csv_io.parse_styles_csv(str(p))
    assert len(styles) == 1
    assert styles[0]["name"] == "Trimmed Name"


def test_parse_skips_empty_name_row(tmp_path):
    p = tmp_path / "e.csv"
    p.write_text(
        "name,prompt,negative_prompt,description,category\n"
        ",ghost,,,\n"
        "Real,x,,,\n",
        encoding="utf-8",
    )
    styles = csv_io.parse_styles_csv(str(p))
    assert [s["name"] for s in styles] == ["Real"]


def test_save_updates_existing_row_by_name(tmp_csv, patch_styles_dirs, monkeypatch):
    monkeypatch.setattr(csv_io, "invalidate_styles_cache", lambda: None)
    csv_io.save_style_to_csv(
        "Test Style A",
        "updated_prompt",
        "updated_neg",
        "updated_desc",
        source_file="styles.csv",
        category="NEWCAT",
    )
    styles = csv_io.parse_styles_csv(str(tmp_csv))
    a = next(s for s in styles if s["name"] == "Test Style A")
    assert a["prompt"] == "updated_prompt"
    assert a["negative_prompt"] == "updated_neg"
    assert a["description"] == "updated_desc"
    assert a["category_explicit"] == "NEWCAT"


def test_save_appends_new_name(tmp_csv, patch_styles_dirs, monkeypatch):
    monkeypatch.setattr(csv_io, "invalidate_styles_cache", lambda: None)
    csv_io.save_style_to_csv(
        "Brand New",
        "np",
        "nn",
        "nd",
        source_file="styles.csv",
        category="Z",
    )
    styles = csv_io.parse_styles_csv(str(tmp_csv))
    assert len(styles) == 4
    n = next(s for s in styles if s["name"] == "Brand New")
    assert n["prompt"] == "np"
    assert n["category_explicit"] == "Z"


def test_save_does_not_corrupt_other_rows(tmp_csv, patch_styles_dirs, monkeypatch):
    monkeypatch.setattr(csv_io, "invalidate_styles_cache", lambda: None)
    before = {s["name"]: dict(s) for s in csv_io.parse_styles_csv(str(tmp_csv))}
    csv_io.save_style_to_csv(
        "Test Style A",
        "only_a_changes",
        "bad_tag_a",
        "Desc A",
        source_file="styles.csv",
        category="BASE",
    )
    after = {s["name"]: dict(s) for s in csv_io.parse_styles_csv(str(tmp_csv))}
    assert after["Test Style B"] == before["Test Style B"]
    assert after["Style With Spaces"] == before["Style With Spaces"]
    assert after["Test Style A"]["prompt"] == "only_a_changes"


def test_delete_removes_row_by_name(tmp_csv, patch_styles_dirs, monkeypatch):
    monkeypatch.setattr(csv_io, "invalidate_styles_cache", lambda: None)
    before = len(csv_io.parse_styles_csv(str(tmp_csv)))
    csv_io.delete_style_from_csv("Test Style B", source_file="styles.csv")
    names = [s["name"] for s in csv_io.parse_styles_csv(str(tmp_csv))]
    assert "Test Style B" not in names
    assert len(names) == before - 1


def test_delete_nonexistent_name_no_raise(tmp_csv, patch_styles_dirs, monkeypatch):
    monkeypatch.setattr(csv_io, "invalidate_styles_cache", lambda: None)
    before = csv_io.parse_styles_csv(str(tmp_csv))
    # Implementation returns True and rewrites file with the same rows.
    assert csv_io.delete_style_from_csv("No Such Style", source_file="styles.csv") is True
    after = csv_io.parse_styles_csv(str(tmp_csv))
    assert len(after) == len(before)
    assert [s["name"] for s in after] == [s["name"] for s in before]


def test_save_updates_first_duplicate_only(tmp_path, patch_styles_dirs, monkeypatch):
    monkeypatch.setattr(csv_io, "invalidate_styles_cache", lambda: None)
    p = tmp_path / "styles.csv"
    p.write_text(
        "name,prompt,negative_prompt,description,category\n"
        "Dup,old1,,,\n"
        "Dup,old2,,,\n"
        "Other,x,,,\n",
        encoding="utf-8",
    )
    csv_io.save_style_to_csv(
        "Dup",
        "first_only",
        "",
        "",
        source_file="styles.csv",
        category="",
    )
    styles = csv_io.parse_styles_csv(str(p))
    dups = [s for s in styles if s["name"] == "Dup"]
    assert len(dups) == 2
    assert dups[0]["prompt"] == "first_only"
    assert dups[1]["prompt"] == "old2"
