import re
from collections.abc import Iterable

EMAIL_PATTERN = re.compile(r"(?<![\w.+-])([A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,190}\.[A-Z]{2,24})(?![\w.-])", re.I)
PHONE_PATTERN = re.compile(r"(?<!\d)(?:\+?1[\s.-]*)?(?:\(\d{3}\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}(?!\d)")
SPACE_PATTERN = re.compile(r"\s+")


def unique(values: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    output: list[str] = []
    for value in values:
        normalized = SPACE_PATTERN.sub(" ", value).strip().lower()
        if normalized and normalized not in seen:
            seen.add(normalized)
            output.append(normalized)
    return output


def extract_contacts(text: str) -> tuple[list[str], list[str]]:
    emails = unique(match.group(1) for match in EMAIL_PATTERN.finditer(text))
    phones = unique(match.group(0) for match in PHONE_PATTERN.finditer(text))
    blocked_email_fragments = ("example.com", "sentry.io", "wixpress.com", "cloudflare.com")
    emails = [email for email in emails if not any(fragment in email for fragment in blocked_email_fragments)]
    return emails[:12], phones[:12]


def evidence_snippet(text: str, needles: list[str], limit: int = 360) -> str:
    compact = SPACE_PATTERN.sub(" ", text).strip()
    lower = compact.lower()
    positions = [lower.find(needle.lower()) for needle in needles if needle and lower.find(needle.lower()) >= 0]
    start = max(0, (min(positions) if positions else 0) - 90)
    snippet = compact[start : start + limit]
    return f"…{snippet}" if start else snippet
