import { and, desc, eq, gte, inArray, isNull, lt, sql } from 'drizzle-orm';
import { DateTime } from 'luxon';
import type { z } from 'zod';
import type { FeedbackDto, PerformanceScoreDto, ProfileDto, updateProfileSchema } from '@org/shared';
import { OPEN_STATUSES } from '@org/shared';
import type { AppContext } from '../../context';
import { people, personAvatars, personFeedback, tasks } from '../../db/schema';
import { todayIn } from '../../lib/dates';
import { AppError, forbidden, invalid, notFound } from '../../lib/errors';
import { getOrg } from '../identity/org';
import { toPersonDto } from '../identity/people-service';
import { policy } from '../identity/policy';
import type { Principal } from '../identity/principal';
import { addInboxItems } from '../inbox/inbox-service';

/**
 * Profiles (APPROVED, docs/DECISIONS.md C-19..C-21): photo or colour, responsibilities, an automatic
 * performance score and signed feedback. Visible to everyone who signs in.
 */

const WINDOW_DAYS = 180;
const MIN_SAMPLE = 3;
const MAX_AVATAR_BYTES = 300 * 1024;

function requireSignedIn(p: Principal) {
  if (p.access === 'link') throw forbidden('Profiles are available to signed-in users');
}

async function loadPerson(ctx: AppContext, p: Principal, id: string) {
  const [row] = await ctx.db
    .select({ person: people, avatarAt: personAvatars.updatedAt })
    .from(people)
    .leftJoin(personAvatars, eq(personAvatars.personId, people.id))
    .where(eq(people.id, id));
  if (!row || row.person.orgId !== p.orgId) throw notFound('Person');
  return row;
}

const canEditProfile = (p: Principal, personId: string) => p.personId === personId || policy.isManager(p);

/**
 * Share of the person's own tasks finished by their due date over the last WINDOW_DAYS.
 * Open tasks that are already overdue count as late; tasks without a due date are not scored.
 */
export async function performanceScore(ctx: AppContext, orgId: string, personId: string): Promise<PerformanceScoreDto> {
  const org = await getOrg(ctx.db, orgId);
  const now = ctx.now();
  const today = todayIn(org.timezone, now);
  const since = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
  const owned = and(eq(tasks.orgId, orgId), eq(tasks.ownerPersonId, personId), isNull(tasks.archivedAt));

  const completed = await ctx.db
    .select({ dueDate: tasks.dueDate, completedAt: tasks.completedAt })
    .from(tasks)
    .where(and(owned, eq(tasks.status, 'completed'), gte(tasks.completedAt, since)));
  const [overdue] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(owned, inArray(tasks.status, [...OPEN_STATUSES]), lt(tasks.dueDate, today)));

  let onTime = 0;
  let late = 0;
  let noDue = 0;
  for (const t of completed) {
    if (!t.dueDate || !t.completedAt) {
      noDue++;
      continue;
    }
    const doneOn = DateTime.fromJSDate(t.completedAt, { zone: org.timezone }).toISODate()!;
    if (doneOn <= t.dueDate) onTime++;
    else late++;
  }
  const openOverdue = overdue?.n ?? 0;
  const sample = onTime + late + openOverdue;
  return {
    value: sample >= MIN_SAMPLE ? Math.round((100 * onTime) / sample) : null,
    completedOnTime: onTime,
    completedLate: late,
    openOverdue,
    completedWithoutDueDate: noDue,
    windowDays: WINDOW_DAYS,
    minSample: MIN_SAMPLE,
  };
}

async function listFeedback(ctx: AppContext, p: Principal, subjectId: string): Promise<FeedbackDto[]> {
  const rows = await ctx.db
    .select()
    .from(personFeedback)
    .where(and(eq(personFeedback.subjectPersonId, subjectId), isNull(personFeedback.deletedAt)))
    .orderBy(desc(personFeedback.id))
    .limit(100);
  return rows.map((f) => ({
    id: f.id,
    authorPersonId: f.authorPersonId,
    body: f.body,
    createdAt: f.createdAt.toISOString(),
    canDelete: f.authorPersonId === p.personId || policy.isManager(p),
  }));
}

export async function getProfile(ctx: AppContext, p: Principal, id: string): Promise<ProfileDto> {
  requireSignedIn(p);
  const { person, avatarAt } = await loadPerson(ctx, p, id);
  return {
    person: toPersonDto(person, policy.canManagePeople(p) || p.personId === id, avatarAt),
    score: await performanceScore(ctx, p.orgId, id),
    feedback: await listFeedback(ctx, p, id),
    canEditProfile: canEditProfile(p, id),
    canGiveFeedback: p.personId !== id && person.role !== null && person.deactivatedAt === null,
  };
}

