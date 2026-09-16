# Copyright (c) 2026-Present Datalayer, Inc.
#
# Datalayer License

"""SQLite persistence for the CMS. Only the standard library is required."""

from __future__ import annotations

import json
import hashlib
import hmac
import re
import secrets
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator
from uuid import uuid4


SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
  username TEXT UNIQUE, password_hash TEXT
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL
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
    def __init__(self, path: str | Path, *, auto_seed: bool = True):
        self.path = str(path)
        Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.executescript(SCHEMA)
            self._migrate(db)
            if auto_seed:
                self._seed(db)

    def _migrate(self, db: sqlite3.Connection) -> None:
        """Bring databases created by earlier revisions forward in place."""
        columns = {row["name"] for row in db.execute("PRAGMA table_info(users)")}
        if "username" not in columns:
            db.execute("ALTER TABLE users ADD COLUMN username TEXT")
        if "password_hash" not in columns:
            db.execute("ALTER TABLE users ADD COLUMN password_hash TEXT")
        db.execute("CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique ON users(username)")
        db.execute("""CREATE TABLE IF NOT EXISTS sessions (
          token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          expires_at TEXT NOT NULL, created_at TEXT NOT NULL)""")

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
        self._seed_demo(db)

    @staticmethod
    def password_hash(password: str) -> str:
        salt = secrets.token_bytes(16)
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 260_000)
        return f"pbkdf2_sha256$260000${salt.hex()}${digest.hex()}"

    @staticmethod
    def verify_password(password: str, encoded: str | None) -> bool:
        if not encoded:
            return False
        try:
            algorithm, rounds, salt, expected = encoded.split("$", 3)
            if algorithm != "pbkdf2_sha256":
                return False
            actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), int(rounds)).hex()
            return hmac.compare_digest(actual, expected)
        except (TypeError, ValueError):
            return False

    def content_summary(self) -> dict[str, int]:
        """Return the records that make an existing CMS database meaningful."""
        with self.connect() as db:
            return {
                table: int(db.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
                for table in ("users", "sites", "entries")
            }

    def seed_demo(self, *, reset: bool = False) -> None:
        with self.connect() as db:
            has_content = db.execute(
                "SELECT EXISTS(SELECT 1 FROM users) OR EXISTS(SELECT 1 FROM sites) "
                "OR EXISTS(SELECT 1 FROM entries)"
            ).fetchone()[0]
            if has_content and not reset:
                raise RuntimeError("CMS data already exists; reset must be confirmed before seeding")
            if reset:
                self._reset(db)
            self._seed_demo(db)

    @staticmethod
    def _reset(db: sqlite3.Connection) -> None:
        """Remove all CMS data in foreign-key-safe order."""
        # Sites own collections, entries, revisions, media, taxonomies, menus,
        # widgets, settings and memberships through ON DELETE CASCADE.
        db.execute("DELETE FROM sites")
        db.execute("DELETE FROM themes")
        db.execute("DELETE FROM users")
        db.execute("DELETE FROM entry_search")
        db.execute("DELETE FROM sqlite_sequence WHERE name='revisions'")

    def _seed_demo(self, db: sqlite3.Connection) -> None:
        stamp = now()
        db.execute("DELETE FROM sessions WHERE user_id IN ('u-admin','u-user1','u-user2')")
        users = [
            ("u-admin", "admin@example.test", "Administrator", "admin", "admin"),
            ("u-user1", "user1@example.test", "User One", "user1", "user1"),
            ("u-user2", "user2@example.test", "User Two", "user2", "user2"),
        ]
        for user_id, email, name, username, password in users:
            db.execute("""INSERT INTO users(id,email,name,disabled,created_at,username,password_hash)
              VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,name=excluded.name,
              disabled=0,username=excluded.username,password_hash=excluded.password_hash""",
              (user_id, email, name, 0, stamp, username, self.password_hash(password)))
        db.executemany("INSERT INTO themes VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING", [
            ("theme-editorial", "editorial", "Editorial", "Warm magazine theme", json.dumps({"accent":"#c2410c","font":"Georgia"})),
            ("theme-studio", "studio", "Studio", "Clean portfolio theme", json.dumps({"accent":"#4f46e5","font":"Inter"})),
        ])
        db.execute("INSERT INTO sites VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING", ("site-main", "acme", "Acme Journal", "Ideas worth shipping", "theme-editorial", stamp, stamp))
        db.executemany("INSERT INTO memberships VALUES(?,?,?) ON CONFLICT(site_id,user_id) DO UPDATE SET role=excluded.role", [
            ("site-main", "u-admin", "admin"), ("site-main", "u-user1", "author"), ("site-main", "u-user2", "author")
        ])
        fields = json.dumps([{"name":"title","type":"text","required":True},{"name":"body","type":"richText","required":True},{"name":"cover","type":"media"}])
        db.executemany("INSERT INTO collections VALUES(?,?,?,?,?,?,?) ON CONFLICT(site_id,slug) DO NOTHING", [
            ("collection-posts", "site-main", "posts", "Posts", "Journal entries", fields, stamp),
            ("collection-pages", "site-main", "pages", "Pages", "Standalone pages", fields, stamp),
        ])
        db.executemany("INSERT INTO taxonomies VALUES(?,?,?,?,?) ON CONFLICT(site_id,slug) DO NOTHING", [
            ("tax-category", "site-main", "categories", "Categories", 1),
            ("tax-tag", "site-main", "tags", "Tags", 0),
        ])
        db.execute("INSERT INTO terms VALUES(?,?,?,?,?,?) ON CONFLICT(taxonomy_id,slug) DO NOTHING", ("term-news", "tax-category", None, "news", "News", "Company news"))
        db.execute("INSERT INTO menus VALUES(?,?,?,?) ON CONFLICT(site_id,slug) DO NOTHING", ("menu-primary", "site-main", "primary", "Primary navigation"))
        db.executemany("INSERT INTO menu_items VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING", [
            ("menu-home", "menu-primary", None, "Home", "/", 0), ("menu-blog", "menu-primary", None, "Blog", "/blog", 10)
        ])
        db.execute("INSERT INTO widgets VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING", ("widget-footer", "site-main", "footer", "text", 0, json.dumps({"text":"Built with Astro + Reactor"})))
        db.executemany("INSERT INTO settings VALUES(?,?,?) ON CONFLICT(site_id,key) DO NOTHING", [("site-main", "postsPerPage", "10"), ("site-main", "locale", "en")])
        published = datetime.now(timezone.utc)
        entries = [
            (
                "entry-welcome", "u-admin", "welcome", "Welcome to Acme Journal",
                "A field guide to the ideas, experiments, and people behind our work.",
                "# Welcome\n\nAcme Journal is a shared place for useful ideas. Explore the stories below, then switch between Editorial and Studio layouts to see the same content take on a completely different structure.",
                {"category": "Launch notes", "readingTime": "4 min", "featured": True},
            ),
            (
                "entry-design-systems", "u-user1", "design-systems-that-travel", "Design systems that travel well",
                "How portable tokens keep a visual language coherent across products and frameworks.",
                "# Design systems that travel well\n\nA durable design system separates meaning from implementation. Functional tokens give every surface a shared vocabulary while allowing each framework to render in its own way.",
                {"category": "Design", "readingTime": "6 min"},
            ),
            (
                "entry-multi-site", "u-user2", "one-cms-many-sites", "One CMS, many distinct sites",
                "Model shared infrastructure without making every publication look the same.",
                "# One CMS, many distinct sites\n\nMulti-site publishing works best when access, content, themes, and navigation remain explicit. Teams can share the platform without giving up their identity.",
                {"category": "Architecture", "readingTime": "5 min"},
            ),
            (
                "entry-layout", "u-admin", "layout-is-part-of-the-story", "Layout is part of the story",
                "Editorial rhythm and studio density create different ways to discover the same writing.",
                "# Layout is part of the story\n\nAn editorial layout emphasizes hierarchy and a lead story. A studio layout favors a compact grid and quick scanning. Content stays portable while presentation changes around it.",
                {"category": "Field notes", "readingTime": "3 min"},
            ),
        ]
        for index, (entry_id, author_id, slug, title, excerpt, body, data) in enumerate(entries):
            published_at = (published - timedelta(days=index)).isoformat()
            db.execute(
                "INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING",
                (
                    entry_id, "site-main", "collection-posts", author_id, slug, title,
                    excerpt, body, json.dumps(data), "published", None,
                    published_at, published_at, published_at,
                ),
            )

    def authenticate(self, username: str, password: str) -> dict[str, Any] | None:
        with self.connect() as db:
            row = db.execute("SELECT * FROM users WHERE username=? AND disabled=0", (username,)).fetchone()
            if not row or not self.verify_password(password, row["password_hash"]):
                return None
            return self.row(row)

    def create_session(self, user_id: str, *, hours: int = 12) -> str:
        token = secrets.token_urlsafe(32)
        with self.connect() as db:
            db.execute("DELETE FROM sessions WHERE expires_at<=?", (now(),))
            db.execute("INSERT INTO sessions VALUES(?,?,?,?)", (
                hashlib.sha256(token.encode()).hexdigest(), user_id,
                (datetime.now(timezone.utc) + timedelta(hours=hours)).isoformat(), now(),
            ))
        return token

    def session_user(self, token: str) -> str | None:
        with self.connect() as db:
            row = db.execute("SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?", (hashlib.sha256(token.encode()).hexdigest(), now())).fetchone()
            return row["user_id"] if row else None

    def revoke_session(self, token: str) -> None:
        with self.connect() as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))

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
            if "body" in changes and "data" not in changes:
                data = json.loads(current["data"])
                data.pop("lexical", None)
                changes["data"] = data
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
