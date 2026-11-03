"""Load an EXACT, read-only U1/E5 research snapshot owned by Faust-S/iwxa.

This is a frozen QA source dependency, not a new implementation, Task Engine,
product U1, or an independently authorized use of private customer data.
"""
from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path
import xml.etree.ElementTree as ET

HERE = Path(__file__).resolve().parent
U1_FILE = HERE / "owner_pins" / "universal_evidence.py"
E5_XML = HERE / "owner_pins" / "E5_LABEL_STUDIO_SOURCE_FIRST.xml"
U1_GIT_BLOB = "eb15aec5ba1a749c29d7c40a868127e1a384b6bf"
E5_XML_GIT_BLOB = "7b82dbd05b4e28c53446d863c5bb48b72245a10d"


class PinMismatch(ValueError):
    """The owner source snapshot or Label Studio format has changed."""


def git_blob_sha(raw: bytes) -> str:
    header = b"blob " + str(len(raw)).encode("ascii") + b"\x00"
    return hashlib.sha1(header + raw).hexdigest()


def _verified_bytes(path: Path, expected: str) -> bytes:
    if path.is_symlink() or not path.is_file():
        raise PinMismatch("OWNER_SNAPSHOT_UNAVAILABLE")
    raw = path.read_bytes()
    if git_blob_sha(raw) != expected:
        raise PinMismatch("OWNER_SNAPSHOT_SHA_MISMATCH")
    return raw


def load_native_u1() -> tuple[object, str]:
    _verified_bytes(U1_FILE, U1_GIT_BLOB)
    spec = importlib.util.spec_from_file_location("_crosslab_pinned_owner_u1", U1_FILE)
    if spec is None or spec.loader is None:
        raise PinMismatch("OWNER_U1_IMPORT_UNAVAILABLE")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    if (getattr(module, "VERSION", None) != "IWXA_ENGINE_UNIVERSAL_EVIDENCE/0.1"
            or not callable(getattr(module, "inspect", None))
            or not callable(getattr(module, "review_hints", None))):
        raise PinMismatch("OWNER_U1_INTERFACE_MISMATCH")
    return module, U1_GIT_BLOB


def check_label_studio_xml() -> str:
    """Validate the ORIGINAL E5 source-first XML without defining new labels."""
    raw = _verified_bytes(E5_XML, E5_XML_GIT_BLOB)
    try:
        root = ET.fromstring(raw)
    except ET.ParseError:
        raise PinMismatch("E5_XML_INVALID") from None
    if (root.tag != "View"
            or [(x.attrib.get("name"), x.attrib.get("toName"))
                for x in root.findall("Labels")] != [("taskness", "source_text")]
            or [(x.attrib.get("name"), x.attrib.get("toName"))
                for x in root.findall("Choices")] != [("review_coverage", "source_text")]
            or len(root.findall("Text")) != 1
            or root.find("Text").attrib.get("name") != "source_text"
            or root.find("Text").attrib.get("value") != "$source_text"):
        raise PinMismatch("E5_LABEL_STUDIO_INTERFACE_MISMATCH")
    return E5_XML_GIT_BLOB
