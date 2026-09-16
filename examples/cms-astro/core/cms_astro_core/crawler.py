# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Small, dependency-free public blog crawler used by the CMS agent tools."""

from __future__ import annotations

import html
import http.client
import ipaddress
import json
import re
import socket
import ssl
import time
import xml.etree.ElementTree as ET
from html.parser import HTMLParser
from typing import Any
from urllib.parse import (
    ParseResult,
    parse_qsl,
    urlencode,
    urljoin,
    urlparse,
    urlunparse,
)

MAX_RESPONSE_BYTES = 2_000_000
MAX_PAGE_TEXT = 50_000
MAX_REDIRECTS = 5
CRAWL_TIMEOUT_SECONDS = 45
USER_AGENT = "Datalayer-Reactor-CMS/0.1 (+https://datalayer.ai)"


def _public_target(
    value: str,
) -> tuple[str, ParseResult, int, int, tuple[Any, ...]]:
    """Validate a URL and return one public address to pin for the connection."""
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username:
        raise ValueError("a public http or https URL is required")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    try:
        targets = socket.getaddrinfo(
            parsed.hostname,
            port,
            type=socket.SOCK_STREAM,
        )
    except (OSError, ValueError) as error:
        raise ValueError(f"could not resolve {parsed.hostname}") from error
    if not targets or any(
        not ipaddress.ip_address(target[4][0]).is_global for target in targets
    ):
        raise ValueError(
            "private, local, reserved, and link-local hosts cannot be crawled"
        )
    family, _, protocol, _, socket_address = targets[0]
    return (
        urlunparse(parsed._replace(fragment="")),
        parsed,
        family,
        protocol,
        socket_address,
    )


def _connect_pinned(
    family: int,
    protocol: int,
    socket_address: tuple[Any, ...],
    timeout: float,
    source_address: tuple[str, int] | None,
) -> socket.socket:
    sock = socket.socket(family, socket.SOCK_STREAM, protocol)
    try:
        sock.settimeout(timeout)
        if source_address:
            sock.bind(source_address)
        sock.connect(socket_address)
        return sock
    except BaseException:
        sock.close()
        raise


class _PinnedHTTPConnection(http.client.HTTPConnection):
    """Connect to the address already approved by the SSRF validation."""

    def __init__(
        self,
        host: str,
        port: int,
        family: int,
        protocol: int,
        socket_address: tuple[Any, ...],
        timeout: float,
    ) -> None:
        super().__init__(host, port, timeout=timeout)
        self._family = family
        self._protocol = protocol
        self._socket_address = socket_address

    def connect(self) -> None:
        self.sock = _connect_pinned(
            self._family,
            self._protocol,
            self._socket_address,
            self.timeout,
            self.source_address,
        )


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """Pin the TCP peer while retaining the hostname for TLS verification."""

    def __init__(
        self,
        host: str,
        port: int,
        family: int,
        protocol: int,
        socket_address: tuple[Any, ...],
        timeout: float,
    ) -> None:
        super().__init__(
            host, port, timeout=timeout, context=ssl.create_default_context()
        )
        self._family = family
        self._protocol = protocol
        self._socket_address = socket_address

    def connect(self) -> None:
        sock = _connect_pinned(
            self._family,
            self._protocol,
            self._socket_address,
            self.timeout,
            self.source_address,
        )
        try:
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except BaseException:
            sock.close()
            raise


def fetch_url(
    value: str,
    *,
    accept: str = "text/html,application/xhtml+xml,application/json",
    deadline: float | None = None,
) -> tuple[str, str, str]:
    """Fetch a bounded response pinned to the address validated for each hop."""
    current = value
    for _ in range(MAX_REDIRECTS + 1):
        remaining = 12.0 if deadline is None else deadline - time.monotonic()
        if remaining <= 0:
            raise ValueError("the crawl exceeded its 45 second deadline")
        current, parsed, family, protocol, socket_address = _public_target(current)
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        connection_type = (
            _PinnedHTTPSConnection
            if parsed.scheme == "https"
            else _PinnedHTTPConnection
        )
        connection = connection_type(
            parsed.hostname,
            port,
            family,
            protocol,
            socket_address,
            min(12.0, remaining),
        )
        path = urlunparse(("", "", parsed.path or "/", parsed.params, parsed.query, ""))
        try:
            connection.request(
                "GET", path, headers={"Accept": accept, "User-Agent": USER_AGENT}
            )
            response = connection.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                location = response.getheader("Location")
                if not location:
                    raise ValueError(
                        "the remote site returned a redirect without a location"
                    )
                current = urljoin(current, location)
                continue
            if response.status < 200 or response.status >= 300:
                raise ValueError(f"the remote site returned HTTP {response.status}")
            content_type = response.headers.get_content_type()
            charset = response.headers.get_content_charset() or "utf-8"
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise ValueError("the remote response is larger than 2 MB")
            return current, content_type, raw.decode(charset, errors="replace")
        except (OSError, http.client.HTTPException) as error:
            raise ValueError(f"could not fetch {current}: {error}") from error
        finally:
            connection.close()
    raise ValueError("the remote site redirected too many times")


