# SolveSphere backend

Node.js and TypeScript API for **SIH26043 — Platform to Crowdsource Societal Challenges and Collaborative Problem Solving**.

This backend is published in the existing [shubhamkadam2737-jpg/solvesphere](https://github.com/shubhamkadam2737-jpg/solvesphere) repository on the `codex/solvesphere-backend` branch. The integrated frontend lives on the separate `codex/solvesphere-frontend` branch; the repository's default branch is left unchanged.

## What is implemented

- Passwordless email-code authentication with short-lived access tokens and rotating refresh tokens
- Server-controlled roles: `Citizen`, `Student`, `Mentor`, and `Admin`
- Challenge reporting, discovery, details, editing, moderation, status history, and readiness
- Evidence upload and authenticated download for JPEG, PNG, WebP, MP4, and PDF files
- Student team creation, membership, and protected owner rules
- Solution drafts, submission, mentor review, revision, and approval
- Progress updates and challenge readiness tracking
- User profiles, notifications/read state, role-aware dashboards, and admin summaries
- PostgreSQL-compatible migrations and a persistent local PGlite database
- Input validation, ownership checks, CORS, security headers, request limits, and rate limiting

## Local setup

Requirements: Node.js 20 or newer. No separately installed database is needed for local development.

```bash
npm install
copy .env.example .env
npm run migrate
npm run dev
```

The API listens on `http://127.0.0.1:4000` by default. Check it with `GET /health`.

The example configuration uses PGlite, a real embedded PostgreSQL-compatible database stored under `.data/`. For a hosted PostgreSQL database, set:

```dotenv
DATABASE_MODE=postgres
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DATABASE
```

Run the production build and tests with:

```bash
npm run build
npm test
npm start
```

## Authentication policy

New accounts are always created as `Citizen`, except the one email named by `BOOTSTRAP_ADMIN_EMAIL`. An administrator must promote accounts to `Student`, `Mentor`, or `Admin`; the client cannot select a privileged role.

`DEV_AUTH_ENABLED=true` uses the fixed `DEV_OTP_CODE` only for local development and tests. Configuration loading fails if development authentication is enabled in production. Production requires `OTP_DELIVERY_WEBHOOK_URL`; the backend sends the one-time code to that HTTPS delivery adapter and never returns it to the browser.

Use random secrets of at least 32 characters for `JWT_ACCESS_SECRET`. Do not commit `.env` or production credentials.

## Storage policy

Local evidence files are stored under `UPLOAD_DIR` and their metadata is stored in PostgreSQL. A hosted deployment should mount durable storage or replace the local adapter with object storage while keeping the API contract unchanged.

## Documentation

- [API contract](docs/API.md)
- [Frontend integration guide](docs/FRONTEND_INTEGRATION.md)
