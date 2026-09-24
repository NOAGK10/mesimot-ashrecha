import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import { tasks } from '../db/schema';
import { createRecurrence, generateDueOccurrences, listRecurrences, setRecurrenceState } from '../modules/recurrence/recurrence-service';
import { changeStatus, listTasks } from '../modules/tasks/task-service';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const occurrences = (definitionId: string) =>
  h.ctx.db.select().from(tasks).where(eq(tasks.recurrenceDefinitionId, definitionId)).orderBy(asc(tasks.occurrenceDate));

const common = { description: '', participantIds: [] as string[], interval: 1, byMonthDay: null, endDate: null };

describe('recurrence', () => {
  it('schedule mode generates occurrences within the horizon, idempotently', async () => {
    const def = await createRecurrence(h.ctx, h.manager, { ...common, title: 'Weekly report', ownerPersonId: h.manager.personId, mode: 'schedule', freq: 'weekly', byWeekday: [0, 3], startDate: '2026-10-04' });
    // Horizon = today + 7 days → Sun 4, Wed 7, Sun 11.
    expect((await occurrences(def.id)).map((t) => t.occurrenceDate)).toEqual(['2026-10-04', '2026-10-07', '2026-10-11']);

    await generateDueOccurrences(h.ctx);
    await generateDueOccurrences(h.ctx);
    expect(await occurrences(def.id)).toHaveLength(3);

    h.clock.now = new Date('2026-10-08T06:00:00Z');
    await generateDueOccurrences(h.ctx);
    expect((await occurrences(def.id)).map((t) => t.occurrenceDate)).toEqual(['2026-10-04', '2026-10-07', '2026-10-11', '2026-10-14']);
    h.clock.now = new Date('2026-10-04T06:00:00Z');
  });

  it('keeps definitions out of task lists; only occurrences appear', async () => {
    const all = await listTasks(h.ctx, h.manager, { view: 'all', mine: false, includeArchived: false });
    expect(all.every((t) => t.recurrenceDefinitionId === null || t.occurrenceDate !== null)).toBe(true);
  });

  it('a missed occurrence stays open and becomes overdue', async () => {
    h.clock.now = new Date('2026-10-06T06:00:00Z');
    const overdue = await listTasks(h.ctx, h.manager, { view: 'overdue', mine: false, includeArchived: false });
    expect(overdue.some((t) => t.title === 'Weekly report' && t.occurrenceDate === '2026-10-04')).toBe(true);
    h.clock.now = new Date('2026-10-04T06:00:00Z');
  });

  it('after-completion mode creates the next occurrence only when the latest one is completed', async () => {
    const def = await createRecurrence(h.ctx, h.manager, { ...common, title: 'Backup', ownerPersonId: h.partner.personId, mode: 'after_completion', freq: 'weekly', byWeekday: [], startDate: '2026-10-05' });
    let occ = await occurrences(def.id);
    expect(occ.map((t) => t.dueDate)).toEqual(['2026-10-05']);

    // Completed on Thursday 8 Oct → next due Thursday 15 Oct.
    h.clock.now = new Date('2026-10-08T10:00:00Z');
    const done = await changeStatus(h.ctx, h.manager, occ[0]!.id, { version: occ[0]!.version, status: 'completed' });
    occ = await occurrences(def.id);
    expect(occ.map((t) => t.dueDate)).toEqual(['2026-10-05', '2026-10-15']);

    // Reopen and complete again must not create a duplicate.
    const reopened = await changeStatus(h.ctx, h.manager, done.id, { version: done.version, status: 'in_progress' });
    await changeStatus(h.ctx, h.manager, done.id, { version: reopened.version, status: 'completed' });
    expect(await occurrences(def.id)).toHaveLength(2);
    h.clock.now = new Date('2026-10-04T06:00:00Z');
  });

  it('pause stops generation; resume skips dates that fell inside the pause', async () => {
    const def = await createRecurrence(h.ctx, h.manager, { ...common, title: 'Daily check', ownerPersonId: h.manager.personId, mode: 'schedule', freq: 'daily', byWeekday: [], startDate: '2026-10-04' });
    expect(await occurrences(def.id)).toHaveLength(8); // 4..11 Oct
    const paused = await setRecurrenceState(h.ctx, h.manager, def.id, def.version, 'pause');

    h.clock.now = new Date('2026-10-20T06:00:00Z');
    await generateDueOccurrences(h.ctx);
    expect(await occurrences(def.id)).toHaveLength(8);

    const resumed = await setRecurrenceState(h.ctx, h.manager, def.id, paused.version, 'resume');
    const dates = (await occurrences(def.id)).map((t) => t.occurrenceDate);
    expect(dates.slice(8)).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27']);
    expect(resumed.state).toBe('active');

    await setRecurrenceState(h.ctx, h.manager, def.id, resumed.version, 'end');
    h.clock.now = new Date('2026-11-10T06:00:00Z');
    await generateDueOccurrences(h.ctx);
    expect(await occurrences(def.id)).toHaveLength(16);
    expect((await listRecurrences(h.ctx, h.manager)).find((d) => d.id === def.id)!.state).toBe('ended');
    h.clock.now = new Date('2026-10-04T06:00:00Z');
  });

  it('is restricted to managers', async () => {
    await expect(listRecurrences(h.ctx, h.guest)).rejects.toMatchObject({ status: 403 });
  });
});
