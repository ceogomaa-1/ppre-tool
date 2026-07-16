import unittest

from acreline_worker.extract import contact_is_near_identity, evidence_snippet, extract_contacts, normalize_phone


class ExtractContactsTests(unittest.TestCase):
    def test_extracts_and_deduplicates_public_contacts(self) -> None:
        text = "Contact Avery@Example.org or avery@example.org. Office: (416) 555-0199."
        emails, phones = extract_contacts(text)
        self.assertEqual(emails, ["avery@example.org"])
        self.assertEqual(phones, ["(416) 555-0199"])

    def test_filters_common_placeholder_domains(self) -> None:
        emails, _ = extract_contacts("demo@example.com support@real-company.ca")
        self.assertEqual(emails, ["support@real-company.ca"])

    def test_snippet_centres_on_evidence(self) -> None:
        snippet = evidence_snippet("prefix " * 40 + "Owner Maya Thompson email maya@studio.ca" + " suffix" * 40, ["maya@studio.ca"])
        self.assertIn("maya@studio.ca", snippet)
        self.assertLessEqual(len(snippet), 361)

    def test_rejects_pdf_xrefs_and_impossible_nanp_numbers(self) -> None:
        self.assertIsNone(normalize_phone("0000000016"))
        self.assertIsNone(normalize_phone("1784238402"))
        self.assertIsNone(normalize_phone("0000003683"))
        self.assertEqual(normalize_phone("905-728-5227"), "905-728-5227")

    def test_contact_must_be_near_target_identity(self) -> None:
        text = "Centurion Apartment REIT at 277 Anderson Ave. Call (905) 555-0199 for leasing."
        self.assertTrue(contact_is_near_identity(text, "(905) 555-0199", "Centurion Apartment REIT", "277 Anderson Ave"))
        self.assertFalse(contact_is_near_identity("Publisher footer (905) 555-0199", "(905) 555-0199", "Centurion Apartment REIT", "277 Anderson Ave"))


if __name__ == "__main__":
    unittest.main()
