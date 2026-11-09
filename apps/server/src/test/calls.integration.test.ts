import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { callSchema } from '@org/shared';
import { createCall, deleteCall, listCalls, updateCall } from '../modules/calls/call-service';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const input = (over: Record<string, unknown> = {}) =>
  callSchema.parse({ callerName: 'יוסי', phone: '050-1234567', status: 'answered', summary: 'ביקש פרטים על האירוע', occurredAt: '2026-10-04T09:00:00+03:00', ...over });

describe('call log', () => {
  it('a manager logs calls, newest first, and edits and deletes them', async () => {
    const a = await createCall(h.ctx, h.manager, input());
    await createCall(h.ctx, h.manager, input({ callerName: 'רותי', status: 'missed', occurredAt: '2026-10-04T10:00:00+03:00' }));
    expect((await listCalls(h.ctx, h.manager)).map((c) => c.callerName)).toEqual(['רותי', 'יוסי']);

    const edited = await updateCall(h.ctx, h.manager, a.id, input({ status: 'callback', summary: 'לחזור אליו מחר' }));
    expect(edited).toMatchObject({ status: 'callback', summary: 'לחזור אליו מחר', phone: '050-1234567' });

    await deleteCall(h.ctx, h.manager, a.id);
    expect((await listCalls(h.ctx, h.manager)).map((c) => c.callerName)).toEqual(['רותי']);
  });

  it('needs a name, a phone number or a person', () => {
    expect(callSchema.safeParse({ status: 'answered', occurredAt: '2026-10-04T09:00:00+03:00' }).success).toBe(false);
    expect(callSchema.safeParse({ phone: 'abc', status: 'answered', occurredAt: '2026-10-04T09:00:00+03:00' }).success).toBe(false);
  });

  it('is private: members cannot use it, and nobody sees or changes someone else\'s calls', async () => {
    await expect(listCalls(h.ctx, h.member)).rejects.toMatchObject({ status: 403 });
    await expect(createCall(h.ctx, h.member, input())).rejects.toMatchObject({ status: 403 });
    const other = { ...h.manager, personId: h.member.personId, access: 'manager' as const };
    const [mineCall] = await listCalls(h.ctx, h.manager);
    expect(await listCalls(h.ctx, other)).toEqual([]);
    await expect(updateCall(h.ctx, other, mineCall!.id, input())).rejects.toMatchObject({ status: 404 });
    await expect(deleteCall(h.ctx, other, mineCall!.id)).rejects.toMatchObject({ status: 404 });
  });

  it('links a call to someone in the organisation only', async () => {
    const c = await createCall(h.ctx, h.manager, input({ callerName: '', personId: h.member.personId }));
    expect(c.personId).toBe(h.member.personId);
    await expect(createCall(h.ctx, h.manager, input({ personId: '00000000-0000-4000-8000-000000000000' }))).rejects.toMatchObject({ status: 400 });
  });
});
