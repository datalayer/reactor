from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "core"))

from cms_astro_core.host import create_app


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
    assert response.json()[0]["entry_count"] == 1


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


def test_author_cannot_edit_another_authors_entry(tmp_path: Path) -> None:
    api = client(tmp_path)
    visible = api.get("/api/cms/sites/site-main/entries", headers={"X-CMS-User":"u-user1"})
    assert [entry["id"] for entry in visible.json()] == ["entry-welcome"]
    response = api.patch("/api/cms/sites/site-main/entries/entry-welcome", headers={"X-CMS-User":"u-user1"}, json={"title":"Taken over"})
    assert response.status_code == 403


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
