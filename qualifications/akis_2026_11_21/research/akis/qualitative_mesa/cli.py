"""Small local JSON CLI for existing Agent ToolProvider / future MCP integration.

stdin -> stdout is one JSON document. No network, file system writes, or code execution
from input. No new MCP server or duplicate IWXA runtime is created.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from .rules import InputError


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="IWXA qualitative operator AKIS (MODEL_ONLY)")
    parser.add_argument("--input", type=Path, help="Read JSON from a local file (default: stdin)")
    args = parser.parse_args(argv)
    try:
        if args.input:
            if args.input.stat().st_size > 1_000_000:
                raise InputError("INPUT_TOO_LARGE")
            scenario = json.loads(args.input.read_text(encoding="utf-8"))
        else:
            payload = sys.stdin.read(1_000_001)
            if len(payload) > 1_000_000:
                raise InputError("INPUT_TOO_LARGE")
            scenario = json.loads(payload)
        try:
            from .mesa_model import simulate
        except ModuleNotFoundError as exc:
            if exc.name == "mesa":
                raise InputError("MESA_3_5_2_DEPENDENCY_NOT_INSTALLED") from exc
            raise
        result = simulate(scenario)
    except (InputError, ValueError, OSError, json.JSONDecodeError) as exc:
        print(json.dumps({"schema": "IWXA_AKIS_QUALITATIVE_ERROR/0.1", "evidence": "MODEL_ONLY", "error": str(exc)}, ensure_ascii=False))
        return 2
    print(json.dumps(result, ensure_ascii=False, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
