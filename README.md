# Mass Aggregation v2

Standalone rebuild of the Guided Mass Aggregation page from the Streamlit app.
Same functionality, professional UI, no Streamlit.

**v1 scope:** single-user, one admin doing wizard + scanning + one-click ASL
submit. Multi-user + real-time collaboration is a later phase per
`../plan.md`. The data model is already shaped for that phase — schemas
match `plan.md §3` so migration is a code-only change.

## Stack

- **Backend:** FastAPI · SQLAlchemy 2 · Alembic · psycopg 3
- **Frontend:** React + Vite + TypeScript · Tailwind · shadcn-style primitives · lucide-react
- **DB:** Neon Postgres (dev + prod branches)
- **Deploy:** Single Railway service — FastAPI serves `/api/*` **and** the built React bundle from `/`.

## Layout

```
mass_aggregation_v2/
├── backend/
│   ├── main.py                FastAPI app + static SPA mount
│   ├── config.py              env
│   ├── db.py                  engine + session
│   ├── models.py              User, Project, KmPool, BoxPool, OpenBox, Box, Submission
│   ├── schemas.py             Pydantic in/out
│   ├── services/
│   │   ├── codes.py           canonical KM, unescape, parsers  (verbatim from page 7)
│   │   ├── scanning.py        claim_km, close_box, undo, discard  (atomic SQL)
│   │   └── asl_client.py      base64 doc build + POST /doc/aggregation + batching
│   └── api/
│       ├── projects.py        CRUD, parse-file, state
│       ├── scanning.py        scan, undo, discard, mode toggles, delete-box
│       └── submissions.py     validate, submit
├── frontend/
│   ├── src/pages/             Setup.tsx, Scan.tsx
│   ├── src/components/        ScanInput, KmSlotGrid, BoxSlotGrid, ClosedBoxes, MissingPanel, ModeBadge, ui/*
│   ├── src/api.ts             typed fetch client
│   ├── src/types.ts
│   └── src/index.css          tailwind
├── alembic/
├── alembic.ini
├── pyproject.toml
├── requirements.txt
├── .env.example
├── Dockerfile                 multi-stage: build frontend, run FastAPI
├── railway.toml
└── README.md
```

## Local dev (once)

1. **Neon:** create project, take the **pooled** connection string
   (`...-pooler.<region>.aws.neon.tech/neondb?sslmode=require`).
   Create a `dev` branch — use its URL locally, keep `main` for prod.
2. **Backend:**
   ```bash
   cd mass_aggregation_v2
   python -m venv .venv
   .venv\Scripts\activate                     # Windows PowerShell / bash
   pip install -r requirements.txt
   cp .env.example .env                       # fill DATABASE_URL + ASL_API_KEY
   alembic upgrade head
   uvicorn backend.main:app --reload --port 8000
   ```
3. **Frontend (separate terminal):**
   ```bash
   cd mass_aggregation_v2/frontend
   npm install
   npm run dev                                # http://localhost:5173, proxies /api → :8000
   ```

Visit `http://localhost:5173`.

## Prod build

```bash
cd frontend && npm run build                  # emits frontend/dist
cd .. && uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

FastAPI serves `frontend/dist/index.html` at `/` and static assets at `/assets/*`.

## Deploy (Railway)

- New service from repo, root = `mass_aggregation_v2/`, uses `Dockerfile`.
- Env vars: `DATABASE_URL` (Neon main branch), `ASL_API_KEY`, `TZ=Asia/Tashkent`.
- Start command is set in `railway.toml`.
- Migrations: run `alembic upgrade head` once against Neon main before/after first deploy (Railway "Run command" or from a local shell against the prod DB URL).

## Invariants (do NOT change without reading)

Same seven invariants from `../plan.md §0`. All live in `backend/services/codes.py`:

- `canonical_km()` — trim every KM to the 31-char sSGTIN identity.
- `unescape_xml_controls()` — Excel writes GS as `_x001D_`; undo before use.
- `parse_excel/csv` uses `header=None` — otherwise you lose row 1.
- SSCC normalised to 20-char `00`+18 form.
- Frontend scan input is stable (React handles focus natively — no widget-remount hacks).
