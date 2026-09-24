import { sql } from 'drizzle-orm';
import {
  bigserial,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  DOCUMENT_KINDS,
  PERSON_ROLES,
  RECURRENCE_FREQS,
  RECURRENCE_MODES,
  RECURRENCE_STATES,
  TASK_STATUSES,
} from '@org/shared';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });
const createdAt = () => ts('created_at').notNull().defaultNow();

export const taskStatus = pgEnum('task_status', TASK_STATUSES);
export const personRole = pgEnum('person_role', PERSON_ROLES);
export const recurrenceMode = pgEnum('recurrence_mode', RECURRENCE_MODES);
export const recurrenceFreq = pgEnum('recurrence_freq', RECURRENCE_FREQS);
export const recurrenceState = pgEnum('recurrence_state', RECURRENCE_STATES);
export const notificationKind = pgEnum('notification_kind', ['assigned', 'due_soon', 'due_today', 'overdue']);
export const notificationStatus = pgEnum('notification_status', ['pending', 'sending', 'sent', 'cancelled', 'failed']);
export const actorType = pgEnum('actor_type', ['person', 'system']);

// ---------------- Identity & Access ----------------

export const organizations = pgTable('organizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('Asia/Jerusalem'),
  /** Local hour (org timezone) at which date-based reminders are sent. */
  reminderHour: smallint('reminder_hour').notNull().default(9),
  /** How many days before the due date the "due soon" reminder goes out. */
  dueSoonDays: smallint('due_soon_days').notNull().default(1),
  createdAt: createdAt(),
});

/** A login identity (Google account). Separate from Person so that people can exist without logins. */
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  googleSub: text('google_sub').unique(),
  createdAt: createdAt(),
  lastLoginAt: ts('last_login_at'),
});

/**
 * Anyone who can own or participate in work. Plays the role of OrganizationMembership:
 *  role = 'manager' → full organisation access (login required)
 *  role = 'guest'   → login, sees only own/participating tasks
 *  role = null      → contact only: e-mail reminders + task-scoped magic links
 */
export const people = pgTable(
  'people',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    userId: uuid('user_id').references(() => users.id),
    displayName: text('display_name').notNull(),
    email: text('email').notNull(),
    role: personRole('role'),
    jobTitle: text('job_title'),
    deactivatedAt: ts('deactivated_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('people_org_email_uq').on(t.orgId, sql`lower(${t.email})`),
    uniqueIndex('people_user_uq').on(t.userId),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tokenHash: text('token_hash').notNull().unique(),
    personId: uuid('person_id').notNull().references(() => people.id),
    /** Set for sessions opened through a magic link: access limited to this task. */
    scopeTaskId: uuid('scope_task_id').references(() => tasks.id),
    createdAt: createdAt(),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
  },
  (t) => [index('sessions_person_idx').on(t.personId)],
);

export const magicLinks = pgTable('magic_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  tokenHash: text('token_hash').notNull().unique(),
  personId: uuid('person_id').notNull().references(() => people.id),
  taskId: uuid('task_id').notNull().references(() => tasks.id),
  createdAt: createdAt(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  lastUsedAt: ts('last_used_at'),
});

// ---------------- Recurrence ----------------

export const recurrenceDefinitions = pgTable(
  'recurrence_definitions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    ownerPersonId: uuid('owner_person_id').notNull().references(() => people.id),
    mode: recurrenceMode('mode').notNull(),
    freq: recurrenceFreq('freq').notNull(),
    interval: integer('interval').notNull().default(1),
    byWeekday: smallint('by_weekday').array().notNull().default(sql`'{}'::smallint[]`),
    byMonthDay: smallint('by_month_day'),
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }),
    state: recurrenceState('state').notNull().default('active'),
    /** Schedule mode: next occurrence date the worker has not generated yet. */
    nextOccurrenceDate: date('next_occurrence_date', { mode: 'string' }),
    createdByPersonId: uuid('created_by_person_id').notNull().references(() => people.id),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    check('recurrence_interval_positive', sql`${t.interval} >= 1`),
    index('recurrence_due_idx').on(t.state, t.nextOccurrenceDate),
  ],
);

