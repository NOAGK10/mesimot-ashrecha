// API contracts shared by server and web. Business rules live on the server;
// this package holds only vocabulary and request/response shapes.
import { z } from 'zod';

export const TASK_STATUSES = ['new', 'in_progress', 'waiting', 'blocked', 'completed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const OPEN_STATUSES: readonly TaskStatus[] = ['new', 'in_progress', 'waiting', 'blocked'];

/** manager: everything · member: sees all, updates/creates own · guest: sees only own. */
export const PERSON_ROLES = ['manager', 'member', 'guest'] as const;
/** null role = contact without login (email / magic link only). */
export type PersonRole = (typeof PERSON_ROLES)[number] | null;

/** org: everyone who signs in sees it · private: only its creator, owner, participants and managers. */
export const TASK_VISIBILITIES = ['org', 'private'] as const;
export type TaskVisibility = (typeof TASK_VISIBILITIES)[number];

export const TASK_VIEWS = ['all', 'today', 'week', 'overdue', 'future', 'undated'] as const;
export type TaskView = (typeof TASK_VIEWS)[number];

export const RECURRENCE_MODES = ['schedule', 'after_completion'] as const;
export const RECURRENCE_FREQS = ['daily', 'weekly', 'monthly'] as const;
export const RECURRENCE_STATES = ['active', 'paused', 'ended'] as const;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const uuid = z.uuid();

// ---- People ----
export const createPersonSchema = z.object({
  displayName: z.string().trim().min(1).max(200),
  email: z.email().max(320),
  role: z.enum(PERSON_ROLES).nullable(),
  /** Job in the organisation, shown as a tag (e.g. 'מגייס כספים'). Not an access level. */
  jobTitle: z.string().trim().max(100).nullable().default(null),
});
export const updatePersonSchema = createPersonSchema.partial().extend({
  // Explicit: a partial update must never reset the job title through the create-schema default.
  jobTitle: z.string().trim().max(100).nullable().optional(),
  active: z.boolean().optional(),
});

// ---- Tasks ----
export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20_000).default(''),
  ownerPersonId: uuid,
  dueDate: isoDate.nullable().default(null),
  participantIds: z.array(uuid).max(100).default([]),
  categoryId: uuid.nullable().optional(),
  /** Absent = 'org'. */
  visibility: z.enum(TASK_VISIBILITIES).optional(),
});
export const updateTaskSchema = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(20_000).optional(),
  ownerPersonId: uuid.optional(),
  dueDate: isoDate.nullable().optional(),
  categoryId: uuid.nullable().optional(),
  visibility: z.enum(TASK_VISIBILITIES).optional(),
});
export const changeStatusSchema = z.object({
  version: z.number().int().positive(),
  status: z.enum(TASK_STATUSES),
  /** Optional explanation, kept in the task history (e.g. why it is stuck). */
  note: z.string().trim().max(2000).optional(),
});
export const setParticipantsSchema = z.object({
  version: z.number().int().positive(),
  participantIds: z.array(uuid).max(100),
});
export const versionOnlySchema = z.object({ version: z.number().int().positive() });

export const listTasksQuerySchema = z.object({
  view: z.enum(TASK_VIEWS).default('all'),
  mine: z.coerce.boolean().default(false),
  ownerPersonId: uuid.optional(),
  /** Tasks a person is involved in (owner or participant) — the personal page. */
  personId: uuid.optional(),
  /** Free-text search in title and description. */
  q: z.string().trim().max(100).optional(),
  /** A category id, or "none" for tasks without a category. */
  categoryId: z.union([uuid, z.literal('none')]).optional(),
  status: z.enum(TASK_STATUSES).optional(),
  includeArchived: z.coerce.boolean().default(false),
});

// ---- Recurrence ----
const recurrenceRuleFields = {
  freq: z.enum(RECURRENCE_FREQS),
  interval: z.number().int().min(1).max(365).default(1),
  /** 0 = Sunday … 6 = Saturday. Required for weekly schedule mode. */
  byWeekday: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  /** Day of month for monthly schedule mode; clamped to month length. */
  byMonthDay: z.number().int().min(1).max(31).nullable().default(null),
};
export const createRecurrenceSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20_000).default(''),
  ownerPersonId: uuid,
  participantIds: z.array(uuid).max(100).default([]),
  categoryId: uuid.nullable().optional(),
  mode: z.enum(RECURRENCE_MODES),
  startDate: isoDate,
  endDate: isoDate.nullable().default(null),
  ...recurrenceRuleFields,
});
export const updateRecurrenceSchema = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(20_000).optional(),
  ownerPersonId: uuid.optional(),
  participantIds: z.array(uuid).max(100).optional(),
  categoryId: uuid.nullable().optional(),
  endDate: isoDate.nullable().optional(),
});