class PageParser(HTMLParser):
    """Extract discovery metadata and readable text without executing markup."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.description = ""
        self.canonical = ""
        self.wordpress_api = ""
        self.links: list[str] = []
        self._title_parts: list[str] = []
        self._text: list[str] = []
        self._ignored = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {key.lower(): value or "" for key, value in attrs}
        if tag in {"script", "style", "svg", "noscript", "nav", "footer"}:
            self._ignored += 1
        if tag == "title":
            self._in_title = True
        if tag == "meta":
            key = (values.get("name") or values.get("property")).lower()
            if key in {"description", "og:description"} and not self.description:
                self.description = values.get("content", "").strip()
        if tag == "link":
            rel = values.get("rel", "").lower().split()
            if "canonical" in rel:
                self.canonical = values.get("href", "")
            if "https://api.w.org/" in rel:
                self.wordpress_api = values.get("href", "")
        if tag == "a" and values.get("href") and not self._ignored:
            self.links.append(values["href"])
        if (
            tag
            in {"p", "div", "article", "main", "section", "li", "h1", "h2", "h3", "br"}
            and not self._ignored
        ):
            self._text.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if (
            tag in {"script", "style", "svg", "noscript", "nav", "footer"}
            and self._ignored
        ):
            self._ignored -= 1
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._ignored:
            return
        value = re.sub(r"\s+", " ", data).strip()
        if not value:
            return
        if self._in_title:
            self._title_parts.append(value)
        self._text.append(value)

    def finish(self) -> None:
        self.title = " ".join(self._title_parts).strip()

    @property
    def text(self) -> str:
        value = " ".join(self._text)
        value = re.sub(r"[ \t]*\n[ \t]*", "\n", value)
        value = re.sub(r" {2,}", " ", value)
        return re.sub(r"\n{3,}", "\n\n", value).strip()


def parse_page(markup: str, url: str) -> tuple[dict[str, Any], list[str], str]:
    parser = PageParser()
    parser.feed(markup)
    parser.finish()
    canonical = urljoin(url, parser.canonical) if parser.canonical else url
    path = urlparse(canonical).path.rstrip("/")
    slug = path.rsplit("/", 1)[-1] or "home"
    page = {
        "url": canonical,
        "slug": slug,
        "title": parser.title or slug.replace("-", " ").title(),
        "excerpt": parser.description,
        "body": parser.text[:MAX_PAGE_TEXT],
    }
    return (
        page,
        parser.links,
        urljoin(url, parser.wordpress_api) if parser.wordpress_api else "",
    )


def _same_origin_links(base: str, links: list[str]) -> list[str]:
    origin = urlparse(base)
    result: list[str] = []
    seen: set[str] = set()
    for href in links:
        candidate = urljoin(base, href)
        parsed = urlparse(candidate)
        if parsed.scheme not in {"http", "https"} or parsed.netloc != origin.netloc:
            continue
        if re.search(
            r"\.(?:jpg|jpeg|png|gif|svg|webp|pdf|zip)(?:$|\?)", parsed.path, re.I
        ):
            continue
        normalized = urlunparse(parsed._replace(fragment=""))
        if normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def crawl_blog(url: str, limit: int = 12) -> dict[str, Any]:
    """Discover same-origin links on a blog index and extract each page."""
    deadline = time.monotonic() + CRAWL_TIMEOUT_SECONDS
    final_url, content_type, markup = fetch_url(url, deadline=deadline)
    if content_type not in {"text/html", "application/xhtml+xml"}:
        raise ValueError("the blog URL did not return HTML")
    index, links, wordpress_api = parse_page(markup, final_url)
    pages: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    candidates = [
        item
        for item in _same_origin_links(final_url, links)
        if item.rstrip("/") != final_url.rstrip("/")
    ]
    blog_path = urlparse(final_url).path.rstrip("/")
    if blog_path:
        under_blog = [
            item
            for item in candidates
            if urlparse(item).path.startswith(f"{blog_path}/")
        ]
        if under_blog:
            candidates = under_blog
    for candidate in candidates[:limit]:
        try:
            page_url, page_type, page_markup = fetch_url(candidate, deadline=deadline)
            if page_type in {"text/html", "application/xhtml+xml"}:
                page, _, _ = parse_page(page_markup, page_url)
                if len(page["body"]) >= 80:
                    pages.append(page)
        except ValueError as error:
            errors.append({"url": candidate, "error": str(error)})
            if time.monotonic() >= deadline:
                break
    if not pages:
        pages.append(index)
    return {
        "source": final_url,
        "kind": "blog",
        "wordpress_api": wordpress_api or None,
        "pages": pages,
        "errors": errors,
    }


def _plain_text(markup: str) -> str:
    parser = PageParser()
    parser.feed(markup)
    parser.finish()
    return html.unescape(parser.text)


def _local_name(tag: str) -> str:
    """Return an XML element name without its RSS/Atom namespace."""
    return tag.rsplit("}", 1)[-1].lower()


def _xml_child(element: ET.Element, *names: str) -> ET.Element | None:
    wanted = {name.lower() for name in names}
    return next(
        (child for child in element if _local_name(child.tag) in wanted),
        None,
    )


def _xml_value(element: ET.Element, *names: str) -> str:
    child = _xml_child(element, *names)
    return "" if child is None else "".join(child.itertext()).strip()


def _feed_link(element: ET.Element, base_url: str) -> str:
    """Read either an RSS text link or an Atom href link."""
    links = [child for child in element if _local_name(child.tag) == "link"]
    for link in links:
        href = link.attrib.get("href", "").strip()
        rel = link.attrib.get("rel", "alternate").lower()
        if href and rel in {"", "alternate"}:
            return urljoin(base_url, href)
    for link in links:
        value = "".join(link.itertext()).strip()
        if value:
            return urljoin(base_url, value)
    return ""


def _parse_feed(source: str, feed_url: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Parse bounded RSS 2.0 or Atom XML without loading external entities."""
    try:
        root = ET.fromstring(source)
    except ET.ParseError as error:
        raise ValueError("the feed returned invalid XML") from error

    kind = _local_name(root.tag)
    if kind == "rss":
        container = _xml_child(root, "channel")
        entries = [] if container is None else [
            child for child in container if _local_name(child.tag) == "item"
        ]
    elif kind == "feed":
        container = root
        entries = [child for child in root if _local_name(child.tag) == "entry"]
    else:
        raise ValueError("the URL did not return an RSS or Atom feed")
    if container is None:
        raise ValueError("the RSS feed has no channel")

    feed = {
        "title": _xml_value(container, "title"),
        "description": _plain_text(_xml_value(container, "description", "subtitle")),
        "url": _feed_link(container, feed_url) or feed_url,
    }
    pages: list[dict[str, Any]] = []
    for entry in entries:
        link = _feed_link(entry, feed_url)
        if not link:
            continue
        title = html.unescape(_xml_value(entry, "title"))
        summary_markup = _xml_value(entry, "description", "summary")
        content_markup = _xml_value(entry, "encoded", "content") or summary_markup
        path = urlparse(link).path.rstrip("/")
        pages.append(
            {
                "url": link,
                "slug": path.rsplit("/", 1)[-1] or "home",
                "title": _plain_text(title) or "Untitled",
                "excerpt": _plain_text(summary_markup),
                "body": _plain_text(content_markup)[:MAX_PAGE_TEXT],
                "published_at": _xml_value(entry, "pubdate", "published", "updated") or None,
                "author": _plain_text(_xml_value(entry, "creator", "author")) or None,
                "categories": [
                    html.unescape("".join(child.itertext()).strip())
                    for child in entry
                    if _local_name(child.tag) == "category"
                    and "".join(child.itertext()).strip()
                ],
                "source_id": _xml_value(entry, "guid", "id") or None,
            }
        )
    if not pages:
        raise ValueError("the feed contains no linked entries")
    return feed, pages


