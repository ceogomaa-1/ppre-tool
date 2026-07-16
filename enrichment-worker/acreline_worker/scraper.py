import asyncio
from urllib.parse import urlsplit

from scrapling.fetchers import AsyncFetcher

from .config import Settings
from .extract import evidence_snippet, extract_contacts
from .models import ScrapedEvidence, SourceCandidate
from .security import UnsafeTargetError, validate_public_url


class PublicWebScraper:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._semaphore = asyncio.Semaphore(settings.worker_concurrency)

    async def fetch(self, candidate: SourceCandidate, owner_name: str) -> ScrapedEvidence | None:
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

        emails, phones = extract_contacts(text)
        claimed_emails = {value.lower() for value in candidate.claimed_emails}
        claimed_phones = {"".join(filter(str.isdigit, value))[-10:] for value in candidate.claimed_phones}
        verified_emails = [value for value in emails if not claimed_emails or value in claimed_emails]
        verified_phones = [value for value in phones if not claimed_phones or "".join(filter(str.isdigit, value))[-10:] in claimed_phones]
        needles = [owner_name, *verified_emails[:2], *verified_phones[:1]]
        return ScrapedEvidence(
            url=url,
            domain=urlsplit(url).hostname or "",
            title=candidate.title,
            match_reason=candidate.match_reason,
            emails=verified_emails,
            phones=verified_phones,
            snippet=evidence_snippet(text, needles),
            confidence=candidate.confidence,
        )
