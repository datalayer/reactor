"""FastAPI routes for editors and Astro server-rendered pages."""

from __future__ import annotations

import json
import sqlite3
from typing import Any

from fastapi import APIRouter, Header, HTTPException, Query, Request
from pydantic import BaseModel, Field

from .store import Store

router = APIRouter()


class EntryCreate(BaseModel):
    collection: str = "posts"
    title: str = Field(min_length=1, max_length=200)
    slug: str | None = None
    excerpt: str = ""
    body: str = ""
    data: dict[str, Any] = Field(default_factory=dict)


class EntryUpdate(BaseModel):
    title: str | None = None
    slug: str | None = None
    excerpt: str | None = None
    body: str | None = None
    data: dict[str, Any] | None = None
    status: str | None = None
    publish_at: str | None = None


class CollectionCreate(BaseModel):
    slug: str
    name: str
    description: str = ""
    fields: list[dict[str, Any]] = Field(default_factory=list)


class MediaCreate(BaseModel):
    filename: str
    url: str
    mime_type: str = "application/octet-stream"
    alt_text: str = ""
    size: int = Field(0, ge=0)


class TaxonomyCreate(BaseModel):
    slug: str
    name: str
    hierarchical: bool = False


class TermCreate(BaseModel):
    slug: str
    name: str
    description: str = ""
    parent_id: str | None = None


class MenuCreate(BaseModel):
    slug: str
    name: str


class MenuItemCreate(BaseModel):
    label: str
    url: str = Field(pattern=r"^(?:https?://|/|#)[^\s]*$")
    parent_id: str | None = None
    position: int = 0


class ThemeUpdate(BaseModel):
    theme: str


class AppearanceUpdate(BaseModel):
    theme: str = Field(pattern="^(datalayer|spatial|lovely|matrix|earth|sand|ivory|sun)$")
    color_mode: str = Field(pattern="^(light|dark|auto)$")
    layout_theme: str | None = None
    light: dict[str, str]
    dark: dict[str, str]


class SiteCreate(BaseModel):
    slug: str
    name: str
    tagline: str = ""
    theme: str = "editorial"


class SiteUpdate(BaseModel):
    slug: str | None = Field(default=None, min_length=1, max_length=120, pattern="^[a-z0-9-]+$")
    name: str | None = Field(default=None, min_length=1, max_length=200)
    tagline: str | None = Field(default=None, max_length=300)


class UserCreate(BaseModel):
    username: str = Field(min_length=1, max_length=120, pattern="^[a-zA-Z0-9._-]+$")
    password: str = Field(min_length=6, max_length=256)
    email: str
    name: str


class UserUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    username: str | None = Field(default=None, min_length=1, max_length=120, pattern="^[a-zA-Z0-9._-]+$")
    email: str | None = None
    password: str | None = Field(default=None, min_length=6, max_length=256)
    disabled: bool | None = None


class MembershipCreate(BaseModel):
    user_id: str
    role: str = Field(pattern="^(admin|editor|author|viewer)$")


class Login(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=256)


def store(request: Request) -> Store:
    return request.app.state.cms_store


def identity(x_cms_user: str | None = Header(default=None)) -> str:
    if not x_cms_user:
        raise HTTPException(401, "X-CMS-User is required for administration")
    return x_cms_user


def fail(error: Exception) -> None:
    if isinstance(error, PermissionError):
        raise HTTPException(403, str(error)) from error
    if isinstance(error, LookupError):
        raise HTTPException(404, str(error)) from error
    raise error


@router.post("/api/cms/auth/login")
async def login(payload: Login, request: Request) -> dict:
    cms = store(request)
    user = cms.authenticate(payload.username, payload.password)
    if not user:
        raise HTTPException(401, "invalid username or password")
    token = cms.create_session(user["id"])
    with cms.connect() as db:
        memberships = db.execute("SELECT site_id,role FROM memberships WHERE user_id=?", (user["id"],)).fetchall()
    return {
        "token": token,
        "user": {key: user[key] for key in ("id", "username", "email", "name", "disabled")},
        "memberships": [dict(row) for row in memberships],
    }


