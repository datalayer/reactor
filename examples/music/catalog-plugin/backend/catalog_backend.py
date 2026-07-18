"""Catalog plugin backend.

A small standalone FastAPI service that exposes the song catalog consumed by the
music frontend plugins (catalog, header, shop).

Run with:

    uvicorn catalog_backend:app --reload --port 8799
"""

from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


class Song(BaseModel):
    id: str
    title: str
    artist: str
    price: float


SONGS: list[Song] = [
    Song(id="s1", title="Quantum Sunrise", artist="Nova Fields", price=1.29),
    Song(id="s2", title="Neon Harbor", artist="The Lumen", price=0.99),
    Song(id="s3", title="Gravity Waltz", artist="Ada Cole", price=1.49),
    Song(id="s4", title="Paper Satellites", artist="Kite Museum", price=1.09),
    Song(id="s5", title="Midnight Kernel", artist="Root Access", price=1.19),
    Song(id="s6", title="Analog Dreams", artist="Vela Bloom", price=0.89),
]

app = FastAPI(title="Music Catalog Backend")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/catalog/songs", response_model=list[Song])
def list_songs() -> list[Song]:
    return SONGS
