import { and, eq, inArray, isNull, like, ne } from 'drizzle-orm';
import type { AppContext } from '../../context';
import {
  auditEvents,
  calls,
  financeEntries,
  institutions,
  sheetContacts,
  contactCategories,
  campaigns,
  distributionPoints,
  sheetSources,
  organizations,
  chatReads,
  documentCategories,
  documents,
  googleConnections,
  magicLinks,
  people,
  personFeedback,
  recurrenceDefinitions,
  sessions,
  taskCategories,
  taskImports,
  tasks,
} from '../../db/schema';
import { forbidden, invalid } from '../../lib/errors';
import { recordAudit } from '../audit/audit';
import { policy } from '../identity/policy';
import { actorOf, type Principal } from '../identity/principal';

/** The word a manager types to confirm. */
export const RESET_CONFIRMATION = 'מחיקה';

export interface ResetResult {
  tasks: number;
  recurrences: number;
  categories: number;
  documents: number;
  feedback: number;
  calls: number;
  financeEntries: number;
  people: number;
}

/**
 * Starts the organisation over while keeping the chat: deletes every task (with its history,
 * notifications and task conversations), recurring task, task category, document, profile
 * "responsible for" text and feedback, and removes everyone except the manager doing it.
 * The general chat and private conversations stay; removed people's messages keep their name.
 * All in one transaction – either everything is deleted or nothing is.
 */
export async function resetContent(ctx: AppContext, p: Principal, confirmation: string): Promise<ResetResult> {
  if (!policy.isManager(p)) throw forbidden();
  if (confirmation.trim() !== RESET_CONFIRMATION) throw invalid(`Type "${RESET_CONFIRMATION}" to confirm`);
  const now = ctx.now();
  const org = p.orgId;

  return ctx.db.transaction(async (tx) => {
    const taskIds = (await tx.select({ id: tasks.id }).from(tasks).where(eq(tasks.orgId, org))).map((t) => t.id);
    if (taskIds.length) {
      // Rows that point at tasks without cascading.
      await tx.delete(sessions).where(inArray(sessions.scopeTaskId, taskIds));
      await tx.delete(magicLinks).where(inArray(magicLinks.taskId, taskIds));
    }
    // Cascades: participants, notifications, task conversations, inbox items, document links, import rows.
    const deletedTasks = await tx.delete(tasks).where(eq(tasks.orgId, org)).returning({ id: tasks.id });
    await tx.delete(chatReads).where(and(eq(chatReads.orgId, org), like(chatReads.channelKey, 'task:%')));

    // Their participants cascade.
    const deletedRecs = await tx.delete(recurrenceDefinitions).where(eq(recurrenceDefinitions.orgId, org)).returning({ id: recurrenceDefinitions.id });

    const deletedCats = await tx.delete(taskCategories).where(eq(taskCategories.orgId, org)).returning({ id: taskCategories.id });

    await tx.delete(taskImports).where(eq(taskImports.orgId, org));
    const deletedDocs = await tx.delete(documents).where(eq(documents.orgId, org)).returning({ id: documents.id });
    await tx.delete(documentCategories).where(eq(documentCategories.orgId, org));

    const deletedCalls = await tx.delete(calls).where(eq(calls.orgId, org)).returning({ id: calls.id });
    const deletedFinance = await tx.delete(financeEntries).where(eq(financeEntries.orgId, org)).returning({ id: financeEntries.id });
    await tx.update(organizations).set({ financeOpeningAgorot: 0 }).where(eq(organizations.id, org));
    // The institutions list and its sheet link (the sheet itself is not touched).
    await tx.delete(institutions).where(eq(institutions.orgId, org));
    await tx.delete(sheetContacts).where(eq(sheetContacts.orgId, org));
    await tx.delete(contactCategories).where(eq(contactCategories.orgId, org)); // members cascade
    await tx.delete(campaigns).where(eq(campaigns.orgId, org)); // items and stored files cascade
    await tx.delete(distributionPoints).where(eq(distributionPoints.orgId, org));
    await tx.delete(sheetSources).where(eq(sheetSources.orgId, org));
    await tx
      .update(organizations)
      .set({
        institutionsSheetId: null,
        institutionsSheetBy: null,
        institutionsSyncedAt: null,
        institutionsSyncError: null,
        institutionsUnmatched: null,
        contactsSheetId: null,
        contactsSheetBy: null,
        contactsSyncedAt: null,
        contactsSyncError: null,
        contactsUnmatched: null,
      })
      .where(eq(organizations.id, org));

    // Profiles: feedback (its notifications and inbox items cascade) and "responsible for".
    const deletedFeedback = await tx.delete(personFeedback).where(eq(personFeedback.orgId, org)).returning({ id: personFeedback.id });
    await tx.update(people).set({ responsibilities: null }).where(eq(people.orgId, org));

    // Everyone except the manager doing this: removed the same way as "delete person" – hidden, cannot sign in.
    const others = await tx
      .update(people)
      .set({ deletedAt: now, deactivatedAt: now })
      .where(and(eq(people.orgId, org), ne(people.id, p.personId), isNull(people.deletedAt)))
      .returning({ id: people.id });
    const otherIds = others.map((o) => o.id);
    if (otherIds.length) {
      await tx.update(sessions).set({ revokedAt: now }).where(and(inArray(sessions.personId, otherIds), isNull(sessions.revokedAt)));
      await tx.delete(googleConnections).where(inArray(googleConnections.personId, otherIds));
    }

    // The history of what was deleted goes too; one entry records the reset itself.
    await tx.delete(auditEvents).where(and(eq(auditEvents.orgId, org), inArray(auditEvents.entityType, ['task', 'recurrence', 'document'])));
    const result: ResetResult = {
      tasks: deletedTasks.length,
      recurrences: deletedRecs.length,
      categories: deletedCats.length,
      documents: deletedDocs.length,
      feedback: deletedFeedback.length,
      calls: deletedCalls.length,
      financeEntries: deletedFinance.length,
      people: otherIds.length,
    };
    await recordAudit(tx, { orgId: org, entityType: 'organization', entityId: org, type: 'org.content_reset', actor: actorOf(p), data: { ...result } });
    return result;
  });
}
