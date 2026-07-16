import socket
import unittest
from unittest.mock import patch

from acreline_worker.security import UnsafeTargetError, validate_public_url


def address(ip: str):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 443))]


class PublicUrlTests(unittest.IsolatedAsyncioTestCase):
    @patch("acreline_worker.security.socket.getaddrinfo", return_value=address("93.184.216.34"))
    async def test_accepts_public_https(self, _resolver) -> None:
        result = await validate_public_url("https://Example.com/contact?ref=1#team")
        self.assertEqual(result, "https://example.com/contact?ref=1")

    @patch("acreline_worker.security.socket.getaddrinfo", return_value=address("127.0.0.1"))
    async def test_blocks_loopback_resolution(self, _resolver) -> None:
        with self.assertRaises(UnsafeTargetError):
            await validate_public_url("https://example.com")

    async def test_blocks_credentials_and_unsafe_ports(self) -> None:
        with self.assertRaises(UnsafeTargetError):
            await validate_public_url("https://user:pass@example.com")
        with self.assertRaises(UnsafeTargetError):
            await validate_public_url("https://example.com:8443")

    @patch("acreline_worker.security.socket.getaddrinfo", return_value=address("93.184.216.34"))
    async def test_enforces_domain_policy(self, _resolver) -> None:
        with self.assertRaises(UnsafeTargetError):
            await validate_public_url("https://social.example.com", blocked_domains={"example.com"})
        with self.assertRaises(UnsafeTargetError):
            await validate_public_url("https://other.org", allowed_domains={"example.com"})


if __name__ == "__main__":
    unittest.main()
