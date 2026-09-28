# DSNL Analytics

![Python](https://img.shields.io/badge/Python-3.10%2B-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-19-149ECA?logo=react&logoColor=white)
![Version](https://img.shields.io/badge/version-1.0-blue)

DSNL Analytics is an analytics platform for large CDR and CODR call-record datasets. It serves read-only dashboards over daily Parquet exports and includes a natural-language AI assistant for analytical questions. FastAPI provides the API, session-based authentication, and permission checks; React provides the dashboard and chat interface.

## Table of contents

- [Features](#features)
- [Architecture](#architecture)
- [Technology](#technology)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
  - [1. Clone the repository](#1-clone-the-repository)
  - [2. Prepare MySQL](#2-prepare-mysql)
  - [3. Set up the backend](#3-set-up-the-backend)
  - [4. Set up the frontend](#4-set-up-the-frontend)
- [Configuration](#configuration)
- [Verification](#verification)
- [Security and deployment notes](#security-and-deployment-notes)

## Features

- **Read-only analytics:** CDR and CODR dashboards and campaign metrics query daily exports without importing them into MySQL.
- **Date-scoped queries:** The API selects the files that match the requested date range and limits query range and result size.
- **Natural-language analysis:** The assistant can answer questions over the same lake using Anthropic, OpenAI, or Google Gemini. A provider key is optional if only the dashboards are needed.
- **Session-based access:** Sign-in issues an HTTP-only session cookie. Dashboard endpoints require a signed-in user; AI endpoints also require the user's `ai_permission` flag. Conversations are scoped to their owner.
- **Separated storage:** MySQL stores users, sessions, and conversation state; DuckDB reads the Parquet data.

## Architecture

```text
React / Vite UI
      |
      | /api (Vite development proxy)
      v
FastAPI backend --------> MySQL
      |                   users, sessions, conversations
      |
      +----> DuckDB ----> CDR and CODR daily Parquet files
      |                   on a local path or mounted network share
      |
      +----> Anthropic / OpenAI / Google Gemini (AI chat only)
```

The backend looks for `cdr_YYYYMMDD.parquet` and `codr_YYYYMMDD.parquet` in the configured lake directories. It resolves a request's dates to the files that exist, then DuckDB queries those files in place. The application does not upload the exports or load the entire lake into application memory. The backend process needs read access to both directories, including when they are mounted from a network share.

## Technology

| Layer                      | Stack                                             |
| -------------------------- | ------------------------------------------------- |
| API and validation         | Python, FastAPI, Pydantic, pydantic-settings      |
| Metadata and session state | SQLAlchemy, PyMySQL, MySQL                        |
| Analytics                  | DuckDB, daily Parquet files                       |
| AI providers               | Anthropic, OpenAI, Google Gemini                  |
| Web application            | React, TypeScript, Vite, custom CSS/UI components |

## Prerequisites

- Python 3.10 or newer and `pip`.
- Node.js and npm compatible with the Vite version in [`frontend/package.json`](frontend/package.json).
- A reachable MySQL server and credentials that can create the application's tables for initial setup.
- Read access to directories containing daily CDR and CODR Parquet exports. The filenames must follow `cdr_YYYYMMDD.parquet` and `codr_YYYYMMDD.parquet`.
- An API key for Anthropic, OpenAI, or Google Gemini **only** if AI chat is required.

## Getting started

### 1. Clone the repository

Replace `YOUR_ORG` with the repository owner:

```bash
git clone https://github.com/{Name}/dsnl-analytics.git
cd dsnl-analytics
```

### 2. Prepare MySQL

Create a database and an application account. For a local development instance, connect as a MySQL administrator with `mysql -u root -p` and run:

```sql
CREATE DATABASE dsnl_analytics CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'dsnl_app'@'localhost' IDENTIFIED BY 'REPLACE_WITH_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON dsnl_analytics.* TO 'dsnl_app'@'localhost';
```

Use credentials and privileges appropriate to your environment. The connection URL in the next step must refer to this database and account. Percent-encode reserved characters in the URL's password.

### 3. Set up the backend

From the repository root, create a virtual environment and install the dependencies:

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

On Windows PowerShell, use these commands instead:

```powershell
cd backend
py -3 -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
```

Create `backend/.env`. The following is a working template; replace the credentials, key, and paths with values for your environment:

```dotenv
DATABASE_URL=mysql+pymysql://dsnl_app:REPLACE_WITH_STRONG_PASSWORD@localhost:3306/dsnl_analytics
CDR_LAKE_PATH=Z:/cdr
CODR_LAKE_PATH=Z:/codr

# Required only for AI chat; use one supported provider key.
OPENAI_API_KEY=REPLACE_WITH_OPENAI_API_KEY
AI_PROVIDER=openai

# Keep false for local HTTP; use true when served over HTTPS.
SESSION_COOKIE_SECURE=false
```

`Z:/cdr` and `Z:/codr` are examples of mounted share paths on Windows. Use absolute paths visible to the backend process, such as `/mnt/cdr` and `/mnt/codr` on Linux. If AI chat is not needed, omit both `OPENAI_API_KEY` and `AI_PROVIDER`; the dashboards still work. You can also start from [`backend/.env.example`](backend/.env.example), but update its example `AI_PROVIDER` and `AI_MODEL` values to match your chosen key and model, or remove them to use automatic provider selection.

Initialize the tables, including the current chat schema:

```bash
python scripts/migrate_ai_chat.py
```

Accounts are currently provisioned directly in MySQL. After the tables exist, connect with `mysql -u dsnl_app -p dsnl_analytics` and create a development account:

```sql
INSERT INTO users (user_id, username, password_hash, ai_permission)
VALUES (UUID(), 'analyst', 'REPLACE_WITH_TEMPORARY_PASSWORD', 1);
```

Set `ai_permission` to `0` for a dashboard-only account. **The current login implementation stores and compares this password as plaintext despite the `password_hash` column name. See [Security and deployment notes](#security-and-deployment-notes) before using real credentials.**

Start the API from `backend/` with the virtual environment active:

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload
```

The API is available at `http://127.0.0.1:8001`; `GET /health` is a public liveness endpoint. API documentation at `/docs` requires a signed-in session.

For an existing database, back up its data before running `scripts/migrate_ai_chat.py`: the script updates the schema and rebuilds legacy chat messages when necessary.

### 4. Set up the frontend

In a second terminal, from the repository root:

```bash
cd frontend
npm install
npm run dev
```

Open the local URL printed by Vite (typically `http://localhost:5173`) and sign in with the account created above. [`frontend/vite.config.ts`](frontend/vite.config.ts) proxies `/api` to `http://127.0.0.1:8001`; run the backend on that port or update the proxy target.

## Configuration

All backend settings are read from environment variables or `backend/.env` when the server is started from `backend/`. Common settings include:

| Variable                                                      | Purpose                                                                                                          |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                              | MySQL connection URL for users, sessions, and chat state.                                                        |
| `CDR_LAKE_PATH`                                             | Directory containing`cdr_YYYYMMDD.parquet` files.                                                              |
| `CODR_LAKE_PATH`                                            | Directory containing`codr_YYYYMMDD.parquet` files.                                                             |
| `CDR_MAX_RANGE_DAYS`                                        | Maximum dashboard query span; default`31`.                                                                     |
| `AI_PROVIDER`                                               | Optional explicit provider:`anthropic`, `openai`, or `gemini`.                                             |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY` | Supply the key for the chosen provider. If`AI_PROVIDER` is unset, the first configured key wins in that order. |
| `AI_MODEL`                                                  | Optional provider-specific model ID.                                                                             |
| `AI_MAX_RANGE_DAYS`                                         | Maximum date span for an AI tool call; default`31`.                                                            |
| `SESSION_TTL_DAYS`                                          | Lifetime of newly issued sessions; default`7`.                                                                 |
| `SESSION_COOKIE_SECURE`                                     | Set to`true` when the site is served over HTTPS.                                                               |

See [`backend/.env.example`](backend/.env.example) and [`backend/app/core/config.py`](backend/app/core/config.py) for the complete settings list. Keep `backend/.env` out of version control; it is ignored by the repository's `.gitignore`.

## Verification

With the API running, check liveness at `http://127.0.0.1:8001/health`. After signing in, the dashboard should display the dates found in the configured lake directories. If no data appears, check the paths, process permissions, and export filenames.

To run the available checks:

```bash
# From backend/, with the virtual environment active
python -m pytest
```

```bash
# From frontend/
npm run lint
npm run build
```

## Security and deployment notes

Session tokens are stored server-side as hashes, delivered in HTTP-only cookies, and checked for expiry. The current access control grants AI access through the `users.ai_permission` flag; it does not implement a general role hierarchy. The password verification code compares plaintext values stored in `users.password_hash`. **Do not use production credentials or expose this deployment to untrusted users until password hashing and a safe account-provisioning flow are implemented.**

Before a production deployment, enable HTTPS and `SESSION_COOKIE_SECURE=true`, restrict the backend's permissive development CORS setting, and grant the backend only the database and lake access it needs. AI requests send question context and query results to the selected external provider; review that data flow against your organization's policies.
