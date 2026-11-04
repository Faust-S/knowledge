import io
import json
import struct
import sys
from pathlib import Path
from unittest import TestCase
import zipfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import solve4x_small_member_pair as pair
import solve4x_zip_range_probe as index

class MemberTests(TestCase):
    def test_deflate_member_exact_crc_and_name(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as z:
            z.writestr("scene01/scene01_vid.json", '{"events":[{"activity":"test"}]}')
        blob = buf.getvalue()
        offset, size, num = index.parse_eocd(blob, 0, len(blob))
        entry = index.parse_central_directory(blob[offset:offset + size], num)[0]
        local = entry["zip_local_header_offset"]
        data = blob[local:local + 30]
        header_len = struct.unpack_from("<H", data, 26)[0] + struct.unpack_from("<H", data, 28)[0]
        full_head = blob[local:local + 30 + header_len]
        payload = blob[local + 30 + header_len: local + 30 + header_len + entry["compressed_bytes"]]
        restored = pair.decode_member(full_head, payload, entry)
        self.assertEqual(json.loads(restored)["events"][0]["activity"], "test")
        self.assertEqual(pair.describe(json.loads(restored))["events_count"], 1)

    def test_crc_mismatch_is_hold(self):
        with self.assertRaisesRegex(index.Hold, "ZIP_MEMBER_CRC_MISMATCH"):
            # Stored raw method is unsupported even when CRC is forged.
            import zlib
            import struct
            content = b'{}'
            cmp = zlib.compressobj(wbits=-15)
            raw = cmp.compress(content) + cmp.flush()
            name = b"scene01/scene01_vid.json"
            h = struct.pack("<IHHHHHIIIHH", 0x04034B50, 20, 0, 8, 0, 0,
                  0, len(raw), len(content), len(name), 0) + name
            pair.decode_member(h, raw, {
                "name": name.decode(), "compressed_bytes":len(raw),
                "uncompressed_bytes": len(content), "zip_crc32":"12345678"})

    def test_never_export_raw_json_values(self):
        example = {
            "scene01/scene01_vid.json": b'{"events":[{"person_secret":"private"}]}',
            "scene01/scene01_ocel.json": b'{"events":{"123":{"actor":"private"}}}',
        }
        report = pair.analyze_members(example, {"source": "test"})
        flat = json.dumps(report)
        self.assertNotIn("private", flat)
        self.assertNotIn('"123"', flat)
        self.assertEqual(report["two_modalities_case_alignment"], "NOT_MEASURED")
        self.assertFalse(report["author_annotation_is_independent_video_ground_truth"])

    def test_missing_pair_holds(self):
        with self.assertRaisesRegex(index.Hold, "INCOMPLETE_PAIR"):
            pair.analyze_members({"scene01/scene01_vid.json":b'{}'}, {})

    def test_oversized_pair_holds(self):
        entries = [{ "name": name, "compressed_bytes": 2048,
                    "uncompressed_bytes": 1024, "compression_method": 8}
                  for name in pair.WANTED]
        entries[0]["uncompressed_bytes"] = 999999
        with self.assertRaisesRegex(index.Hold, "PAIR_MEMBER_UNSUPPORTED"):
            pair.selected_members({"target_files":entries})
