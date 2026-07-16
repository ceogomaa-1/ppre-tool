import asyncio
import hashlib
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any

from .config import Settings
from .models import DiscoveryResult, Lead, ScrapedEvidence
from .openai_enrichment import DiscoveryClient
from .scraper import PublicWebScraper
from .supabase_rest import SupabaseRest


def fingerprint(lead: Lead) -> str:
    identity = "|".join(
        str(value or "").strip().lower()
        for value in [lead.owner_name, lead.property_address, lead.city, lead.province, lead.postal_code]
    )
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def _merge_evidence(evidence: list[ScrapedEvidence], discovery: DiscoveryResult) -> dict[str, Any]:
    ranked = sorted(evidence, key=lambda item: item.confidence, reverse=True)
    emails = list(dict.fromkeys(email for item in ranked for email in item.emails))
    phones = list(dict.fromkeys(phone for item in ranked for phone in item.phones))
    contact_sources = sum(bool(item.emails or item.phones) for item in ranked)
    raw_score = max((item.confidence for item in ranked), default=0)
    confidence = min(99, raw_score + (5 if contact_sources >= 2 else 0))
    if contact_sources == 1:
        confidence = min(confidence, 84)
    if not emails and not phones:
        confidence = min(confidence, 55)
    status = "verified" if confidence >= 85 and (emails or phones) else "needs_review" if evidence else "not_found"
    return {
        "email": emails[0] if emails else None,
        "phone": phones[0] if phones else None,
        "additional_emails": emails[1:],
        "additional_phones": phones[1:],
        "confidence": confidence,
        "status": status,
        "enrichment_summary": discovery.summary[:500],
        "enriched_at": datetime.now(UTC).isoformat(),
        "updated_at": datetime.now(UTC).isoformat(),
    }


