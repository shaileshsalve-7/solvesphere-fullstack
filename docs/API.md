# SolveSphere API contract

Base URL: `http://localhost:4000/api`

Send authenticated requests with `Authorization: Bearer <accessToken>`. JSON errors use `{ "error": "machine_code", "message": "human readable text" }`; validation errors also contain `details`.

## Authentication and accounts

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/request-code` | Public | Request a one-time code for `{ email }` |
| POST | `/auth/verify-code` | Public | Verify `{ email, code }` and receive an access token, rotating refresh token, expiry, and user |
| POST | `/auth/refresh` | Public | Exchange `{ refreshToken }`; the previous token is revoked |
| POST | `/auth/logout` | Public | Revoke `{ refreshToken }` |
| GET | `/auth/me` | Signed in | Current server-authoritative identity |
| GET/PATCH | `/profiles/me` | Signed in | Read or update name/avatar; role is never client-editable |

## Challenges and evidence

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/challenges` | Public | Search/filter by `q`, `status`, `priority`, `category`, `limit`, and `offset` |
| POST | `/challenges` | Signed in | Report a challenge; initial status is `Under review` |
| GET | `/challenges/:id` | Public | Challenge details, counts, and status history |
| PATCH | `/challenges/:id` | Owner/Admin | Edit fields; owners can edit only while under review or denied |
| PATCH | `/challenges/:id/status` | Admin | Apply a validated moderation/status transition |
| GET | `/challenges/:id/evidence` | Public | Evidence metadata |
| POST | `/challenges/:id/evidence` | Owner/team/Admin | Multipart upload with `file` and optional `caption` |
| GET | `/evidence/:id/download` | Signed in | Download stored evidence |

Challenge creation accepts `title`, `description`, `category`, `location`, and `priority`. Status values are `Under review`, `Open`, `In progress`, `Submitted`, `Resolved`, and `Denied`. Priority values are `Low`, `Medium`, `High`, and `Critical`.

Allowed status transitions are enforced by the server:

| From | To |
| --- | --- |
| Under review | Open, Denied |
| Open | In progress, Denied |
| In progress | Submitted, Resolved, Denied |
| Submitted | Resolved, In progress, Denied |
| Denied | Under review |
| Resolved | No further transition |

Creating the first team automatically moves an open challenge to `In progress` and records the transition.

## Teams

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/teams?challengeId=...` | Signed in | List active/inactive teams |
| GET | `/teams/:id` | Signed in | Team details and members |
| POST | `/challenges/:challengeId/teams` | Student | Create a team and become owner |
| POST | `/teams/:id/join` | Student | Join an active team |
| DELETE | `/teams/:id/members/me` | Student member | Leave a team; owners cannot abandon ownership |

## Solutions, reviews, and progress

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/solutions` | Signed in | Filter by `teamId`, `challengeId`, `status`, or `mine=true` |
| GET | `/solutions/:id` | Signed in | Solution with review history |
| POST | `/teams/:teamId/solutions` | Student member | Create a draft |
| POST | `/solutions` | Student member | Compatibility endpoint; body must include `teamId` |
| PATCH | `/solutions/:id` | Student member | Edit a draft or requested revision |
| POST | `/solutions/:id/submit` | Student member | Move a draft/revision to `Mentor review` |
| PATCH | `/solutions/:id/review` | Mentor/Admin | Submit `Approved` or `Changes requested` with feedback |
| GET | `/solutions/:solutionId/progress` | Signed in | Progress history |
| POST | `/solutions/:solutionId/progress` | Student member | Add summary, completion percentage, blockers, and milestone date |

Solution creation accepts `title`, `description`, optional `repositoryUrl`, and optional `demoUrl`. Review feedback must contain at least 10 characters.

## Notifications, dashboards, and administration

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/notifications` | Signed in | Most recent notifications |
| PATCH | `/notifications/:id/read` | Owner | Mark one notification read |
| PATCH | `/notifications/read-all` | Signed in | Mark all personal notifications read |
| GET | `/dashboard` | Signed in | Challenge/team/solution and unread counts |
| GET | `/admin/users` | Admin | List accounts and current roles |
| PATCH | `/admin/users/:id/role` | Admin | Assign a server-controlled role |
| GET | `/admin/overview` | Admin | Counts by role and workflow state |

## Identifier decision

All backend entity identifiers are UUID strings. The reference frontend currently declares `Challenge.id` as a number and uses numeric mock IDs. The frontend integration must change that type to `string`; the backend does not expose a second numeric identifier or silently coerce UUIDs.
