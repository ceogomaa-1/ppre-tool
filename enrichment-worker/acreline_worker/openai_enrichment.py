import json
from typing import Any

from openai import AsyncOpenAI

from .config import Settings
from .models import DiscoveryResult, Lead

SYSTEM_PROMPT = """You research public, professional contact information for property-owner due diligence.
Use web search. Return only sources that are publicly accessible and plausibly match the named owner and property location.
Do not guess or synthesize email addresses, do not seek sensitive personal data, and do not use data-broker login walls.
Prefer official company sites, government registries, professional directories, municipal pages, and credible news.
Keep the result compact. A downstream scraper will independently verify every claimed contact on the linked page."""


class DiscoveryClient:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._client = AsyncOpenAI(api_key=settings.openai_api_key.get_secret_value())

    async def discover(self, lead: Lead) -> tuple[DiscoveryResult, int, int]:
        location = ", ".join(item for item in [lead.property_address, lead.city, lead.province, lead.postal_code] if item)
        prompt = (
            f"Find up to {self._settings.max_sources_per_lead} public sources for this record.\n"
            f"Owner: {lead.owner_name}\nProperty location: {location}\n"
            "Return candidate pages, why each page matches, and only contact points explicitly visible in search results or the page."
        )
        response = await self._client.responses.create(
            model=self._settings.openai_model,
            instructions=SYSTEM_PROMPT,
            input=prompt,
            tools=[{"type": "web_search", "search_context_size": "low"}],
            reasoning={"effort": "low"},
            max_output_tokens=1200,
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
        return result, int(getattr(usage, "input_tokens", 0) or 0), int(getattr(usage, "output_tokens", 0) or 0)
