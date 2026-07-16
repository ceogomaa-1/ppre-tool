import unittest
import sys
import types
from unittest.mock import AsyncMock

scraper_stub = types.ModuleType("acreline_worker.scraper")
scraper_stub.PublicWebScraper = object
sys.modules.setdefault("acreline_worker.scraper", scraper_stub)

from acreline_worker.pipeline import EnrichmentPipeline


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


if __name__ == "__main__":
    unittest.main()