// ---- Documents (Phase 2) ----
export const DOCUMENT_KINDS = ['google_doc', 'google_sheet', 'link'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const addDocumentSchema = z.union([
  z.object({ googleFileId: z.string().min(10).max(200), categoryId: uuid.nullable().default(null), taskId: uuid.optional() }),
  z.object({
    url: z.url().max(2000),
    title: z.string().trim().min(1).max(300).optional(),
    categoryId: uuid.nullable().default(null),
    taskId: uuid.optional(),
  }),
]);
export const updateDocumentSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  categoryId: uuid.nullable().optional(),
  archived: z.boolean().optional(),
});
export const categorySchema = z.object({ name: z.string().trim().min(1).max(100) });
export const linkDocumentSchema = z.object({ documentId: uuid });

export interface DocumentDto {
  id: string;
  kind: DocumentKind;
  title: string;
  url: string;
  googleFileId: string | null;
  categoryId: string | null;
  taskIds: string[];
  createdAt: string;
  archivedAt: string | null;
}
export interface CategoryDto {
  id: string;
  name: string;
}

// ---- Sheet import (Phase 2) ----
/** A table read from an uploaded file or a Google Sheet, before any mapping. */
export interface SourceTable {
  name: string;
  rows: string[][];
}
export interface ImportPreviewDto {
  sourceName: string;
  googleFileId: string | null;
  googleFileKind: 'google_sheet' | 'google_doc' | null;
  tables: SourceTable[];
  truncated: boolean;
}
export const importPreviewGoogleSchema = z.object({ googleFileId: z.string().min(10).max(200) });
export const importPreviewLinkSchema = z.object({ url: z.url().max(2000) });

/** One reviewed row, already mapped by the manager. The server validates everything again. */
export const importRowSchema = z.object({
  sourceRow: z.number().int().min(1),
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20_000).default(''),
  ownerPersonId: uuid,
  dueDate: isoDate.nullable().default(null),
  status: z.enum(TASK_STATUSES).default('new'),
  participantIds: z.array(uuid).max(100).default([]),
  categoryId: uuid.nullable().optional(),
});
export const commitImportSchema = z.object({
  sourceName: z.string().trim().min(1).max(300),
  sheetName: z.string().max(300).default(''),
  googleFileId: z.string().min(10).max(200).nullable().default(null),
  /** Kind of the Google source file, recorded as the import's source document. */
  googleFileKind: z.enum(['google_sheet', 'google_doc']).default('google_sheet'),
  categoryId: uuid.nullable().default(null),
  rows: z.array(importRowSchema).min(1).max(2000),
});
export interface ImportResultDto {
  importId: string;
  created: number;
  documentId: string | null;
}

/** Lenient date reader for spreadsheet cells: 25/09/2026, 25.9.26, 2026-09-25. Day comes first. */
export function parseLooseDate(input: string): string | null {
  const s = input.trim();
  if (!s) return null;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  let y: number, mo: number, d: number;
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else {
    m = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(s);
    if (!m) return null;
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (y < 100) y += 2000;
  }
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date.toISOString().slice(0, 10);
}

/** Cell values that usually mean "done" in hand-kept sheets. */
export function looksDone(input: string): boolean {
  return /^(v|✓|✔|☑|x|true|yes|done|כן|בוצע|הושלם|הושלמה|סיום|נעשה|גמור)$/i.test(input.trim());
}

// ---- Google connection ----
export interface GoogleStatusDto {
  enabled: boolean;
  connected: boolean;
  clientId: string | null;
  apiKey: string | null;
  appId: string | null;
}
export const googleConnectSchema = z.object({ code: z.string().min(10) });

// ---- Chat & inbox ----
/** A message in the general chat (taskId null) or in a task's chat. */
export const postMessageSchema = z.object({
  body: z.string().trim().min(1).max(4000),
  taskId: uuid.nullable().default(null),
  /** People tagged with @ in this message; each gets an inbox notification. */
  mentionIds: z.array(uuid).max(50).default([]),
});
export const listMessagesQuerySchema = z.object({
  taskId: uuid.optional(),
  /** Only messages newer than this id (polling). */
  after: z.coerce.number().int().min(0).optional(),
  /** Only messages older than this id (loading history). */
  before: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export interface MessageDto {
  id: number;
  taskId: string | null;
  authorPersonId: string;
  body: string;
  mentionIds: string[];
  createdAt: string;
  deleted: boolean;
  canDelete: boolean;
}

export const INBOX_KINDS = ['mention', 'task_assigned', 'feedback'] as const;
export type InboxKind = (typeof INBOX_KINDS)[number];
export interface InboxItemDto {
  id: number;
  kind: InboxKind;
  actorPersonId: string | null;
  taskId: string | null;
  taskTitle: string | null;
  taskDueDate: string | null;
  messageId: number | null;
  /** Start of the message that mentioned the person. */
  excerpt: string | null;
  createdAt: string;
  read: boolean;
}
export const markReadSchema = z.union([z.object({ ids: z.array(z.number().int()).min(1).max(200) }), z.object({ all: z.literal(true) })]);

// ---- Profiles, score, feedback ----
export const AVATAR_COLORS = ['#2456c9', '#0f8a6a', '#b4531d', '#8a3fb8', '#c2185b', '#00838f', '#6d7a12', '#a33a3a', '#3f51b5', '#5d6b7a'] as const;
/** Stable default colour per person, so everyone looks different before choosing one. */
export function defaultAvatarColor(id: string): string {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length]!;
}
export const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'expected #RRGGBB');

