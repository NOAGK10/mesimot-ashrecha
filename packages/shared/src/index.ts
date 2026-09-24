// API contracts shared by server and web. Business rules live on the server;
// this package holds only vocabulary and request/response shapes.
import { z } from 'zod';

export const TASK_STATUSES = ['new', 'in_progress', 'waiting', 'completed', 'cancelled'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const OPEN_STATUSES: readonly TaskStatus[] = ['new', 'in_progress', 'waiting'];

export const PERSON_ROLES = ['manager', 'guest'] as const;
/** null role = contact without login (email / magic link only). */
export type PersonRole = (typeof PERSON_ROLES)[number] | null;

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
});
export const updatePersonSchema = createPersonSchema.partial().extend({
  active: z.boolean().optional(),
});

// ---- Tasks ----
export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(300),
  description: z.string().max(20_000).default(''),
  ownerPersonId: uuid,
  dueDate: isoDate.nullable().default(null),
  participantIds: z.array(uuid).max(100).default([]),
});
export const updateTaskSchema = z.object({
  version: z.number().int().positive(),
  title: z.string().trim().min(1).max(300).optional(),
  description: z.string().max(20_000).optional(),
  ownerPersonId: uuid.optional(),
  dueDate: isoDate.nullable().optional(),
});
export const changeStatusSchema = z.object({
  version: z.number().int().positive(),
  status: z.enum(TASK_STATUSES),
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
});
export const commitImportSchema = z.object({
  sourceName: z.string().trim().min(1).max(300),
  sheetName: z.string().max(300).default(''),
  googleFileId: z.string().min(10).max(200).nullable().default(null),
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

// ---- Auth ----
export const googleLoginSchema = z.object({ credential: z.string().min(10) });
export const devLoginSchema = z.object({ email: z.email() });

// ---- Response DTOs (shapes only) ----
export interface PersonDto {
  id: string;
  displayName: string;
  email: string;
  role: PersonRole;
  active: boolean;
  hasLogin: boolean;
}
export interface TaskDto {
  id: string;
  title: string;
  description: string;
  status: TaskStatus;
  ownerPersonId: string;
  dueDate: string | null;
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
  events: AuditEventDto[];
  /** Display names of everyone referenced by this task and its history. */
  names: Record<string, string>;
  documents: DocumentDto[];
}
export interface RecurrenceDto {
  id: string;
  title: string;
  description: string;
  ownerPersonId: string;
  participantIds: string[];
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
  access: 'manager' | 'guest' | 'link';
  scopeTaskId: string | null;
  organization: { id: string; name: string; timezone: string };
}
export interface ApiErrorDto {
  error: { code: string; message: string; details?: unknown };
}
