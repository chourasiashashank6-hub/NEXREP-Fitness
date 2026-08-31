#!/usr/bin/env python3
"""Replace hardcoded light-theme color literals with imports from theme/colors.ts."""

from __future__ import annotations

import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "src"
COLORS_FILE = ROOT / "theme" / "colors.ts"

CONST_PATTERNS = {
    "GREEN": r'const\s+GREEN\s*=\s*"#0F6E56"\s*;?\s*\n?',
    "GREEN_LIGHT": r'const\s+GREEN_LIGHT\s*=\s*"#E8F5EE"\s*;?\s*\n?',
    "BG": r'const\s+BG\s*=\s*"#F7F6F3"\s*;?\s*\n?',
    "TEXT": r'const\s+TEXT\s*=\s*"#1A1A18"\s*;?\s*\n?',
    "MUTED": r'const\s+MUTED\s*=\s*"#6F766F"\s*;?\s*\n?',
    "BORDER": r'const\s+BORDER\s*=\s*"#ECEAE5"\s*;?\s*\n?',
    "WHITE": r'const\s+WHITE\s*=\s*"#FFFFFF"\s*;?\s*\n?',
}

INLINE_REPLACEMENTS = {
    '"#0F6E56"': "GREEN",
    "'#0F6E56'": "GREEN",
    '"#E8F5EE"': "GREEN_LIGHT",
    "'#E8F5EE'": "GREEN_LIGHT",
    '"#F7F6F3"': "BG",
    "'#F7F6F3'": "BG",
    '"#1A1A18"': "TEXT",
    "'#1A1A18'": "TEXT",
    '"#6F766F"': "MUTED",
    "'#6F766F'": "MUTED",
    '"#ECEAE5"': "BORDER",
    "'#ECEAE5'": "BORDER",
    '"#FFFFFF"': "WHITE",
    "'#FFFFFF'": "WHITE",
}


def relative_import_path(file_path: Path) -> str:
    rel = os.path.relpath(COLORS_FILE, file_path.parent).replace("\\", "/")
    if not rel.startswith("."):
        rel = f"./{rel}"
    return rel[:-3] if rel.endswith(".ts") else rel


def collect_needed_symbols(content: str) -> set[str]:
    needed: set[str] = set()
    for name, pattern in CONST_PATTERNS.items():
        if re.search(pattern, content):
            needed.add(name)
    for literal, symbol in INLINE_REPLACEMENTS.items():
        if literal in content:
            needed.add(symbol)
    return needed


def strip_const_defs(content: str) -> str:
    for pattern in CONST_PATTERNS.values():
        content = re.sub(pattern, "", content)
    return content


def replace_inline_literals(content: str, symbols: set[str]) -> str:
    # Only replace green literal if GREEN is imported
    if "GREEN" in symbols:
        content = content.replace('"#0F6E56"', "GREEN").replace("'#0F6E56'", "GREEN")
    if "GREEN_LIGHT" in symbols:
        content = content.replace('"#E8F5EE"', "GREEN_LIGHT").replace("'#E8F5EE'", "GREEN_LIGHT")
    if "BG" in symbols:
        content = content.replace('"#F7F6F3"', "BG").replace("'#F7F6F3'", "BG")
    if "TEXT" in symbols:
        content = content.replace('"#1A1A18"', "TEXT").replace("'#1A1A18'", "TEXT")
    if "MUTED" in symbols:
        content = content.replace('"#6F766F"', "MUTED").replace("'#6F766F'", "MUTED")
    if "BORDER" in symbols:
        content = content.replace('"#ECEAE5"', "BORDER").replace("'#ECEAE5'", "BORDER")
    if "WHITE" in symbols:
        content = content.replace('"#FFFFFF"', "WHITE").replace("'#FFFFFF'", "WHITE")
    return content


def has_colors_import(content: str) -> bool:
    return "from" in content and "theme/colors" in content


def insert_import(content: str, import_path: str, symbols: list[str]) -> str:
    import_line = f'import {{ {", ".join(symbols)} }} from "{import_path}";\n'
    if has_colors_import(content):
        return content
    lines = content.splitlines(keepends=True)
    last_import_idx = -1
    for i, line in enumerate(lines):
        if line.startswith("import "):
            last_import_idx = i
    if last_import_idx >= 0:
        lines.insert(last_import_idx + 1, import_line)
        return "".join(lines)
    return import_line + content


def process_file(path: Path) -> bool:
    if path == COLORS_FILE:
        return False
    original = path.read_text(encoding="utf-8")
    if "#0F6E56" not in original and not any(
        re.search(p, original) for p in CONST_PATTERNS.values()
    ):
        return False

    needed = collect_needed_symbols(original)
    if not needed:
        return False

    content = strip_const_defs(original)
    content = replace_inline_literals(content, needed)

    symbols = sorted(needed, key=lambda s: ["GREEN", "GREEN_LIGHT", "BG", "TEXT", "MUTED", "BORDER", "WHITE"].index(s))
    import_path = relative_import_path(path)
    content = insert_import(content, import_path, symbols)

    if content != original:
        path.write_text(content, encoding="utf-8")
        return True
    return False


def main() -> None:
    changed = 0
    for path in sorted(ROOT.rglob("*")):
        if path.suffix not in {".ts", ".tsx"}:
            continue
        if process_file(path):
            changed += 1
            print(path.relative_to(ROOT.parent))
    print(f"Updated {changed} files")


if __name__ == "__main__":
    main()