@router.delete("/api/cms/auth/logout", status_code=204)
async def logout(request: Request, authorization: str | None = Header(default=None)) -> None:
    if authorization and authorization.lower().startswith("bearer "):
        store(request).revoke_session(authorization[7:].strip())


@router.get("/api/cms/session")
async def session(request: Request, user_id: str = Header(alias="X-CMS-User")) -> dict:
    with store(request).connect() as db:
        user = db.execute("SELECT id,username,email,name,disabled FROM users WHERE id=?", (user_id,)).fetchone()
        if not user or user["disabled"]:
            raise HTTPException(401, "unknown or disabled user")
        memberships = db.execute("SELECT site_id,role FROM memberships WHERE user_id=?", (user_id,)).fetchall()
        return {"user": dict(user), "memberships": [dict(row) for row in memberships]}


@router.get("/api/cms/sites")
async def sites(request: Request, user_id: str = Header(alias="X-CMS-User")) -> list[dict]:
    with store(request).connect() as db:
        rows = db.execute("""SELECT s.*,m.role,t.slug theme_slug,t.name theme_name,t.tokens,
          (SELECT COUNT(*) FROM memberships sm WHERE sm.site_id=s.id) member_count,
          (SELECT COUNT(*) FROM entries se WHERE se.site_id=s.id) entry_count,
          COALESCE((SELECT value FROM settings WHERE site_id=s.id AND key='appearance.theme'),'datalayer') appearance_theme,
          COALESCE((SELECT value FROM settings WHERE site_id=s.id AND key='appearance.colorMode'),'auto') appearance_color_mode
          FROM sites s JOIN memberships m ON m.site_id=s.id JOIN themes t ON t.id=s.theme_id
          WHERE m.user_id=? ORDER BY s.name""", (user_id,)).fetchall()
        return [store(request).row(row) for row in rows]


@router.post("/api/cms/sites", status_code=201)
async def create_site(payload: SiteCreate, request: Request, user_id: str = Header(alias="X-CMS-User")) -> dict:
    from uuid import uuid4
    from .store import now
    with store(request).connect() as db:
        if not db.execute("SELECT 1 FROM users WHERE id=? AND disabled=0", (user_id,)).fetchone():
            raise HTTPException(401, "unknown or disabled user")
        if not db.execute("SELECT 1 FROM memberships WHERE user_id=? AND role='admin'", (user_id,)).fetchone():
            raise HTTPException(403, "administrator role required to create sites")
        theme = db.execute("SELECT id FROM themes WHERE slug=?", (payload.theme,)).fetchone()
        if not theme: raise HTTPException(404, "theme not found")
        site_id, stamp = f"site-{uuid4().hex}", now()
        db.execute("INSERT INTO sites VALUES(?,?,?,?,?,?,?)", (site_id, payload.slug, payload.name, payload.tagline, theme["id"], stamp, stamp))
        db.execute("INSERT INTO memberships VALUES(?,?,?)", (site_id, user_id, "admin"))
        return store(request).row(db.execute("SELECT * FROM sites WHERE id=?", (site_id,)).fetchone()) or {}


@router.patch("/api/cms/sites/{site_id}")
async def update_site(site_id: str, payload: SiteUpdate, request: Request, user_id: str = Header(alias="X-CMS-User")) -> dict:
    from .store import now
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "admin")
        except Exception as error: fail(error)
        changes = payload.model_dump(exclude_none=True)
        changes["updated_at"] = now()
        assignments = ",".join(f"{column}=?" for column in changes)
        try:
            db.execute(f"UPDATE sites SET {assignments} WHERE id=?", (*changes.values(), site_id))
        except sqlite3.IntegrityError as error:
            raise HTTPException(409, "site slug is already in use") from error
        return dict(db.execute("SELECT * FROM sites WHERE id=?", (site_id,)).fetchone())


