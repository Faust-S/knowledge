#!/usr/bin/env python3
"""Privacy-preserving build error classifier for private D04 source validation.

Print only predefined failure categories and bounded codes. Never print source,
private paths, URLs, user inputs, token/secret values or raw build log lines.
"""
from __future__ import annotations

import pathlib
import re
import sys

if len(sys.argv) != 2:
    raise SystemExit("D04_BUILD_DIAGNOSTICS_ARGS_INVALID")
data = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
classes: list[str] = []
patterns = {
    "GIT_SOURCE_DRIFT": r"(?:_CANONICAL_BLOB_DRIFT|_SOURCE_MISSING|_HOST_COLLISION|_EXACT_SOURCE_MISMATCH)",
    "TYPESCRIPT_ERROR": r"(?:error TS\d{4}|TS\d{4}|\btsc\s+failed\b)",
    "VITE_TRANSFORM_ERROR": r"(?:\bTransform failed\b|\[vite\].*error|error during build|Plugin.*vite)",
    "MISSING_IMPORT": r"(?:Cannot find module|Could not resolve|Failed to resolve|Could not load|does not provide an export)",
    "SYNTAX_ERROR": r"(?:SyntaxError|Unexpected token|Expected \";\"|Expected identifier)",
    "ASSERTION_ERROR": r"(?:AssertionError|ERR_ASSERTION)",
    "DEPENDENCY_ERROR": r"(?:ERESOLVE|npm ERR|ERR_MODULE_NOT_FOUND|Cannot resolve dependency)",
    "NETWORK_ERROR": r"(?:ENOTFOUND|ETIMEDOUT|ECONNRESET|certificate verify failed)",
    "FILE_SYSTEM_ERROR": r"(?:ENOENT|EACCES|EPERM|EEXIST)",
    "CORE_QUALIFICATION_ERROR": r"(?:IWXA_T2_|KERNEL_[A-Z_]*FAILED|FACTORY2_)",
    "BUILD_DISPATCH_ERROR": r"(?:Error \[ERR_|subprocess exited|non-zero exit code|Command failed)",
    "RUNTIME_ERROR": r"(?:TypeError|ReferenceError|RangeError)",
}
for name, pattern in patterns.items():
    if re.search(pattern, data, re.IGNORECASE):
        classes.append(name)
if not classes:
    classes.append("UNKNOWN")
print("D04_BUILD_FAILURE_CLASSES=" + ",".join(classes[:9]))
error_codes = sorted(set(re.findall(
    r"\b(?:BAZMED|D04|IWXA|FACTORY2|KERNEL)_[A-Z0-9_]{3,65}\b", data
)))
for code in error_codes[:12]:
    print("D04_BUILD_FAILURE_CODE=" + code)
for code in sorted(set(re.findall(r"\berror TS\d{4}\b", data)))[:8]:
    print("D04_BUILD_TS_CODE=" + code.replace(" ", "_"))
