import json
from typing import Any

from openai import AsyncOpenAI

from .config import Settings
from .models import DiscoveryResult, Lead

SYSTEM_PROMPT = """You research public, professional contact information for property-owner due diligence.
Use one concise web-search pass. Return only sources that directly match the named owner or exact property location.
Do not guess or synthesize contact details, do not seek sensitive personal data, and do not use data-broker login walls.
Prefer official company sites, government registries, professional directories, municipal pages, and credible news.
Public business or professional profiles on Facebook, Instagram, and TikTok are valid sources when they help confirm identity or expose an explicitly public contact point.
Only put an email or phone in claimed_emails/claimed_phones when the page explicitly identifies it as belonging to the target owner or property. Never claim a publisher, journalist, website footer, directory operator, unrelated tenant, or third-party contact.
Classify each source role and identity match conservatively. Keep the result compact; a downstream scraper independently verifies every claimed contact."""


class DiscoveryClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = AsyncOpenAI(api_key=settings.openai_api_key.get_secret_value())

    async def discover(self, lead: Lead, model: str, source_limit: int) -> tuple[DiscoveryResult, int, int, int]:
        location = ", ".join(item for item in [lead.property_address, lead.city, lead.province, lead.postal_code] if item)
        prompt = (
            f"Find at most {source_limit} public sources for this record.\n"
            f"Owner: {lead.owner_name}\nProperty location: {location}\n"
            "Return candidate pages, why each page matches, and only contact points explicitly visible in search results or the page."
        )
        response = await self._client.responses.create(
            model=model,
            instructions=SYSTEM_PROMPT,
            input=prompt,
            tools=[{"type": "web_search", "search_context_size": "low"}],
            max_output_tokens=500,
            text={
                "format": {
                    "type": "json_schema",
                    "name": "property_source_discovery",
                    "strict": True,
                    "schema": DiscoveryResult.model_json_schema(),
                }
            },
        )
        result = DiscoveryResult.model_validate(json.loads(response.output_text))
        usage: Any = response.usage
        web_search_calls = sum(1 for item in response.output if getattr(item, "type", "") == "web_search_call")
        return result, int(getattr(usage, "input_tokens", 0) or 0), int(getattr(usage, "output_tokens", 0) or 0), web_search_calls