@router.post("/api/cms/sites/{site_id}/users", status_code=201)
async def create_user(site_id: str, payload: UserCreate, request: Request, user_id: str = Header(alias="X-CMS-User")) -> dict:
    from uuid import uuid4
    from .store import now
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "admin")
        except Exception as error: fail(error)
        new_id = f"user-{uuid4().hex}"
        db.execute("INSERT INTO users(id,email,name,disabled,created_at,username,password_hash) VALUES(?,?,?,?,?,?,?)", (
            new_id, payload.email, payload.name, 0, now(), payload.username, store(request).password_hash(payload.password)
        ))
        return dict(db.execute("SELECT id,username,email,name,disabled,created_at FROM users WHERE id=?", (new_id,)).fetchone())


@router.get("/api/cms/sites/{site_id}/users")
async def users(site_id: str, request: Request, user_id: str = Header(alias="X-CMS-User")) -> list[dict]:
    """List site members. Membership roles never leak across tenants."""
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "admin")
        except Exception as error: fail(error)
        rows = db.execute("""SELECT u.id,u.username,u.email,u.name,u.disabled,u.created_at,m.role
          FROM memberships m JOIN users u ON u.id=m.user_id
          WHERE m.site_id=? ORDER BY u.name,u.email""", (site_id,)).fetchall()
        return [dict(row) for row in rows]


@router.patch("/api/cms/sites/{site_id}/users/{member_id}")
async def update_user(site_id: str, member_id: str, payload: UserUpdate, request: Request, user_id: str = Header(alias="X-CMS-User")) -> dict:
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "admin")
        except Exception as error: fail(error)
        if not db.execute("SELECT 1 FROM memberships WHERE site_id=? AND user_id=?", (site_id, member_id)).fetchone():
            raise HTTPException(404, "site member not found")
        if member_id == user_id and payload.disabled:
            raise HTTPException(409, "administrators cannot disable their own account")
        changes = payload.model_dump(exclude_none=True)
        if "password" in changes:
            changes["password_hash"] = store(request).password_hash(changes.pop("password"))
        if changes:
            assignments = ",".join(f"{column}=?" for column in changes)
            try:
                db.execute(f"UPDATE users SET {assignments} WHERE id=?", (*[int(value) if isinstance(value, bool) else value for value in changes.values()], member_id))
            except sqlite3.IntegrityError as error:
                raise HTTPException(409, "username or email is already in use") from error
        row = db.execute("""SELECT u.id,u.username,u.email,u.name,u.disabled,u.created_at,m.role
          FROM memberships m JOIN users u ON u.id=m.user_id
          WHERE m.site_id=? AND u.id=?""", (site_id, member_id)).fetchone()
        return dict(row)


@router.delete("/api/cms/sites/{site_id}/users/{member_id}", status_code=204)
async def delete_user(site_id: str, member_id: str, request: Request, user_id: str = Header(alias="X-CMS-User")) -> None:
    """Remove a member from this site and delete an orphaned user account."""
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "admin")
        except Exception as error: fail(error)
        membership = db.execute(
            "SELECT role FROM memberships WHERE site_id=? AND user_id=?",
            (site_id, member_id),
        ).fetchone()
        if not membership:
            raise HTTPException(404, "site member not found")
        if member_id == user_id:
            raise HTTPException(409, "administrators cannot remove their own account")
        if membership["role"] == "admin":
            admins = db.execute(
                "SELECT COUNT(*) count FROM memberships WHERE site_id=? AND role='admin'",
                (site_id,),
            ).fetchone()["count"]
            if admins <= 1:
                raise HTTPException(409, "a site must keep at least one administrator")
        db.execute("DELETE FROM memberships WHERE site_id=? AND user_id=?", (site_id, member_id))
        remaining = db.execute("SELECT 1 FROM memberships WHERE user_id=? LIMIT 1", (member_id,)).fetchone()
        if not remaining:
            authored = db.execute("SELECT 1 FROM entries WHERE author_id=? LIMIT 1", (member_id,)).fetchone()
            if authored:
                db.execute("UPDATE users SET disabled=1 WHERE id=?", (member_id,))
                db.execute("DELETE FROM sessions WHERE user_id=?", (member_id,))
            else:
                db.execute("DELETE FROM users WHERE id=?", (member_id,))


