#!/usr/bin/env python3
"""Solve4X exact small JSON ZIP members, fetched via HTTP Range only.

Research-only; never writes raw member bytes or source event IDs to output.
No independent video review or human Task gold is claimed.
"""
from __future__ import annotations

import argparse
import json
from hashlib import sha256
from pathlib import Path
import struct
import sys
import zlib

import solve4x_zip_range_probe as zipidx

SCHEMA = "IWXA_SOLVE4X_SMALL_MEMBER_PAIR/0.1"
WANTED = ("scene01/scene01_vid.json", "scene01/scene01_ocel.json")
MAX_UNCOMPRESSED = 256 * 1024
MAX_COMPRESSED = 64 * 1024


def selected_members(index):
    targets = index.get("target_files", [])
    chosen = [next((e for e in targets if e.get("name") == x), None)
              for x in WANTED]
    zipidx.check(all(chosen), "EXACT_SCENE_PAIR_MISSING")
    zipidx.check(all(e["compression_method"] == 8 and
                     0 < e["compressed_bytes"] <= MAX_COMPRESSED and
                     0 < e["uncompressed_bytes"] <= MAX_UNCOMPRESSED
                     for e in chosen), "PAIR_MEMBER_UNSUPPORTED_COMPRESSION_OR_SIZE")
    return chosen


def decode_member(header: bytes, compressed: bytes, expected: dict) -> bytes:
    zipidx.check(len(header) >= 30, "ZIP_LOCAL_HEADER_SHORT")
    signature, version, flags, method, mtime, mdate, crc, csize, usize, namelen, extralen = (
        struct.unpack_from("<IHHHHHIIIHH", header, 0))
    zipidx.check(signature == 0x04034B50 and method == 8 and not flags & 1,
                 "ZIP_LOCAL_HEADER_INVALID")
    zipidx.check(flags & 8 == 0 or crc == 0 or crc == int(expected["zip_crc32"], 16),
                 "ZIP_LOCAL_CRC_CONFLICT")
    zipidx.check(len(compressed) == expected["compressed_bytes"],
                 "ZIP_MEMBER_COMPRESSED_SIZE_DRIFT")
    zipidx.check(csize in (0, expected["compressed_bytes"]) and
                 usize in (0, expected["uncompressed_bytes"]),
                 "ZIP_LOCAL_SIZE_DRIFT")
    zipidx.check(namelen <= 1024 and extralen <= 2048,
                 "ZIP_MEMBER_HEADER_TOO_LARGE")
    zipidx.check(len(header) == 30 + namelen + extralen,
                 "ZIP_MEMBER_LOCAL_HEADER_LENGTH_INVALID")
    filename = header[30:30 + namelen].decode("utf-8" if flags & 0x800 else "cp437")
    zipidx.check(filename == expected["name"], "ZIP_MEMBER_FILENAME_MISMATCH")
    obj = zlib.decompressobj(-15)
    data = obj.decompress(compressed, MAX_UNCOMPRESSED + 1)
    zipidx.check(obj.eof and len(data) <= MAX_UNCOMPRESSED and
                 not obj.unused_data and not obj.unconsumed_tail,
                 "ZIP_MEMBER_DECOMPRESSION_INCOMPLETE")
    zipidx.check(len(data) == expected["uncompressed_bytes"],
                 "ZIP_MEMBER_UNCOMPRESSED_SIZE_DRIFT")
    zipidx.check(f"{zlib.crc32(data):08x}" == expected["zip_crc32"],
                 "ZIP_MEMBER_CRC_MISMATCH")
    return data


def _download_member(url: str, archive_total: int, item: dict) -> bytes:
    offset = item["zip_local_header_offset"]
    first, at, _ = zipidx._read_range(url, f"bytes={offset}-{offset+29}",
                                      30, archive_total)
    zipidx.check(at == offset, "ZIP_MEMBER_LOCAL_POSITION_DRIFT")
    zipidx.check(len(first) == 30, "ZIP_MEMBER_LOCAL_HEADER_SHORT")
    signature, version, flags, method, t, d, crc, csize, usize, namelen, extralen = (
        struct.unpack_from("<IHHHHHIIIHH", first))
    zipidx.check(namelen <= 1024 and extralen <= 2048, "ZIP_MEMBER_HEADER_TOO_LARGE")
    rest_len = namelen + extralen
    if rest_len:
        rest, at, _ = zipidx._read_range(url,
                            f"bytes={offset+30}-{offset+29+rest_len}",
                            3072, archive_total)
        zipidx.check(at == offset + 30, "ZIP_MEMBER_NAME_POSITION_DRIFT")
    else:
        rest = b""
    payload_at = offset + 30 + rest_len
    compressed, at, _ = zipidx._read_range(url,
          f"bytes={payload_at}-{payload_at+item['compressed_bytes']-1}",
          MAX_COMPRESSED, archive_total)
    zipidx.check(at == payload_at, "ZIP_MEMBER_PAYLOAD_POSITION_DRIFT")
    return decode_member(first + rest, compressed, item)


