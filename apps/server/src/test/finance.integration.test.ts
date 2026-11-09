import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { financeEntrySchema } from '@org/shared';
import { deleteFinanceEntry, getFinance, reportFinance, setFinanceOpening } from '../modules/finance/finance-service';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const report = (kind: 'income' | 'expense', amountAgorot: number, by = h.manager, personId = h.manager.personId) =>
  reportFinance(h.ctx, by, { kind, amountAgorot, description: kind === 'income' ? 'תרומה' : 'קניות', personId, occurredOn: '2026-10-04' });

describe('finance', () => {
  it('the balance is the opening amount plus income minus expenses', async () => {
    await setFinanceOpening(h.ctx, h.manager, 1_000_00);
    await report('income', 500_00);
    await report('expense', 120_50, h.member, h.member.personId);
    const f = await getFinance(h.ctx, h.manager);
    expect(f).toMatchObject({ openingAgorot: 1_000_00, incomeAgorot: 500_00, expenseAgorot: 120_50, balanceAgorot: 1_379_50 });
    expect(f.entries.map((e) => e.personName)).toContain('Member');
  });

  it('deleting a report takes it out of the balance; members delete only their own', async () => {
    const f = await getFinance(h.ctx, h.member);
    const mine = f.entries.find((e) => e.kind === 'expense')!;
    const managers = f.entries.find((e) => e.kind === 'income')!;
    expect([mine.canDelete, managers.canDelete]).toEqual([true, false]);
    await expect(deleteFinanceEntry(h.ctx, h.member, managers.id)).rejects.toMatchObject({ status: 403 });
    await deleteFinanceEntry(h.ctx, h.member, mine.id);
    expect((await getFinance(h.ctx, h.manager)).balanceAgorot).toBe(1_500_00);
  });

  it('only managers set the opening amount; guests see nothing', async () => {
    await expect(setFinanceOpening(h.ctx, h.member, 5)).rejects.toMatchObject({ status: 403 });
    await expect(getFinance(h.ctx, h.guest)).rejects.toMatchObject({ status: 403 });
    await expect(report('income', 100, h.guest)).rejects.toMatchObject({ status: 403 });
  });

  it('amounts must be positive whole agorot, with details', () => {
    const ok = { kind: 'income', amountAgorot: 1050, description: 'x', personId: h.manager.personId, occurredOn: '2026-10-04' };
    expect(financeEntrySchema.safeParse(ok).success).toBe(true);
    expect(financeEntrySchema.safeParse({ ...ok, amountAgorot: 0 }).success).toBe(false);
    expect(financeEntrySchema.safeParse({ ...ok, amountAgorot: 10.5 }).success).toBe(false);
    expect(financeEntrySchema.safeParse({ ...ok, description: ' ' }).success).toBe(false);
  });
});
