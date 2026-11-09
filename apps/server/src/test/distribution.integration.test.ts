import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDistributionPoints, mapPointsSheet, pointFieldOf, refreshDistributionPoints, setDistributionSheet } from '../modules/distribution/distribution-service';
import { getSheetContacts } from '../modules/sheet-contacts/contacts-service';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const SHEET = 'distributionSheet001';
const csv = (rows: string[][]) => rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');

describe('distribution points from a Google Sheet', () => {
  it('recognises the headers', () => {
    expect(['שם', 'טלפון', 'עיר', 'הערות'].map(pointFieldOf)).toEqual(['name', 'phone', 'city', 'notes']);
    expect(['שם המוקד', 'נייד', 'יישוב', 'האם יש הערות'].map(pointFieldOf)).toEqual(['name', 'phone', 'city', 'notes']);
    expect(mapPointsSheet([['מוקד הרצל', '050-1', 'חולון', 'רק בימי שלישי']]).rows[0]).toEqual({ name: 'מוקד הרצל', phone: '050-1', city: 'חולון', notes: 'רק בימי שלישי' });
  });

  it('a manager connects the sheet, the team sees the points, updates replace them', async () => {
    h.fakeDrive.publicCsv.set(SHEET, csv([['שם', 'טלפון', 'עיר', 'הערות'], ['מוקד הרצל', '050-1234567', 'חולון', 'רק בימי שלישי'], ['מוקד הגפן', '', 'בני ברק', '']]));
    const r = await setDistributionSheet(h.ctx, h.manager, `https://docs.google.com/spreadsheets/d/${SHEET}/edit`);
    expect(r.items.map((i) => [i.name, i.city, i.notes])).toEqual([['מוקד הרצל', 'חולון', 'רק בימי שלישי'], ['מוקד הגפן', 'בני ברק', '']]);
    expect((await getDistributionPoints(h.ctx, h.member)).items).toHaveLength(2);

    h.fakeDrive.publicCsv.set(SHEET, csv([['שם', 'עיר'], ['מוקד חדש', 'אלעד']]));
    expect((await refreshDistributionPoints(h.ctx, h.manager)).items.map((i) => i.name)).toEqual(['מוקד חדש']);

    // Replacing the link keeps one source per organisation.
    h.fakeDrive.publicCsv.set('distributionSheet002', csv([['שם'], ['א'], ['ב']]));
    expect((await setDistributionSheet(h.ctx, h.manager, 'https://docs.google.com/spreadsheets/d/distributionSheet002/edit')).items).toHaveLength(2);
  });

  it('is separate from the other sheet lists, and closed to guests; only managers connect', async () => {
    expect((await getSheetContacts(h.ctx, h.manager)).sheetUrl).toBeNull();
    await expect(getDistributionPoints(h.ctx, h.guest)).rejects.toMatchObject({ status: 403 });
    await expect(setDistributionSheet(h.ctx, h.member, `https://docs.google.com/spreadsheets/d/${SHEET}/edit`)).rejects.toMatchObject({ status: 403 });
  });

  it('if the sheet becomes unreadable the last list stays, with the reason', async () => {
    h.fakeDrive.publicCsv.delete('distributionSheet002');
    await expect(refreshDistributionPoints(h.ctx, h.manager)).rejects.toMatchObject({ status: 400 });
    const r = await getDistributionPoints(h.ctx, h.manager);
    expect(r.items).toHaveLength(2);
    expect(r.syncError).toMatch(/private/);
  });
});
