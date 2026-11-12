"""K05 independently pinned *public procurement PDF* evidence, no private corpus.

This reads the official Woodbury County board packet in CI, not a retyped
quotation. Its agenda request, supplier quote and commercial conditions are
distinct documents within one published packet. Historical buyer acceptance,
previous quote version and actual negotiated terms remain UNKNOWN.
"""
from __future__ import annotations

import argparse
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import urllib.request

SCHEMA = "IWXA_K05_PUBLIC_COMMERCIAL_DOCUMENT_EVIDENCE/0.1"
SOURCE = "https://www.woodburycountyiowa.gov/files/meetings/2016-10-25-2.pdf"
MAX_BYTES = 80_000_000
PINNED_SHA256 = "a97dcffeead9991795ec68975c71ccb12bd4e0aa6839b5c7e9c667e37a264d64"  # Independently observed from GitHub Actions PDF discovery.


class SourceHold(ValueError):
    pass


def normalized(value: str) -> str:
    return " ".join(value.split())


def capture_pdf() -> tuple[bytes, list[str]]:
    if not shutil.which("pdftotext"):
        raise SourceHold("PDF_TEXT_EXTRACTOR_UNAVAILABLE")
    request = urllib.request.Request(SOURCE, headers={
        "User-Agent": "IWXA-K05-public-procurement-source-replay/0.1",
        "Accept": "application/pdf",
    })
    with urllib.request.urlopen(request, timeout=30) as response:
        data = response.read(MAX_BYTES + 1)
        content_type = response.headers.get('Content-Type', '')
        http_status = response.status
    if len(data) > MAX_BYTES or not data.startswith(b"%PDF"):
        raise SourceHold('SOURCE_NOT_VERIFIED_PDF:' + json.dumps({
            'http_status': http_status, 'content_type': content_type,
            'bytes': len(data), 'prefix_hex': data[:12].hex(),
        }, sort_keys=True))
    with tempfile.TemporaryDirectory() as directory:
        target = Path(directory) / "source.pdf"
        target.write_bytes(data)
        processed = subprocess.run(
            ["pdftotext", "-layout", "-enc", "UTF-8", str(target), "-"],
            capture_output=True, text=True, timeout=30, check=True
        )
        pages = processed.stdout.split("\f")
    return data, [normalized(p) for p in pages if p.strip()]


def one_page(pages: list[str], all_of: list[str]) -> tuple[int, str]:
    matches = [(i + 1, page) for i, page in enumerate(pages)
               if all(term in page for term in all_of)]
    if len(matches) != 1:
        raise SourceHold("LOCATOR_UNKNOWN_OR_AMBIGUOUS")
    return matches[0]


def make_proof(data: bytes, pages: list[str], *, expected_sha256: str | None) -> dict:
    digest = hashlib.sha256(data).hexdigest()
    if expected_sha256 is not None and digest != expected_sha256:
        raise SourceHold("PINNED_PDF_REVISION_CHANGED")
    quote_no, quote = one_page(pages, [
        "Revised - Record Storage - USED OPTION", "269.23", "7,269.21",
        "315.38", "1,892.28", "838.51"])
    agenda_no, agenda = one_page(pages, [
        "FINANCIAL IMPACT:", "10,000.00",
        "Approve purchase of 33 heavy duty used shelving units"])
    terms_no, terms = one_page(pages, [
        "Terms of Sale", "50%", "30 days", "Order Changes"])
    if "Quotation Valid For 30 Days" not in quote:
        raise SourceHold("VALIDITY_NOT_FOUND")
    if "Owner to Unload & Install" not in quote:
        raise SourceHold("INSTALLATION_NOT_FOUND")
    if "may be required" not in terms:
        raise SourceHold("CONDITIONAL_PAYMENT_NOT_FOUND")
    net = Decimal("27")*Decimal("269.23")+Decimal("6")*Decimal("315.38")+Decimal("838.51")
    if net != Decimal("10000.00"):
        raise SourceHold("PRICE_ARITHMETIC_FAILED")
    observations = []
    for name,page_no,page in (
        ("board_agenda_request",agenda_no,agenda),
        ("revised_used_shelving_quote",quote_no,quote),
        ("supplier_terms_and_conditions",terms_no,terms),
    ):
        observations.append({
            "document": name,
            "source_url": SOURCE,
            "source_sha256": digest,
            "locator": f"pdf-page:{page_no}",
            "page_text_sha256": hashlib.sha256(page.encode("utf-8")).hexdigest(),
            "state": "SOURCE_TEXT_OBSERVED",
        })
    return {
        "schema": SCHEMA,
        "status": "PINNED_PUBLIC_PDF_OBSERVED" if expected_sha256 else "DISCOVERY_UNPINNED_NOT_ACCEPTED",
        "source": {"url": SOURCE, "sha256": digest, "bytes": len(data),
                   "pages_with_text": len(pages)},
        "observations": observations,
        "facts": {
            "proposed_purchase_count": 33,
            "used_quote_total_usd": "10000.00",
            "arithmetic_total_usd": str(net),
            "shipment_quote_valid_days": 30,
            "unloading_installation": "OWNER_TO_UNLOAD_AND_INSTALL",
            "deposit_of_50_percent": "CONDITIONAL_MAY_BE_REQUIRED",
            "prior_unrevised_price": None,
            "independent_approval_of_purchase": None,
            "payment_amount_definitely_due_upfront": None,
        },
        "measurement": {
            "source_download_bytes": len(data),
            "extracted_pages": len(pages),
            "human_read_seconds": None,
            "provider_model_calls": 0,
            "llm_response_quality": None,
        },
        "epistemic": {
            "real_historical_public_documents": True,
            "source_revision_pinned": expected_sha256 is not None,
            "human_gold": False,
            "claim_semantics_comprehensively_verified": False,
            "accepted_current_commercial_offer": False,
        },
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--discover", action="store_true")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    if args.out.exists():
        parser.error("OUTPUT_EXISTS")
    if not args.discover and not PINNED_SHA256:
        raise SourceHold("SOURCE_SHA256_NOT_PINNED")
    data, pages = capture_pdf()
    proof = make_proof(
        data, pages, expected_sha256=None if args.discover else PINNED_SHA256
    )
    args.out.write_text(json.dumps(proof, sort_keys=True, ensure_ascii=True, indent=2)+"\n")
    print("K05_PUBLIC_OFFER "+json.dumps({
        "status": proof["status"],
        "source_sha256": proof["source"]["sha256"],
        "bytes": proof["source"]["bytes"],
        "page_locs": [x["locator"] for x in proof["observations"]],
        "arithmetic_total_usd": proof["facts"]["arithmetic_total_usd"],
        "current_legal_status": "UNKNOWN",
    }, sort_keys=True))


if __name__ == "__main__":
    main()
