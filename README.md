# Organization Management — Phase 1 (Core Task Management)

What needs to be done → who owns it → when → what supports it → what is the status.

Phase 1 of the architecture baseline: authentication, organisation, people and roles, tasks, owners, participants, statuses, due dates, personal and organisation views, recurrence, reminders, audit. No documents, AI or Gmail (Phases 2–4).

See [docs/DECISIONS.md](docs/DECISIONS.md) for what was decided and what is still **PROPOSED** or **OPEN**.

## Layout

```
packages/shared     API contracts (zod schemas, DTO types, status vocabulary). No business rules.
apps/server         Modular monolith (Fastify + Drizzle + PostgreSQL)
  src/modules/
    identity/       Google sign-in, magic links, sessions, people, authorization policy
    tasks/          Task Management — the only module that changes tasks for people
    recurrence/     Recurrence definitions and occurrence generation
    notifications/  Reminder planning, outbox, e-mail delivery
    audit/          Append-only audit log
  src/worker.ts     Background worker (recurrence + notification delivery + heartbeat)
  drizzle/          SQL migrations
apps/web            React + Vite, Hebrew RTL
```

Module rules: routes → service → store. Services own authorization (`policy.ts`), transactions and audit. Only `tasks/task-store.ts` inserts task rows; recurrence goes through it too.

## Running locally

Requires Node 22+. No PostgreSQL install is needed: development uses PGlite, a real PostgreSQL embedded in the process.

```bash
npm install
cp apps/server/.env.example apps/server/.env
npm run seed --workspace @org/server -- --demo
```

Then, in two terminals:

```bash
npm run dev:server
```

```bash
npm run dev:web
```

Open http://localhost:5173 and sign in with the dev login as `manager@example.org`. E-mails are not sent in dev; open http://localhost:5173/dev/outbox to read them and follow magic links.

To use Google sign-in, create an OAuth 2.0 Web client in Google Cloud, add `http://localhost:5173` as an authorised JavaScript origin, and set `GOOGLE_CLIENT_ID`.

## Tests

```bash
npm test
```

- Unit tests: lifecycle, authorization policy, recurrence rules, reminder planning (including DST).
- Integration tests on real PostgreSQL (PGlite in memory): transactions, audit, optimistic locking, views by org timezone, guest isolation, recurrence idempotency, pause/resume, magic-link scoping, reminder delivery, CSRF, health.

## Production

```bash
npm run build
```

- Web: `apps/web/dist` (served by the API when `WEB_DIST_DIR` is set).
- API: `node apps/server/dist/main.js` with `WORKER_MODE=separate`.
- Worker: `node apps/server/dist/worker-main.js`, exactly one or more instances (claims are lock-safe).
- Release step: `node apps/server/dist/migrate-main.js`.
- First start: `node apps/server/dist/seed-main.js` with `BOOTSTRAP_MANAGER_EMAILS` creates the organisation and first managers.

Production config refuses dev login, the embedded database and the console mailer. Required: `DATABASE_URL` (PostgreSQL), `GOOGLE_CLIENT_ID`, `APP_URL`, `MAIL_TRANSPORT=smtp`, `SMTP_URL`.

Observability: structured JSON logs (pino, cookies redacted), `/healthz` (liveness), `/readyz` (database), and `/api/ops/status` (worker heartbeat, notification backlog and failures; managers only; also in the UI under "מצב המערכת").

Backups: use the managed PostgreSQL provider's automated backups with point-in-time recovery, and rehearse a restore before go-live. This is still to be documented once the provider is chosen (A7).
