"""Bounded public diagnostic for T2-owned D04 browser witness failures.

Read an ephemeral private log but reveal only allowlisted public UI stage codes.
Never write the log to stdout or upload it as an artifact.
"""
from pathlib import Path
import sys

MARKERS = {
    "NATIVE_SAVE_PROMPT": "Подтвердите сохранение:",
    "PERSONAL_CREATE": "life-os-create-personal",
    "PERSONAL_OVERVIEW": "life-os-personal-dashboard",
    "PENDING_CONFIRM": "life-os-pending-continue",
    "NATIVE_WORKSPACE": "bazmed-life-os-workspace-selector",
    "KERNEL_RESULT": "data-t2-result-kind",
    "PUBLIC_SAVE": "bazmed-save-life-os",
}


def main() -> None:
    if len(sys.argv) != 2:
        print("D04_NATIVE_WAIT_STAGE=UNAVAILABLE")
        return
    try:
        content = Path(sys.argv[1]).read_text(encoding="utf-8", errors="replace")
    except (OSError, ValueError):
        print("D04_NATIVE_WAIT_STAGE=UNAVAILABLE")
        return
    rows = content.splitlines()
    relevant = "\n".join(
        row for row in rows
        if "waiting for locator(" in row
        or "locator.waitFor:" in row
        or "locator.click:" in row
    )
    matches = [code for code, needle in MARKERS.items() if needle in relevant]
    print("D04_NATIVE_WAIT_STAGE=" + ("_".join(matches[:2]) if matches else "UNCLASSIFIED"))
    print("D04_NATIVE_WAIT_CLASS=" + (
        "TIMEOUT" if "TimeoutError" in content else "OTHER"
    ))


if __name__ == "__main__":
    main()