@router.put("/api/cms/sites/{site_id}/memberships", status_code=201)
async def set_membership(site_id: str, payload: MembershipCreate, request: Request, user_id: str = Header(alias="X-CMS-User")) -> dict:
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "admin")
        except Exception as error: fail(error)
        if not db.execute("SELECT 1 FROM users WHERE id=?", (payload.user_id,)).fetchone():
            raise HTTPException(404, "user not found")
        current = db.execute(
            "SELECT role FROM memberships WHERE site_id=? AND user_id=?",
            (site_id, payload.user_id),
        ).fetchone()
        if current and current["role"] == "admin" and payload.role != "admin":
            admin_count = db.execute(
                "SELECT COUNT(*) count FROM memberships WHERE site_id=? AND role='admin'",
                (site_id,),
            ).fetchone()["count"]
            if admin_count <= 1:
                raise HTTPException(409, "a site must keep at least one administrator")
        db.execute("INSERT INTO memberships(site_id,user_id,role) VALUES(?,?,?) ON CONFLICT(site_id,user_id) DO UPDATE SET role=excluded.role", (site_id, payload.user_id, payload.role))
        return {"site_id": site_id, "user_id": payload.user_id, "role": payload.role}


@router.get("/api/cms/sites/{site_id}/collections")
async def collections(site_id: str, request: Request, user_id: str = Header(alias="X-CMS-User")) -> list[dict]:
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "viewer")
        except Exception as error: fail(error)
        return [store(request).row(row) for row in db.execute("SELECT * FROM collections WHERE site_id=? ORDER BY name", (site_id,))]


@router.post("/api/cms/sites/{site_id}/collections", status_code=201)
async def create_collection(site_id: str, payload: CollectionCreate, request: Request, user_id: str = Header(alias="X-CMS-User")) -> dict:
    from uuid import uuid4
    from .store import now
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "admin")
        except Exception as error: fail(error)
        item_id = f"collection-{uuid4().hex}"
        db.execute("INSERT INTO collections VALUES(?,?,?,?,?,?,?)", (item_id, site_id, payload.slug, payload.name, payload.description, json.dumps(payload.fields), now()))
        return store(request).row(db.execute("SELECT * FROM collections WHERE id=?", (item_id,)).fetchone()) or {}


@router.get("/api/cms/sites/{site_id}/entries")
async def entries(site_id: str, request: Request, status: str | None = None, user_id: str = Header(alias="X-CMS-User")) -> list[dict]:
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "viewer")
        except Exception as error: fail(error)
        sql = "SELECT e.*,c.slug collection FROM entries e JOIN collections c ON c.id=e.collection_id WHERE e.site_id=?"
        args: list[Any] = [site_id]
        if status:
            sql += " AND e.status=?"; args.append(status)
        sql += " ORDER BY e.updated_at DESC"
        return [store(request).row(row) for row in db.execute(sql, args)]


@router.post("/api/cms/sites/{site_id}/entries", status_code=201)
async def create_entry(site_id: str, payload: EntryCreate, request: Request, user_id: str = Header(alias="X-CMS-User")) -> dict:
    try: return store(request).create_entry(site_id, user_id, payload.model_dump())
    except Exception as error: fail(error); return {}


@router.patch("/api/cms/sites/{site_id}/entries/{entry_id}")
async def update_entry(site_id: str, entry_id: str, payload: EntryUpdate, request: Request, user_id: str = Header(alias="X-CMS-User")) -> dict:
    try: return store(request).update_entry(site_id, entry_id, user_id, payload.model_dump(exclude_none=True))
    except Exception as error: fail(error); return {}


@router.post("/api/cms/sites/{site_id}/entries/{entry_id}/publish")
async def publish(site_id: str, entry_id: str, request: Request, user_id: str = Header(alias="X-CMS-User")) -> dict:
    try: return store(request).publish(site_id, entry_id, user_id)
    except Exception as error: fail(error); return {}