/** Fields a person may edit on their own profile (managers may edit anyone's). */
export const taskCategorySchema = z.object({ name: z.string().trim().min(1).max(60), color: hexColor });
export interface TaskCategoryDto {
  id: string;
  name: string;
  color: string;
}

export const updateProfileSchema = z.object({
  avatarColor: hexColor.nullable().optional(),
  /** What this person is responsible for in the organisation, in their own words. */
  responsibilities: z.string().trim().max(2000).nullable().optional(),
});
/** A square image, already resized in the browser, as a data URL. */
export const uploadAvatarSchema = z.object({ dataUrl: z.string().max(500_000) });

export const postFeedbackSchema = z.object({ body: z.string().trim().min(1).max(2000) });

export interface FeedbackDto {
  id: number;
  authorPersonId: string;
  body: string;
  createdAt: string;
  canDelete: boolean;
}
/**
 * Automatic score: share of the person's tasks finished by their due date over the last `windowDays`,
 * counting open tasks that are already overdue as late. Null until there are `minSample` tasks.
 */
export interface PerformanceScoreDto {
  value: number | null;
  completedOnTime: number;
  completedLate: number;
  openOverdue: number;
  completedWithoutDueDate: number;
  windowDays: number;
  minSample: number;
}
export interface ProfileDto {
  person: PersonDto;
  score: PerformanceScoreDto;
  feedback: FeedbackDto[];
  canEditProfile: boolean;
  canGiveFeedback: boolean;
}

// ---- Organisation settings ----
export const updateOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  /** Local hour at which date reminders are sent. */
  reminderHour: z.number().int().min(0).max(23).optional(),
  /** Days before the due date for the "due soon" reminder; 0 turns it off. */
  dueSoonDays: z.number().int().min(0).max(14).optional(),
});
export interface OrganizationDto {
  id: string;
  name: string;
  timezone: string;
  reminderHour: number;
  dueSoonDays: number;
}

// ---- Auth ----
export const googleLoginSchema = z.object({ credential: z.string().min(10) });
export const devLoginSchema = z.object({ email: z.email() });

// ---- Response DTOs (shapes only) ----
export interface PersonDto {
  id: string;
  displayName: string;
  email: string;
  role: PersonRole;
  jobTitle: string | null;
  active: boolean;
  hasLogin: boolean;
  /** Profile colour (#RRGGBB); a default from AVATAR_COLORS when not chosen. */
  avatarColor: string;
  /** Cache-busting version of the uploaded photo, or null when there is none. */
  avatarVersion: number | null;
  responsibilities: string | null;
}
export interface TaskDto {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  ownerPersonId: string;
  dueDate: string | null;
  categoryId: string | null;
  visibility: TaskVisibility;
  createdByPersonId: string | null;
  recurrenceDefinitionId: string | null;
  occurrenceDate: string | null;
  participantIds: string[];
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  archivedAt: string | null;
  version: number;
  isOverdue: boolean;
}
export interface AuditEventDto {
  id: number;
  type: string;
  actorPersonId: string | null;
  actorType: 'person' | 'system';
  data: Record<string, unknown>;
  createdAt: string;
}
export interface TaskDetailDto extends TaskDto {
  allowedStatuses: TaskStatus[];
  canEdit: boolean;
  canDelete: boolean;
  events: AuditEventDto[];
  /** Display names of everyone referenced by this task and its history. */
  names: Record<string, string>;
  jobTitles: Record<string, string>;
  documents: DocumentDto[];
}
export interface RecurrenceDto {
  id: string;
  title: string;
  description: string;
  ownerPersonId: string;
  participantIds: string[];
  categoryId: string | null;
  mode: (typeof RECURRENCE_MODES)[number];
  freq: (typeof RECURRENCE_FREQS)[number];
  interval: number;
  byWeekday: number[];
  byMonthDay: number | null;
  startDate: string;
  endDate: string | null;
  state: (typeof RECURRENCE_STATES)[number];
  nextOccurrenceDate: string | null;
  version: number;
}
export interface MeDto {
  personId: string;
  displayName: string;
  email: string;
  access: 'manager' | 'member' | 'guest' | 'link';
  scopeTaskId: string | null;
  organization: { id: string; name: string; timezone: string };
}
export interface ApiErrorDto {
  error: { code: string; message: string; details?: unknown };
}
