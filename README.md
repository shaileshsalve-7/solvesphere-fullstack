# SolveSphere frontend

React and TypeScript frontend for **SIH26043 — Platform to Crowdsource Societal Challenges and Collaborative Problem Solving**.

This branch contains the frontend only. The backend is maintained on the `codex/solvesphere-backend` branch of the same repository. The original frontend work and commit history are preserved from [shubhamkadam2737-jpg/solvesphere](https://github.com/shubhamkadam2737-jpg/solvesphere).

## Features connected to the API

- Email verification-code sign-in with access/refresh sessions
- Server-authoritative Citizen, Student, Mentor, and Admin roles
- Challenge discovery, reporting, details, evidence, and moderation
- Team creation and membership
- Solution drafts, submission, mentor review, and progress updates
- Notifications/read state, profile editing, dashboards, and admin role management
- Loading, empty, success, validation, permission, and request-error states

## Run with the backend

Frontend requirements: Node.js 20 or newer.

```bash
npm install
copy .env.example .env.local
npm run dev
```

The frontend defaults to `http://localhost:4000/api`. Configure another backend URL with:

```dotenv
VITE_API_URL=http://localhost:4000/api
```

In a second checkout of the same repository, switch to `codex/solvesphere-backend`, follow that branch's README, and start the backend on port 4000.

For the local development OTP flow, use the code configured as `DEV_OTP_CODE` on the backend. The browser never chooses its own role: new users start as Citizens, the configured bootstrap email becomes the initial Admin, and an Admin promotes verified users to Student or Mentor.

## Build

```bash
npm run build
npm run preview
```

All API entity identifiers are UUID strings. The former numeric mock challenge IDs and static mock datasets have been removed.