@router.get("/api/cms/sites/{site_id}/entries/{entry_id}/revisions")
async def revisions(site_id: str, entry_id: str, request: Request, user_id: str = Header(alias="X-CMS-User")) -> list[dict]:
    with store(request).connect() as db:
        try: role = store(request).require(db, site_id, user_id, "viewer")
        except Exception as error: fail(error)
        entry = db.execute(
            "SELECT author_id FROM entries WHERE id=? AND site_id=?",
            (entry_id, site_id),
        ).fetchone()
        if not entry:
            raise HTTPException(404, "entry not found")
        if role == "author" and entry["author_id"] != user_id:
            raise HTTPException(403, "authors may read revisions only for their own entries")
        return [dict(row) | {"snapshot": json.loads(row["snapshot"])} for row in db.execute("SELECT * FROM revisions WHERE entry_id=? ORDER BY id DESC", (entry_id,))]


@router.get("/api/cms/sites/{site_id}/media")
async def media(site_id: str, request: Request, user_id: str = Header(alias="X-CMS-User")) -> list[dict]:
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "viewer")
        except Exception as error: fail(error)
        return [dict(row) for row in db.execute("SELECT * FROM media WHERE site_id=? ORDER BY created_at DESC", (site_id,))]


@router.post("/api/cms/sites/{site_id}/media", status_code=201)
async def create_media(site_id: str, payload: MediaCreate, request: Request, user_id: str = Header(alias="X-CMS-User")) -> dict:
    from uuid import uuid4
    from .store import now
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "author")
        except Exception as error: fail(error)
        item_id = f"media-{uuid4().hex}"
        db.execute("INSERT INTO media VALUES(?,?,?,?,?,?,?,?,?)", (item_id, site_id, user_id, payload.filename, payload.url, payload.mime_type, payload.alt_text, payload.size, now()))
        return dict(db.execute("SELECT * FROM media WHERE id=?", (item_id,)).fetchone())


@router.get("/api/cms/sites/{site_id}/taxonomies")
async def taxonomies(site_id: str, request: Request, user_id: str = Header(alias="X-CMS-User")) -> list[dict]:
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "viewer")
        except Exception as error: fail(error)
        result = [dict(row) for row in db.execute("SELECT * FROM taxonomies WHERE site_id=? ORDER BY name", (site_id,))]
        for item in result:
            item["terms"] = [dict(row) for row in db.execute("SELECT * FROM terms WHERE taxonomy_id=? ORDER BY name", (item["id"],))]
        return result


@router.post("/api/cms/sites/{site_id}/taxonomies", status_code=201)
async def create_taxonomy(site_id: str, payload: TaxonomyCreate, request: Request, user_id: str = Header(alias="X-CMS-User")) -> dict:
    from uuid import uuid4
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "editor")
        except Exception as error: fail(error)
        item_id = f"taxonomy-{uuid4().hex}"
        db.execute("INSERT INTO taxonomies VALUES(?,?,?,?,?)", (item_id, site_id, payload.slug, payload.name, int(payload.hierarchical)))
        return dict(db.execute("SELECT * FROM taxonomies WHERE id=?", (item_id,)).fetchone())


@router.post("/api/cms/sites/{site_id}/taxonomies/{taxonomy_id}/terms", status_code=201)
async def create_term(site_id: str, taxonomy_id: str, payload: TermCreate, request: Request, user_id: str = Header(alias="X-CMS-User")) -> dict:
    from uuid import uuid4
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "editor")
        except Exception as error: fail(error)
        if not db.execute("SELECT 1 FROM taxonomies WHERE id=? AND site_id=?", (taxonomy_id, site_id)).fetchone():
            raise HTTPException(404, "taxonomy not found")
        item_id = f"term-{uuid4().hex}"
        db.execute("INSERT INTO terms VALUES(?,?,?,?,?,?)", (item_id, taxonomy_id, payload.parent_id, payload.slug, payload.name, payload.description))
        return dict(db.execute("SELECT * FROM terms WHERE id=?", (item_id,)).fetchone())