def describe(value):
    """Only schema-level field names and aggregate lengths; NEVER source values."""
    result = {"root_type": type(value).__name__}
    if isinstance(value, dict):
        result["root_keys"] = sorted(str(k) for k in value)[:50]
        result["root_field_count"] = len(value)
        for field in ("events", "objects", "objectTypes", "eventTypes", "traces",
                      "activities", "annotations"):
            item = value.get(field)
            if isinstance(item, (list, dict)):
                result[field + "_count"] = len(item)
                first = next(iter(item.values()), None) if isinstance(item, dict) else (
                    item[0] if item else None)
                if isinstance(first, dict):
                    result[field + "_record_keys"] = sorted(str(k) for k in first)[:30]
    elif isinstance(value, list):
        result["records"] = len(value)
        if value and isinstance(value[0], dict):
            result["record_keys"] = sorted(str(k) for k in value[0])[:30]
    for field in ("ocel:events", "ocel:objects", "localisations", "label"):
        child = value.get(field) if isinstance(value, dict) else None
        if isinstance(child, (dict, list)):
            sample = next(iter(child.values()), None) if isinstance(child, dict) else (
                child[0] if child else None)
            shape = {"container_type": type(child).__name__,
                     "container_count": len(child),
                     "sample_type": type(sample).__name__}
            if isinstance(sample, dict):
                shape["sample_record_keys"] = sorted(str(k) for k in sample)[:30]
                for inner_key, inner_val in sample.items():
                    if isinstance(inner_val, (dict, list)):
                        shape["nested_field_shapes"] = {
                            str(inner_key): {"kind": type(inner_val).__name__,
                                             "count": len(inner_val),
                                             "keys": (sorted(str(k) for k in inner_val)[:40]
                                                      if isinstance(inner_val, dict) else []),
                                             "item_shape": (
                                                 sorted(str(k) for k in inner_val[0])[:30]
                                                 if isinstance(inner_val, list) and inner_val
                                                 and isinstance(inner_val[0], dict) else []),
                                             "value_type": (
                                                 type(next(iter(inner_val.values()))).__name__
                                                 if isinstance(inner_val, dict) and inner_val
                                                 else "UNKNOWN")}
                        }
                        break
            elif isinstance(sample, list):
                shape["sample_list_length"] = len(sample)
                if sample and isinstance(sample[0], dict):
                    shape["sample_list_record_keys"] = sorted(str(k) for k in sample[0])[:30]
            result[field + "_nested_structure"] = shape
    return result


def analyze_members(raw_by_name: dict, provenance: dict) -> dict:
    zipidx.check(set(raw_by_name) == set(WANTED), "INCOMPLETE_PAIR")
    summaries = {}
    for name in WANTED:
        raw = raw_by_name[name]
        zipidx.check(0 < len(raw) <= MAX_UNCOMPRESSED, "PAIR_BYTES_INVALID")
        try:
            value = json.loads(raw.decode("utf-8"))
        except (ValueError, UnicodeError):
            raise zipidx.Hold("PAIR_JSON_INVALID") from None
        summaries[name] = {
            "sha256": sha256(raw).hexdigest(), "byte_length": len(raw),
            "structure": describe(value),
        }
    return {
        "schema": SCHEMA,
        "status": "TWO_DIFFERENT_LOG_DERIVATIVES_LOADED_NOT_INDEPENDENTLY_REVIEWED",
        "source": provenance,
        "members": summaries,
        "pair_bytes_loaded": True,
        "no_full_archive_download": True,
        "raw_member_content_exported": False,
        "author_annotation_is_independent_video_ground_truth": False,
        "two_modalities_case_alignment": "NOT_MEASURED",
        "task_quality": "NOT_MEASURED",
        "accepted_tasks": 0,
    }


def probe():
    index = zipidx.probe()
    zipidx.check(index["status"] == "ZIP_RANGE_INDEX_ONLY_NOT_MULTIMODAL_REPLAY",
                 "ZIP_SOURCE_INDEX_HOLD")
    chosen = selected_members(index)
    meta = zipidx._metadata()
    zipidx.check(meta["archive_size"] == index["source"]["archive_bytes"],
                 "ARCHIVE_SIZE_CHANGED")
    raw = {e["name"]: _download_member(meta["download_url"],
             meta["archive_size"], e) for e in chosen}
    return analyze_members(raw, {
        "figshare_article": meta["article_id"], "file_id": meta["file_id"],
        "central_sha256": index["source"]["central_sha256"],
        "figshare_metadata_sha256": meta["metadata_sha256"],
        "archive_bytes": meta["archive_size"],
    })


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True, type=Path)
    opts = ap.parse_args()
    zipidx.check(not opts.out.exists(), "OUTPUT_ALREADY_EXISTS")
    try:
        report = probe()
        good = True
    except (zipidx.Hold, OSError, ValueError, TimeoutError) as error:
        report = {
            "schema": SCHEMA,
            "status": "SELECTIVE_PAIR_SOURCE_HOLD",
            "failure_class": type(error).__name__,
            "failure_code": str(error)[:100] if isinstance(error, zipidx.Hold)
                            else "EXTERNAL_SOURCE_REQUEST_FAILED",
            "pair_bytes_loaded": False,
            "no_full_archive_download": True,
            "raw_member_content_exported": False,
            "two_modalities_case_alignment": "NOT_MEASURED",
            "task_quality": "NOT_MEASURED",
            "accepted_tasks": 0,
        }
        good = False
    opts.out.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True)
                        + "\n", encoding="utf-8")
    print("SOLVE4X_PAIR", report["status"],
          "members", len(report.get("members", {})),
          "alignment", report["two_modalities_case_alignment"])
    return 0 if good else 2


if __name__ == "__main__":
    sys.exit(main())
