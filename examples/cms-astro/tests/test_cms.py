from __future__ import annotations

import sys
from pathlib import Path

from fastapi.testclient import TestClient

ROOT = Path(__file__).parents[1]
sys.path.insert(0, str(ROOT / "core"))

from cms_astro_core.host import create_app


def client(tmp_path: Path) -> TestClient:
    # Extension discovery is covered by Reactor itself; API tests stay isolated
    # from whichever unrelated example wheels are installed in the environment.
    return TestClient(create_app(database=tmp_path / "cms.sqlite3", discover=False))


def test_seed_is_multi_user_multi_site_ready(tmp_path: Path) -> None:
    api = client(tmp_path)
    response = api.get("/api/cms/sites", headers={"X-CMS-User": "u-editor"})
    assert response.status_code == 200
    assert response.json()[0]["role"] == "editor"
    assert response.json()[0]["theme_slug"] == "editorial"


def test_draft_publish_revision_and_public_query(tmp_path: Path) -> None:
    api = client(tmp_path)
    headers = {"X-CMS-User": "u-author"}
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
    response = api.patch("/api/cms/sites/site-main/entries/entry-welcome", headers={"X-CMS-User":"u-author"}, json={"title":"Taken over"})
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


def test_admin_can_create_a_second_site_and_add_a_user(tmp_path: Path) -> None:
    api = client(tmp_path)
    headers = {"X-CMS-User": "u-admin"}
    site = api.post("/api/cms/sites", headers=headers, json={"slug":"studio","name":"Studio Site","theme":"studio"})
    assert site.status_code == 201
    assert len(api.get("/api/cms/sites", headers=headers).json()) == 2
    user = api.post("/api/cms/sites/site-main/users", headers=headers, json={"email":"writer@example.test","name":"New Writer"}).json()
    membership = api.put("/api/cms/sites/site-main/memberships", headers=headers, json={"user_id":user["id"],"role":"author"})
    assert membership.status_code == 201
    members = api.get("/api/cms/sites/site-main/users", headers=headers)
    assert any(item["email"] == "writer@example.test" and item["role"] == "author" for item in members.json())
    disabled = api.patch(f"/api/cms/sites/site-main/users/{user['id']}", headers=headers, json={"disabled": True})
    assert disabled.status_code == 200
    assert disabled.json()["disabled"] == 1
    assert api.patch("/api/cms/sites/site-main/users/u-admin", headers=headers, json={"disabled": True}).status_code == 409


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
