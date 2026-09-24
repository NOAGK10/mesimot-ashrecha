import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { auditEvents, notifications, tasks } from '../db/schema';
import { changeStatus, createTask, getTaskDetail, listTasks, setArchived, setParticipants, updateTask } from '../modules/tasks/task-service';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const base = { description: '', participantIds: [] as string[] };

describe('task management', () => {
  it('creates a task with audit trail, assignment notice and reminders in one transaction', async () => {
    const task = await createTask(h.ctx, h.manager, { ...base, title: 'Report', ownerPersonId: h.partner.personId, dueDate: '2026-10-08', participantIds: [h.contactId] });
    expect(task.status).toBe('new');
    expect(task.participantIds).toEqual([h.contactId]);

    const events = await h.ctx.db.select().from(auditEvents).where(eq(auditEvents.entityId, task.id));
    expect(events.map((e) => e.type)).toEqual(['task.created']);
    expect(events[0]!.actorPersonId).toBe(h.manager.personId);

    const notes = await h.ctx.db.select().from(notifications).where(eq(notifications.taskId, task.id));
    const kinds = notes.map((n) => `${n.kind}:${n.personId === h.contactId ? 'contact' : 'partner'}`).sort();
    expect(kinds).toEqual([
      'assigned:contact', 'assigned:partner',
      'due_soon:contact', 'due_soon:partner',
      'due_today:contact', 'due_today:partner',
      'overdue:contact', 'overdue:partner',
    ]);
  });

  it('never leaves a partially created task when validation fails inside the transaction', async () => {
    const before = await h.ctx.db.select().from(tasks);
    await expect(
      createTask(h.ctx, h.manager, { ...base, title: 'Bad', ownerPersonId: h.manager.personId, dueDate: null, participantIds: ['00000000-0000-4000-8000-000000000000'] }),
    ).rejects.toThrow(/unknown or inactive/);
    expect(await h.ctx.db.select().from(tasks)).toHaveLength(before.length);
  });

  it('enforces the lifecycle and records who changed status', async () => {
    const t = await createTask(h.ctx, h.manager, { ...base, title: 'Lifecycle', ownerPersonId: h.manager.personId, dueDate: null });
    const t2 = await changeStatus(h.ctx, h.manager, t.id, { version: t.version, status: 'completed' });
    expect(t2.completedAt).not.toBeNull();
    await expect(changeStatus(h.ctx, h.manager, t.id, { version: t2.version, status: 'waiting' })).rejects.toThrow(/Cannot move/);
    const t3 = await changeStatus(h.ctx, h.manager, t.id, { version: t2.version, status: 'in_progress' });
    expect(t3.completedAt).toBeNull();
    const detail = await getTaskDetail(h.ctx, h.manager, t.id);
    expect(detail.events.filter((e) => e.type === 'task.status_changed').map((e) => e.data)).toEqual([
      { from: 'new', to: 'completed' },
      { from: 'completed', to: 'in_progress' },
    ]);
  });

  it('rejects stale writes (optimistic concurrency)', async () => {
    const t = await createTask(h.ctx, h.manager, { ...base, title: 'Race', ownerPersonId: h.manager.personId, dueDate: null });
    await updateTask(h.ctx, h.manager, t.id, { version: t.version, title: 'Race 2' });
    await expect(updateTask(h.ctx, h.partner, t.id, { version: t.version, title: 'Race 3' })).rejects.toMatchObject({ code: 'stale_version' });
  });

  it('audits owner and due-date changes and re-plans reminders', async () => {
    const t = await createTask(h.ctx, h.manager, { ...base, title: 'Move', ownerPersonId: h.manager.personId, dueDate: '2026-10-20' });
    const u = await updateTask(h.ctx, h.manager, t.id, { version: t.version, ownerPersonId: h.partner.personId, dueDate: '2026-10-22' });
    const detail = await getTaskDetail(h.ctx, h.manager, u.id);
    expect(detail.events.map((e) => e.type)).toEqual(['task.created', 'task.due_date_changed', 'task.owner_changed']);
    const pending = await h.ctx.db.select().from(notifications).where(eq(notifications.taskId, t.id));
    const dateReminders = pending.filter((n) => n.kind !== 'assigned');
    expect(new Set(dateReminders.map((n) => n.personId))).toEqual(new Set([h.partner.personId]));
    expect(pending.some((n) => n.kind === 'assigned' && n.personId === h.partner.personId)).toBe(true);
  });

  it('cancels pending reminders when a task is completed or archived', async () => {
    const t = await createTask(h.ctx, h.manager, { ...base, title: 'Close', ownerPersonId: h.partner.personId, dueDate: '2026-10-20' });
    await changeStatus(h.ctx, h.manager, t.id, { version: t.version, status: 'completed' });
    expect(await h.ctx.db.select().from(notifications).where(eq(notifications.taskId, t.id))).toHaveLength(0);
  });

  it('makes archived tasks read-only until unarchived', async () => {
    const t = await createTask(h.ctx, h.manager, { ...base, title: 'Archive me', ownerPersonId: h.manager.personId, dueDate: null });
    const a = await setArchived(h.ctx, h.manager, t.id, t.version, true);
    await expect(updateTask(h.ctx, h.manager, t.id, { version: a.version, title: 'x' })).rejects.toThrow(/read-only/);
    await expect(changeStatus(h.ctx, h.manager, t.id, { version: a.version, status: 'in_progress' })).rejects.toThrow(/Archived/);
    expect((await listTasks(h.ctx, h.manager, { view: 'all', mine: false, includeArchived: false })).some((x) => x.id === t.id)).toBe(false);
    const u = await setArchived(h.ctx, h.manager, t.id, a.version, false);
    expect(u.archivedAt).toBeNull();
  });

  it('limits guests to tasks they are involved in, and to status changes', async () => {
    const mine = await createTask(h.ctx, h.manager, { ...base, title: 'Guest task', ownerPersonId: h.manager.personId, dueDate: null, participantIds: [h.guest.personId] });
    const other = await createTask(h.ctx, h.manager, { ...base, title: 'Not for guest', ownerPersonId: h.manager.personId, dueDate: null });
    const visible = await listTasks(h.ctx, h.guest, { view: 'all', mine: false, includeArchived: false });
    expect(visible.map((t) => t.id)).toEqual([mine.id]);
    await expect(getTaskDetail(h.ctx, h.guest, other.id)).rejects.toMatchObject({ status: 404 });
    await expect(updateTask(h.ctx, h.guest, mine.id, { version: mine.version, title: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(createTask(h.ctx, h.guest, { ...base, title: 'x', ownerPersonId: h.guest.personId, dueDate: null })).rejects.toMatchObject({ status: 403 });
    const moved = await changeStatus(h.ctx, h.guest, mine.id, { version: mine.version, status: 'in_progress' });
    expect(moved.status).toBe('in_progress');
    const removed = await setParticipants(h.ctx, h.manager, mine.id, { version: moved.version, participantIds: [] });
    expect(removed.participantIds).toEqual([]);
    await expect(getTaskDetail(h.ctx, h.guest, mine.id)).rejects.toMatchObject({ status: 404 });
  });

  it('computes Today / This Week / Overdue / Future in the organisation timezone', async () => {
    // T0 = Sunday 2026-10-04 09:00 Jerusalem. Week ends Saturday 2026-10-10.
    const who = h.principal(h.partner.personId);
    const mk = (title: string, dueDate: string | null) => createTask(h.ctx, h.manager, { ...base, title, ownerPersonId: who.personId, dueDate });
    await mk('V-today', '2026-10-04');
    await mk('V-week', '2026-10-09');
    await mk('V-overdue', '2026-10-01');
    await mk('V-future', '2026-10-11');
    await mk('V-undated', null);
    const titles = async (view: 'today' | 'week' | 'overdue' | 'future' | 'undated') =>
      (await listTasks(h.ctx, who, { view, mine: true, includeArchived: false })).map((t) => t.title).filter((t) => t.startsWith('V-'));
    expect(await titles('today')).toEqual(['V-today']);
    expect(await titles('week')).toEqual(['V-today', 'V-week']);
    expect(await titles('overdue')).toEqual(['V-overdue']);
    expect(await titles('future')).toEqual(['V-future']);
    expect(await titles('undated')).toEqual(['V-undated']);
    // 23:30 local on Sunday is still Sunday even though UTC is also Sunday; 00:30 local Monday is Sunday in UTC.
    h.clock.now = new Date('2026-10-04T21:30:00Z'); // 00:30 Monday in Jerusalem
    expect(await titles('today')).toEqual([]);
    expect(await titles('overdue')).toEqual(['V-overdue', 'V-today']);
    h.clock.now = new Date('2026-10-04T06:00:00Z');
  });
});