class EnrichmentPipeline:
    def __init__(self, settings: Settings, database: SupabaseRest) -> None:
        self.settings = settings
        self.db = database
        self.discovery = DiscoveryClient(settings)
        self.scraper = PublicWebScraper(settings)

    async def claim(self, job_id: str) -> dict[str, Any]:
        jobs = await self.db.select("enrichment_jobs", {"id": f"eq.{job_id}", "select": "*", "limit": "1"})
        if not jobs:
            raise ValueError("Job not found")
        job = jobs[0]
        if job["status"] not in {"queued", "paused", "failed"}:
            raise ValueError(f"Job cannot start from status {job['status']}")

        now = datetime.now(UTC).isoformat()
        claimed = await self.db.update_returning(
            "enrichment_jobs",
            {"id": f"eq.{job_id}", "status": "in.(queued,paused,failed)"},
            {"status": "running", "started_at": now, "updated_at": now},
        )
        if not claimed:
            raise ValueError("Job was claimed by another worker")
        return claimed[0]

    async def run(self, job_id: str) -> None:
        job = await self.claim(job_id)
        await self.run_claimed(job)

    async def run_claimed(self, job: dict[str, Any]) -> None:
        job_id = str(job["id"])
        max_records = min(int(job.get("configuration", {}).get("max_records", 500)), 25_000)

        completed = int(job.get("rows_completed", 0))
        failed = int(job.get("rows_failed", 0))
        input_tokens = int(job.get("input_tokens", 0))
        output_tokens = int(job.get("output_tokens", 0))
        processed_this_run = 0

        try:
            now = datetime.now(UTC).isoformat()
            await self.db.update("datasets", {"id": f"eq.{job['dataset_id']}"}, {"status": "processing", "updated_at": now})
            while processed_this_run < max_records:
                current = await self.db.select(
                    "enrichment_jobs",
                    {"id": f"eq.{job_id}", "select": "status", "limit": "1"},
                )
                if not current or current[0]["status"] != "running":
                    return
                rows = await self.db.select(
                    "leads",
                    {
                        "dataset_id": f"eq.{job['dataset_id']}",
                        "status": "eq.queued",
                        "select": "*",
                        "order": "row_number.asc",
                        "limit": str(min(500, max_records - processed_this_run)),
                    },
                )
                if not rows:
                    break
                for row in rows:
                    current = await self.db.select(
                        "enrichment_jobs",
                        {"id": f"eq.{job_id}", "select": "status", "limit": "1"},
                    )
                    if not current or current[0]["status"] != "running":
                        if current and current[0]["status"] == "paused":
                            await self.db.update(
                                "datasets",
                                {"id": f"eq.{job['dataset_id']}"},
                                {"status": "paused", "updated_at": datetime.now(UTC).isoformat()},
                            )
                        return
                    lead = Lead.model_validate(row)
                    try:
                        used_input, used_output = await self._process_lead(lead)
                        input_tokens += used_input
                        output_tokens += used_output
                        completed += 1
                    except Exception as error:
                        failed += 1
                        await self.db.update("leads", {"id": f"eq.{lead.id}"}, {"status": "failed", "last_error": str(error)[:500], "updated_at": datetime.now(UTC).isoformat()})
                    processed_this_run += 1
                    if (completed + failed) % 10 == 0:
                        await self._update_job(job_id, completed, failed, input_tokens, output_tokens)

            remaining = await self.db.select(
                "leads",
                {"dataset_id": f"eq.{job['dataset_id']}", "status": "eq.queued", "select": "id", "limit": "1"},
            )
            final_status = "paused" if remaining else "completed"
            await self._update_job(job_id, completed, failed, input_tokens, output_tokens, final_status=final_status)
            await self.db.update(
                "datasets",
                {"id": f"eq.{job['dataset_id']}"},
                {"status": final_status, "processed_count": completed + failed, "failed_count": failed, "updated_at": datetime.now(UTC).isoformat()},
            )
        except Exception:
            await self.db.update("enrichment_jobs", {"id": f"eq.{job_id}"}, {"status": "failed", "updated_at": datetime.now(UTC).isoformat()})
            await self.db.update("datasets", {"id": f"eq.{job['dataset_id']}"}, {"status": "failed", "updated_at": datetime.now(UTC).isoformat()})
            raise

    async def _process_lead(self, lead: Lead) -> tuple[int, int]:
        key = fingerprint(lead)
        cached = await self.db.select(
            "enrichment_cache",
            {"user_id": f"eq.{lead.user_id}", "fingerprint": f"eq.{key}", "expires_at": f"gt.{datetime.now(UTC).isoformat()}", "select": "result", "limit": "1"},
        )
        if cached:
            await self.db.update("leads", {"id": f"eq.{lead.id}"}, cached[0]["result"])
            return 0, 0

        await self.db.update("leads", {"id": f"eq.{lead.id}"}, {"status": "researching", "updated_at": datetime.now(UTC).isoformat()})
        discovery, input_tokens, output_tokens = await self.discovery.discover(lead)
        candidates = discovery.candidates[: self.settings.max_sources_per_lead]
        results = await asyncio.gather(*(self.scraper.fetch(candidate, lead.owner_name) for candidate in candidates))
        evidence = [item for item in results if item is not None]
        result = _merge_evidence(evidence, discovery)
        await self.db.update("leads", {"id": f"eq.{lead.id}"}, result)

        if evidence:
            await self.db.upsert(
                "sources",
                [
                    {
                        "lead_id": lead.id,
                        "user_id": lead.user_id,
                        "source_url": item.url,
                        "source_domain": item.domain,
                        "title": item.title,
                        "snippet": item.snippet,
                        "evidence": {"reason": item.match_reason, "emails": item.emails, "phones": item.phones, "confidence": item.confidence},
                        "content_hash": hashlib.sha256(item.snippet.encode("utf-8")).hexdigest(),
                    }
                    for item in evidence
                ],
                "lead_id,source_url",
            )

        await self.db.upsert(
            "enrichment_cache",
            {
                "user_id": lead.user_id,
                "fingerprint": key,
                "result": result,
                "source_urls": [item.url for item in evidence],
                "expires_at": (datetime.now(UTC) + timedelta(days=self.settings.cache_ttl_days)).isoformat(),
            },
            "user_id,fingerprint",
        )
        return input_tokens, output_tokens

    async def _update_job(self, job_id: str, completed: int, failed: int, input_tokens: int, output_tokens: int, *, final_status: str | None = None) -> None:
        # Token-only estimate; built-in web-search fees are reported separately by OpenAI billing.
        token_cost = (Decimal(input_tokens) * Decimal("1") + Decimal(output_tokens) * Decimal("6")) / Decimal(1_000_000)
        payload: dict[str, Any] = {
            "rows_completed": completed,
            "rows_failed": failed,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "estimated_cost_usd": str(token_cost.quantize(Decimal("0.000001"))),
            "updated_at": datetime.now(UTC).isoformat(),
        }
        if final_status:
            payload["status"] = final_status
            if final_status == "completed":
                payload["completed_at"] = datetime.now(UTC).isoformat()
        await self.db.update("enrichment_jobs", {"id": f"eq.{job_id}"}, payload)
