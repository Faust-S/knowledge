"""Independent Python acceptance of real open K02 document-study artifacts.

Runs only AFTER the live two-model study; does not run models, import Agent,
or infer correctness from CLI exit codes. Receipts are illustrative and do
not become Personal Agent Result or human acceptance.
"""
from __future__ import annotations

from decimal import Decimal, ROUND_HALF_UP
from hashlib import sha256
import json
import os
from pathlib import Path


def expect(condition: bool, label: str) -> None:
    if not condition:
        raise AssertionError(label)


def cents(decimal_value: Decimal) -> int:
    return int((decimal_value * Decimal("100")).quantize(
        Decimal("1"), rounding=ROUND_HALF_UP))


def verify(directory: Path, fixtures: Path, expected_revision: str) -> dict:
    data = json.loads((directory / "measurements.json").read_text(encoding="utf-8"))
    fixture = json.loads((fixtures / "orders.json").read_text(encoding="utf-8"))
    expect(data.get("schema") == "IWXA.K02.LIVE_DOCUMENT_STUDY/0.1.0",
           "wrong_study_schema")
    expect(len(data.get("reports", [])) == 6, "six_comparisons_required")
    expect(len({x["id"] for x in data["reports"]}) == 5, "comparison_ids_unique")
    expect(data["modelCalls"]["mini"] >= 2 and data["modelCalls"]["qwen"] >= 2,
           "both_models_were_not_invoked")
    expect({x["modelName"] for x in data["modelVariants"]} ==
           {"smollm2:135m-instruct-q2_K", "qwen3:0.6b"},
           "unexpected_models")
    expect(data["pricing"] == "LOCAL_PROVIDER_FEE_ZERO; HOST_COMPUTE_UNKNOWN",
           "compute_cost_not_measured")
    expected_lines = []
    for invoice in fixture["orders"]:
        subtotal = invoice["quantity"] * invoice["unitPriceCents"]
        discount = int((Decimal(subtotal) *
                        Decimal(invoice["discountBps"]) /
                        Decimal(10000)).quantize(
                            Decimal("1"), rounding=ROUND_HALF_UP))
        expected_lines.append((invoice["documentId"],
                               subtotal - discount + invoice["shippingCents"]))
    expect(expected_lines == [("INV-1042", 141000), ("INV-1043", 33500)],
           "source_invoice_data_changed")
    expected_total = sum(value for _, value in expected_lines)
    expect(expected_total == 174500, "independent_arithmetic_wrong")
    reports = [x for x in data["reports"] if x["id"] in
               ("k02-source-skill-jq", "k02-tools-only")]
    expect(len(reports) == 2, "two_tool_first_variants_required")
    for report in reports:
        text = (directory / (report["id"] + ".md")).read_text(encoding="utf-8")
        expect(report["incompatibleSkillRejected"] is True, "incompatible_skill_not_rejected")
        expect(report["modelInvoked"] is (report["id"] == "k02-source-skill-jq"),
               "unexpected_extra_model_call")
        expect(sha256(text.encode("utf-8")).hexdigest() == report["fileDigest"],
               "result_file_digest_mismatch")
        expect(report.get("status") == "REAL_INVOKE" and report["userResultSuccessful"],
               "verified_result_not_accepted_by_study")
        expect(report["sourceFilesReadByGit"] == 3 and
               report["sourceQuotesVerified"] == 2 and report["jqExecuted"],
               "source_skill_and_program_not_executed")
        expect(report["modelDraftIncluded"] is False, "unverified_model_draft_leaked")
        expect("Human Review: REQUIRED" in text, "product_review_improperly_bypassed")
        expect(f"Source revision: {expected_revision}" in text, "source_revision_mismatch")
        expect(f"Project: {fixture['project']}" in text, "project_id_mismatch")
        expect(f"Currency: {fixture['currency']}" in text, "currency_mismatch")
        for invoice_id, value in expected_lines:
            expect(f"| {invoice_id} | {Decimal(value) / Decimal(100):.2f} |" in text,
                   f"invoice_amount_mismatch:{invoice_id}")
        expect(f"Grand total: {Decimal(expected_total) / Decimal(100):.2f} RUB" in text,
               "grand_total_mismatch")
        source_files = ["INV-1042.txt", "INV-1043.txt", "orders.json"]
        for label, file in zip(("A", "B", "data"), source_files, strict=True):
            expected_digest = sha256((fixtures / file).read_bytes()).hexdigest()
            expect(f"Source SHA-256 {label}: {expected_digest}" in text,
                   f"source_digest_mismatch:{label}")
        for quote in ("Line item: brackets, quantity 12 at 125.00 RUB each.",
                      "Line item: cable fittings, quantity 7 at 45.00 RUB each."):
            expect(f"- {quote}" in text, "verified_source_quote_missing")
    report = next(x for x in reports if x["id"] == "k02-source-skill-jq")
    verified = sum(bool(r.get("userResultSuccessful")) for r in data["reports"])
    expect(verified == data["userResults"], "success_count_mismatch")
    return {"status": "PASS", "independentCurrency": "RUB",
            "independentTotalCents": expected_total,
            "sourceFilesVerified": len(source_files),
            "successfulResults": verified,
            "reportSha256": report["fileDigest"],
            "resultScope": "OPEN_STUDY_NOT_AGENT_PRODUCT"}


if __name__ == "__main__":
    root = Path(__file__).resolve().parent.parent / "fixtures" / "document-task"
    output = os.environ.get("K02_CASE_OUTPUT_DIR")
    revision = os.environ.get("GITHUB_SHA")
    if not output or not revision or len(revision) != 40:
        raise SystemExit("K02_STUDY_OUTPUT_AND_GITHUB_SHA_REQUIRED")
    result = verify(Path(output), root, revision)
    print("K02_INDEPENDENT_PYTHON_ACCEPTANCE " + json.dumps(result, sort_keys=True))
