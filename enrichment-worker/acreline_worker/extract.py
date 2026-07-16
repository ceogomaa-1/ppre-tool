import re
from collections.abc import Iterable

EMAIL_PATTERN = re.compile(r"(?<![\w.+-])([A-Z0-9._%+-]{1,64}@[A-Z0-9.-]{1,190}\.[A-Z]{2,24})(?![\w.-])", re.I)
PHONE_PATTERN = re.compile(r"(?<!\d)(?:\+?1[\s.-]*)?(?:\(\d{3}\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}(?!\d)")
SPACE_PATTERN = re.compile(r"\s+")
NON_DIGIT_PATTERN = re.compile(r"\D+")
IDENTITY_STOP_WORDS = {
    "apartment", "apartments", "company", "corporation", "development", "holdings",
    "incorporated", "limited", "property", "properties", "street", "avenue", "road",
    "drive", "court", "place", "canada", "ontario",
}


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
    return emails[:12], [phone for phone in phones if normalize_phone(phone) is not None][:12]


def normalize_phone(value: str) -> str | None:
    digits = NON_DIGIT_PATTERN.sub("", value)
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10 or digits[0] in "01" or digits[3] in "01":
        return None
    if len(set(digits)) < 4:
        return None
    return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"


def contact_is_near_identity(text: str, contact: str, owner_name: str, property_address: str | None, radius: int = 520) -> bool:
    lower = SPACE_PATTERN.sub(" ", text).lower()
    contact_position = lower.find(contact.lower())
    if contact_position < 0:
        return False
    tokens = re.findall(r"[a-z0-9]+", f"{owner_name} {property_address or ''}".lower())
    identity_terms = {
        token for token in tokens
        if len(token) >= 4 and token not in IDENTITY_STOP_WORDS and not token.isdigit()
    }
    if not identity_terms:
        return False
    context = lower[max(0, contact_position - radius): contact_position + len(contact) + radius]
    return any(term in context for term in identity_terms)


def evidence_snippet(text: str, needles: list[str], limit: int = 360) -> str:
    compact = SPACE_PATTERN.sub(" ", text).strip()
    lower = compact.lower()
    positions = [lower.find(needle.lower()) for needle in needles if needle and lower.find(needle.lower()) >= 0]
    start = max(0, (min(positions) if positions else 0) - 90)
    snippet = compact[start : start + limit]
    return f"…{snippet}" if start else snippet
