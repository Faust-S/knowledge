from __future__ import annotations
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import k05_real_offer_public as real


class PublicCommercialQuote(unittest.TestCase):
    def test_source_is_official_not_republished_as_artifact(self):
        self.assertEqual(real.SCHEMA, "IWXA_K05_PUBLIC_COMMERCIAL_DOCUMENT_EVIDENCE/0.1")
        self.assertTrue(real.SOURCE.startswith("https://www.woodburycountyiowa.gov/"))
        self.assertEqual(real.PINNED_SHA256, 'a97dcffeead9991795ec68975c71ccb12bd4e0aa6839b5c7e9c667e37a264d64')
        self.assertLessEqual(real.MAX_BYTES, 80_000_000)

    def test_ambiguous_or_missing_locator_is_not_asserted(self):
        with self.assertRaisesRegex(real.SourceHold,"LOCATOR_UNKNOWN_OR_AMBIGUOUS"):
            real.one_page(["Different page"],["specific quote"])
        with self.assertRaisesRegex(real.SourceHold,"LOCATOR_UNKNOWN_OR_AMBIGUOUS"):
            real.one_page(["same quote","same quote"],["same quote"])

    def test_incomplete_or_tampered_quote_is_rejected(self):
        agenda="FINANCIAL IMPACT: $10,000.00 Approve purchase of 33 heavy duty used shelving units"
        quote=("Revised - Record Storage - USED OPTION 269.23 7,269.21 "
               "315.38 1,892.28 838.51 Quotation Valid For 30 Days "
               "Owner to Unload & Install")
        terms="Order Changes Terms of Sale 50% may be required net 30 days"
        mock=b"%PDF controlled-only-shape"
        proof=real.make_proof(mock,[agenda,quote,terms],expected_sha256=None)
        self.assertEqual(proof["status"],"DISCOVERY_UNPINNED_NOT_ACCEPTED")
        self.assertEqual(proof["facts"]["arithmetic_total_usd"],"10000.00")
        self.assertIsNone(proof["facts"]["prior_unrevised_price"])
        self.assertIsNone(proof["facts"]["independent_approval_of_purchase"])
        with self.assertRaisesRegex(real.SourceHold,"PINNED_PDF_REVISION_CHANGED"):
            real.make_proof(mock,[agenda,quote,terms],expected_sha256="0"*64)
        with self.assertRaisesRegex(real.SourceHold,"VALIDITY_NOT_FOUND"):
            real.make_proof(mock,[agenda,quote.replace("Quotation Valid For 30 Days",""),terms],
                            expected_sha256=None)


if __name__=="__main__":
    unittest.main()
