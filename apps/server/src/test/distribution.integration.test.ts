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

  it('reads the tab the link points to (gid), not the first one', async () => {
    const ID = 'multiTabSheet0001';
    h.fakeDrive.publicCsv.set(ID, csv([['שם', 'קיבלו?', 'נשלח?'], ['משפחת כהן', 'כן', 'לא']])); // first tab: families
    h.fakeDrive.publicCsv.set(`${ID}#670543334`, csv([['שם', 'טלפון', 'עיר', 'הערות'], ['מוקד א', '1', 'חולון', ''], ['מוקד ב', '2', 'אלעד', 'x'], ['מוקד ג', '', 'צפת', '']]));
    const r = await setDistributionSheet(h.ctx, h.manager, `https://docs.google.com/spreadsheets/d/${ID}/edit?gid=670543334#gid=670543334`);
    expect(r.items.map((i) => i.name)).toEqual(['מוקד א', 'מוקד ב', 'מוקד ג']);
    expect(r.sheetUrl).toBe(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=670543334`);
    // Later updates keep reading that tab.
    expect((await refreshDistributionPoints(h.ctx, h.manager)).items).toHaveLength(3);
  });

  it('is separate from the other sheet lists, and closed to guests; only managers connect', async () => {
    expect((await getSheetContacts(h.ctx, h.manager)).sheetUrl).toBeNull();
    await expect(getDistributionPoints(h.ctx, h.guest)).rejects.toMatchObject({ status: 403 });
    await expect(setDistributionSheet(h.ctx, h.member, `https://docs.google.com/spreadsheets/d/${SHEET}/edit`)).rejects.toMatchObject({ status: 403 });
  });

  it('if the sheet becomes unreadable the last list stays, with the reason', async () => {
    h.fakeDrive.publicCsv.clear();
    await expect(refreshDistributionPoints(h.ctx, h.manager)).rejects.toMatchObject({ status: 400 });
    const r = await getDistributionPoints(h.ctx, h.manager);
    expect(r.items).toHaveLength(3);
    expect(r.syncError).toMatch(/private/);
  });
});

describe('Google links', () => {
  it('finds the tab in a link', async () => {
    const { parseGoogleUrl } = await import('../modules/google/gateway');
    expect(parseGoogleUrl('https://docs.google.com/spreadsheets/d/1QECBbO9huryz9DY0KTU/edit?gid=670543334#gid=670543334')).toEqual({ fileId: '1QECBbO9huryz9DY0KTU', kind: 'google_sheet', gid: '670543334' });
    expect(parseGoogleUrl('https://docs.google.com/spreadsheets/d/1QECBbO9huryz9DY0KTU/edit#gid=12')?.gid).toBe('12');
    expect(parseGoogleUrl('https://docs.google.com/spreadsheets/d/1QECBbO9huryz9DY0KTU/edit')?.gid).toBeNull();
  });
});
