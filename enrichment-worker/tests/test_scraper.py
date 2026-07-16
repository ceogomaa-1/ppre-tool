import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from acreline_worker.models import Lead, SourceCandidate
from acreline_worker.scraper import PublicWebScraper


class FakeResponse:
    def __init__(self, text: str) -> None:
        self.text = text

    def get_all_text(self, **_: object) -> str:
        return self.text


class ScraperVerificationTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        settings = SimpleNamespace(
            worker_concurrency=1,
            allowed_domain_set=set(),
            blocked_domain_set=set(),
            scrape_timeout_seconds=5,
        )
        self.scraper = PublicWebScraper(settings)
        self.lead = Lead(
            id="00000000-0000-4000-8000-000000000001",
            dataset_id="00000000-0000-4000-8000-000000000002",
            user_id="00000000-0000-4000-8000-000000000003",
            owner_name="YWCA Canada",
            property_address="55 McGrigor Street",
            city="Oshawa",
        )

    def candidate(self, **overrides: object) -> SourceCandidate:
        values = {
            "url": "https://example.org/ywca",
            "title": "YWCA record",
            "source_role": "news",
            "identity_match": "exact",
            "match_reason": "Exact address",
            "claimed_emails": [],
            "claimed_phones": [],
        }
        values.update(overrides)
        return SourceCandidate(**values)

    @patch("acreline_worker.scraper.validate_public_url", new_callable=AsyncMock)
    @patch("acreline_worker.scraper.AsyncFetcher.get", new_callable=AsyncMock)
    async def test_unclaimed_publisher_contacts_are_not_accepted(self, fetch: AsyncMock, validate: AsyncMock) -> None:
        validate.return_value = "https://example.org/ywca"
        fetch.return_value = FakeResponse("YWCA Canada 55 McGrigor Street. Publisher: editor@oshawaexpress.ca 905-728-5227")
        result = await self.scraper.fetch(self.candidate(), self.lead)
        self.assertIsNotNone(result)
        self.assertEqual(result.emails, [])
        self.assertEqual(result.phones, [])

    @patch("acreline_worker.scraper.validate_public_url", new_callable=AsyncMock)
    @patch("acreline_worker.scraper.AsyncFetcher.get", new_callable=AsyncMock)
    async def test_raw_pdf_xrefs_are_never_extracted_as_phones(self, fetch: AsyncMock, validate: AsyncMock) -> None:
        validate.return_value = "https://example.org/offering.pdf"
        fetch.return_value = FakeResponse("%PDF-1.7 0000000016 0000003683 Centurion Apartment REIT")
        result = await self.scraper.fetch(self.candidate(claimed_phones=["0000000016"]), self.lead)
        self.assertIsNotNone(result)
        self.assertEqual(result.phones, [])
        self.assertIn("contact extraction skipped", result.snippet)


if __name__ == "__main__":
    unittest.main()