export const recurrenceParticipants = pgTable(
  'recurrence_participants',
  {
    definitionId: uuid('definition_id').notNull().references(() => recurrenceDefinitions.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').notNull().references(() => people.id),
  },
  (t) => [primaryKey({ columns: [t.definitionId, t.personId] })],
);

// ---------------- Tasks ----------------

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: taskStatus('status').notNull().default('new'),
    ownerPersonId: uuid('owner_person_id').notNull().references(() => people.id),
    dueDate: date('due_date', { mode: 'string' }),
    recurrenceDefinitionId: uuid('recurrence_definition_id').references(() => recurrenceDefinitions.id),
    occurrenceDate: date('occurrence_date', { mode: 'string' }),
    createdByPersonId: uuid('created_by_person_id').references(() => people.id),
    createdAt: createdAt(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    completedAt: ts('completed_at'),
    archivedAt: ts('archived_at'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    // Duplicate prevention for recurring occurrences (architecture rule R-02).
    uniqueIndex('tasks_occurrence_uq').on(t.recurrenceDefinitionId, t.occurrenceDate),
    check(
      'tasks_occurrence_pair',
      sql`(${t.recurrenceDefinitionId} is null) = (${t.occurrenceDate} is null)`,
    ),
    index('tasks_org_status_idx').on(t.orgId, t.status),
    index('tasks_org_owner_idx').on(t.orgId, t.ownerPersonId),
    index('tasks_org_due_idx').on(t.orgId, t.dueDate),
  ],
);

export const taskParticipants = pgTable(
  'task_participants',
  {
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').notNull().references(() => people.id),
    addedAt: ts('added_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.personId] }), index('task_participants_person_idx').on(t.personId)],
);

// ---------------- Audit ----------------

/** Append-only log of important mutations, written in the same transaction as the change. */
export const auditEvents = pgTable(
  'audit_events',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    entityType: text('entity_type').notNull(),
    entityId: uuid('entity_id').notNull(),
    type: text('type').notNull(),
    actorType: actorType('actor_type').notNull(),
    actorPersonId: uuid('actor_person_id').references(() => people.id),
    /** How the actor acted: 'session' | 'magic_link' | 'worker'. */
    via: text('via').notNull(),
    data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index('audit_entity_idx').on(t.entityType, t.entityId, t.id)],
);

// ---------------- Notifications ----------------

/** Each row is one message to one person. Doubles as the delivery outbox for the worker. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    personId: uuid('person_id').notNull().references(() => people.id),
    kind: notificationKind('kind').notNull(),
    sendAt: ts('send_at').notNull(),
    status: notificationStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    claimedAt: ts('claimed_at'),
    sentAt: ts('sent_at'),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('notifications_dedupe_uq').on(t.taskId, t.personId, t.kind, t.sendAt),
    index('notifications_due_idx').on(t.status, t.sendAt),
  ],
);

// ---------------- Documents (Phase 2) ----------------

export const documentKind = pgEnum('document_kind', DOCUMENT_KINDS);

export const documentCategories = pgTable(
  'document_categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('document_categories_org_name_uq').on(t.orgId, t.name)],
);

/** A reference to an external document. Google owns the content; we keep identity and metadata only. */
export const documents = pgTable(
  'documents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orgId: uuid('org_id').notNull().references(() => organizations.id),
    kind: documentKind('kind').notNull(),
    googleFileId: text('google_file_id'),
    url: text('url').notNull(),
    title: text('title').notNull(),
    categoryId: uuid('category_id').references(() => documentCategories.id, { onDelete: 'set null' }),
    addedByPersonId: uuid('added_by_person_id').notNull().references(() => people.id),
    createdAt: createdAt(),
    archivedAt: ts('archived_at'),
  },
  (t) => [uniqueIndex('documents_org_google_uq').on(t.orgId, t.googleFileId)],
);

export const taskDocuments = pgTable(
  'task_documents',
  {
    taskId: uuid('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    documentId: uuid('document_id').notNull().references(() => documents.id, { onDelete: 'cascade' }),
    addedByPersonId: uuid('added_by_person_id').references(() => people.id),
    addedAt: ts('added_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.documentId] }), index('task_documents_document_idx').on(t.documentId)],
);

/** One approved sheet import. Rows are traced in task_import_rows rather than on the Task entity. */
export const taskImports = pgTable('task_imports', {
  id: uuid('id').primaryKey().defaultRandom(),
  orgId: uuid('org_id').notNull().references(() => organizations.id),
  sourceName: text('source_name').notNull(),
  sheetName: text('sheet_name').notNull().default(''),
  documentId: uuid('document_id').references(() => documents.id, { onDelete: 'set null' }),
  approvedByPersonId: uuid('approved_by_person_id').notNull().references(() => people.id),
  rowCount: integer('row_count').notNull(),
  createdAt: createdAt(),
});

export const taskImportRows = pgTable('task_import_rows', {
  taskId: uuid('task_id').primaryKey().references(() => tasks.id, { onDelete: 'cascade' }),
  importId: uuid('import_id').notNull().references(() => taskImports.id, { onDelete: 'cascade' }),
  sourceRow: integer('source_row').notNull(),
});

/** Per-person Google authorization (drive.file scope). The refresh token is encrypted at rest. */
export const googleConnections = pgTable('google_connections', {
  personId: uuid('person_id').primaryKey().references(() => people.id, { onDelete: 'cascade' }),
  refreshTokenEnc: text('refresh_token_enc').notNull(),
  scope: text('scope').notNull(),
  connectedAt: ts('connected_at').notNull().defaultNow(),
});

// ---------------- Operations ----------------

export const workerHeartbeats = pgTable('worker_heartbeats', {
  name: text('name').primaryKey(),
  lastBeatAt: ts('last_beat_at').notNull(),
  lastError: text('last_error'),
  lastErrorAt: ts('last_error_at'),
});
