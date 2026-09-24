# Phase 1 — Decisions Log

Status legend: **APPROVED** = decided by the product owner · **PROPOSED** = implemented as a default, awaiting architect/owner approval · **OPEN** = not decided, not implemented.

Every PROPOSED item is isolated in one place in the code, so changing it is local.

## Product decisions

| ID | Topic | Status | What was implemented | Where |
|---|---|---|---|---|
| D1 | Participants without accounts | **APPROVED** — all three channels | (a) e-mail notifications to everyone; (b) Google sign-in for people with role `guest`; (c) task-scoped magic links (sent automatically to contacts without login, or generated manually by a manager) | `modules/identity/auth-service.ts`, `notifications/dispatcher.ts` |
| D6 | Recurrence | **APPROVED** — both modes, chosen per definition | `schedule` (fixed calendar; occurrences created on time even if the previous is open) and `after_completion` (next due = completion day + interval) | `modules/recurrence/*` |
| D8 | Language / locale | **APPROVED** — Hebrew, RTL | UI in Hebrew, `dir="rtl"`, org timezone `Asia/Jerusalem`, weeks Sunday–Saturday, `due_date` is a calendar date (no time) | `apps/web`, `lib/dates.ts` |
| D2 | Who may change what | PROPOSED | Managers: everything. Guests and link visitors: view tasks they own/participate in, change **status only**. Only managers create tasks. | `modules/identity/policy.ts` |
| D3 | Visibility | PROPOSED | Both managers are equal and see all organisation tasks. No private tasks. | `policy.ts` |
| D4 | Owner required | PROPOSED | Every task has exactly one owner; the owner may be any active person, including a contact without login. | `db/schema.ts` (`owner_person_id NOT NULL`) |
| D5 | Status vocabulary | PROPOSED | `new → in_progress ⇄ waiting → completed`; `cancelled` from any open state; reopen `completed → in_progress`; restore `cancelled → new`. Archive is a separate flag, not a status. | `modules/tasks/lifecycle.ts` |
| D6a | Missed occurrence | PROPOSED | Stays open and appears as overdue; not auto-closed. | `recurrence-service.ts` |
| D6b | Definition edits | PROPOSED | Apply to occurrences generated afterwards only. | `updateRecurrence` |
| D6c | Pause / resume | PROPOSED | Schedule mode: dates inside the pause are skipped. After-completion mode: if nothing is open on resume, a new occurrence is created for today. | `setRecurrenceState` |
| D6d | Generation horizon | PROPOSED | Schedule-mode occurrences are created 7 days ahead (`RECURRENCE_HORIZON_DAYS`), capped at 60 per pass. | `config.ts` |
| D7 | Reminder policy | PROPOSED | Assignment notice immediately; "due soon" 1 day before, "due today", and "overdue" the day after, all at 09:00 org time, to owner and participants. Past reminders are not back-filled. | `notifications/plan.ts`, org columns `reminder_hour`, `due_soon_days` |
| D9 | Mobile | PROPOSED | Responsive web; no native app. | `styles.css` |

## Architectural decisions

