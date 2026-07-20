# Turkuaz Marketing Parser

Market parser service for collecting competitor product prices and discounts.

## Run Locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8503 --reload
```

Open API docs:

```text
http://localhost:8503/docs
```

## Run With Docker Compose

```bash
docker compose up --build
```

The API will be available at:

```text
http://localhost:8503/docs
```

The admin UI will be available at:

```text
http://localhost:7503
```

SQLite data is stored in the `marketing_parser_data` Docker volume. Migrations run automatically
before the API starts.

## Automatic Parser Runs

The backend can start parser runs on a fixed interval without frontend interaction. Enable it on
the server with environment variables:

```text
PARSER_AUTO_RUN_ENABLED=true
PARSER_AUTO_RUN_INTERVAL_DAYS=5
PARSER_AUTO_RUN_SOURCE_CODE=globus
```

The scheduler runs with `parse_all_enabled=true`, records runs as `created_by=scheduler`, skips
startup if a parser run is already `pending` or `running`, and waits until the configured interval
has elapsed since the latest run for that source.

## Run On Windows Server Without Docker

When the frontend is opened from another computer, do not put `localhost` in browser-facing
frontend variables. In the browser, `localhost` means the user's computer, not the Windows server.

Start the backend on the server:

```powershell
py -3.12 -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
$env:DATABASE_URL = "sqlite:///./data/marketing_parser.db"
$env:BACKEND_CORS_ORIGINS = "http://SERVER_IP_OR_DOMAIN:7503"
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8503
```

For a development-style frontend with Vite proxy, start it on the same server:

```powershell
cd frontend
npm install
$env:VITE_PROXY_TARGET = "http://127.0.0.1:8503"
$env:VITE_IDENTITY_PROXY_TARGET = "http://127.0.0.1:8500"
$env:VITE_IDENTITY_API_FALLBACK_BASE_URL = "http://SERVER_IP_OR_DOMAIN:8500/api/v1"
npm run dev -- --host 0.0.0.0 --port 7503
```

Open:

```text
http://SERVER_IP_OR_DOMAIN:7503
```

If the frontend is built and served as static files without the Vite dev server proxy, set the
public backend URL before building:

```powershell
cd frontend
$env:VITE_API_BASE_URL = "http://SERVER_IP_OR_DOMAIN:8503"
$env:VITE_IDENTITY_API_BASE_URL = "http://SERVER_IP_OR_DOMAIN:8500/api/v1"
npm run build
```

If IIS serves the built `dist` folder on port `7503` and `VITE_API_BASE_URL` is left empty, IIS
must reverse-proxy API paths to the backend. Without that, `/api/v1/...` returns IIS `404`.
Use either:

```text
IIS 7503 -> /api/* reverse proxy -> http://127.0.0.1:8503/api/*
IIS 7503 -> /identity-api/* reverse proxy -> http://127.0.0.1:8500/api/v1/*
```

or rebuild the frontend with `VITE_API_BASE_URL=http://SERVER_IP_OR_DOMAIN:8503` and open TCP port
`8503` in Windows Firewall. Identity should point to the API port with
`VITE_IDENTITY_API_BASE_URL=http://SERVER_IP_OR_DOMAIN:8500/api/v1` unless IIS on port `7500`
explicitly reverse-proxies `/api/*` to `http://127.0.0.1:8500/api/*`.

## Module

The first source is Globus Online:

```text
Source -> Category -> Parser Run -> Product -> Snapshot -> Stats -> Export
```

API is exposed under:

```text
/api/v1/market-parser
```

## Permissions

The module declares permission codes in `app/modules/market_parser/permissions.py`.
Backend routes validate the Turkuaz Identity JWT from `Authorization: Bearer <token>`.
The frontend uses the shared `identity_access_token` localStorage key and proxies login/me
requests to Identity through `/identity-api`.

```text
market_parser.sources.read
market_parser.sources.manage
market_parser.categories.read
market_parser.categories.manage
market_parser.runs.read
market_parser.runs.create
market_parser.products.read
market_parser.stats.read
market_parser.export.read
```

Identity settings:

```text
AUTH_ENABLED=true
IDENTITY_SECRET_KEY=dev-change-me-32-byte-secret-key-for-turkuaz-identity
IDENTITY_ALGORITHM=HS256
DEV_ADMIN_LOGIN_ENABLED=false
VITE_IDENTITY_PROXY_TARGET=http://localhost:8500
VITE_IDENTITY_API_FALLBACK_BASE_URL=http://localhost:8500/api/v1
```

Register the `market_parser` service in Identity and assign these permissions to the roles that
should use parser sources, categories, manual runs, product history, reports, and exports.
Identity bootstrap creates convenience roles:

```text
market_parser_viewer
market_parser_operator
market_parser_manager
```

Market Parser data is global rather than branch-scoped, so these roles must be assigned globally
in Identity. Branch-scoped permission claims do not grant access to the module's global API.
The optional local admin login is disabled by default; enable it only in an isolated development
environment with `DEV_ADMIN_LOGIN_ENABLED=true` and `VITE_DEV_ADMIN_LOGIN_ENABLED=true`.

## Globus Notes

The parser uses the public SSR HTML state from Globus category pages. It does not access cart,
checkout, personal account pages, captcha flows, or protected endpoints.
