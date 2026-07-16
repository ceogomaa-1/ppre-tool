import asyncio
from urllib.parse import urlsplit

try:
    from scrapling.fetchers import AsyncFetcher
except ModuleNotFoundError:  # Keeps pure unit tests runnable before optional browser dependencies are installed.
    class AsyncFetcher:  # type: ignore[no-redef]
        @staticmethod
        async def get(*_: object, **__: object) -> object:
            raise RuntimeError("Scrapling fetcher dependencies are not installed")

from .config import Settings
from .extract import contact_is_near_identity, evidence_snippet, extract_contacts, normalize_phone
from .models import Lead, ScrapedEvidence, SourceCandidate
from .security import UnsafeTargetError, validate_public_url


class PublicWebScraper:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._semaphore = asyncio.Semaphore(settings.worker_concurrency)

    async def fetch(self, candidate: SourceCandidate, lead: Lead) -> ScrapedEvidence | None:
        try:
            url = await validate_public_url(
                candidate.url,
                allowed_domains=self._settings.allowed_domain_set or None,
                blocked_domains=self._settings.blocked_domain_set,
            )
        except UnsafeTargetError:
            return None

        try:
            async with self._semaphore:
                response = await AsyncFetcher.get(
                    url,
                    timeout=self._settings.scrape_timeout_seconds,
                    retries=1,
                    retry_delay=0.5,
                    follow_redirects="safe",
                    max_redirects=5,
                    stealthy_headers=False,
                )
            text = str(response.get_all_text(separator=" ", strip=True))[:180_000]
        except Exception:
            return None

        is_binary_pdf = text.lstrip().startswith("%PDF-")
        emails, phones = ([], []) if is_binary_pdf else extract_contacts(text)
        claimed_emails = {value.lower() for value in candidate.claimed_emails}
        claimed_phones = {normalized for value in candidate.claimed_phones if (normalized := normalize_phone(value))}
        verified_emails = [
            value for value in emails
            if candidate.identity_match != "weak" and value in claimed_emails
            and contact_is_near_identity(text, value, lead.owner_name, lead.property_address)
        ]
        verified_phones = [
            normalized for value in phones
            if candidate.identity_match != "weak"
            and (normalized := normalize_phone(value)) in claimed_phones
            and contact_is_near_identity(text, value, lead.owner_name, lead.property_address)
        ]
        needles = [lead.owner_name, *verified_emails[:2], *verified_phones[:1]]
        return ScrapedEvidence(
            url=url,
            domain=urlsplit(url).hostname or "",
            title=candidate.title,
            source_role=candidate.source_role,
            identity_match=candidate.identity_match,
            match_reason=candidate.match_reason,
            emails=verified_emails,
            phones=verified_phones,
            snippet="PDF retained as identity evidence; contact extraction skipped." if is_binary_pdf else evidence_snippet(text, needles),
        )
