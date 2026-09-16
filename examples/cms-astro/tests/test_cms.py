# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

from __future__ import annotations

import json
import sys
from email.message import Message
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "core"))

from cms_astro_core.host import create_app
from cms_astro_core.crawler import crawl_feed, fetch_url, parse_page
from cms_astro_core.seed import seed_database
from cms_astro_core.store import Store


def client(tmp_path: Path) -> TestClient:
    # Extension discovery is covered by Reactor itself; API tests stay isolated
    # from whichever unrelated example wheels are installed in the environment.
    return TestClient(create_app(database=tmp_path / "cms.sqlite3", discover=False, allow_identity_header=True))


def test_seed_is_multi_user_multi_site_ready(tmp_path: Path) -> None:
    api = client(tmp_path)
    response = api.get("/api/cms/sites", headers={"X-CMS-User": "u-user1"})
    assert response.status_code == 200
    assert response.json()[0]["role"] == "author"
    assert response.json()[0]["theme_slug"] == "editorial"
    assert response.json()[0]["member_count"] == 3
    assert response.json()[0]["entry_count"] == 4


def test_password_login_and_admin_boundaries(tmp_path: Path) -> None:
    api = TestClient(create_app(database=tmp_path / "secure.sqlite3", discover=False))
    admin_login = api.post("/api/cms/auth/login", json={"username": "admin", "password": "admin"})
    user_login = api.post("/api/cms/auth/login", json={"username": "user1", "password": "user1"})
    user2_login = api.post("/api/cms/auth/login", json={"username": "user2", "password": "user2"})
    assert admin_login.status_code == 200
    assert user_login.status_code == 200
    assert user2_login.status_code == 200
    admin_headers = {"Authorization": f"Bearer {admin_login.json()['token']}"}
    user_headers = {"Authorization": f"Bearer {user_login.json()['token']}"}
    user2_headers = {"Authorization": f"Bearer {user2_login.json()['token']}"}
    assert api.get("/api/cms/sites/site-main/users", headers=admin_headers).status_code == 200
    assert api.get("/api/cms/sites/site-main/users", headers=user_headers).status_code == 403
    assert api.get("/api/cms/sites/site-main/entries", headers=user_headers).status_code == 200
    assert api.get("/api/cms/sites", headers=user2_headers).json()[0]["id"] == "site-main"
    assert api.post("/api/cms/sites", headers=user_headers, json={"slug":"forbidden","name":"Forbidden"}).status_code == 403
    assert api.patch("/api/cms/sites/site-main/theme", headers=user_headers, json={"theme":"studio"}).status_code == 403
    portable = {"theme":"datalayer", "color_mode":"light", "light":{"--bgColor-default":"#fff"}, "dark":{"--bgColor-default":"#000"}}
    assert api.patch("/api/cms/sites/site-main/appearance", headers=user_headers, json=portable).status_code == 403
    unsafe = portable | {"light":{"--bgColor-default":"red;display:none"}}
    assert api.patch("/api/cms/sites/site-main/appearance", headers=admin_headers, json=unsafe).status_code == 422
    assert api.post("/api/cms/auth/login", json={"username": "user2", "password": "wrong"}).status_code == 401


