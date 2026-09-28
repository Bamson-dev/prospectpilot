"""Pin research crawls to public addresses chosen before the socket opens."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

from scrapy.exceptions import IgnoreRequest
from twisted.internet.endpoints import HostnameEndpoint

PINS: dict[str, str] = {}
_ORIGINAL_GETADDRINFO = socket.getaddrinfo

BLOCKED_HOSTS = {
    "localhost",
    "localhost.localdomain",
    "metadata.google.internal",
    "metadata.internal",
    "host.docker.internal",
    "coolify.leadpilot.live",
}


def is_blocked_ip(value: str) -> bool:
    text = value.strip().lower().strip("[]").split("%", 1)[0]
    try:
        parsed = ipaddress.ip_address(text)
    except ValueError:
        return True
    if isinstance(parsed, ipaddress.IPv6Address) and parsed.ipv4_mapped is not None:
        return is_blocked_ip(str(parsed.ipv4_mapped))
    if not parsed.is_global or parsed.is_loopback or parsed.is_link_local or parsed.is_private or parsed.is_multicast or parsed.is_reserved or parsed.is_unspecified:
        return True
    if isinstance(parsed, ipaddress.IPv4Address) and any(parsed in network for network in (
        ipaddress.ip_network("100.64.0.0/10"),
        ipaddress.ip_network("192.0.0.0/24"),
        ipaddress.ip_network("192.0.2.0/24"),
        ipaddress.ip_network("198.18.0.0/15"),
        ipaddress.ip_network("198.51.100.0/24"),
        ipaddress.ip_network("203.0.113.0/24"),
    )):
        return True
    if isinstance(parsed, ipaddress.IPv6Address) and parsed.packed[:2] == b"\x20\x02":
        return True
    return False


def choose_address(addresses: list[str]) -> str:
    if not addresses or any(is_blocked_ip(address) for address in addresses):
        raise ValueError("private-network")
    return addresses[0]


def resolve_addresses(host: str) -> list[str]:
    if _is_ip(host):
        return [host]
    found: list[str] = []
    for family in (socket.AF_INET, socket.AF_INET6):
        try:
            infos = _ORIGINAL_GETADDRINFO(host, None, family, socket.SOCK_STREAM)
        except socket.gaierror:
            continue
        for info in infos:
            address = info[4][0]
            if address not in found:
                found.append(address)
    return found


def pin_host(host: str) -> str:
    address = choose_address(resolve_addresses(host))
    PINS[host.lower().rstrip(".")] = address
    return address


def pinned_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    key = host.decode("ascii", "ignore") if isinstance(host, bytes) else str(host)
    key = key.strip("[]").lower().rstrip(".")
    address = PINS.get(key)
    if not address:
        raise socket.gaierror(socket.EAI_NONAME, "unpinned host")
    numeric_family = socket.AF_INET6 if ":" in address else socket.AF_INET
    return _ORIGINAL_GETADDRINFO(address, port, numeric_family, socket.SOCK_STREAM, socket.IPPROTO_TCP)


def install_pinned_resolver() -> None:
    HostnameEndpoint._getaddrinfo = staticmethod(pinned_getaddrinfo)


class PinPublicDestinationMiddleware:
    def process_request(self, request, spider):
        parsed = urlparse(request.url)
        host = (parsed.hostname or "").lower().rstrip(".")
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if parsed.scheme not in ("http", "https") or port not in (80, 443) or _blocked_host(host):
            _mark_private(spider)
            raise IgnoreRequest("private-network")
        try:
            pin_host(host)
        except ValueError:
            _mark_private(spider)
            raise IgnoreRequest("private-network") from None
        return None


def _mark_private(spider) -> None:
    note = getattr(spider, "result_note", None)
    if isinstance(note, dict):
        note["value"] = "private-network"


def _blocked_host(host: str) -> bool:
    return (not host) or host in BLOCKED_HOSTS or host.endswith(".local") or host.endswith(".internal")


def _is_ip(host: str) -> bool:
    try:
        ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return False
    return True
