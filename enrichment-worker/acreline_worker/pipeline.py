import asyncio
import hashlib
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from typing import Any
from urllib.parse import urlsplit

from .config import Settings
from .costs import estimate_cost
from .models import DiscoveryResult, Lead, ScrapedEvidence
from .openai_enrichment import DiscoveryClient
from .scraper import PublicWebScraper
from .supabase_rest import SupabaseRest


def fingerprint(lead: Lead) -> str:
    identity = "contact-verification-v2|" + "|".join(
        str(value or "").strip().lower()
        for value in [lead.owner_name, lead.property_address, lead.city, lead.province, lead.postal_code]
    )
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


def _merge_evidence(evidence: list[ScrapedEvidence], discovery: DiscoveryResult) -> dict[str, Any]:
    usable = [item for item in evidence if item.identity_match != "weak"]

    def independent_domain(value: str) -> str:
        host = (urlsplit(value).hostname or "").lower().removeprefix("www.")
        labels = host.split(".")
        if len(labels) <= 2:
            return host
        common_two_part_suffixes = {"co.uk", "org.uk", "com.au", "com.br", "co.nz"}
        suffix = ".".join(labels[-2:])
        return ".".join(labels[-3:]) if suffix in common_two_part_suffixes else suffix

    email_support: dict[str, set[str]] = {}
    phone_support: dict[str, set[str]] = {}
    email_roles: dict[str, set[str]] = {}
    phone_roles: dict[str, set[str]] = {}
    for item in usable:
        domain = independent_domain(item.url)
        for email in item.emails:
            normalized_email = email.lower()
            email_support.setdefault(normalized_email, set()).add(domain)
            email_roles.setdefault(normalized_email, set()).add(item.source_role)
        for phone in item.phones:
            phone_support.setdefault(phone, set()).add(domain)
            phone_roles.setdefault(phone, set()).add(item.source_role)

    authoritative_roles = {"first_party", "government"}
    corroborated_emails = [
        value for value, domains in email_support.items()
        if len(domains) >= 2 and email_roles[value] & authoritative_roles
    ]
    corroborated_phones = [
        value for value, domains in phone_support.items()
        if len(domains) >= 2 and phone_roles[value] & authoritative_roles
    ]
    is_verified = bool(corroborated_emails or corroborated_phones)
    if is_verified:
        emails, phones = corroborated_emails, corroborated_phones
        strongest_support = max(
            [len(domains) for domains in email_support.values()] + [len(domains) for domains in phone_support.values()]
        )
        confidence = 90 if strongest_support >= 3 else 86
        status = "verified"
    else:
        emails = list(email_support)
        phones = list(phone_support)
        has_strong_single_source = any(
            item.identity_match == "exact" and item.source_role in {"first_party", "government"}
            and bool(item.emails or item.phones)
            for item in usable
        )
        if emails or phones:
            confidence = 68 if has_strong_single_source else 58
            status = "needs_review"
        elif any(item.identity_match == "exact" for item in usable):
            confidence = 45
            status = "not_found"
        elif usable:
            confidence = 30
            status = "not_found"
        else:
            confidence = 0
            status = "not_found"
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
        if not bool(job.get("cost_estimate_complete", False)):
            raise ValueError("Legacy job is locked because paid web-search calls were not tracked")
        can_retry_completed = job["status"] == "completed" and int(job.get("rows_failed", 0)) > 0
        if job["status"] not in {"queued", "paused", "failed"} and not can_retry_completed:
            raise ValueError(f"Job cannot start from status {job['status']}")

        now = datetime.now(UTC).isoformat()
        if int(job.get("rows_failed", 0)) > 0:
            failed_filters = {"dataset_id": f"eq.{job['dataset_id']}", "status": "eq.failed"}
            target_ids = job.get("configuration", {}).get("target_lead_ids", [])
            if target_ids:
                failed_filters["id"] = f"in.({','.join(str(value) for value in target_ids)})"
            await self.db.update(
                "leads",
                failed_filters,
                {"status": "queued", "last_error": None, "updated_at": now},
            )
            job["rows_failed"] = 0
        claimed = await self.db.update_returning(
            "enrichment_jobs",
            {"id": f"eq.{job_id}", "status": "in.(queued,paused,failed,completed)"},
            {"status": "running", "rows_failed": 0, "started_at": now, "completed_at": None, "updated_at": now},
        )
        if not claimed:
            raise ValueError("Job was claimed by another worker")
        return claimed[0]

    async def run(self, job_id: str) -> None:
        job = await self.claim(job_id)
        await self.run_claimed(job)

    async def run_claimed(self, job: dict[str, Any]) -> None:
        job_id = str(job["id"])
        configuration = job.get("configuration", {})
        max_records = min(int(configuration.get("max_records", 500)), 25_000)
        target_ids = [str(value) for value in configuration.get("target_lead_ids", [])]
        force_refresh = bool(configuration.get("force_refresh", False))

        completed = int(job.get("rows_completed", 0))
        failed = int(job.get("rows_failed", 0))
        input_tokens = int(job.get("input_tokens", 0))
        output_tokens = int(job.get("output_tokens", 0))
        web_search_calls = int(job.get("web_search_calls", 0))
        model = str(job.get("model") or self.settings.openai_model)
        source_limit = min(int(configuration.get("source_limit", 3)), self.settings.max_sources_per_lead, 3)
        cost_limit = Decimal(str(job.get("cost_limit_usd") or "2.00"))
        processed_this_run = 0
        repeated_error = ""
        repeated_error_count = 0

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
                lead_filters = {
                    "dataset_id": f"eq.{job['dataset_id']}",
                    "status": "eq.queued",
                    "select": "*",
                    "order": "row_number.asc",
                    "limit": str(min(500, max_records - processed_this_run)),
                }
                if target_ids:
                    lead_filters["id"] = f"in.({','.join(target_ids)})"
                rows = await self.db.select(
                    "leads",
                    lead_filters,
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
                    current_cost = estimate_cost(model, input_tokens, output_tokens, web_search_calls)
                    if current_cost + Decimal("0.05") > cost_limit:
                        await self._update_job(
                            job_id, completed, failed, input_tokens, output_tokens, web_search_calls,
                            model=model, final_status="paused",
                        )
                        await self.db.update(
                            "datasets", {"id": f"eq.{job['dataset_id']}"},
                            {"status": "paused", "updated_at": datetime.now(UTC).isoformat()},
                        )
                        return
                    try:
                        used_input, used_output, used_searches = await self._process_lead(
                            lead, model, source_limit, force_refresh=force_refresh
                        )
                        input_tokens += used_input
                        output_tokens += used_output
                        web_search_calls += used_searches
                        completed += 1
                        repeated_error = ""
                        repeated_error_count = 0
                    except Exception as error:
                        failed += 1
                        error_text = str(error)[:500]
                        await self.db.update("leads", {"id": f"eq.{lead.id}"}, {"status": "failed", "last_error": error_text, "updated_at": datetime.now(UTC).isoformat()})
                        repeated_error_count = repeated_error_count + 1 if error_text == repeated_error else 1
                        repeated_error = error_text
                    processed_this_run += 1
                    await self._update_job(job_id, completed, failed, input_tokens, output_tokens, web_search_calls, model=model)
                    if repeated_error_count >= 3:
                        raise RuntimeError(f"Systemic enrichment failure after 3 records: {repeated_error}")

            remaining_filters = {
                "dataset_id": f"eq.{job['dataset_id']}",
                "status": "eq.queued",
                "select": "id",
                "limit": "1",
            }
            if target_ids:
                remaining_filters["id"] = f"in.({','.join(target_ids)})"
            remaining = await self.db.select(
                "leads",
                remaining_filters,
            )
            final_status = "paused" if remaining else "failed" if failed else "completed"
            await self._update_job(job_id, completed, failed, input_tokens, output_tokens, web_search_calls, model=model, final_status=final_status)
            dataset_rows = await self.db.select(
                "leads",
                {"dataset_id": f"eq.{job['dataset_id']}", "select": "id,status", "limit": "25000"},
            )
            matched = sum(1 for row in dataset_rows if row["status"] == "verified")
            dataset_failed = sum(1 for row in dataset_rows if row["status"] == "failed")
            dataset_processed = sum(
                1 for row in dataset_rows
                if row["status"] in {"verified", "needs_review", "not_found", "failed"}
            )
            dataset_status = (
                "paused"
                if any(row["status"] in {"queued", "researching"} for row in dataset_rows)
                else final_status
            )
            await self.db.update(
                "datasets",
                {"id": f"eq.{job['dataset_id']}"},
                {
                    "status": dataset_status,
                    "processed_count": dataset_processed,
                    "matched_count": matched,
                    "failed_count": dataset_failed,
                    "updated_at": datetime.now(UTC).isoformat(),
                },
            )
        except Exception:
            await self.db.update("enrichment_jobs", {"id": f"eq.{job_id}"}, {"status": "failed", "updated_at": datetime.now(UTC).isoformat()})
            await self.db.update(
                "datasets",
                {"id": f"eq.{job['dataset_id']}"},
                {"status": "failed", "updated_at": datetime.now(UTC).isoformat()},
            )
            raise

    async def _process_lead(
        self, lead: Lead, model: str, source_limit: int, *, force_refresh: bool = False
    ) -> tuple[int, int, int]:
        key = fingerprint(lead)
        cached = await self.db.select(
            "enrichment_cache",
            {"user_id": f"eq.{lead.user_id}", "fingerprint": f"eq.{key}", "expires_at": f"gt.{datetime.now(UTC).isoformat()}", "select": "result", "limit": "1"},
        )
        if cached and not force_refresh:
            await self.db.update("leads", {"id": f"eq.{lead.id}"}, cached[0]["result"])
            return 0, 0, 0

        await self.db.update("leads", {"id": f"eq.{lead.id}"}, {"status": "researching", "updated_at": datetime.now(UTC).isoformat()})
        discovery, input_tokens, output_tokens, web_search_calls = await self.discovery.discover(lead, model, source_limit)
        candidates = discovery.candidates[:source_limit]
        results = await asyncio.gather(*(self.scraper.fetch(candidate, lead) for candidate in candidates))
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
                        "evidence": {
                            "reason": item.match_reason,
                            "emails": item.emails,
                            "phones": item.phones,
                            "source_role": item.source_role,
                            "identity_match": item.identity_match,
                        },
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
        return input_tokens, output_tokens, web_search_calls

    async def _update_job(
        self, job_id: str, completed: int, failed: int, input_tokens: int, output_tokens: int,
        web_search_calls: int, *, model: str, final_status: str | None = None,
    ) -> None:
        tracked_cost = estimate_cost(model, input_tokens, output_tokens, web_search_calls)
        payload: dict[str, Any] = {
            "rows_completed": completed,
            "rows_failed": failed,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "web_search_calls": web_search_calls,
            "cost_estimate_complete": True,
            "estimated_cost_usd": str(tracked_cost.quantize(Decimal("0.000001"))),
            "updated_at": datetime.now(UTC).isoformat(),
        }
        if final_status:
            payload["status"] = final_status
            if final_status in {"completed", "failed"}:
                payload["completed_at"] = datetime.now(UTC).isoformat()
        await self.db.update("enrichment_jobs", {"id": f"eq.{job_id}"}, payload)
