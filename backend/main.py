"""FastAPI app entry.

Serves:
  /api/*             — JSON API
  /health            — liveness for Railway
  /                  — the built React SPA (frontend/dist)
  /assets/*          — SPA assets
Anything else falls back to index.html for client-side routing.
"""
from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .api import auth as auth_api
from .api import (
    custom_agg, gtin_stock, inspector, projects, scanning,
    search as search_api, submissions, users as users_api,
)

app = FastAPI(title="Mass Aggregation v2",
              docs_url="/api/docs", openapi_url="/api/openapi.json")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],   # Vite dev; prod is same-origin
    allow_credentials=True,                    # send/set the auth cookie
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_api.router)
app.include_router(projects.router)
app.include_router(scanning.router)
app.include_router(submissions.router)
app.include_router(gtin_stock.router)
app.include_router(inspector.router)
app.include_router(custom_agg.router)
app.include_router(search_api.router)
app.include_router(users_api.router)


@app.get("/health")
def health():
    return {"ok": True}


# ── static SPA (only if built) ──────────────────────────────
_FRONTEND_DIST = Path(__file__).resolve().parent.parent / "frontend" / "dist"

if _FRONTEND_DIST.is_dir():
    app.mount("/assets", StaticFiles(directory=_FRONTEND_DIST / "assets"), name="assets")

    @app.get("/{full_path:path}", include_in_schema=False)
    def spa_fallback(full_path: str):
        # Never intercept the API namespace.
        if full_path.startswith("api/") or full_path == "health":
            return JSONResponse({"detail": "not found"}, status_code=404)
        index = _FRONTEND_DIST / "index.html"
        if not index.is_file():
            return JSONResponse({"detail": "frontend not built"}, status_code=503)
        return FileResponse(index)
else:
    @app.get("/", include_in_schema=False)
    def dev_landing():
        return JSONResponse({
            "ok": True,
            "note": "frontend not built — run `npm run dev` in ./frontend or "
                    "`npm run build` for production.",
            "docs": "/api/docs",
        })
