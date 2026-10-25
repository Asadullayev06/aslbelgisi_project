# TracePro / Asl Belgisi — MCP server

A small, **read-only** MCP server so an external AI agent (Hermes) can answer
questions against the ASL Belgisi track-and-trace data — "how much of this
GTIN is left?", "who owns this KM code?", etc.

It is a **separate process** from the web app. It reuses the platform's ASL
client code and resolves company credentials **live from the same database**
(the `asl_companies` table that the web UI's company module manages), so a key
change in the UI takes effect on the next call — no restart, no redeploy.

## Tools (7)

| Tool | What it answers |
|---|---|
| `list_companies()` | which saved companies you can query (name + INN; never the key) |
| `gtin_ostatok(company, gtin, …)` | **how much of a product remains** — stock summary by status/owner/series |
| `km_info(company, codes[])` | full KM details: owner, product, status, aggregation, provenance |
| `km_owner(company, code)` | quick **current owner** of one KM code |
| `sscc_contents(company, sscc)` | the child KM codes inside a box (SSCC) + ownership verdict |
| `mod_list(company)` | the company's MOD / business-place entries |
| `code_search(codes[])` | locate codes in the company's **own** aggregation records (internal DB) |

Every `company` argument accepts a saved **company name or its INN**
(see `list_companies`). Credentials are never passed in by the agent.

## Configuration (env)

| Var | Purpose |
|---|---|
| `DATABASE_URL` | same Neon DB as the web app (to read `asl_companies`) |
| `ASL_API_BASE` | ASL base URL (default from `backend.config`, e.g. `https://aslbelgisi.uz`) |
| `MCP_AUTH_TOKEN` | **required** — bearer token Hermes must send; without it the server runs unauthenticated and warns |
| `MCP_HOST` | bind host (default `0.0.0.0`) |
| `MCP_PORT` | bind port (default `8900`) |

## Run

```bash
# from mass_aggregation_v2/
export DATABASE_URL=postgresql://…           # same DB as the web app
export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
export MCP_PORT=8900
python -m mcp_server.server
```

## Deploy (Coolify, public URL)

Run it as a **second service** from this same repo/image, with start command:

```
python -m mcp_server.server
```

Expose port `8900`, point a Cloudflare tunnel public hostname (e.g.
`asl-mcp.andromeda-ai.uz`) at `http://localhost:8900`, and give Hermes:

- URL: `https://asl-mcp.andromeda-ai.uz/sse`
- Header: `Authorization: Bearer <MCP_AUTH_TOKEN>`

`GET /health` is open (no auth) for uptime checks.

## Safety

This server exposes **only** the read/query tools above. It never scans,
submits to ASL, or touches users/projects. The API keys live in the DB and are
used server-side — they are never returned to the agent.
