from typing import Any

import httpx

from .config import Settings


class SupabaseRest:
    def __init__(self, settings: Settings) -> None:
        key = settings.supabase_service_role_key.get_secret_value()
        self._client = httpx.AsyncClient(
            base_url=f"{str(settings.supabase_url).rstrip('/')}/rest/v1/",
            headers={"apikey": key, "Authorization": f"Bearer {key}"},
            timeout=httpx.Timeout(20),
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def select(self, table: str, params: dict[str, str]) -> list[dict[str, Any]]:
        response = await self._client.get(table, params=params)
        response.raise_for_status()
        return response.json()

    async def update(self, table: str, filters: dict[str, str], payload: dict[str, Any]) -> None:
        response = await self._client.patch(
            table,
            params=filters,
            json=payload,
            headers={"Prefer": "return=minimal"},
        )
        response.raise_for_status()

    async def update_returning(self, table: str, filters: dict[str, str], payload: dict[str, Any]) -> list[dict[str, Any]]:
        response = await self._client.patch(
            table,
            params=filters,
            json=payload,
            headers={"Prefer": "return=representation"},
        )
        response.raise_for_status()
        return response.json()

    async def insert(self, table: str, payload: dict[str, Any] | list[dict[str, Any]]) -> None:
        response = await self._client.post(table, json=payload, headers={"Prefer": "return=minimal"})
        response.raise_for_status()

    async def upsert(self, table: str, payload: dict[str, Any] | list[dict[str, Any]], on_conflict: str) -> None:
        response = await self._client.post(
            table,
            params={"on_conflict": on_conflict},
            json=payload,
            headers={"Prefer": "resolution=merge-duplicates,return=minimal"},
        )
        response.raise_for_status()