export async function updateProfile(ctx: AppContext, p: Principal, id: string, input: z.output<typeof updateProfileSchema>): Promise<void> {
  requireSignedIn(p);
  await loadPerson(ctx, p, id);
  if (!canEditProfile(p, id)) throw forbidden();
  const patch: Partial<typeof people.$inferInsert> = {};
  if (input.avatarColor !== undefined) patch.avatarColor = input.avatarColor;
  if (input.responsibilities !== undefined) patch.responsibilities = input.responsibilities || null;
  if (Object.keys(patch).length) await ctx.db.update(people).set(patch).where(eq(people.id, id));
}

/** Recognises the image type from its first bytes, so a renamed file cannot pass as an image. */
function sniffImage(data: Buffer): string | null {
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return 'image/jpeg';
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (data.subarray(0, 4).toString('ascii') === 'RIFF' && data.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export async function setAvatar(ctx: AppContext, p: Principal, id: string, dataUrl: string): Promise<void> {
  requireSignedIn(p);
  await loadPerson(ctx, p, id);
  if (!canEditProfile(p, id)) throw forbidden();
  const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) throw invalid('Expected a JPEG, PNG or WebP image');
  const data = Buffer.from(m[1]!, 'base64');
  if (data.length > MAX_AVATAR_BYTES) throw invalid('The image is too large');
  const mimeType = sniffImage(data);
  if (!mimeType) throw invalid('The file is not a valid image');
  const row = { personId: id, mimeType, dataBase64: data.toString('base64'), updatedAt: ctx.now() };
  await ctx.db.insert(personAvatars).values(row).onConflictDoUpdate({ target: personAvatars.personId, set: row });
}

export async function deleteAvatar(ctx: AppContext, p: Principal, id: string): Promise<void> {
  requireSignedIn(p);
  await loadPerson(ctx, p, id);
  if (!canEditProfile(p, id)) throw forbidden();
  await ctx.db.delete(personAvatars).where(eq(personAvatars.personId, id));
}

export async function getAvatar(ctx: AppContext, p: Principal, id: string): Promise<{ mimeType: string; data: Buffer }> {
  const [row] = await ctx.db
    .select({ avatar: personAvatars, orgId: people.orgId })
    .from(personAvatars)
    .innerJoin(people, eq(people.id, personAvatars.personId))
    .where(eq(personAvatars.personId, id));
  if (!row || row.orgId !== p.orgId) throw notFound('Avatar');
  return { mimeType: row.avatar.mimeType, data: Buffer.from(row.avatar.dataBase64, 'base64') };
}

/** Everyone who signs in may give signed feedback to anyone else who signs in (not to themselves). */
export async function addFeedback(ctx: AppContext, p: Principal, subjectId: string, body: string): Promise<FeedbackDto> {
  requireSignedIn(p);
  const { person } = await loadPerson(ctx, p, subjectId);
  if (subjectId === p.personId) throw invalid('You cannot give feedback to yourself');
  if (person.role === null || person.deactivatedAt) throw new AppError(400, 'invalid', 'Feedback is for active site users');
  return ctx.db.transaction(async (tx) => {
    const [f] = await tx
      .insert(personFeedback)
      .values({ orgId: p.orgId, subjectPersonId: subjectId, authorPersonId: p.personId, body, createdAt: ctx.now() })
      .returning();
    await addInboxItems(tx, [{ orgId: p.orgId, personId: subjectId, kind: 'feedback', actorPersonId: p.personId, feedbackId: f!.id, createdAt: ctx.now() }]);
    return { id: f!.id, authorPersonId: f!.authorPersonId, body: f!.body, createdAt: f!.createdAt.toISOString(), canDelete: true };
  });
}

/** Authors may withdraw their feedback; managers may remove any (moderation). */
export async function deleteFeedback(ctx: AppContext, p: Principal, id: number): Promise<void> {
  requireSignedIn(p);
  const [f] = await ctx.db.select().from(personFeedback).where(eq(personFeedback.id, id));
  if (!f || f.orgId !== p.orgId) throw notFound('Feedback');
  if (f.authorPersonId !== p.personId && !policy.isManager(p)) throw forbidden();
  await ctx.db.update(personFeedback).set({ deletedAt: ctx.now(), deletedByPersonId: p.personId }).where(eq(personFeedback.id, id));
}
