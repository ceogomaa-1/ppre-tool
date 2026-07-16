import unittest
from unittest.mock import AsyncMock

from acreline_worker.models import DiscoveryResult, ScrapedEvidence
from acreline_worker.pipeline import EnrichmentPipeline, _merge_evidence


class PipelineClaimTests(unittest.IsolatedAsyncioTestCase):
    async def test_completed_job_with_failures_resets_only_failed_rows_for_retry(self) -> None:
        pipeline = object.__new__(EnrichmentPipeline)
        pipeline.db = AsyncMock()
        pipeline.db.select.return_value = [{
            "id": "job-1",
            "dataset_id": "dataset-1",
            "status": "completed",
            "rows_completed": 7,
            "rows_failed": 3,
            "cost_estimate_complete": True,
        }]
        pipeline.db.update_returning.return_value = [{
            "id": "job-1",
            "dataset_id": "dataset-1",
            "status": "running",
            "rows_completed": 7,
            "rows_failed": 0,
        }]

        claimed = await pipeline.claim("job-1")

        self.assertEqual(claimed["status"], "running")
        pipeline.db.update.assert_awaited_once()
        filters = pipeline.db.update.await_args.args[1]
        payload = pipeline.db.update.await_args.args[2]
        self.assertEqual(filters, {"dataset_id": "eq.dataset-1", "status": "eq.failed"})
        self.assertEqual(payload["status"], "queued")
        self.assertIsNone(payload["last_error"])


class EvidenceMergeTests(unittest.TestCase):
    discovery = DiscoveryResult(candidates=[], summary="Public evidence reviewed.")

    @staticmethod
    def evidence(url: str, *, phone: str = "905-728-5227", role: str = "government") -> ScrapedEvidence:
        return ScrapedEvidence(
            url=url,
            domain=url.split("/")[2],
            title="Source",
            source_role=role,
            identity_match="exact",
            match_reason="Exact owner and address",
            phones=[phone],
        )

    def test_single_source_contact_never_becomes_verified(self) -> None:
        result = _merge_evidence([self.evidence("https://durham.ca/record")], self.discovery)
        self.assertEqual(result["status"], "needs_review")
        self.assertEqual(result["confidence"], 68)

    def test_same_contact_on_two_domains_is_verified_but_not_99(self) -> None:
        result = _merge_evidence([
            self.evidence("https://durham.ca/record"),
            self.evidence("https://ywca.ca/contact", role="first_party"),
        ], self.discovery)
        self.assertEqual(result["status"], "verified")
        self.assertEqual(result["confidence"], 86)

    def test_different_contacts_do_not_corroborate_each_other(self) -> None:
        result = _merge_evidence([
            self.evidence("https://one.example/record", phone="905-728-5227"),
            self.evidence("https://two.example/contact", phone="416-555-0199"),
        ], self.discovery)
        self.assertEqual(result["status"], "needs_review")

    def test_two_news_pages_cannot_verify_a_publisher_contact(self) -> None:
        result = _merge_evidence([
            self.evidence("https://news-one.example/story", role="news"),
            self.evidence("https://news-two.example/story", role="news"),
        ], self.discovery)
        self.assertEqual(result["status"], "needs_review")
        self.assertLess(result["confidence"], 85)


if __name__ == "__main__":
    unittest.main()
