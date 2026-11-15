"""K05 source replay/economics tests, all inputs synthetic and owner-mocked."""
import hashlib
import json
import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from k05_agent06_effectiveness import (
    K05EffectivenessHold, observe_run, compare_process_phases,
)
from k05_agent06_admission import (
    compare_verified_task_runs, compare_verified_process_runs,
    _population_digest,
)
from test_k05_agent06_effectiveness import (
    fixture, COHORT, TASK, RESULT, digest,
)


def joined(*samples):
    source, proofs = {}, {}
    for _run, files, _verify, evidence in samples:
        for ref, raw in files.items():
            assert ref not in source
            source[ref] = raw
        for ref, proof in evidence.items():
            assert ref not in proofs
            proofs[ref] = proof
    def verify(ref, kind, raw):
        if source[ref] != raw:
            raise AssertionError("fake owner bytes")
        return proofs[ref].copy()
    return source, verify, proofs


def accounting_case(before=None, after=None):
    before = before or fixture("BeforeAudit", phase="BEFORE", cost=2000,
                               elapsed=9000, human=6000, returns=3)
    after = after or fixture("AfterAudit", phase="AFTER", cost=1200,
                             elapsed=5000, human=1800, returns=1)
    source, verify, proofs = joined(before, after)
    prior = observe_run(before[0], source_bytes=source, owner_verify=verify)
    later = observe_run(after[0], source_bytes=source, owner_verify=verify)
    case_mix = digest(b"case-mix verified by original owner")
    raw = b'{"owner":"synthetic-matched-population-evidence"}'
    evidence = {"ref": "matched.population", "kind": "DOMAIN_FACT",
                "sha256": digest(raw)}
    source[evidence["ref"]] = raw
    proofs[evidence["ref"]] = {
        "verified": True, "kind": "DOMAIN_FACT", "source_sha256":digest(raw),
        "epistemic_status":"OBSERVED", "status":"OBSERVED",
        "task_sha256": None, "result_sha256": None,
        "values": {
            "purpose": "IWXA_PROCESS_COMPARISON",
            "currency": "USD", "cohort_sha256": COHORT,
            "before_population_sha256": _population_digest([prior]),
            "after_population_sha256": _population_digest([later]),
            "full_cost_coverage":True, "same_case_definition":True,
            "case_mix_before_sha256":case_mix,
            "case_mix_after_sha256":case_mix,
            "original_source_readback": True, "plan_or_forecast_included":False,
            "before_start":"2026-09-01T00:00:00Z",
            "before_end":"2026-09-30T00:00:00Z",
            "after_start":"2026-10-01T00:00:00Z",
            "after_end":"2026-10-31T00:00:00Z",
        },
    }
    raw_cost=b'{"owner":"synthetic-paid-implementation-invoice"}'
    investment = {
        "ref":"matched.investment","kind":"COST_INVOICE",
        "sha256":digest(raw_cost),"value_minor":200, "currency":"USD",
    }
    source[investment["ref"]] = raw_cost
    proofs[investment["ref"]] = {
        "verified": True, "kind":"COST_INVOICE", "source_sha256":digest(raw_cost),
        "epistemic_status":"OBSERVED", "status":"OBSERVED",
        "task_sha256": None, "result_sha256": None, "currency":"USD",
        "values":{"investment_minor":200,"cohort_sha256":COHORT,
                  "purpose":"IWXA_IMPLEMENTATION","payment_status":"PAID"},
    }
    return before,after,source,verify,proofs,investment,evidence


