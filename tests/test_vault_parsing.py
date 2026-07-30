"""Characterization tests for the shared vault-parsing primitives.

These pin the behavior that both server/vault.py and scripts/markdown_reader.py
now share, including the frontmatter edge cases the parser feeds the entire
JSON cache from.
"""
from scripts import vault_parsing as vp
from server import vault as server_vault
from scripts import markdown_reader


def test_split_frontmatter_happy_path():
    fm, body = vp.split_frontmatter("---\nkind: task\nstatus: open\n---\n# Title\nbody\n")
    assert fm == {"kind": "task", "status": "open"}
    assert body == "# Title\nbody\n"


def test_split_frontmatter_edge_cases():
    # No frontmatter at all
    assert vp.split_frontmatter("# Just a body") == ({}, "# Just a body")
    # Opening fence but no closing fence -> treated as no frontmatter
    assert vp.split_frontmatter("---\nkind: task\n# never closed") == ({}, "---\nkind: task\n# never closed")
    # Empty frontmatter block
    assert vp.split_frontmatter("---\n---\nbody") == ({}, "body")
    # CRLF line endings
    fm, _ = vp.split_frontmatter("---\r\nkind: task\r\n---\r\nbody")
    assert fm == {"kind": "task"}
    # Non-dict YAML (a list) degrades to {} rather than corrupting downstream
    assert vp.split_frontmatter("---\n- a\n- b\n---\nbody") == ({}, "body")
    # Malformed YAML is swallowed, not raised
    assert vp.split_frontmatter("---\nkey: : :\n---\nbody")[0] == {}


def test_scalar_and_listify():
    assert vp.scalar(None) is None
    assert vp.scalar(["a"]) is None
    assert vp.scalar(3) == "3"
    assert vp.listify(None) == []
    assert vp.listify("  ") == []
    assert vp.listify("one") == ["one"]
    assert vp.listify(["a", None, "b"]) == ["a", "b"]


def test_snippet_and_word_count():
    # word_count strips code spans and markdown links but not heading markers.
    assert vp.word_count("# Heading\nsome `code` and [a](http://x) words") == 4
    long = "x " * 200
    out = vp.snippet(long)
    assert out.endswith("…")
    assert len(out) <= 221


def test_both_consumers_use_the_same_shared_helpers():
    # The whole point of the consolidation: one implementation, no drift.
    assert server_vault.split_frontmatter is markdown_reader.split_frontmatter is vp.split_frontmatter
    assert server_vault.snippet is markdown_reader.snippet is vp.snippet
    assert server_vault.extract_codex_instructions is markdown_reader.extract_codex_instructions


def test_core_fields_stay_consumer_specific():
    # CORE_FIELDS is intentionally NOT shared: the server promotes assignee to a
    # top-level field; the reader exposes it via `properties`. Guard the divergence.
    assert "assignee" in server_vault.CORE_FIELDS
    assert "assignee" not in markdown_reader.CORE_FIELDS
