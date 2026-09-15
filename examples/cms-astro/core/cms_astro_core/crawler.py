# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""Small, dependency-free public blog crawler used by the CMS agent tools."""

from __future__ import annotations

import html
import ipaddress
import json
import re
import socket
from html.parser import HTMLParser
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse
from urllib.request import HTTPRedirectHandler, Request, build_opener

MAX_RESPONSE_BYTES = 2_000_000
MAX_REDIRECTS = 5
USER_AGENT = "Datalayer-Reactor-CMS/0.1 (+https://datalayer.ai)"


def _public_url(value: str) -> str:
    """Validate an HTTP URL and reject hosts resolving to non-public networks."""
    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username:
        raise ValueError("a public http or https URL is required")
    try:
        addresses = {
            item[4][0]
            for item in socket.getaddrinfo(parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
        }
    except socket.gaierror as error:
        raise ValueError(f"could not resolve {parsed.hostname}") from error
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("private, local, reserved, and link-local hosts cannot be crawled")
    return urlunparse(parsed._replace(fragment=""))


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, file_pointer, code, message, headers, new_url):
        return None


def fetch_url(value: str, *, accept: str = "text/html,application/xhtml+xml,application/json") -> tuple[str, str, str]:
    """Fetch a bounded public response, revalidating every redirect target."""
    current = value
    opener = build_opener(_NoRedirect)
    for _ in range(MAX_REDIRECTS + 1):
        current = _public_url(current)
        request = Request(current, headers={"Accept": accept, "User-Agent": USER_AGENT})
        try:
            response = opener.open(request, timeout=12)
        except HTTPError as error:
            if error.code not in {301, 302, 303, 307, 308}:
                raise ValueError(f"the remote site returned HTTP {error.code}") from error
            location = error.headers.get("Location")
            if not location:
                raise ValueError("the remote site returned a redirect without a location") from error
            current = urljoin(current, location)
            continue
        except (TimeoutError, URLError) as error:
            raise ValueError(f"could not fetch {current}: {error.reason if isinstance(error, URLError) else error}") from error
        with response:
            content_type = response.headers.get_content_type()
            charset = response.headers.get_content_charset() or "utf-8"
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise ValueError("the remote response is larger than 2 MB")
            return response.geturl(), content_type, raw.decode(charset, errors="replace")
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
        if tag in {"p", "div", "article", "main", "section", "li", "h1", "h2", "h3", "br"} and not self._ignored:
            self._text.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "svg", "noscript", "nav", "footer"} and self._ignored:
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
        "body": parser.text,
    }
    return page, parser.links, urljoin(url, parser.wordpress_api) if parser.wordpress_api else ""


def _same_origin_links(base: str, links: list[str]) -> list[str]:
    origin = urlparse(base)
    result: list[str] = []
    seen: set[str] = set()
    for href in links:
        candidate = urljoin(base, href)
        parsed = urlparse(candidate)
        if parsed.scheme not in {"http", "https"} or parsed.netloc != origin.netloc:
            continue
        if re.search(r"\.(?:jpg|jpeg|png|gif|svg|webp|pdf|zip)(?:$|\?)", parsed.path, re.I):
            continue
        normalized = urlunparse(parsed._replace(fragment=""))
        if normalized not in seen:
            seen.add(normalized)
            result.append(normalized)
    return result


def crawl_blog(url: str, limit: int = 12) -> dict[str, Any]:
    """Discover same-origin links on a blog index and extract each page."""
    final_url, content_type, markup = fetch_url(url)
    if content_type not in {"text/html", "application/xhtml+xml"}:
        raise ValueError("the blog URL did not return HTML")
    index, links, wordpress_api = parse_page(markup, final_url)
    pages: list[dict[str, Any]] = []
    errors: list[dict[str, str]] = []
    candidates = [item for item in _same_origin_links(final_url, links) if item.rstrip("/") != final_url.rstrip("/")]
    blog_path = urlparse(final_url).path.rstrip("/")
    if blog_path:
        under_blog = [item for item in candidates if urlparse(item).path.startswith(f"{blog_path}/")]
        if under_blog:
            candidates = under_blog
    for candidate in candidates[:limit]:
        try:
            page_url, page_type, page_markup = fetch_url(candidate)
            if page_type in {"text/html", "application/xhtml+xml"}:
                page, _, _ = parse_page(page_markup, page_url)
                if len(page["body"]) >= 80:
                    pages.append(page)
        except ValueError as error:
            errors.append({"url": candidate, "error": str(error)})
    if not pages:
        pages.append(index)
    return {"source": final_url, "kind": "blog", "wordpress_api": wordpress_api or None, "pages": pages, "errors": errors}


def _plain_text(markup: str) -> str:
    parser = PageParser()
    parser.feed(markup)
    parser.finish()
    return html.unescape(parser.text)


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
    query.update({"_embed": "1", "per_page": str(limit), "orderby": "date", "order": "desc"})
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
        body = _plain_text(str((post.get("content") or {}).get("rendered", "")))
        pages.append({
            "url": post.get("link"),
            "slug": post.get("slug"),
            "title": title,
            "excerpt": excerpt,
            "body": body,
            "published_at": post.get("date_gmt") or post.get("date"),
            "source_id": post.get("id"),
        })
    return {"source": final_url, "api": response_url, "kind": "wordpress", "pages": pages, "errors": []}
