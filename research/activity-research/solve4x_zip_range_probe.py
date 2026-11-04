#!/usr/bin/env python3
"""Small, read-only HTTP-range ZIP index probe for Figshare Solve4X.

No 2.8 GB archive download. No raw annotated/media bytes exported.
ZIP central directory is an index, not evidence of observed human activity.
"""
from __future__ import annotations
import argparse
from hashlib import sha256
import json
from pathlib import Path
import re
import struct
import sys
from urllib.parse import urlparse
from urllib.request import Request, urlopen

ART_ID = 25246291
ARCHIVE_NAME = "solve4x.zip"
MAX_TAIL = 131072
MAX_DIRECTORY = 8 * 1024 * 1024
MAX_METADATA = 1024 * 1024
TARGETS = ("scene01_vid.json", "scene01_ocel.json", "scene01_video_ocel.json",
           "scene01_ui.csv", "itam.ocelxml", "itam_ocel.json", "global_ocel.json")
SCHEMA = "IWXA_SOLVE4X_ZIP_RANGE_INDEX/0.1"


class Hold(Exception):
    pass


def check(condition: bool, error: str) -> None:
    if not condition:
        raise Hold(error)


def range_response(start: int, end: int, total: int, data: bytes) -> tuple[bytes, int]:
    """Strict response format for a bounded partial response."""
    check(total > 0 and 0 <= start <= end < total, "RANGE_BOUNDS_INVALID")
    check(len(data) == end - start + 1, "RANGE_BYTE_COUNT_INVALID")
    return data, start


def parse_content_range(header: str, expected: int | None = None) -> tuple[int, int, int]:
    match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", header or "")
    check(match is not None, "HTTP_RANGE_HEADER_INVALID")
    start, end, total = map(int, match.groups())
    check(total > 0 and 0 <= start <= end < total, "HTTP_RANGE_BOUNDS_INVALID")
    if expected is not None:
        check(total == expected, "HTTP_RANGE_TOTAL_MISMATCH")
    return start, end, total


def parse_eocd(tail: bytes, offset: int, archive_total: int) -> tuple[int, int, int]:
    """Reject multivolume and ZIP64 archives instead of guessing offsets."""
    last = tail.rfind(b"PK\x05\x06")
    check(last >= 0 and last + 22 <= len(tail), "ZIP_END_RECORD_NOT_FOUND")
    (signature, disk, disk_cd, on_disk, count, central_size, central_offset,
     comment_size) = struct.unpack_from("<IHHHHIIH", tail, last)
    check(signature == 0x06054B50 and disk == 0 and disk_cd == 0
          and on_disk == count, "ZIP_MULTIVOLUME_UNSUPPORTED")
    check(count > 0, "ZIP_EMPTY_DIRECTORY")
    check(central_offset != 0xFFFFFFFF and central_size != 0xFFFFFFFF
          and count != 0xFFFF, "ZIP64_INDEX_NOT_IMPLEMENTED_HOLD")
    check(central_size <= MAX_DIRECTORY and central_size > 0,
          "ZIP_DIRECTORY_TOO_LARGE")
    check(last + 22 + comment_size == len(tail), "ZIP_END_RECORD_LENGTH_INVALID")
    check(central_offset + central_size == offset + last,
          "ZIP_CENTRAL_OFFSET_MISMATCH")
    check(central_offset + central_size <= archive_total,
          "ZIP_CENTRAL_OUT_OF_BOUNDS")
    return central_offset, central_size, count


def parse_central_directory(directory: bytes, entries_expected: int) -> list[dict]:
    offset, entries = 0, []
    while offset < len(directory):
        check(offset + 46 <= len(directory), "ZIP_TRUNCATED_CENTRAL_DIRECTORY")
        values = struct.unpack_from("<IHHHHHHIIIHHHHHII", directory, offset)
        (signature, _made, _need, flags, method, _time, _date, crc, size_zip,
         size_raw, name_len, extra_len, comment_len, disk, _internal,
         _external, local_off) = values
        check(signature == 0x02014B50, "ZIP_CENTRAL_RECORD_INVALID")
        check(disk == 0 and not (flags & 1), "ZIP_ENCRYPTION_OR_MULTIVOLUME_HOLD")
        check(local_off != 0xFFFFFFFF and size_zip != 0xFFFFFFFF
              and size_raw != 0xFFFFFFFF, "ZIP64_ENTRY_HOLD")
        finish = offset + 46 + name_len + extra_len + comment_len
        check(finish <= len(directory), "ZIP_CENTRAL_ENTRY_TRUNCATED")
        raw_name = directory[offset + 46:offset + 46 + name_len]
        check(b"\x00" not in raw_name, "ZIP_NAME_INVALID")
        try:
            name = raw_name.decode("utf-8" if flags & 0x800 else "cp437")
        except UnicodeDecodeError:
            raise Hold("ZIP_NAME_ENCODING_INVALID") from None
        entries.append({
            "name": name, "compressed_bytes": size_zip, "uncompressed_bytes": size_raw,
            "compression_method": method, "zip_local_header_offset": local_off,
            "zip_crc32": f"{crc:08x}",
        })
        offset = finish
    check(len(entries) == entries_expected, "ZIP_CENTRAL_COUNT_MISMATCH")
    return entries


