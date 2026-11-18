#!/usr/bin/env python3
"""Minimal PUBLIC summary of private CI failures; no source, logs, values or secrets."""
from __future__ import annotations
import pathlib
import re
import sys

if len(sys.argv) != 3 or sys.argv[1] not in ("research", "types", "lint"):
    raise SystemExit("D04_DIAGNOSTIC_ARGUMENTS_INVALID")
stage = sys.argv[1]
data = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8", errors="replace")
lines = data.splitlines()
issued: set[str] = set()
def emit(value: str) -> None:
    if len(issued) < 24 and value not in issued:
        issued.add(value)
        print(value)
if stage == "research":
    # Test display titles are identifiers, never emit assertion payloads or traces.
    for line in lines:
        match = re.match(r"^\s*(?:not ok\s+([0-9]+)\s+-\s+|[✖×]\s+)([^<>]*?)\s*$", line)
        if match:
            title = (match.group(2) or "").split(" (", 1)[0][:100]
            title = "".join(c for c in title if c.isalnum() or c in " _./:-")
            if title:
                emit("D04_TEST_NAME=" + title)
    for item in sorted(set(re.findall(
        r"\b(?:ERR_[A-Z0-9_]+|AssertionError|TypeError|SyntaxError|ReferenceError|RangeError|ENOENT|EACCES)\b", data
    ))):
        emit("D04_TEST_ERROR_CLASS=" + item)
    for line in lines:
        if re.match(r"^\s*#\s*(?:tests|pass|fail|cancelled|skipped)\s+[0-9]+", line):
            emit("D04_TEST_" + re.sub(r"\s+", "_", line.strip().lstrip("#").strip()))
elif stage == "types":
    for line in lines:
        match = re.search(r"^(.*?\.(?:ts|tsx|mts))\((\d+),(\d+)\):\s+error\s+(TS\d+)", line)
        if match:
            file, row, col, code = match.groups()
            # Only relative path, source location and diagnostic code, never message.
            file = file.replace("\\", "/").split("d04-private/site/")[-1].lstrip("/")
            if re.fullmatch(r"[A-Za-z0-9_./$-]+", file):
                emit(f"D04_TS_ERROR={file}:{row}:{col}:{code}")
    if not issued:
        for kind in sorted(set(re.findall(r"error\s+TS\d+", data))):
            emit("D04_TS_CLASS=" + kind.replace(" ", "_"))
else:
    current = ""
    for line in lines:
        stripped = line.strip().replace("\\", "/")
        if re.fullmatch(r".*\.(?:ts|tsx|js|mjs|jsx)", stripped) and " " not in stripped:
            current = stripped.split("d04-private/site/")[-1].lstrip("/")
        match = re.match(r"^\s*(\d+):(\d+)\s+error\s+.+?\s+([a-zA-Z@/][a-zA-Z0-9@/_-]+)\s*$", line)
        if match:
            row, col, rule = match.groups()
            if re.fullmatch(r"[A-Za-z0-9_./$-]+", current):
                emit(f"D04_LINT_ERROR={current}:{row}:{col}:{rule}")
    total = re.search(r"(\d+)\s+problems?\s+\((\d+)\s+errors?,\s+(\d+)\s+warnings?\)", data)
    if total:
        emit(f"D04_LINT_COUNTS={total.group(1)}/{total.group(2)}/{total.group(3)}")
if not issued:
    print("D04_DIAGNOSTIC_CLASS_UNAVAILABLE")
