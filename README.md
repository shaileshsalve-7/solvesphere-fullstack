# SolveSphere backend

Node.js and TypeScript API for **SIH26043 — Platform to Crowdsource Societal Challenges and Collaborative Problem Solving**.

This backend belongs on the `codex/solvesphere-backend` branch of [shaileshsalve-7/solvesphere-fullstack](https://github.com/shaileshsalve-7/solvesphere-fullstack). The React frontend is maintained on `codex/solvesphere-frontend`; its original commit history is preserved from [shubhamkadam2737-jpg/solvesphere](https://github.com/shubhamkadam2737-jpg/solvesphere).

## Implemented workflow

1. A Citizen creates and verifies an account, then reports a societal challenge.
2. An Admin reviews the report and opens or denies it.
3. Students create or join a team for an open challenge and submit a solution.
4. Mentors review submitted solutions and return approval or requested changes.
5. Teams post progress while owners and participants receive notifications.

The API also provides role-aware dashboards, profiles, notification read state, challenge evidence, status history, and Admin inspection views for users, challenges, teams, solutions, reviews, evidence counts, and progress counts.

## Technology and data

- Node.js 20+, TypeScript, Fastify, Zod, bcrypt, JWT access tokens, and rotating refresh tokens
- SQL migrations shared by persistent local PGlite and hosted PostgreSQL
- Local filesystem evidence storage with SQL metadata
- UUID identifiers and foreign-key relationships throughout the domain

Core writes use database transactions. Refresh tokens are stored only as SHA-256 hashes and passwords only as bcrypt hashes. Access checks reload the current role from the database.

## Local setup

```bash
npm install
copy .env.example .env
npm run migrate
npm run dev
```

The API starts at `http://127.0.0.1:4000`; `GET /health` verifies API and database availability. Local data persists under `.data/solvesphere`, and uploads persist under `uploads/`. Both paths are ignored by Git.

The example environment enables local demo mode. On startup it idempotently creates:

- Admin: `admin@solvesphere.local` / `Admin@123`
- Six published challenges covering roads, waste, water, streetlights, traffic, and parks

These credentials and records are development data. `DEV_SEED_ENABLED=true` is rejected when `NODE_ENV=production`. The seeder never changes the password of an existing credential-based Admin and never promotes a non-Admin email.

## Local email verification

`DEV_AUTH_ENABLED=true` makes the API return a fresh, random six-digit `developmentCode` in signup and resend responses. The UI must label it as a local development code; no email is sent. The code expires after ten minutes, older codes are invalidated, attempts are limited, and successful use is single-use.

Production rejects development authentication. Configure an HTTPS delivery adapter instead:

```dotenv
NODE_ENV=production
DEV_AUTH_ENABLED=false
DEV_SEED_ENABLED=false
OTP_DELIVERY_WEBHOOK_URL=https://your-mail-service.example/verification
OTP_DELIVERY_API_KEY=replace-with-provider-secret
```

The webhook receives `{ email, code, purpose: "email-verification" }`. Production responses never contain the code. Use a random `JWT_ACCESS_SECRET` of at least 32 characters and do not commit `.env`.

The retired passwordless endpoints return HTTP 410. An older non-Admin profile without a password may securely enroll through signup; it must verify the email again and retains its server-assigned role. Administrator credentials cannot be claimed through public signup.

## Validation and authorization

- Public signup accepts only `Citizen`, `Student`, or `Mentor`; `Admin` is never accepted.
- Passwords require upper/lowercase letters, a number, a symbol, and at most 72 UTF-8 bytes.
- Pending and denied challenges are visible only to their owner, Admins, and existing team members. `GET /challenges?mine=true` gives an owner their complete list.
- Draft solutions are visible only to team members and Admins. Mentors see submitted solutions; approved solutions are visible to signed-in users.
- Evidence requires an allowed extension, matching MIME type, matching file signature, size limits, and challenge access.
- Teams for a denied or otherwise hidden challenge cannot be discovered or joined by outsiders.

## Commands

```bash
npm run build
npm test
npm start
```

The integration suite uses real PGlite databases and covers credentials, email verification, sessions/logout, role enforcement, seeds, challenge moderation, teams, solutions, mentor reviews, progress, notifications, profiles, evidence validation/privacy, Admin inspection, production guardrails, and restart persistence.

For hosted PostgreSQL set `DATABASE_MODE=postgres` and `DATABASE_URL`. Hosted evidence needs a durable mounted `UPLOAD_DIR` or an object-storage adapter that preserves the documented API.

## Documentation

- [API contract](docs/API.md)
- [Frontend integration](docs/FRONTEND_INTEGRATION.md)
