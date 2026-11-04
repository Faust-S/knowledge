"""BPI13 official Incidents C1 synthetic parser and epistemic contract tests."""
from __future__ import annotations
import gzip
from hashlib import sha256
import sys
from pathlib import Path
from unittest import TestCase, main

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import bpi13_xes_u1_replay as bpi
import bpi13_incidents_applicability as inc


def fixture(*, include_group=True, bad_time=False):
    group = ('<string key="org:group" value="{g}"/>' if include_group else "")
    def evt(a, g, t, status):
        return ('<event><string key="concept:name" value="' + a + '"/>'
                + group.format(g=g)
                + '<string key="organization involved" value="Org-1"/>'
                + '<string key="lifecycle:transition" value="' + status + '"/>'
                + '<date key="time:timestamp" value="' + t
                + ('"' if bad_time else '+00:00"') + '/></event>')
    c1 = ('<trace><string key="concept:name" value="C1"/>'
          + evt("Assigned", "L1", "2013-03-01T08:00:00", "Accepted/Assigned")
          + evt("Waiting", "L2", "2013-03-01T09:00:00", "Accepted/Wait-User")
          + evt("Closed", "L1", "2013-03-01T10:00:00", "Completed/Closed")
          + '</trace>')
    c2 = ('<trace><string key="concept:name" value="C2"/>'
          + evt("Opened", "L2", "2013-03-01T08:00:00", "Accepted/Assigned")
          + evt("Closed", "L2", "2013-03-01T10:00:00", "Completed/Closed")
          + '</trace>')
    return gzip.compress(('<log xmlns="http://www.xes-standard.org/">'
                          + c1 + c2 + '</log>').encode(), mtime=0)


class IncidentsTests(TestCase):
    def test_profile_needs_sha(self):
        with self.assertRaisesRegex(bpi.Hold, "BPI_INCIDENTS_SOURCE_SHA_MISMATCH"):
            bpi.parse_xes(fixture(), source_profile="OFFICIAL_INCIDENTS_CLAIM")
        with self.assertRaisesRegex(bpi.Hold, "BPI_UNKNOWN_SOURCE_PROFILE"):
            bpi.parse_xes(fixture(), source_profile="UNKNOWN")

    def test_wrong_sha_rejected(self):
        with self.assertRaisesRegex(bpi.Hold, "BPI_INCIDENTS_SOURCE_SHA_MISMATCH"):
            bpi.parse_xes(fixture(), source_profile="OFFICIAL_INCIDENTS_CLAIM",
                          expected_sha256="0"*64)

    def test_source_hooks_reuse_same_parser(self):
        raw = fixture()
        fields = []
        traces, population = bpi.parse_xes(
            raw, source_profile="OFFICIAL_INCIDENTS_CLAIM",
            expected_sha256=sha256(raw).hexdigest(),
            on_event=lambda case, n, node: fields.append(
                (case, n, bpi.attr(node, "org:group"))))
        self.assertEqual(population["registered_events"], 5)
        self.assertEqual(len(fields), 5)
        self.assertEqual(fields[1][2], "L2")
        self.assertNotIn("MIRROR", population["log_origin_claim"])

    def test_scope_and_native_u1_are_not_task_acceptance(self):
        r = inc.analyze(fixture(), sample_cases=2)
        self.assertEqual(r["question_count"], 4)
        self.assertEqual(r["u1_sample"]["units"], 5)
        self.assertFalse(r["u1_sample"]["engine_accepted"])
        self.assertEqual(r["qualification"]["accepted_user_tasks"], 0)
        self.assertFalse(r["population"]["catalogue_counts_match"])
        self.assertEqual(r["status"], "SOURCE_POPULATION_MISMATCH_HOLD")
        self.assertFalse(r["source"]["sha_pinned_before_this_run"])
        self.assertFalse(r["source"]["official_file_identity_independently_verified"])
        self.assertFalse(r["source_independence"][
            "different_exports_are_independent_real_world_observations"])
        self.assertEqual(r["field_applicability"]["registered_group_A_B_A_motifs"], 1)
        self.assertEqual(r["field_applicability"]["wait_user_label_events"], 1)
        self.assertEqual(r["questions"][0]["source_fit"],
                         "INCIDENT_LOG_AND_GROUP_ATTRIBUTE_PRESENT")

    def test_missing_group_remains_unknown(self):
        r = inc.analyze(fixture(include_group=False), sample_cases=2)
        self.assertEqual(r["field_applicability"]["consecutive_registered_group_changes"], 0)
        self.assertEqual(r["questions"][1]["source_fit"], "GROUP_TRANSITIONS_UNKNOWN")
        self.assertFalse(r["questions"][1]["real_human_team_ping_pong_proven"])

    def test_reported_wait_does_not_prove_abuse(self):
        r = inc.analyze(fixture(), sample_cases=2)
        self.assertFalse(r["questions"][2]["misconduct_or_motive_proven"])
        self.assertEqual(r["qualification"][
            "false_confident_claim_rate_against_human_gold"], "NOT_MEASURED")

    def test_bad_timestamp_stays_hold(self):
        with self.assertRaisesRegex(bpi.Hold, "XES_TIMESTAMP_TIMEZONE_REQUIRED"):
            inc.analyze(fixture(bad_time=True), sample_cases=2)


if __name__ == "__main__":
    main()
