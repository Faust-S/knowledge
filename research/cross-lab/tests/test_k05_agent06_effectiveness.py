"""Public contract tests. Mock owner attestations are NOT real IWXA outcomes."""
import hashlib
import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from k05_agent06_effectiveness import (
    K05EffectivenessHold, observe_run, compare_task_executors,
    compare_process_phases,
)
from k05_agent06_otlp import project_otlp_json

def digest(data):
    return hashlib.sha256(data).hexdigest()

TASK = digest(b"one exact task")
INPUT = digest(b"same input")
COHORT = digest(b"same process and case definition")
RESULT = digest(b"accepted exact result")

def fixture(label, phase="RUN", accepted=True, include_money=True, *,
            elapsed=2000, human=1000, cost=400, retries=0, returns=0,
            tool_status="SUCCEEDED"):
    source = {}
    proofs = {}
    pins = []
    measurements = {}
    def put(ref, kind, status, values, *, result=True, currency=None):
        raw = json.dumps({"fixture":ref, "source":"mock-only"},sort_keys=True).encode()
        sha = digest(raw)
        source[ref] = raw
        pin = {"ref":ref, "kind":kind, "sha256":sha}
        pins.append(pin)
        proofs[ref] = {
            "verified":True, "kind":kind, "source_sha256":sha,
            "epistemic_status":"OBSERVED", "status":status,
            "values":values, "task_sha256":TASK,
            "result_sha256":RESULT if result else None,
            "currency":currency,
        }
        return ref
    def add(name, value, kind):
        ref=label+"."+name
        put(ref,kind,"OBSERVED",{name:value},currency="USD" if kind=="COST_INVOICE" else None)
        measurements[name]={"value":value,"source_ref":ref}
    add("elapsed_ms",elapsed,"ACTIVITY")
    add("human_active_ms",human,"TIME_TRACKING")
    add("retry_count",retries,"ACTIVITY")
    add("return_count",returns,"ACTIVITY")
    if include_money: add("actual_cost_minor",cost,"COST_INVOICE")
    acceptance = {"value":accepted,"source_ref":label+".review"} if accepted is not None else {"value":None,"source_ref":None}
    if accepted is not None:
        put(label+".review","HUMAN_REVIEW","ACCEPTED" if accepted else "REJECTED",{})
    put(label+".tool","TOOL_RECEIPT",tool_status,{},result=False)
    run={
        "run_id":label, "task_sha256":TASK, "input_sha256":INPUT,
        "cohort_sha256":COHORT, "result_sha256":RESULT,
        "executor":label, "executor_kind":"AGENT", "phase":phase,
        "currency":"USD", "evidence":pins,
        "measurements":measurements, "accepted":acceptance,
        "tool_receipt_refs":[label+".tool"],
    }
    def verify(ref,kind,raw):
        assert raw == source[ref]
        return dict(proofs[ref])
    return run, source, verify, proofs

def observed(t):
    return observe_run(t[0],source_bytes=t[1],owner_verify=t[2])

