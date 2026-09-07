# SolveSphere API contract

Base URL: `http://localhost:4000/api`

Authenticated requests send `Authorization: Bearer <accessToken>`. Errors use `{ "error": "machine_code", "message": "human-readable text" }`; validation errors also include `details`.

## Authentication

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/signup` | Public | Create an unverified Citizen, Student, or Mentor credential account |
| POST | `/auth/verify-email` | Public | Verify the signup code and receive a session |
| POST | `/auth/resend-verification` | Public | Replace the previous verification code |
| POST | `/auth/login` | Public | Sign in with verified email and password |
| POST | `/auth/refresh` | Public | Rotate a refresh token and receive a new session |
| POST | `/auth/logout` | Public | Revoke a refresh token |
| GET | `/auth/me` | Signed in | Return the current server-authoritative user |

Signup body:

```json
{
  "name": "Asha Patil",
  "email": "asha@example.com",
  "password": "Example@123",
  "role": "Student"
}
```

Public role values are `Citizen`, `Student`, and `Mentor`. Admin is rejected. A development signup returns HTTP 201:

```json
{
  "ok": true,
  "email": "asha@example.com",
  "verificationRequired": true,
  "delivery": "development",
  "expiresInSeconds": 600,
  "developmentCode": "random-six-digit-code"
}
```

With production delivery, `delivery` is `email` and `developmentCode` is absent. Verify with `{ "email", "code" }`. Verification and login return:

```json
{
  "accessToken": "...",
  "refreshToken": "...",
  "expiresAt": "...",
  "user": { "id": "uuid", "email": "...", "name": "...", "role": "Student" }
}
```

Expected auth errors include `email_exists` (409), `invalid_credentials` (401), `email_not_verified` (403), `invalid_code` (401), and `validation_error` (400). Retired `/auth/request-code` and `/auth/verify-code` return 410.

## Profiles and notifications

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET/PATCH | `/profiles/me` | Signed in | Read or edit name/avatar; role is not client-editable |
| GET | `/notifications` | Signed in | List the latest 100 personal notifications |
| PATCH | `/notifications/:id/read` | Owner | Mark one personal notification read |
| PATCH | `/notifications/read-all` | Signed in | Mark all personal notifications read |
| GET | `/dashboard` | Signed in | Role, workflow counts, personal teams/solutions, unread count |

Notifications cover challenge submission/moderation, team activity, solution submission, mentor feedback, progress, and Admin role changes.

## Challenges and evidence

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/challenges` | Public | Published challenges; filters: `q`, `status`, `priority`, `category`, `limit`, `offset` |
| GET | `/challenges?mine=true` | Signed in | All challenges owned by the caller, including pending/denied |
| POST | `/challenges` | Signed in | Report a challenge in `Under review` |
| GET | `/challenges/:id` | Public/related | Details and status history subject to visibility rules |
| PATCH | `/challenges/:id` | Owner/Admin | Edit allowed fields |
| PATCH | `/challenges/:id/status` | Admin | Apply a valid moderation/status transition |
| GET | `/challenges/:id/evidence` | Public/related | Evidence metadata subject to challenge visibility |
| POST | `/challenges/:id/evidence` | Owner/team/Admin | Upload one validated evidence file |
| GET | `/evidence/:id/download` | Signed in/related | Download evidence subject to challenge visibility |

Challenge creation accepts `title`, `description`, `category`, `location`, and `priority`. Public tracking states are `Published`, `In progress`, and `Implemented`; hidden moderation states are `Under review` and `Rejected`. These statuses track platform progress only and do not claim real-world execution. Priority is `Low`, `Medium`, `High`, or `Critical`.

Allowed transitions are:

| From | To |
| --- | --- |
| Under review | Published, Rejected |
| Published | In progress, Rejected |
| In progress | Implemented, Rejected |
| Rejected | Under review |
| Implemented | None |

Evidence is multipart form data with `file` and optional `caption`. Supported types are JPEG, PNG, WebP, MP4, and PDF. Extension, declared MIME type, content signature, authorization, and configured size are checked.

## Teams

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/teams?challengeId=...` | Signed in | Visible active/inactive teams |
| GET | `/teams/:id` | Signed in/related | Team details and member names/roles |
| POST | `/challenges/:challengeId/teams` | Student | Create a team for an open/in-progress challenge |
| POST | `/teams/:id/join` | Student | Join an active team on an open/in-progress challenge |
| DELETE | `/teams/:id/members/me` | Student member | Leave; owners cannot abandon ownership |

Creating the first team moves a `Published` challenge to `In progress` atomically. Ordinary team details do not expose member email addresses; Admin inspection does.

## Solutions, reviews, and progress

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/solutions` | Signed in/scoped | Filter visible solutions by `teamId`, `challengeId`, `status`, `mine` |
| GET | `/solutions/:id` | Signed in/scoped | Solution and review history |
| POST | `/teams/:teamId/solutions` | Student team member | Create a draft |
| POST | `/solutions` | Student team member | Compatibility create endpoint with `teamId` in body |
| PATCH | `/solutions/:id` | Student team member | Edit draft/requested revision |
| POST | `/solutions/:id/submit` | Student team member | Atomically move to `Mentor review` and notify reviewers |
| PATCH | `/solutions/:id/review` | Mentor/Admin | Atomically approve or request changes with feedback |
| GET | `/solutions/:solutionId/progress` | Signed in/scoped | Visible progress history |
| POST | `/solutions/:solutionId/progress` | Student team member | Add progress and update challenge readiness |

Repository and demo URLs must use HTTP or HTTPS. Drafts are limited to team members/Admins; Mentors can access non-drafts; challenge owners can access non-drafts for their challenge; approved solutions are visible to signed-in users.

## Administration

All routes require Admin.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/overview` | Counts by role/status plus totals for users, challenges, teams, solutions, reviews, evidence, progress |
| GET | `/admin/users` | Accounts and roles |
| PATCH | `/admin/users/:id/role` | Assign a server-controlled role; returns `{ id, role }` |
| GET | `/admin/challenges` | All challenge states with owner and counts |
| GET | `/admin/teams` | All teams with owner/member/solution counts |
| GET | `/admin/solutions` | All solutions with creator and latest review data |
| GET | `/admin/reviews` | All mentor/Admin feedback records |

All identifiers are UUID strings.
