"""Local worker for the pinned Rust4PM Python binding.
Input is the validated alias-only OCEL prepared by Activity.
No caller file paths or shell commands; no new IWXA store or exchange.
"""
import importlib.metadata
import json
from pathlib import Path
import sys
import tempfile

LIMIT = 8 * 1024 * 1024
VERSION = "0.7.1"


def main():
    if len(sys.argv) != 1:
        raise ValueError("arguments unsupported")
    if importlib.metadata.version("r4pm") != VERSION:
        raise ValueError("unqualified engine version")
    import r4pm

    raw = sys.stdin.buffer.read(LIMIT + 1)
    if not raw or len(raw) > LIMIT:
        raise ValueError("input limit")
    projected = json.loads(raw.decode("utf-8"))
    with tempfile.TemporaryDirectory(prefix="iwxa-activity-r4pm-") as directory:
        source = Path(directory) / "local.ocel.json"
        source.write_text(json.dumps(projected, ensure_ascii=True), encoding="utf-8")
        item = r4pm.import_item("SlimLinkedOCEL", str(source))
        result = r4pm.bindings.discover_dfg_from_ocel(item)
        output = json.dumps({
            "engine": "r4pm", "version": VERSION,
            "operation": "discover_dfg_from_ocel",
            "object_type_to_dfg": {
                kind: {field: graph[field] for field in (
                    "activities", "directly_follows_relations",
                    "start_activities", "end_activities")}
                for kind, graph in result["object_type_to_dfg"].items()
            },
        }, ensure_ascii=True, allow_nan=False, separators=(",", ":"))
        if len(output.encode("utf-8")) > LIMIT:
            raise ValueError("output limit")
        sys.stdout.write(output + "\n")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Do not echo a source record, local path or foreign engine exception.
        sys.exit(2)
