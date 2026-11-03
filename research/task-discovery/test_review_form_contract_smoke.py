import unittest
import review_form_contract as c

class ContractSmoke(unittest.TestCase):
    def test_declared_fields(self):
        self.assertEqual(c.INTERPRETATION, ("goal", "expected_result", "acceptance_criterion"))

    def test_pin_is_distinct_from_generic_e5(self):
        self.assertNotEqual(c.TASK_EXP_XML_BLOB, c.GENERIC_E5_XML_BLOB)

    def test_owner_xml_required(self):
        from pathlib import Path
        with self.assertRaises(c.ContractHold):
            c.check_file(Path("/not-a-real-owner-local-file.xml"))

if __name__ == "__main__":
    unittest.main()