| ID | Topic | Status | Choice |
|---|---|---|---|
| A1 | Authentication | PROPOSED | Google Identity Services ID token, verified server-side; opaque session token in an `HttpOnly; SameSite=Lax` cookie, stored hashed. No self-registration: a manager must add the person first. |
| A2 | Google account type | **OPEN** | Workspace vs consumer Gmail still unknown. Phase 1 only needs the `openid email` scope, so it is unaffected; Phase 2+ is. |
| A3 | Notification channel | PROPOSED | E-mail (SMTP adapter, console adapter in dev) + in-app views. No push. |
| A4 | Background processing | PROPOSED | No queue library: the `notifications` table is the outbox, claimed with `FOR UPDATE SKIP LOCKED`; recurrence uses a per-definition cursor under a row lock. Worker runs inline in dev, as a separate process in production. |
| A5 | Duplicate prevention | PROPOSED | Unique `(recurrence_definition_id, occurrence_date)`; unique `(task_id, person_id, kind, send_at)` on notifications; "latest occurrence only" check for after-completion. Delivery is at-least-once (a crash between send and commit can duplicate one mail). |
| A6 | Audit | PROPOSED | Append-only `audit_events`, written in the same transaction as the change; records actor (person or `system`) and channel (`session` / `magic_link` / `worker`). |
| A7 | Hosting | **OPEN** | Not chosen. The build produces one container (API + static web) and one worker command; any PaaS with managed PostgreSQL and point-in-time recovery fits. |
| A8 | Code structure | PROPOSED | npm workspaces: `packages/shared` (contracts only), `apps/server` (modular monolith), `apps/web`. |
| A9 | Concurrency | PROPOSED | Optimistic locking with a `version` column on tasks and definitions; stale writes return HTTP 409. |
| A10 | Local database | PROPOSED | PGlite (PostgreSQL compiled to WASM) for dev and tests, so contributors need no Postgres install; production uses real PostgreSQL through the same migrations. |

## Deviations from the architecture baseline (§11)

1. **`OrganizationMembership` is folded into `people.role`.** A separate `people` (Person) entity was added because participants can exist without a login (D1). `users` holds only Google login identities. Role `null` = contact without login.
2. **`Archived` is not a status** (baseline §12 draws it as one). It is `archived_at`, orthogonal to status, to avoid storing the same fact twice (§7.2).
3. **`Reminder` is named `notifications`** and also covers the "assigned" message; it doubles as the delivery outbox.
4. Added `cancelled` status (not in the baseline lifecycle).

## Still open before production

- A2 Google account type · A7 cloud provider · backup/restore RPO & RTO targets · real SMTP provider · error-tracking service (logs are structured JSON via pino; a Sentry-style hook is not wired yet).

# Phase 2 — Documents and sheet import

Started at the product owner's request before Phase 1 was in real use (the baseline says Phase 2 comes after Phase 1 usage). **Deviation to be acknowledged by the architect.**

| ID | Topic | Status | What was implemented |
|---|---|---|---|
| P2-1 | Purpose | **APPROVED** — "turn our sheets into the site" | One-time **import** of a hand-kept table into tasks. After the import the app is the source of truth; the sheet is never written back to. |
| P2-2 | Sources | **APPROVED** — all | Excel (.xlsx) / CSV upload, Google Sheet picked from Drive, pasted Sheets link (works only if the sheet is private-but-picked, or shared "anyone with the link"). |
| P2-3 | Google account type | **APPROVED** — consumer Gmail | Scope `drive.file` only: non-sensitive, no Google verification needed. The app sees only files the user picks or the app creates. |
| P2-4 | Approval boundary | PROPOSED | Import is two steps: preview (nothing stored) → manager reviews every mapped row → commit creates all rows in **one transaction** or none. Each task records its source import and row (`task_import_rows`), not a new column on Task (rule 10). |
| P2-5 | Import notifications | PROPOSED | No "assigned" e-mails for imported tasks (they already existed on paper); date reminders apply to open ones. |
| P2-6 | Unmapped data | PROPOSED | Unmapped columns and unreadable dates are appended to the task description so nothing from the sheet is lost. |
| P2-7 | Documents | PROPOSED | References only (id, kind, title, URL, category). Managers add/categorise/attach; anyone who can see a task sees its documents. Dedup by Google file id. Upload stores the file in the uploader's Drive (converted to Docs/Sheets). |
| P2-8 | Google credentials | PROPOSED | Authorization-code popup; refresh token exchanged and stored **server-side, AES-256-GCM encrypted**. The browser only receives a short-lived access token for the Picker (baseline §20 "no privileged Google access from frontend" — the Picker token is user-scoped and short-lived). |

Still open for Phase 2: R-04 (document moved/deleted/access revoked — currently the link simply stops working), whether guests should see a document library, and whether sheets should ever be written back to (would be a baseline change).