@router.get("/api/cms/sites/{site_id}/menus")
async def menus(site_id: str, request: Request, user_id: str = Header(alias="X-CMS-User")) -> list[dict]:
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "viewer")
        except Exception as error: fail(error)
        result = [dict(row) for row in db.execute("SELECT * FROM menus WHERE site_id=?", (site_id,))]
        for item in result:
            item["items"] = [dict(row) for row in db.execute("SELECT * FROM menu_items WHERE menu_id=? ORDER BY position", (item["id"],))]
        return result


@router.post("/api/cms/sites/{site_id}/menus", status_code=201)
async def create_menu(site_id: str, payload: MenuCreate, request: Request, user_id: str = Header(alias="X-CMS-User")) -> dict:
    from uuid import uuid4
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "editor")
        except Exception as error: fail(error)
        item_id = f"menu-{uuid4().hex}"
        db.execute("INSERT INTO menus VALUES(?,?,?,?)", (item_id, site_id, payload.slug, payload.name))
        return dict(db.execute("SELECT * FROM menus WHERE id=?", (item_id,)).fetchone())


@router.post("/api/cms/sites/{site_id}/menus/{menu_id}/items", status_code=201)
async def create_menu_item(site_id: str, menu_id: str, payload: MenuItemCreate, request: Request, user_id: str = Header(alias="X-CMS-User")) -> dict:
    from uuid import uuid4
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "editor")
        except Exception as error: fail(error)
        if not db.execute("SELECT 1 FROM menus WHERE id=? AND site_id=?", (menu_id, site_id)).fetchone():
            raise HTTPException(404, "menu not found")
        item_id = f"menu-item-{uuid4().hex}"
        db.execute("INSERT INTO menu_items VALUES(?,?,?,?,?,?)", (item_id, menu_id, payload.parent_id, payload.label, payload.url, payload.position))
        return dict(db.execute("SELECT * FROM menu_items WHERE id=?", (item_id,)).fetchone())


@router.get("/api/cms/themes")
async def themes(request: Request, user_id: str = Header(alias="X-CMS-User")) -> list[dict]:
    with store(request).connect() as db:
        return [store(request).row(row) for row in db.execute("SELECT * FROM themes ORDER BY name")]


@router.patch("/api/cms/sites/{site_id}/theme")
async def set_theme(site_id: str, payload: ThemeUpdate, request: Request, user_id: str = Header(alias="X-CMS-User")) -> dict:
    from .store import now
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "admin")
        except Exception as error: fail(error)
        theme = db.execute("SELECT id FROM themes WHERE slug=?", (payload.theme,)).fetchone()
        if not theme: raise HTTPException(404, "theme not found")
        db.execute("UPDATE sites SET theme_id=?,updated_at=? WHERE id=?", (theme["id"], now(), site_id))
        return store(request).row(db.execute("SELECT * FROM sites WHERE id=?", (site_id,)).fetchone()) or {}


@router.patch("/api/cms/sites/{site_id}/appearance")
async def set_appearance(site_id: str, payload: AppearanceUpdate, request: Request, user_id: str = Header(alias="X-CMS-User")) -> dict:
    """Persist framework-neutral Primer functional CSS variables for a site."""
    from .store import now
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "admin")
        except Exception as error: fail(error)
        for mode, tokens in (("light", payload.light), ("dark", payload.dark)):
            if not tokens or len(tokens) > 256 or any(
                not key.startswith("--")
                or len(value) > 200
                or any(character in value for character in ";{}<>")
                for key, value in tokens.items()
            ):
                raise HTTPException(422, f"invalid {mode} CSS variable map")
        values = {
            "appearance.theme": payload.theme,
            "appearance.colorMode": payload.color_mode,
            "appearance.tokens.light": json.dumps(payload.light, separators=(",", ":"), sort_keys=True),
            "appearance.tokens.dark": json.dumps(payload.dark, separators=(",", ":"), sort_keys=True),
        }
        db.executemany(
            "INSERT INTO settings(site_id,key,value) VALUES(?,?,?) ON CONFLICT(site_id,key) DO UPDATE SET value=excluded.value",
            ((site_id, key, value) for key, value in values.items()),
        )
        if payload.layout_theme:
            layout_theme = db.execute("SELECT id FROM themes WHERE slug=?", (payload.layout_theme,)).fetchone()
            if not layout_theme:
                raise HTTPException(404, "theme not found")
            db.execute("UPDATE sites SET theme_id=? WHERE id=?", (layout_theme["id"], site_id))
        db.execute("UPDATE sites SET updated_at=? WHERE id=?", (now(), site_id))
        return {"site_id": site_id, "theme": payload.theme, "color_mode": payload.color_mode, "layout_theme": payload.layout_theme}


