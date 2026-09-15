"""SQLite persistence for the CMS. Only the standard library is required."""

from __future__ import annotations

import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4


SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS themes (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', tokens TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '', theme_id TEXT NOT NULL REFERENCES themes(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memberships (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('admin','editor','author','viewer')),
  PRIMARY KEY(site_id, user_id)
);
CREATE TABLE IF NOT EXISTS collections (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL,
  UNIQUE(site_id, slug)
);
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id), slug TEXT NOT NULL,
  title TEXT NOT NULL, excerpt TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'draft'
    CHECK(status IN ('draft','review','scheduled','published','trashed')),
  publish_at TEXT, published_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(site_id, collection_id, slug)
);
CREATE TABLE IF NOT EXISTS revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id), snapshot TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id), filename TEXT NOT NULL, url TEXT NOT NULL,
  mime_type TEXT NOT NULL, alt_text TEXT NOT NULL DEFAULT '', size INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS taxonomies (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug TEXT NOT NULL, name TEXT NOT NULL, hierarchical INTEGER NOT NULL DEFAULT 0,
  UNIQUE(site_id, slug)
);
CREATE TABLE IF NOT EXISTS terms (
  id TEXT PRIMARY KEY, taxonomy_id TEXT NOT NULL REFERENCES taxonomies(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES terms(id) ON DELETE SET NULL, slug TEXT NOT NULL, name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', UNIQUE(taxonomy_id, slug)
);
CREATE TABLE IF NOT EXISTS entry_terms (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  term_id TEXT NOT NULL REFERENCES terms(id) ON DELETE CASCADE, PRIMARY KEY(entry_id, term_id)
);
CREATE TABLE IF NOT EXISTS menus (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  slug TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(site_id, slug)
);
CREATE TABLE IF NOT EXISTS menu_items (
  id TEXT PRIMARY KEY, menu_id TEXT NOT NULL REFERENCES menus(id) ON DELETE CASCADE,
  parent_id TEXT REFERENCES menu_items(id) ON DELETE CASCADE, label TEXT NOT NULL,
  url TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS widgets (
  id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  area TEXT NOT NULL, kind TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS settings (
  site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  key TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY(site_id, key)
);
CREATE VIRTUAL TABLE IF NOT EXISTS entry_search USING fts5(entry_id UNINDEXED, site_id UNINDEXED, title, excerpt, body);
CREATE TRIGGER IF NOT EXISTS entries_search_insert AFTER INSERT ON entries BEGIN
  INSERT INTO entry_search(entry_id,site_id,title,excerpt,body) VALUES(new.id,new.site_id,new.title,new.excerpt,new.body);
END;
CREATE TRIGGER IF NOT EXISTS entries_search_update AFTER UPDATE ON entries BEGIN
  DELETE FROM entry_search WHERE entry_id=old.id;
  INSERT INTO entry_search(entry_id,site_id,title,excerpt,body) VALUES(new.id,new.site_id,new.title,new.excerpt,new.body);
END;
CREATE TRIGGER IF NOT EXISTS entries_search_delete AFTER DELETE ON entries BEGIN
  DELETE FROM entry_search WHERE entry_id=old.id;
END;
"""

ROLE_LEVEL = {"viewer": 0, "author": 1, "editor": 2, "admin": 3}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "untitled"


class Store:
    def __init__(self, path: str | Path):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript(SCHEMA)
            self._seed(db)

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise
        finally:
            db.close()

    def _seed(self, db: sqlite3.Connection) -> None:
        if db.execute("SELECT 1 FROM users LIMIT 1").fetchone():
            return
        stamp = now()
        db.executemany("INSERT INTO users VALUES(?,?,?,?,?)", [
            ("u-admin", "admin@example.test", "Ada Admin", 0, stamp),
            ("u-editor", "editor@example.test", "Ed Editor", 0, stamp),
            ("u-author", "author@example.test", "Ari Author", 0, stamp),
        ])
        db.executemany("INSERT INTO themes VALUES(?,?,?,?,?)", [
            ("theme-editorial", "editorial", "Editorial", "Warm magazine theme", json.dumps({"accent":"#c2410c","font":"Georgia"})),
            ("theme-studio", "studio", "Studio", "Clean portfolio theme", json.dumps({"accent":"#4f46e5","font":"Inter"})),
        ])
        db.execute("INSERT INTO sites VALUES(?,?,?,?,?,?,?)", ("site-main", "acme", "Acme Journal", "Ideas worth shipping", "theme-editorial", stamp, stamp))
        db.executemany("INSERT INTO memberships VALUES(?,?,?)", [
            ("site-main", "u-admin", "admin"), ("site-main", "u-editor", "editor"), ("site-main", "u-author", "author")
        ])
        fields = json.dumps([{"name":"title","type":"text","required":True},{"name":"body","type":"richText","required":True},{"name":"cover","type":"media"}])
        db.executemany("INSERT INTO collections VALUES(?,?,?,?,?,?,?)", [
            ("collection-posts", "site-main", "posts", "Posts", "Journal entries", fields, stamp),
            ("collection-pages", "site-main", "pages", "Pages", "Standalone pages", fields, stamp),
        ])
        db.executemany("INSERT INTO taxonomies VALUES(?,?,?,?,?)", [
            ("tax-category", "site-main", "categories", "Categories", 1),
            ("tax-tag", "site-main", "tags", "Tags", 0),
        ])
        db.execute("INSERT INTO terms VALUES(?,?,?,?,?,?)", ("term-news", "tax-category", None, "news", "News", "Company news"))
        db.execute("INSERT INTO menus VALUES(?,?,?,?)", ("menu-primary", "site-main", "primary", "Primary navigation"))
        db.executemany("INSERT INTO menu_items VALUES(?,?,?,?,?,?)", [
            ("menu-home", "menu-primary", None, "Home", "/", 0), ("menu-blog", "menu-primary", None, "Blog", "/blog", 10)
        ])
        db.execute("INSERT INTO widgets VALUES(?,?,?,?,?,?)", ("widget-footer", "site-main", "footer", "text", 0, json.dumps({"text":"Built with Astro + Reactor"})))
        db.executemany("INSERT INTO settings VALUES(?,?,?)", [("site-main", "postsPerPage", "10"), ("site-main", "locale", "en")])
        entry_id = "entry-welcome"
        db.execute("INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
            entry_id, "site-main", "collection-posts", "u-admin", "welcome", "Welcome to Acme Journal",
            "The first database-backed story.", "# Welcome\n\nEdit this story from the CMS API.", "{}", "published", None, stamp, stamp, stamp
        ))

    @staticmethod
    def row(row: sqlite3.Row | None) -> dict[str, Any] | None:
        if row is None:
            return None
        value = dict(row)
        for key in ("fields", "data", "tokens"):
            if key in value and isinstance(value[key], str):
                value[key] = json.loads(value[key])
        return value

    def role(self, db: sqlite3.Connection, site_id: str, user_id: str) -> str | None:
        row = db.execute("SELECT role FROM memberships WHERE site_id=? AND user_id=?", (site_id, user_id)).fetchone()
        return row["role"] if row else None

    def require(self, db: sqlite3.Connection, site_id: str, user_id: str, minimum: str) -> str:
        role = self.role(db, site_id, user_id)
        if role is None or ROLE_LEVEL[role] < ROLE_LEVEL[minimum]:
            raise PermissionError(f"{minimum} role required")
        return role

    def create_entry(self, site_id: str, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.connect() as db:
            self.require(db, site_id, user_id, "author")
            collection = db.execute("SELECT id FROM collections WHERE site_id=? AND slug=?", (site_id, payload["collection"])).fetchone()
            if not collection:
                raise LookupError("collection not found")
            stamp, entry_id = now(), f"entry-{uuid4().hex}"
            db.execute("INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (
                entry_id, site_id, collection["id"], user_id, payload.get("slug") or slugify(payload["title"]),
                payload["title"], payload.get("excerpt", ""), payload.get("body", ""), json.dumps(payload.get("data", {})),
                "draft", None, None, stamp, stamp
            ))
            return self.row(db.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()) or {}

    def update_entry(self, site_id: str, entry_id: str, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        with self.connect() as db:
            role = self.require(db, site_id, user_id, "author")
            current = db.execute("SELECT * FROM entries WHERE site_id=? AND id=?", (site_id, entry_id)).fetchone()
            if not current:
                raise LookupError("entry not found")
            if role == "author" and current["author_id"] != user_id:
                raise PermissionError("authors may edit only their own entries")
            db.execute("INSERT INTO revisions(entry_id,author_id,snapshot,created_at) VALUES(?,?,?,?)", (entry_id, user_id, json.dumps(dict(current)), now()))
            allowed = {"title", "slug", "excerpt", "body", "data", "status", "publish_at"}
            changes = {k: v for k, v in payload.items() if k in allowed}
            if "data" in changes:
                changes["data"] = json.dumps(changes["data"])
            if not changes:
                return self.row(current) or {}
            changes["updated_at"] = now()
            sql = ", ".join(f"{key}=?" for key in changes)
            db.execute(f"UPDATE entries SET {sql} WHERE id=?", (*changes.values(), entry_id))
            return self.row(db.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()) or {}

    def publish(self, site_id: str, entry_id: str, user_id: str) -> dict[str, Any]:
        with self.connect() as db:
            role = self.require(db, site_id, user_id, "author")
            entry = db.execute("SELECT * FROM entries WHERE site_id=? AND id=?", (site_id, entry_id)).fetchone()
            if not entry:
                raise LookupError("entry not found")
            if role == "author" and entry["author_id"] != user_id:
                raise PermissionError("authors may publish only their own entries")
            stamp = now()
            db.execute("INSERT INTO revisions(entry_id,author_id,snapshot,created_at) VALUES(?,?,?,?)", (entry_id, user_id, json.dumps(dict(entry)), stamp))
            db.execute("UPDATE entries SET status='published', published_at=?, updated_at=? WHERE id=?", (stamp, stamp, entry_id))
            return self.row(db.execute("SELECT * FROM entries WHERE id=?", (entry_id,)).fetchone()) or {}