class EffectivenessContractTests(unittest.TestCase):
    def test_two_executors_same_task_different_costs(self):
        a=observed(fixture("Alpha",elapsed=3600,human=1800,cost=300,retries=2))
        b=observed(fixture("Beta",elapsed=2600,human=600,cost=250,retries=0))
        pair=compare_task_executors(a,b)
        self.assertEqual(pair["status"],"SOURCE_BOUND_COMPARABLE")
        self.assertEqual(pair["acceptance"],["ACCEPTED","ACCEPTED"])
        self.assertEqual(pair["metric_deltas_alternative_minus_baseline"]["elapsed_ms"],-1000)
        self.assertEqual(pair["metric_deltas_alternative_minus_baseline"]["human_active_ms"],-1200)
        self.assertEqual(pair["metric_deltas_alternative_minus_baseline"]["retry_count"],-2)
        self.assertEqual(pair["metric_deltas_alternative_minus_baseline"]["actual_cost_minor"],-50)
        self.assertEqual(pair["result_quality_ranking"],"NOT_MEASURABLE")

    def test_before_after_and_observational_roi(self):
        before=observed(fixture("Before",phase="BEFORE",elapsed=9000,
                                human=6000,cost=2000,returns=3))
        after=observed(fixture("After",phase="AFTER",elapsed=5000,
                               human=1800,cost=1200,returns=1))
        evidence=fixture("Invest")
        source=evidence[1]
        raw=b'{"invoice":"synthetic-investment"}'
        ref="Invest.investment"
        source[ref]=raw
        proof={"verified":True, "kind":"COST_INVOICE",
               "source_sha256":digest(raw), "epistemic_status":"OBSERVED",
               "status":"OBSERVED","values":{"investment_minor":200},
               "currency":"USD","task_sha256":None,"result_sha256":None}
        def verifier(ref_arg,kind,raw_arg):
            self.assertEqual((ref_arg,kind,raw_arg),(ref,"COST_INVOICE",raw))
            return proof
        r=compare_process_phases([before],[after],investment={
            "ref":ref,"kind":"COST_INVOICE","sha256":digest(raw),
            "value_minor":200,"currency":"USD"},source_bytes={ref:raw},
            owner_verify=verifier)
        self.assertEqual(r["before"]["cost_per_accepted_result_minor"],"2000.00")
        self.assertEqual(r["deltas_after_minus_before"]["return_count"],-2)
        self.assertEqual(r["observed_accounting_net_minor"],600)
        self.assertEqual(r["observed_accounting_roi_percent"],"300.00")
        self.assertEqual(r["roi_attributable_to_iwxa"],"NOT_MEASURABLE")
        self.assertFalse(r["forecasts_used"])

    def test_missing_cost_or_investment_cannot_invent_roi(self):
        a=observed(fixture("Before",phase="BEFORE",include_money=False))
        b=observed(fixture("After",phase="AFTER"))
        r=compare_process_phases([a],[b],investment=None,
                                 source_bytes={},owner_verify=lambda *args: None)
        self.assertIsNone(r["observed_accounting_roi_percent"])
        self.assertEqual(r["roi_status"],"NOT_MEASURABLE")
        self.assertIsNone(r["before"]["cost_per_accepted_result_minor"])

    def test_unknown_acceptance_not_measured(self):
        a=observed(fixture("Before",phase="BEFORE",accepted=None))
        b=observed(fixture("After",phase="AFTER"))
        r=compare_process_phases([a],[b],investment=None,
                                 source_bytes={},owner_verify=lambda *args:None)
        self.assertIsNone(r["before"]["cost_per_accepted_result_minor"])
        self.assertEqual(r["before"]["acceptance_unknown_count"],1)
        self.assertEqual(r["roi_status"],"NOT_MEASURABLE")

    def test_rejected_or_tampered_evidence(self):
        run,source,verify,proofs=fixture("Alpha")
        source[run["evidence"][0]["ref"]]=b"altered"
        with self.assertRaisesRegex(K05EffectivenessHold,"SOURCE_BYTES_MISMATCH"):
            observe_run(run,source_bytes=source,owner_verify=verify)
        run,source,verify,proofs=fixture("Beta")
        proofs["Beta.review"]["status"]="OBSERVED"
        with self.assertRaisesRegex(K05EffectivenessHold,"ACCEPTANCE_NOT_OWNER_BOUND"):
            observe_run(run,source_bytes=source,owner_verify=verify)
        run,source,verify,proofs=fixture("Gamma")
        proofs["Gamma.actual_cost_minor"]["currency"]="RUB"
        with self.assertRaisesRegex(K05EffectivenessHold,"COST_CURRENCY_OR_SOURCE_INVALID"):
            observe_run(run,source_bytes=source,owner_verify=verify)

    def test_no_unverified_receipts_or_fake_sources(self):
        run,source,verify,proofs=fixture("Alpha")
        proofs["Alpha.tool"]["status"]="ACCEPTED"
        with self.assertRaisesRegex(K05EffectivenessHold,"TOOL_RECEIPT_UNBOUND"):
            observe_run(run,source_bytes=source,owner_verify=verify)
        run,source,verify,proofs=fixture("Beta")
        proofs["Beta.elapsed_ms"]["values"]["elapsed_ms"]=77
        with self.assertRaisesRegex(K05EffectivenessHold,"METRIC_NOT_OWNER_BOUND"):
            observe_run(run,source_bytes=source,owner_verify=verify)
        run,source,verify,proofs=fixture("Delta")
        run["measurements"]["actual_cost_minor"]["value"]=100000
        with self.assertRaisesRegex(K05EffectivenessHold,"METRIC_NOT_OWNER_BOUND"):
            observe_run(run,source_bytes=source,owner_verify=verify)

    def test_process_denominator_and_case_mismatch(self):
        a=observed(fixture("Before",phase="BEFORE"))
        b=observed(fixture("After",phase="AFTER",accepted=False))
        result=compare_process_phases([a],[b],investment=None,
                                      source_bytes={},owner_verify=lambda *args:None)
        self.assertFalse(result["comparability"]["equal_run_and_accepted_counts"])
        pair=compare_task_executors(a,b)
        self.assertEqual(pair["status"],"SOURCE_BOUND_COMPARABLE")
        b=dict(b,cohort_sha256="f"*64)
        self.assertEqual(compare_task_executors(a,b)["status"],"NOT_COMPARABLE")
        with self.assertRaisesRegex(K05EffectivenessHold,"INCOMPARABLE_PROCESS_OR_CURRENCY"):
            compare_process_phases([a],[b],investment=None,
                                   source_bytes={},owner_verify=lambda *args:None)

    def test_otlp_only_technical_and_opt_in(self):
        row=observed(fixture("Gamma"))
        self.assertEqual(project_otlp_json(row)["status"],"DISABLED")
        self.assertEqual(project_otlp_json(row,enabled=True)["status"],
                         "MEASUREMENT_WINDOW_REQUIRED")
        export=project_otlp_json(
            row, enabled=True, start_time_unix_nano=1794736800000000000,
            time_unix_nano=1794736803000000000)
        self.assertEqual(export["status"],"READY_FOR_OWNER_APPROVED_EXPORT")
        data=json.dumps(export)
        self.assertNotIn(RESULT,data)
        self.assertNotIn("actual_cost_minor",data)
        self.assertNotIn("Gamma",data)
        self.assertIn("iwxa.agent.execution.duration",data)
        points=export["otlp"]["resourceMetrics"][0]["scopeMetrics"][0]["metrics"]
        self.assertEqual(len(points),2)
        duration=next(x for x in points if x["name"]=="iwxa.agent.execution.duration")
        self.assertEqual(duration["gauge"]["dataPoints"][0]["asInt"],"2000")
        self.assertEqual(duration["gauge"]["dataPoints"][0]["startTimeUnixNano"],
                         "1794736800000000000")
        returns=next(x for x in points if x["name"]=="iwxa.task.retries")
        self.assertIs(returns["sum"]["isMonotonic"],True)
        self.assertEqual(returns["sum"]["aggregationTemporality"],1)

    def test_otlp_rejects_forged_source_status_and_time(self):
        row=observed(fixture("Gamma"))
        invalid=dict(row,metrics={**row["metrics"],"input_tokens":100})
        with self.assertRaisesRegex(K05EffectivenessHold,"OTLP_METRIC_STATUS_INVALID"):
            project_otlp_json(invalid,enabled=True,
                              start_time_unix_nano=1794736800000000000,
                              time_unix_nano=1794736803000000000)
        self.assertEqual(project_otlp_json(
            row,enabled=True,start_time_unix_nano=1794736803000000000,
            time_unix_nano=1794736800000000000)["status"],
            "MEASUREMENT_WINDOW_REQUIRED")

if __name__ == "__main__":
    unittest.main()
