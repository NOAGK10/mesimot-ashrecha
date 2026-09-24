import { asc, eq } from 'drizzle-orm';
import type { AppContext } from './context';
import { organizations, people } from './db/schema';
import { addDays, todayIn } from './lib/dates';
import { createPerson } from './modules/identity/people-service';
import type { Principal } from './modules/identity/principal';
import { createRecurrence } from './modules/recurrence/recurrence-service';
import { createTask } from './modules/tasks/task-service';

/**
 * Creates the organisation and its first managers (there is no self-registration).
 * Safe to run repeatedly: does nothing once an organisation exists.
 */
export async function bootstrapOrganization(ctx: AppContext, orgName: string, managerEmails: string[]): Promise<string> {
  const [existing] = await ctx.db.select().from(organizations).limit(1);
  if (existing) return existing.id;
  if (managerEmails.length === 0) throw new Error('Set BOOTSTRAP_MANAGER_EMAILS to create the first managers');
  return ctx.db.transaction(async (tx) => {
    const [org] = await tx.insert(organizations).values({ name: orgName }).returning();
    await tx.insert(people).values(
      managerEmails.map((email) => ({ orgId: org!.id, email: email.toLowerCase(), displayName: email.split('@')[0]!, role: 'manager' as const })),
    );
    return org!.id;
  });
}

/** Sample data for local development. */
export async function seedDemo(ctx: AppContext, orgId: string): Promise<void> {
  const [manager] = await ctx.db.select().from(people).where(eq(people.orgId, orgId)).orderBy(asc(people.createdAt)).limit(1);
  const as: Principal = { personId: manager!.id, orgId, access: 'manager', scopeTaskId: null, via: 'session' };
  const today = todayIn('Asia/Jerusalem', ctx.now());

  const dana = await createPerson(ctx, as, { displayName: 'דנה לוי', email: 'dana@example.org', role: 'guest' });
  const yossi = await createPerson(ctx, as, { displayName: 'יוסי כהן (ללא חשבון)', email: 'yossi@example.org', role: null });

  await createTask(ctx, as, { title: 'להכין דוח רבעוני', description: 'סיכום פעילות הרבעון להנהלה', ownerPersonId: manager!.id, dueDate: today, participantIds: [dana.id] });
  await createTask(ctx, as, { title: 'לחדש ביטוח משרד', description: '', ownerPersonId: manager!.id, dueDate: addDays(today, -2), participantIds: [] });
  await createTask(ctx, as, { title: 'לתאם פגישת צוות', description: '', ownerPersonId: dana.id, dueDate: addDays(today, 3), participantIds: [yossi.id] });
  await createTask(ctx, as, { title: 'לבדוק הצעות מחיר לספקים', description: '', ownerPersonId: yossi.id, dueDate: addDays(today, 20), participantIds: [] });
  await createTask(ctx, as, { title: 'לעדכן את רשימת אנשי הקשר', description: '', ownerPersonId: dana.id, dueDate: null, participantIds: [] });
  await createRecurrence(ctx, as, { title: 'דוח שבועי', description: '', ownerPersonId: manager!.id, participantIds: [], mode: 'schedule', freq: 'weekly', interval: 1, byWeekday: [0], byMonthDay: null, startDate: today, endDate: null });
  await createRecurrence(ctx, as, { title: 'גיבוי קבצים', description: 'חודש אחרי הגיבוי הקודם', ownerPersonId: dana.id, participantIds: [], mode: 'after_completion', freq: 'monthly', interval: 1, byWeekday: [], byMonthDay: null, startDate: addDays(today, 1), endDate: null });
}
