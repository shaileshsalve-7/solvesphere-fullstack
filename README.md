# SolveSphere frontend

React and TypeScript frontend for **SIH26043 — Platform to Crowdsource Societal Challenges and Collaborative Problem Solving**.

Live website: https://solvesphere-dpes.onrender.com

Live API health: https://solvesphere-api-tsbq.onrender.com/health

This branch contains the frontend only. The backend is maintained on the `codex/solvesphere-backend` branch of [shaileshsalve-7/solvesphere-fullstack](https://github.com/shaileshsalve-7/solvesphere-fullstack). The original frontend work and commit history are preserved from [shubhamkadam2737-jpg/solvesphere](https://github.com/shubhamkadam2737-jpg/solvesphere).

## Features connected to the API

- Password signup and login with email verification, short-lived access tokens, and rotating refresh sessions
- Public Citizen, Student, and Mentor registration; Admin creation is never exposed publicly
- Server-authoritative role and ownership checks for every protected workflow
- Challenge discovery, reporting, details, evidence, and moderation
- Team creation and membership
- Solution drafts, submission, mentor review, and progress updates
- Notifications/read state, profile editing, dashboards, and full admin inspection
- Loading, empty, success, validation, permission, and request-error states

## Run with the backend

Frontend requirements: Node.js 20 or newer.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

The frontend defaults to `http://localhost:4000/api`. Configure another backend URL with:

```dotenv
VITE_API_URL=http://localhost:4000/api
```

In a second checkout of the same repository, switch to `codex/solvesphere-backend`, follow that branch's README, and start the backend on port 4000.

When the backend explicitly enables development authentication, the verification screen displays the temporary code returned by the local API. Production mode rejects that setting and requires an HTTPS delivery adapter. The local seed can create `admin@solvesphere.local` with password `Admin@123`; those are development-only demo credentials and must never be reused in production.

## Build

```bash
npm run build
npm run preview
```

With the backend and frontend already running, the real-browser lifecycle check can be run with:

```bash
npm run test:e2e
```

It uses an installed Microsoft Edge/Chromium browser and covers Citizen reporting, Admin moderation, Student team/solution work, Mentor feedback, notifications, profile editing, evidence upload, session refresh, logout, and protected-route behavior.

All API entity identifiers are UUID strings. The former numeric mock challenge IDs and static mock datasets have been removed.