def summarize(entries: list[dict], source: dict) -> dict:
    matches = [e for e in entries if any(
        e["name"].split("/")[-1] == item for item in TARGETS)]
    return {
        "schema": SCHEMA,
        "status": "ZIP_RANGE_INDEX_ONLY_NOT_MULTIMODAL_REPLAY",
        "source": source,
        "archive_entry_count": len(entries),
        "target_files": matches,
        "target_files_count": len(matches),
        "target_name_both_video_and_ocel": (
            any(x["name"].endswith("/scene01_vid.json") for x in matches)
            and any(x["name"].endswith("/scene01_ocel.json") for x in matches)),
        "full_archive_downloaded": False,
        "media_downloaded": False,
        "original_source_files_exported": False,
        "case_level_two_modalities_loaded": False,
        "source_independent_alignment": "NOT_MEASURED",
        "human_task_gold": "NOT_MEASURED",
        "accepted_tasks": 0,
    }


def _read_range(download: str, range_value: str, cap: int, total: int | None = None):
    request = Request(download, headers={
        "User-Agent": "IWXA-Solve4X-Source-Range/0.1",
        "Range": range_value,
        "Accept-Encoding": "identity",
    })
    with urlopen(request, timeout=22) as response:
        check(response.status == 206, "HTTP_RANGE_UNSUPPORTED_HOLD")
        start, end, received_total = parse_content_range(
            response.headers.get("Content-Range", ""), total)
        check(end - start + 1 <= cap, "HTTP_RANGE_RESPONSE_TOO_LARGE")
        payload = response.read(cap + 1)
    check(len(payload) == end - start + 1, "HTTP_RANGE_BYTE_COUNT_MISMATCH")
    return payload, start, received_total


def _metadata() -> dict:
    req = Request("https://api.figshare.com/v2/articles/25246291",
                  headers={"Accept": "application/json"})
    with urlopen(req, timeout=18) as response:
        raw = response.read(MAX_METADATA + 1)
    check(0 < len(raw) <= MAX_METADATA, "FIGSHARE_METADATA_SIZE_HOLD")
    obj = json.loads(raw.decode("utf-8"))
    check(obj.get("id") == ART_ID, "FIGSHARE_ARTICLE_MISMATCH")
    matches = [x for x in obj.get("files", [])
               if isinstance(x, dict) and x.get("name") == ARCHIVE_NAME]
    check(len(matches) == 1, "FIGSHARE_ARCHIVE_NOT_UNIQUE")
    file_obj = matches[0]
    check(file_obj.get("id") == 45865263 and
          file_obj.get("size") == 2814811460, "FIGSHARE_ARCHIVE_VERSION_DRIFT")
    url = file_obj.get("download_url", "")
    parsed = urlparse(url)
    check(parsed.scheme == "https" and parsed.hostname in
          ("ndownloader.figshare.com", "figshare.com"), "FIGSHARE_DOWNLOAD_HOST_UNVERIFIED")
    return {
        "download_url": url,
        "archive_size": file_obj["size"],
        "article_id": ART_ID,
        "file_id": file_obj["id"],
        "metadata_sha256": sha256(raw).hexdigest(),
    }


def probe() -> dict:
    meta = _metadata()
    archive_size = meta["archive_size"]
    tail, start, total = _read_range(
        meta["download_url"], f"bytes=-{MAX_TAIL}", MAX_TAIL, archive_size)
    directory_start, directory_size, entries_count = parse_eocd(tail, start, total)
    if directory_start >= start and directory_start + directory_size <= start + len(tail):
        index = tail[directory_start - start:directory_start - start + directory_size]
    else:
        index, position, _ = _read_range(meta["download_url"],
                          f"bytes={directory_start}-{directory_start+directory_size-1}",
                          MAX_DIRECTORY, total)
        check(position == directory_start, "ZIP_DIRECTORY_POSITION_MISMATCH")
    entries = parse_central_directory(index, entries_count)
    return summarize(entries, {
        "dataset_figshare_id": ART_ID, "archive_file_id": meta["file_id"],
        "archive_bytes": archive_size,
        "metadata_sha256": meta["metadata_sha256"],
        "tail_sha256": sha256(tail).hexdigest(),
        "central_sha256": sha256(index).hexdigest(),
        "download_url_exported": False,
    })


def main() -> int:
    args = argparse.ArgumentParser()
    args.add_argument("--out", type=Path, required=True)
    opts = args.parse_args()
    check(not opts.out.exists(), "OUTPUT_ALREADY_EXISTS")
    try:
        output = probe()
        success = True
    except (Hold, OSError, ValueError, TimeoutError, json.JSONDecodeError) as error:
        output = {
            "schema": SCHEMA, "status": "ZIP_RANGE_ACCESS_OR_FORMAT_HOLD",
            "failure_class": type(error).__name__,
            "failure_code": str(error)[:100] if isinstance(error, Hold) else
                            "EXTERNAL_SOURCE_REQUEST_FAILED",
            "full_archive_downloaded": False,
            "case_level_two_modalities_loaded": False,
            "human_task_gold": "NOT_MEASURED",
            "accepted_tasks": 0,
        }
        success = False
    opts.out.write_text(json.dumps(output, indent=2, sort_keys=True) + "\n",
                        encoding="utf-8")
    print("SOLVE4X_ZIP_RANGE", output["status"],
          "targets", output.get("target_files_count", "UNKNOWN"))
    return 0 if success else 2


if __name__ == "__main__":
    sys.exit(main())