def test_authenticated_browser_request_allows_cors_preflight(tmp_path: Path) -> None:
    api = TestClient(create_app(database=tmp_path / "cors.sqlite3", discover=False))
    response = api.options(
        "/api/cms/sites",
        headers={
            "Origin": "http://localhost:4321",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization,content-type",
        },
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "*"
    assert "authorization" in response.headers["access-control-allow-headers"].lower()


def test_blog_crawl_is_authenticated_and_returns_public_pages(tmp_path: Path, monkeypatch) -> None:
    from cms_astro_core import api as cms_api

    result = {
        "source": "https://example.test/blog",
        "kind": "blog",
        "pages": [{"title": "A public story", "slug": "story", "body": "Public body"}],
        "errors": [],
    }
    monkeypatch.setattr(cms_api, "crawl_blog", lambda url, limit: result | {"limit": limit})
    api = TestClient(create_app(database=tmp_path / "crawl.sqlite3", discover=False))
    assert api.post(
        "/api/cms/sites/site-main/crawl/blog",
        json={"url": "https://example.test/blog"},
    ).status_code == 401
    login = api.post("/api/cms/auth/login", json={"username": "user1", "password": "user1"}).json()
    response = api.post(
        "/api/cms/sites/site-main/crawl/blog",
        headers={"Authorization": f"Bearer {login['token']}"},
        json={"url": "https://example.test/blog", "limit": 3},
    )
    assert response.status_code == 200
    assert response.json()["pages"][0]["slug"] == "story"
    assert response.json()["limit"] == 3


def test_feed_crawl_is_authenticated(tmp_path: Path, monkeypatch) -> None:
    from cms_astro_core import api as cms_api

    monkeypatch.setattr(
        cms_api,
        "crawl_feed",
        lambda url, limit: {
            "source": url,
            "kind": "feed",
            "pages": [{"title": "Feed story", "slug": "feed-story"}],
            "errors": [],
            "limit": limit,
        },
    )
    api = TestClient(create_app(database=tmp_path / "feed.sqlite3", discover=False))
    assert api.post(
        "/api/cms/sites/site-main/crawl/feed",
        json={"url": "https://example.test/feed/"},
    ).status_code == 401
    login = api.post(
        "/api/cms/auth/login", json={"username": "user1", "password": "user1"}
    ).json()
    response = api.post(
        "/api/cms/sites/site-main/crawl/feed",
        headers={"Authorization": f"Bearer {login['token']}"},
        json={"url": "https://example.test/feed/", "limit": 3},
    )
    assert response.status_code == 200
    assert response.json()["pages"][0]["slug"] == "feed-story"


def test_crawler_extracts_wordpress_discovery_and_clean_text() -> None:
    page, links, wordpress = parse_page(
        """
        <html><head><title>Example Blog</title>
        <meta name="description" content="Useful stories">
        <link rel="https://api.w.org/" href="/wp-json/"></head>
        <body><nav>Navigation noise</nav><main><h1>Story</h1><p>Readable body.</p></main>
        <a href="/blog/story">Read</a><script>ignored()</script></body></html>
        """,
        "https://example.test/blog",
    )
    assert page["title"] == "Example Blog"
    assert "Readable body" in page["body"]
    assert "Navigation noise" not in page["body"]
    assert links == ["/blog/story"]
    assert wordpress == "https://example.test/wp-json/"


def test_feed_crawler_reads_rss_metadata_and_linked_page_content(monkeypatch) -> None:
    from cms_astro_core import crawler

    feed = """<?xml version="1.0" encoding="UTF-8"?>
    <rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
      <channel><title>Example Journal</title><link>https://example.test/</link>
        <description>Useful stories</description><item>
          <title>A feed story</title><link>https://example.test/feed-story/</link>
          <description><![CDATA[A concise summary.]]></description>
          <dc:creator>Example Author</dc:creator><category>Engineering</category>
          <pubDate>Wed, 02 Sep 2026 01:29:09 +0000</pubDate>
          <guid>story-42</guid>
        </item></channel>
    </rss>"""
    article = """<html><head><title>A feed story</title></head><body><main>
      <h1>A feed story</h1><p>This is the complete linked article body with
      enough useful content for the crawler to prefer it over the summary.</p>
    </main></body></html>"""

    def fake_fetch(url: str, **_kwargs):
        if url.endswith("/feed/"):
            return url, "application/rss+xml", feed
        return url, "text/html", article

    monkeypatch.setattr(crawler, "fetch_url", fake_fetch)
    result = crawl_feed("https://example.test/feed/", limit=1)
    assert result["kind"] == "feed"
    assert result["feed"]["title"] == "Example Journal"
    assert result["pages"][0]["slug"] == "feed-story"
    assert result["pages"][0]["author"] == "Example Author"
    assert result["pages"][0]["categories"] == ["Engineering"]
    assert "complete linked article body" in result["pages"][0]["body"]


def test_crawler_pins_the_validated_dns_address(monkeypatch) -> None:
    from cms_astro_core import crawler

    opened: dict[str, object] = {}

    class Response:
        status = 200
        headers = Message()
        headers["Content-Type"] = "text/html; charset=utf-8"

        def read(self, _limit: int) -> bytes:
            return b"<title>Pinned</title>"

    class Connection:
        def __init__(
            self,
            host: str,
            port: int,
            family: int,
            protocol: int,
            socket_address: tuple[object, ...],
            timeout: float,
        ) -> None:
            opened.update(
                host=host,
                port=port,
                family=family,
                protocol=protocol,
                socket_address=socket_address,
                timeout=timeout,
            )

        def request(self, method: str, path: str, headers: dict[str, str]) -> None:
            opened.update(method=method, path=path, headers=headers)

        def getresponse(self) -> Response:
            return Response()

        def close(self) -> None:
            opened["closed"] = True

    resolutions = 0

    def resolve(*_args, **_kwargs):
        nonlocal resolutions
        resolutions += 1
        return [(2, 1, 6, "", ("93.184.216.34", 80))]

    monkeypatch.setattr(crawler.socket, "getaddrinfo", resolve)
    monkeypatch.setattr(crawler, "_PinnedHTTPConnection", Connection)
    final_url, content_type, body = fetch_url("http://example.test/blog")
    assert resolutions == 1
    assert opened["socket_address"] == ("93.184.216.34", 80)
    assert opened["host"] == "example.test"
    assert opened["closed"] is True
    assert (final_url, content_type, body) == (
        "http://example.test/blog",
        "text/html",
        "<title>Pinned</title>",
    )


def test_fetch_rejects_an_expired_crawl_deadline(monkeypatch) -> None:
    from cms_astro_core import crawler

    monkeypatch.setattr(crawler.time, "monotonic", lambda: 20.0)
    with pytest.raises(ValueError, match="45 second deadline"):
        fetch_url("https://example.test/blog", deadline=19.0)


def test_draft_publish_revision_and_public_query(tmp_path: Path) -> None:
    api = client(tmp_path)
    headers = {"X-CMS-User": "u-user1"}
    created = api.post("/api/cms/sites/site-main/entries", headers=headers, json={"collection":"posts","title":"A new Astro story","body":"# Story\n\nLive content."})
    assert created.status_code == 201
    entry = created.json()
    assert entry["status"] == "draft"
    assert api.get(f"/api/content/acme/entries/{entry['slug']}").status_code == 404
    published = api.post(f"/api/cms/sites/site-main/entries/{entry['id']}/publish", headers=headers)
    assert published.status_code == 200
    assert published.json()["status"] == "published"
    assert api.get(f"/api/content/acme/entries/{entry['slug']}").json()["title"] == "A new Astro story"
    revisions = api.get(f"/api/cms/sites/site-main/entries/{entry['id']}/revisions", headers=headers)
    assert len(revisions.json()) == 1
    assert api.get(
        f"/api/cms/sites/site-main/entries/{entry['id']}/revisions",
        headers={"X-CMS-User": "u-user2"},
    ).status_code == 403

    second_site = api.post(
        "/api/cms/sites",
        headers={"X-CMS-User": "u-admin"},
        json={"slug": "other", "name": "Other site"},
    ).json()
    assert api.get(
        f"/api/cms/sites/{second_site['id']}/entries/{entry['id']}/revisions",
        headers={"X-CMS-User": "u-admin"},
    ).status_code == 404


def test_author_cannot_edit_another_authors_entry(tmp_path: Path) -> None:
    api = client(tmp_path)
    visible = api.get("/api/cms/sites/site-main/entries", headers={"X-CMS-User":"u-user1"})
    assert {entry["id"] for entry in visible.json()} == {
        "entry-welcome", "entry-design-systems", "entry-multi-site", "entry-layout"
    }
    response = api.patch("/api/cms/sites/site-main/entries/entry-welcome", headers={"X-CMS-User":"u-user1"}, json={"title":"Taken over"})
    assert response.status_code == 403
    duplicate = api.post(
        "/api/cms/sites/site-main/entries",
        headers={"X-CMS-User": "u-user1"},
        json={
            "collection": "pages",
            "title": "Same slug, different collection",
            "slug": "design-systems-that-travel",
        },
    )
    assert duplicate.status_code == 201
    read_by_slug = api.get(
        "/api/cms/sites/site-main/entries/by-slug/design-systems-that-travel?collection=posts",
        headers={"X-CMS-User": "u-user2"},
    )
    assert read_by_slug.status_code == 200
    assert read_by_slug.json()["id"] == "entry-design-systems"
    assert read_by_slug.json()["collection"] == "posts"
    read_by_id = api.get(
        "/api/cms/sites/site-main/entries/entry-design-systems",
        headers={"X-CMS-User": "u-user2"},
    )
    assert read_by_id.status_code == 200
    assert read_by_id.json()["slug"] == "design-systems-that-travel"
    lexical_entry = api.post(
        "/api/cms/sites/site-main/entries",
        headers={"X-CMS-User": "u-user1"},
        json={
            "collection": "posts",
            "title": "Lexical draft",
            "body": "Old text",
            "data": {"source_url": "https://example.test", "lexical": "serialized"},
        },
    ).json()
    assert api.patch(
        f"/api/cms/sites/site-main/entries/{lexical_entry['id']}",
        headers={"X-CMS-User": "u-user1"},
        json={"body": "Updated by the agent"},
    ).status_code == 200
    updated_lexical_entry = api.get(
        f"/api/cms/sites/site-main/entries/{lexical_entry['id']}",
        headers={"X-CMS-User": "u-user1"},
    ).json()
    assert updated_lexical_entry["data"] == {"source_url": "https://example.test"}
    by_slug = api.patch(
        "/api/cms/sites/site-main/entries/by-slug/design-systems-that-travel?collection=posts",
        headers={"X-CMS-User": "u-user1"},
        json={"excerpt": "Updated safely by an exact slug."},
    )
    assert by_slug.status_code == 200
    assert by_slug.json() == {
        "id": "entry-design-systems",
        "slug": "design-systems-that-travel",
        "status": "published",
        "collection": "posts",
    }
    page = api.patch(
        "/api/cms/sites/site-main/entries/by-slug/design-systems-that-travel?collection=pages",
        headers={"X-CMS-User": "u-user1"},
        json={"excerpt": "Only the standalone page."},
    )
    assert page.status_code == 200
    assert page.json()["id"] == duplicate.json()["id"]
    published_page = api.post(
        "/api/cms/sites/site-main/entries/by-slug/design-systems-that-travel/publish?collection=pages",
        headers={"X-CMS-User": "u-user1"},
    )
    assert published_page.status_code == 200
    assert published_page.json()["id"] == duplicate.json()["id"]
    assert published_page.json()["status"] == "published"


def test_reseed_requires_confirmation_and_removes_existing_data(tmp_path: Path) -> None:
    database = tmp_path / "reseed.sqlite3"
    store = Store(database)
    with store.connect() as db:
        db.execute(
            "INSERT INTO users(id,email,name,disabled,created_at,username,password_hash) VALUES(?,?,?,?,?,?,?)",
            ("custom-user", "custom@example.test", "Custom", 0, "now", "custom", "hash"),
        )

    assert seed_database(str(database), input_fn=lambda _: "no") is False
    with store.connect() as db:
        assert db.execute("SELECT 1 FROM users WHERE id='custom-user'").fetchone()

    assert seed_database(str(database), input_fn=lambda _: "yes") is True
    with store.connect() as db:
        assert not db.execute("SELECT 1 FROM users WHERE id='custom-user'").fetchone()
        assert db.execute("SELECT COUNT(*) FROM entries").fetchone()[0] == 4


def test_admin_can_model_content_and_switch_theme(tmp_path: Path) -> None:
    api = client(tmp_path)
    headers = {"X-CMS-User": "u-admin"}
    collection = api.post("/api/cms/sites/site-main/collections", headers=headers, json={"slug":"products","name":"Products","fields":[{"name":"price","type":"number"}]})
    assert collection.status_code == 201
    assert collection.json()["fields"][0]["name"] == "price"
    theme = api.patch("/api/cms/sites/site-main/theme", headers=headers, json={"theme":"studio"})
    assert theme.status_code == 200
    assert api.get("/api/content/acme/bootstrap").json()["site"]["theme_slug"] == "studio"
    appearance = api.patch("/api/cms/sites/site-main/appearance", headers=headers, json={
        "theme": "spatial", "color_mode": "auto", "layout_theme": "editorial",
        "light": {"--bgColor-default": "#ffffff", "--fgColor-default": "#111827", "--fgColor-accent": "#3730a3"},
        "dark": {"--bgColor-default": "#111827", "--fgColor-default": "#e0e7ff", "--fgColor-accent": "#6366f1"},
    })
    assert appearance.status_code == 200
    settings = api.get("/api/content/acme/bootstrap").json()["settings"]
    assert settings["appearance.theme"] == "spatial"
    assert settings["appearance.colorMode"] == "auto"
    assert json.loads(settings["appearance.tokens.dark"])["--fgColor-accent"] == "#6366f1"
    assert api.get("/api/content/acme/bootstrap").json()["site"]["theme_slug"] == "editorial"


def test_admin_can_create_a_second_site_and_add_a_user(tmp_path: Path) -> None:
    api = client(tmp_path)
    headers = {"X-CMS-User": "u-admin"}
    site = api.post("/api/cms/sites", headers=headers, json={"slug":"studio","name":"Studio Site","theme":"studio"})
    assert site.status_code == 201
    assert len(api.get("/api/cms/sites", headers=headers).json()) == 2
    updated_site = api.patch(f"/api/cms/sites/{site.json()['id']}", headers=headers, json={"name":"Studio Journal","tagline":"A second publication"})
    assert updated_site.status_code == 200
    assert updated_site.json()["tagline"] == "A second publication"
    user = api.post("/api/cms/sites/site-main/users", headers=headers, json={"username":"writer","password":"writer-password","email":"writer@example.test","name":"New Writer"}).json()
    membership = api.put("/api/cms/sites/site-main/memberships", headers=headers, json={"user_id":user["id"],"role":"author"})
    assert membership.status_code == 201
    members = api.get("/api/cms/sites/site-main/users", headers=headers)
    assert any(item["email"] == "writer@example.test" and item["role"] == "author" for item in members.json())
    disabled = api.patch(f"/api/cms/sites/site-main/users/{user['id']}", headers=headers, json={"disabled": True})
    assert disabled.status_code == 200
    assert disabled.json()["disabled"] == 1
    updated = api.patch(f"/api/cms/sites/site-main/users/{user['id']}", headers=headers, json={"name": "Updated Writer", "username": "updated-writer", "email": "updated@example.test"})
    assert updated.status_code == 200
    assert updated.json()["username"] == "updated-writer"
    assert api.patch("/api/cms/sites/site-main/users/u-admin", headers=headers, json={"disabled": True}).status_code == 409
    assert api.put(
        "/api/cms/sites/site-main/memberships",
        headers=headers,
        json={"user_id": "u-admin", "role": "author"},
    ).status_code == 409
    assert api.delete("/api/cms/sites/site-main/users/u-admin", headers=headers).status_code == 409
    assert api.delete(f"/api/cms/sites/site-main/users/{user['id']}", headers=headers).status_code == 204
    assert all(member["id"] != user["id"] for member in api.get("/api/cms/sites/site-main/users", headers=headers).json())


def test_search_media_taxonomy_and_menu_management(tmp_path: Path) -> None:
    api = client(tmp_path)
    headers = {"X-CMS-User": "u-admin"}
    assert api.get("/api/cms/sites/site-main/search?q=Welcome", headers=headers).json()[0]["id"] == "entry-welcome"
    media = api.post("/api/cms/sites/site-main/media", headers=headers, json={"filename":"hero.jpg","url":"/uploads/hero.jpg","mime_type":"image/jpeg","alt_text":"Sunrise"})
    assert media.status_code == 201
    taxonomy = api.post("/api/cms/sites/site-main/taxonomies", headers=headers, json={"slug":"topics","name":"Topics"}).json()
    term = api.post(f"/api/cms/sites/site-main/taxonomies/{taxonomy['id']}/terms", headers=headers, json={"slug":"astro","name":"Astro"})
    assert term.status_code == 201
    menu = api.post("/api/cms/sites/site-main/menus", headers=headers, json={"slug":"footer","name":"Footer"}).json()
    item = api.post(f"/api/cms/sites/site-main/menus/{menu['id']}/items", headers=headers, json={"label":"About","url":"/about"})
    assert item.status_code == 201
    unsafe_item = api.post(
        f"/api/cms/sites/site-main/menus/{menu['id']}/items",
        headers=headers,
        json={"label": "Unsafe", "url": "javascript:alert(1)"},
    )
    assert unsafe_item.status_code == 422
