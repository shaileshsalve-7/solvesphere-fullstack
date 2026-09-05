# Frontend integration guide

Reference frontend: [github.com/shubhamkadam2737-jpg/solvesphere](https://github.com/shubhamkadam2737-jpg/solvesphere)

The current frontend is a Vite/React/TypeScript prototype. Its `src/services/api.ts` already defaults to `http://localhost:4000/api`, but most screens import `src/data/mockData.ts` directly and their buttons are not connected to handlers.

## Required frontend changes

1. Set `VITE_API_URL=http://localhost:4000/api` in the frontend `.env.local`.
2. In `src/types/index.ts`, change challenge IDs from `number` to `string`. Team, solution, evidence, user, and notification IDs are also UUID strings.
3. Replace demo login. The UI must call `/auth/request-code`, then `/auth/verify-code`. Remove the role selector; the verified response supplies the server role.
4. Store the access token in memory where possible and store the rotating refresh token using an agreed secure browser-session strategy. Add a response interceptor that calls `/auth/refresh` once after a 401 and replaces both tokens.
5. Replace direct `mockData` imports in Dashboard, Challenges, ChallengeDetails, Teams, Solutions, Notifications, Profile, and Admin with API queries.
6. Connect the Report challenge, Create team, Join team, Submit solution, Review, evidence upload, progress, and notification buttons to the documented endpoints.
7. Use `multipart/form-data` with a `file` field and optional `caption` for challenge evidence.
8. Render server validation errors and `403` permission errors. Do not derive authorization from the selected screen role.

## Existing helper compatibility

The backend supports the endpoints already declared in `src/services/api.ts`:

- `GET /challenges`
- `POST /challenges`
- `PATCH /challenges/:id/status`
- `GET /solutions`
- `POST /solutions` when the body includes `teamId`
- `PATCH /solutions/:id/review`

The frontend still needs helpers for authentication, refresh/logout, challenge details/editing/evidence, team membership, solution editing/submission, progress, profiles, notifications, dashboards, and administration.

## Known frontend-only blockers

The reference frontend currently starts in Vite development mode, but its production build fails on TypeScript inference in `Home.tsx` and `Dashboard.tsx`. Backend verification does not fix or conceal those errors. Full browser end-to-end validation should happen only after the frontend owner completes API wiring and resolves its own build issues.
