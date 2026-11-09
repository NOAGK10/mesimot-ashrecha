import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTaskSchema } from '@org/shared';
import { createTask, updateTask } from '../modules/tasks/task-service';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const base = { description: '', participantIds: [] as string[] };

describe('time of day and "done" when creating a task', () => {
  it('keeps an optional time with the date, and drops it when the date is cleared', async () => {
    const t = await createTask(h.ctx, h.manager, { ...base, title: 'פגישה', ownerPersonId: h.manager.personId, dueDate: '2026-10-08', dueTime: '14:30' });
    expect(t).toMatchObject({ dueDate: '2026-10-08', dueTime: '14:30', status: 'new' });
    const moved = await updateTask(h.ctx, h.manager, t.id, { version: t.version, dueTime: '09:00' });
    expect(moved.dueTime).toBe('09:00');
    const cleared = await updateTask(h.ctx, h.manager, t.id, { version: moved.version, dueDate: null });
    expect(cleared).toMatchObject({ dueDate: null, dueTime: null });
  });

  it('ignores a time without a date, and rejects a malformed time', async () => {
    const t = await createTask(h.ctx, h.manager, { ...base, title: 'בלי תאריך', ownerPersonId: h.manager.personId, dueDate: null, dueTime: '10:00' });
    expect(t.dueTime).toBeNull();
    expect(createTaskSchema.safeParse({ title: 'x', ownerPersonId: h.manager.personId, dueTime: '25:00' }).success).toBe(false);
    expect(createTaskSchema.safeParse({ title: 'x', ownerPersonId: h.manager.personId, dueTime: '14:30' }).success).toBe(true);
    expect(createTaskSchema.safeParse({ title: 'x', ownerPersonId: h.manager.personId, dueTime: '09:05' }).success).toBe(true);
  });

  it('can be created already done', async () => {
    const t = await createTask(h.ctx, h.manager, { ...base, title: 'טופל', ownerPersonId: h.manager.personId, dueDate: '2026-10-04', done: true });
    expect(t.status).toBe('completed');
    expect(t.completedAt).not.toBeNull();
    expect(t.isOverdue).toBe(false);
  });
});