class K05ReplayAdmissionTests(unittest.TestCase):
    def test_compare_two_actual_owner_verified_executors(self):
        a=fixture("ExecutorA",elapsed=3600,cost=300,retries=2)
        b=fixture("ExecutorB",elapsed=2600,cost=250,retries=0)
        source,verify,_=joined(a,b)
        result=compare_verified_task_runs(a[0],b[0],source_bytes=source,
                                          owner_verify=verify)
        self.assertTrue(result["source_replayed"])
        self.assertEqual(result["accepted_result_comparison_status"],
                         "TWO_HUMAN_OR_DOMAIN_ACCEPTED_RESULTS")
        self.assertEqual(result["comparison"]["metric_deltas_alternative_minus_baseline"]["actual_cost_minor"],-50)
        self.assertEqual(result["causal_effect"],"NOT_MEASURABLE")

    def test_no_roi_from_manually_supplied_projections(self):
        before,after,source,verify,_,investment,_ = accounting_case()
        first=observe_run(before[0],source_bytes=source,owner_verify=verify)
        second=observe_run(after[0],source_bytes=source,owner_verify=verify)
        result=compare_process_phases([first],[second],investment=investment,
                                      source_bytes=source,owner_verify=verify)
        self.assertIsNone(result["observed_accounting_roi_percent"])
        self.assertEqual(result["roi_status"],"NOT_MEASURABLE")
        self.assertIn("REPLAY_ORIGINAL_SOURCE_RUNS",result["roi_missing_requirements"])

    def test_source_replay_verified_population_paid_invoice_roi(self):
        before,after,source,verify,_,investment,population=accounting_case()
        result=compare_verified_process_runs(
            [before[0]],[after[0]],source_bytes=source,owner_verify=verify,
            investment=investment,comparison_evidence=population)
        report=result["comparison"]
        self.assertEqual(report["roi_status"],"OBSERVATIONAL_ONLY")
        self.assertEqual(report["observed_accounting_roi_percent"],"300.00")
        self.assertEqual(report["observed_accounting_net_minor"],600)
        self.assertEqual(report["deltas_after_minus_before"]["human_active_ms"],-4200)
        self.assertEqual(report["before"]["cost_per_accepted_result_minor"],"2000.00")
        self.assertTrue(report["source_replayed"])
        self.assertEqual(report["roi_attributable_to_iwxa"],"NOT_MEASURABLE")
        self.assertFalse(report["forecasts_used"])
        txt=json.dumps(result)
        self.assertNotIn("synthetic-paid-implementation-invoice",txt)
        self.assertNotIn("BeforeAudit",txt)
        self.assertNotIn("matched.population",txt)

    def test_missing_population_or_invoice_never_calculates_roi(self):
        before,after,source,verify,_,investment,population=accounting_case()
        for missing_investment,missing_audit in ((True,False),(False,True)):
            r=compare_verified_process_runs(
                [before[0]],[after[0]],source_bytes=source,owner_verify=verify,
                investment=None if missing_investment else investment,
                comparison_evidence=None if missing_audit else population)
            self.assertIsNone(r["comparison"]["observed_accounting_roi_percent"])
            self.assertEqual(r["comparison"]["roi_status"],"NOT_MEASURABLE")

    def test_unknown_actual_cost_not_guessed_despite_population_assertion(self):
        before=fixture("BeforeCostUnknown",phase="BEFORE",include_money=False)
        after=fixture("AfterCostUnknown",phase="AFTER",cost=1200)
        b,a,source,verify,_,invoice,audit=accounting_case(before,after)
        r=compare_verified_process_runs([b[0]],[a[0]],source_bytes=source,
                                        owner_verify=verify,
                                        investment=invoice,comparison_evidence=audit)
        self.assertIsNone(r["comparison"]["observed_accounting_roi_percent"])
        self.assertIsNone(r["comparison"]["before"]["cost_per_accepted_result_minor"])

    def test_unrelated_invoice_and_draft_invoice_hold(self):
        for change in (
            {"cohort_sha256":"f"*64},
            {"payment_status":"FORECAST"},
            {"purpose":"SOFTWARE_BUDGET"},
        ):
            before,after,source,verify,proofs,invoice,audit=accounting_case()
            proofs[invoice["ref"]]["values"].update(change)
            with self.assertRaisesRegex(K05EffectivenessHold,"INVESTMENT_NOT_OWNER_BOUND"):
                compare_verified_process_runs(
                    [before[0]],[after[0]],source_bytes=source,owner_verify=verify,
                    investment=invoice,comparison_evidence=audit)

    def test_population_case_mix_periods_and_membership_hold(self):
        for patch, expected in (
            ({"case_mix_after_sha256":"f"*64},
             "POPULATION_INCOMPARABLE_OR_INCOMPLETE"),
            ({"full_cost_coverage":False},
             "POPULATION_INCOMPARABLE_OR_INCOMPLETE"),
            ({"plan_or_forecast_included":True},
             "POPULATION_INCOMPARABLE_OR_INCOMPLETE"),
            ({"before_population_sha256":"0"*64},
             "POPULATION_INCOMPARABLE_OR_INCOMPLETE"),
            ({"after_start":"2026-09-15T00:00:00Z"},
             "POPULATION_PERIOD_ORDER_INVALID"),
        ):
            with self.subTest(patch=patch):
                before,after,source,verify,proofs,invoice,audit=accounting_case()
                proofs[audit["ref"]]["values"].update(patch)
                with self.assertRaisesRegex(K05EffectivenessHold,expected):
                    compare_verified_process_runs(
                        [before[0]],[after[0]],source_bytes=source,owner_verify=verify,
                        investment=invoice,comparison_evidence=audit)

    def test_misattributed_run_usage_invoices_or_human_time_hold(self):
        for metric in ("actual_cost_minor","human_active_ms","elapsed_ms"):
            with self.subTest(metric=metric):
                run,source,verify,proofs=fixture("Unbound"+metric)
                proofs["Unbound"+metric+"."+metric]["task_sha256"] = None
                with self.assertRaisesRegex(K05EffectivenessHold,"METRIC_NOT_OWNER_BOUND"):
                    observe_run(run,source_bytes=source,owner_verify=verify)
                run,source,verify,proofs=fixture("ResultUnbound"+metric)
                proofs["ResultUnbound"+metric+"."+metric]["result_sha256"]=None
                with self.assertRaisesRegex(K05EffectivenessHold,"METRIC_NOT_OWNER_BOUND"):
                    observe_run(run,source_bytes=source,owner_verify=verify)

    def test_changed_source_bytes_or_forged_value_cannot_pay_roi(self):
        before,after,source,verify,_,invoice,audit=accounting_case()
        forged=dict(before[0])
        forged["measurements"] = dict(before[0]["measurements"])
        forged["measurements"]["actual_cost_minor"] = {
            "value":99999999,
            "source_ref":before[0]["measurements"]["actual_cost_minor"]["source_ref"],
        }
        with self.assertRaisesRegex(K05EffectivenessHold,"METRIC_NOT_OWNER_BOUND"):
            compare_verified_process_runs(
                [forged],[after[0]],source_bytes=source,owner_verify=verify,
                investment=invoice,comparison_evidence=audit)
        source[audit["ref"]] = b"changed source bytes"
        with self.assertRaisesRegex(K05EffectivenessHold,"SOURCE_BYTES_MISMATCH"):
            compare_verified_process_runs(
                [before[0]],[after[0]],source_bytes=source,owner_verify=verify,
                investment=invoice,comparison_evidence=audit)

    def test_rejected_pair_does_not_promote_result_acceptance(self):
        a=fixture("AcceptA",accepted=True)
        b=fixture("RejectB",accepted=False)
        sources,verify,_=joined(a,b)
        r=compare_verified_task_runs(a[0],b[0],source_bytes=sources,owner_verify=verify)
        self.assertEqual(r["accepted_result_comparison_status"],"NOT_MEASURABLE")
        self.assertEqual(r["comparison"]["acceptance"],["ACCEPTED","REJECTED"])


if __name__ == "__main__":
    unittest.main()
