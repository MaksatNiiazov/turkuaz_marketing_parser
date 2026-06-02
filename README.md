# Turkuaz Marketing Parser

Market parser service for collecting competitor product prices and discounts.

## Run Locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8040 --reload
```

Open API docs:

```text
http://localhost:8040/docs
```

## Run With Docker Compose

```bash
docker compose up --build
```

The API will be available at:

```text
http://localhost:8040/docs
```

The admin UI will be available at:

```text
http://localhost:5178
```

SQLite data is stored in the `marketing_parser_data` Docker volume. Migrations run automatically
before the API starts.

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
VITE_IDENTITY_PROXY_TARGET=http://localhost:8020
```

Register the `market_parser` service in Identity and assign these permissions to the roles that
should use parser sources, categories, manual runs, product history, reports, and exports.
Identity bootstrap creates convenience roles:

```text
market_parser_viewer
market_parser_operator
market_parser_manager
```

## Globus Notes

The parser uses the public SSR HTML state from Globus category pages. It does not access cart,
checkout, personal account pages, captcha flows, or protected endpoints.