@router.get("/api/cms/sites/{site_id}/search")
async def search(site_id: str, request: Request, q: str = Query(min_length=1), user_id: str = Header(alias="X-CMS-User")) -> list[dict]:
    with store(request).connect() as db:
        try: store(request).require(db, site_id, user_id, "viewer")
        except Exception as error: fail(error)
        rows = db.execute("SELECT e.*,c.slug collection,bm25(entry_search) rank FROM entry_search JOIN entries e ON e.id=entry_search.entry_id JOIN collections c ON c.id=e.collection_id WHERE entry_search MATCH ? AND entry_search.site_id=? ORDER BY rank", (q, site_id)).fetchall()
        return [store(request).row(row) for row in rows]


@router.get("/api/content/{site_slug}/entries")
async def public_entries(site_slug: str, request: Request, collection: str = "posts", limit: int = Query(20, ge=1, le=100)) -> list[dict]:
    with store(request).connect() as db:
        rows = db.execute("""SELECT e.id,e.slug,e.title,e.excerpt,e.body,e.data,e.published_at
          FROM entries e JOIN sites s ON s.id=e.site_id JOIN collections c ON c.id=e.collection_id
          WHERE s.slug=? AND c.slug=? AND e.status='published' ORDER BY e.published_at DESC LIMIT ?""", (site_slug, collection, limit)).fetchall()
        return [store(request).row(row) for row in rows]


@router.get("/api/content/{site_slug}/entries/{slug}")
async def public_entry(site_slug: str, slug: str, request: Request) -> dict:
    with store(request).connect() as db:
        row = db.execute("""SELECT e.id,e.slug,e.title,e.excerpt,e.body,e.data,e.published_at,c.slug collection
          FROM entries e JOIN sites s ON s.id=e.site_id JOIN collections c ON c.id=e.collection_id
          WHERE s.slug=? AND e.slug=? AND e.status='published'""", (site_slug, slug)).fetchone()
        if not row: raise HTTPException(404, "published entry not found")
        return store(request).row(row) or {}


@router.get("/api/content/{site_slug}/bootstrap")
async def bootstrap(site_slug: str, request: Request) -> dict:
    with store(request).connect() as db:
        site = db.execute("SELECT s.*,t.slug theme_slug,t.name theme_name,t.tokens FROM sites s JOIN themes t ON t.id=s.theme_id WHERE s.slug=?", (site_slug,)).fetchone()
        if not site: raise HTTPException(404, "site not found")
        site_id = site["id"]
        settings = {row["key"]: row["value"] for row in db.execute("SELECT key,value FROM settings WHERE site_id=?", (site_id,))}
        menus = [dict(row) for row in db.execute("SELECT * FROM menus WHERE site_id=?", (site_id,))]
        for menu in menus:
            menu["items"] = [dict(row) for row in db.execute("SELECT * FROM menu_items WHERE menu_id=? ORDER BY position", (menu["id"],))]
        widgets = [dict(row) | {"data": json.loads(row["data"])} for row in db.execute("SELECT * FROM widgets WHERE site_id=? ORDER BY area,position", (site_id,))]
        return {"site": store(request).row(site), "settings": settings, "menus": menus, "widgets": widgets}