def crawl_feed(url: str, limit: int = 12) -> dict[str, Any]:
    """Discover RSS/Atom entries and extract full content from their linked pages."""
    deadline = time.monotonic() + CRAWL_TIMEOUT_SECONDS
    final_url, content_type, source = fetch_url(
        url,
        accept=(
            "application/rss+xml,application/atom+xml,application/xml,text/xml,"
            "application/xhtml+xml;q=0.8,text/html;q=0.8"
        ),
        deadline=deadline,
    )
    if content_type not in {
        "application/rss+xml",
        "application/atom+xml",
        "application/xml",
        "text/xml",
        "text/html",
        "application/xhtml+xml",
    }:
        raise ValueError("the feed URL did not return XML")
    feed, discovered = _parse_feed(source, final_url)
    pages: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    for item in discovered[:limit]:
        try:
            page_url, page_type, markup = fetch_url(item["url"], deadline=deadline)
            if page_type not in {"text/html", "application/xhtml+xml"}:
                raise ValueError("the linked feed page did not return HTML")
            page, _, _ = parse_page(markup, page_url)
            pages.append(
                {
                    **item,
                    "url": page["url"],
                    "slug": page["slug"] or item["slug"],
                    "title": item["title"] or page["title"],
                    "excerpt": item["excerpt"] or page["excerpt"],
                    "body": page["body"] if len(page["body"]) >= 80 else item["body"],
                }
            )
        except ValueError as error:
            # A feed item is still useful when its embedded content is available.
            if item["body"]:
                pages.append(item)
            errors.append({"url": item["url"], "error": str(error)})
            if time.monotonic() >= deadline:
                break
    return {
        "source": final_url,
        "kind": "feed",
        "feed": feed,
        "pages": pages,
        "errors": errors,
    }


