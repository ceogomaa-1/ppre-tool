import asyncio
import ipaddress
import socket
from urllib.parse import urlsplit, urlunsplit


class UnsafeTargetError(ValueError):
    pass


def _domain_matches(hostname: str, rule: str) -> bool:
    return hostname == rule or hostname.endswith(f".{rule}")


async def validate_public_url(
    raw_url: str,
    *,
    allowed_domains: set[str] | None = None,
    blocked_domains: set[str] | None = None,
) -> str:
    parsed = urlsplit(raw_url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise UnsafeTargetError("Only absolute HTTP(S) URLs are allowed")
    if parsed.username or parsed.password:
        raise UnsafeTargetError("Credential-bearing URLs are blocked")
    if parsed.port and parsed.port not in {80, 443}:
        raise UnsafeTargetError("Non-standard ports are blocked")

    hostname = parsed.hostname.rstrip(".").lower().encode("idna").decode("ascii")
    if hostname == "localhost" or hostname.endswith((".localhost", ".local", ".internal")):
        raise UnsafeTargetError("Local targets are blocked")
    if blocked_domains and any(_domain_matches(hostname, rule) for rule in blocked_domains):
        raise UnsafeTargetError("This domain is blocked by workspace policy")
    if allowed_domains and not any(_domain_matches(hostname, rule) for rule in allowed_domains):
        raise UnsafeTargetError("This domain is outside the workspace allowlist")

    try:
        addresses = await asyncio.wait_for(
            asyncio.to_thread(socket.getaddrinfo, hostname, parsed.port or (443 if parsed.scheme == "https" else 80)),
            timeout=3,
        )
    except (TimeoutError, socket.gaierror) as error:
        raise UnsafeTargetError("The target hostname could not be safely resolved") from error

    for address in {item[4][0] for item in addresses}:
        ip = ipaddress.ip_address(address)
        if any((ip.is_private, ip.is_loopback, ip.is_link_local, ip.is_multicast, ip.is_reserved, ip.is_unspecified)):
            raise UnsafeTargetError("Private and reserved network targets are blocked")

    netloc = hostname if not parsed.port else f"{hostname}:{parsed.port}"
    return urlunsplit((parsed.scheme, netloc, parsed.path or "/", parsed.query, ""))
