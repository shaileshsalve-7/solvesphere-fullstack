# Frontend integration

Set the frontend environment:

```dotenv
VITE_API_URL=http://localhost:4000/api
```

## Credential flow

1. Create account with `POST /auth/signup` and `name`, `email`, `password`, and `role` (`Citizen`, `Student`, or `Mentor`).
2. Show the verification screen. If `delivery === "development"`, display `developmentCode` with the label **Local development code — no email was sent**. Never assume this property exists in production.
3. Send `{ email, code }` to `POST /auth/verify-email`. The response is a normal session and includes the authoritative server role.
4. Returning users call `POST /auth/login` with email/password.
5. Store the returned access and refresh tokens using the existing session strategy. On one 401, call `/auth/refresh`, replace both tokens, and retry once. Logout calls `/auth/logout` and clears local session state even if the request fails.

Map these server errors to forms: `validation_error`, `email_exists`, `invalid_credentials`, `email_not_verified`, and `invalid_code`. An unverified login should offer `POST /auth/resend-verification`.

The server rejects Admin signup. The local Admin account exists only when development seeding is enabled; it uses the documented demo credentials in the backend README.

## Visibility and role rules

- Use `GET /challenges` for public discovery and `GET /challenges?mine=true` for a Citizen's pending/denied submissions.
- Admin moderation must load `/admin/challenges`; the public collection intentionally omits pending and denied records.
- Students can create/join teams only for open or in-progress challenges.
- Solution collections are server-scoped. Students receive their team drafts plus approved public work; Mentors receive submitted/reviewed solutions; Admins receive all.
- Show permission messages from server 403 responses. Treat scoped 404 responses as unavailable records.
- Never derive authority only from a client-selected role. The user returned by login/refresh/me is authoritative.

## Main API helpers

- Challenges: list/mine/details/create/edit/status/evidence
- Teams: list/details/create/join/leave
- Solutions: list/details/create/edit/submit/review/progress
- Account: profile, dashboard, notifications, read/read-all
- Admin: overview, users/roles, challenges, teams, solutions, reviews

Uploads use multipart form data with a `file` field and optional `caption`. Do not set the multipart boundary manually in Axios.

All entity identifiers are UUID strings. Render API loading, empty, validation, authorization, and unexpected-error states; do not fall back to mock records when a request fails.