def crawl_wordpress(url: str, limit: int = 12) -> dict[str, Any]:
    """Use WordPress REST discovery and `_embed` metadata instead of scraping cards."""
    final_url, content_type, markup = fetch_url(url)
    if content_type not in {"text/html", "application/xhtml+xml"}:
        raise ValueError("the WordPress blog URL did not return HTML")
    _, _, discovered = parse_page(markup, final_url)
    if discovered:
        api_root = discovered
    else:
        parsed = urlparse(final_url)
        api_root = f"{parsed.scheme}://{parsed.netloc}/wp-json/"
    endpoint = urljoin(api_root.rstrip("/") + "/", "wp/v2/posts")
    parsed_endpoint = urlparse(endpoint)
    query = dict(parse_qsl(parsed_endpoint.query))
    query.update(
        {"_embed": "1", "per_page": str(limit), "orderby": "date", "order": "desc"}
    )
    endpoint = urlunparse(parsed_endpoint._replace(query=urlencode(query)))
    response_url, response_type, source = fetch_url(endpoint, accept="application/json")
    if response_type != "application/json":
        raise ValueError("the discovered WordPress REST endpoint did not return JSON")
    try:
        posts = json.loads(source)
    except json.JSONDecodeError as error:
        raise ValueError("the WordPress REST endpoint returned invalid JSON") from error
    if not isinstance(posts, list):
        raise ValueError("the WordPress REST endpoint did not return a post list")
    pages = []
    for post in posts[:limit]:
        if not isinstance(post, dict):
            continue
        title = _plain_text(str((post.get("title") or {}).get("rendered", "")))
        excerpt = _plain_text(str((post.get("excerpt") or {}).get("rendered", "")))
        body = _plain_text(str((post.get("content") or {}).get("rendered", "")))[
            :MAX_PAGE_TEXT
        ]
        pages.append(
            {
                "url": post.get("link"),
                "slug": post.get("slug"),
                "title": title,
                "excerpt": excerpt,
                "body": body,
                "published_at": post.get("date_gmt") or post.get("date"),
                "source_id": post.get("id"),
            }
        )
    return {
        "source": final_url,
        "api": response_url,
        "kind": "wordpress",
        "pages": pages,
        "errors": [],
    }
