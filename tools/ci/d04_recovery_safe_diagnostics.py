#!/usr/bin/env python3
"""Bounded class-and-position diagnosis of private D04 UI logs.
Never print raw log lines, browser URLs, challenge values, source or stack traces.
"""
from __future__ import annotations
import pathlib
import re
import sys

if len(sys.argv) != 2:
    raise SystemExit("D04_RECOVERY_DIAGNOSTIC_USAGE")
lines = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace").splitlines()
emitted: set[str] = set()
def emit(item: str) -> None:
    if item not in emitted and len(emitted) < 16:
        emitted.add(item)
        print(item)
for line in lines:
    for code in re.findall(r"\b(?:D04|BAZMED|FACTORY2|IWXA|KERNEL)_[A-Z0-9_]{3,75}\b", line):
        emit("D04_RECOVERY_ERROR_CODE=" + code)
    for kind in ("TimeoutError", "AssertionError", "TypeError", "ReferenceError", "SyntaxError",
                 "ProtocolError", "TargetClosedError", "Error"):
        if re.search(r"\b"+re.escape(kind)+r"(?:\s*:|$)", line):
            emit("D04_RECOVERY_ERROR_CLASS=" + kind)
    for filename in ("recovery-revisions.browser.mjs", "real-kernel-e2e.mjs",
                     "independent-browser-witness.mjs"):
        # Only a fixed, pre-approved filename and numeric coordinates.
        match = re.search(re.escape(filename)+r":(\d+):(\d+)", line)
        if match:
            emit(f"D04_RECOVERY_ERROR_LOCATION={filename}:{match.group(1)}:{match.group(2)}")
if not emitted:
    print("D04_RECOVERY_DIAGNOSTIC_CLASS_UNAVAILABLE")
