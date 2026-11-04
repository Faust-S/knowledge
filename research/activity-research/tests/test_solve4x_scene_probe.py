"""Synthetic Solve4X HTML fixtures: structure tests, not human activity gold."""
import json
import sys
from pathlib import Path
from unittest import TestCase, main

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from solve4x_scene_probe import inspect_scene, analyze, Hold


def sample(*, omit=False, reversed_time=False):
    parts = ["<html><h2>Scene 01</h2>"]
    for case, count in (("ID001", 8), ("ID002", 7), ("ID003", 8)):
        if omit and case == "ID003":
            continue
        parts.append("<h2>" + case + "</h2><table><tr>")
        parts.extend("<th>" + x + "</th>" for x in
                     ("Step", "Begin", "End", "Activity", "Humans", "Assets", "Locations"))
        parts.append("</tr>")
        for i in range(1, count + 1):
            end = "07:00:00.000" if reversed_time and i == 1 else "08:01:10.000"
            data = (str(i), "08:01:00.000", end,
                    "Check-Out asset to user" if i == 6 else "Chat",
                    "Person-1", "Asset-1", "Desk")
            parts.append("<tr>" + "".join("<td>" + x + "</td>" for x in data) + "</tr>")
        parts.append("</table>")
    parts.append("<h2>Download Scene Files</h2></html>")
    return "".join(parts).encode()


class Solve4XTests(TestCase):
    def test_annotated_three_cases_and_23_segments(self):
        x = inspect_scene(sample())
        self.assertEqual(x["instances"], 3)
        self.assertEqual(x["segments"], 23)

    def test_missing_case_abstains(self):
        with self.assertRaisesRegex(Hold, "SCENE_LAYOUT_CHANGED"):
            inspect_scene(sample(omit=True))

    def test_incorrect_time_abstains(self):
        with self.assertRaisesRegex(Hold, "INTERVAL_INVALID"):
            inspect_scene(sample(reversed_time=True))

    def test_no_unsupported_independence(self):
        x = analyze(sample())
        self.assertFalse(x["independence"]["separate_ITAM_transaction_log_loaded"])
        self.assertEqual(x["independence"]["same_case_two_channel_comparison"], "NOT_MEASURED")
        self.assertEqual(x["qualification"]["task_discovery"], "NOT_MEASURED")
        self.assertFalse(x["source"]["raw_annotations_redistributed"])

    def test_metadata_not_independent_video_review(self):
        x = analyze(sample(), json.dumps({"id": 25246291, "files": []}).encode())
        self.assertFalse(x["repository_metadata"]["raw_media_downloaded"])
        self.assertFalse(x["independence"]["video_independently_reviewed"])

    def test_wrong_article_id_rejected(self):
        with self.assertRaisesRegex(Hold, "FIGSHARE_ID_HOLD"):
            analyze(sample(), b'{"id":123,"files":[]}')


if __name__ == "__main__":
    main()
