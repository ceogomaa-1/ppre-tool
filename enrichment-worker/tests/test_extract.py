import unittest

from acreline_worker.extract import evidence_snippet, extract_contacts


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


if __name__ == "__main__":
    unittest.main()
