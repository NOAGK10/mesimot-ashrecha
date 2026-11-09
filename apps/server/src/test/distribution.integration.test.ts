import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  getDistributionPoints,
  mapPointsSheet,
  pointFieldOf,
  previewDistributionColumns,
  refreshDistributionPoints,
  setDistributionColumns,
  setDistributionSheet,
} from '../modules/distribution/distribution-service';
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
    expect(mapPointsSheet([['שם המוקד', 'נייד', 'יישוב', 'האם יש הערות'], ['מוקד הרצל', '050-1', 'חולון', 'רק בימי שלישי']]).rows[0]).toEqual({ name: 'מוקד הרצל', phone: '050-1', city: 'חולון', notes: 'רק בימי שלישי' });
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

  it("shows the sheet's other columns on each point", async () => {
    const ID = 'extraColsSheet0001';
    h.fakeDrive.publicCsv.set(ID, csv([['שם', 'טלפון', 'עיר', 'שכונה / אזור', 'רחוב', 'קיבלו?', 'הערות'], ['משפחת פנחסוב', '054-1', 'אלעד', 'מרכז', 'רבי עקיבא 3', 'כן', ''], ['רום', '', 'ירושלים', '', '', '', 'בערב']]));
    const r = await setDistributionSheet(h.ctx, h.manager, `https://docs.google.com/spreadsheets/d/${ID}/edit`);
    expect(r.items[0]!.extra).toEqual([['שכונה / אזור', 'מרכז'], ['רחוב', 'רבי עקיבא 3'], ['קיבלו?', 'כן']]);
    expect(r.items[1]!.extra).toEqual([]);
    expect(r.unmatchedColumns).toEqual([]);
  });

  it('tells the manager how many rows were read and skipped; a manager can choose the columns', async () => {
    const ID = 'chooseColsSheet0001';
    // "שם" is mostly empty (only some rows have a place name); the families are in "עמודה 1".
    h.fakeDrive.publicCsv.set(
      ID,
      csv([
        ['עמודה 1', 'שם', 'טלפון', 'עיר', 'הערות'],
        ['משפחת כהן', 'בארון חשמל', '050-1', 'אלעד', 'בערב'],
        ['משפחת לוי', '', '050-2', 'אלעד', ''],
        ['משפחת כץ', '', '050-3', 'צפת', ''],
        ['', '', '', '', ''],
      ]),
    );
    const auto = await setDistributionSheet(h.ctx, h.manager, `https://docs.google.com/spreadsheets/d/${ID}/edit`);
    // Every row is kept (the list is shown as the sheet's table), even when the name column is empty.
    expect(auto.stats).toMatchObject({ rowsInSheet: 3, loaded: 3, skipped: 0, manual: false, columns: { name: 'שם', phone: 'טלפון' } });
    expect(auto.headers).toEqual(['עמודה 1', 'שם', 'טלפון', 'עיר', 'הערות']);
    expect(auto.items.map((i) => i.cells)).toEqual([
      ['משפחת כהן', 'בארון חשמל', '050-1', 'אלעד', 'בערב'],
      ['משפחת לוי', '', '050-2', 'אלעד', ''],
      ['משפחת כץ', '', '050-3', 'צפת', ''],
    ]);
    expect((await getDistributionPoints(h.ctx, h.member)).stats).toBeNull(); // managers only

    const preview = await previewDistributionColumns(h.ctx, h.manager);
    expect(preview.headers).toEqual(['עמודה 1', 'שם', 'טלפון', 'עיר', 'הערות']);
    expect(preview.sample[1]).toEqual(['משפחת לוי', '', '050-2', 'אלעד', '']);

    const chosen = await setDistributionColumns(h.ctx, h.manager, { name: 'עמודה 1', phone: 'טלפון', city: 'עיר', notes: 'הערות' });
    expect(chosen.items.map((i) => i.name)).toEqual(['משפחת כהן', 'משפחת לוי', 'משפחת כץ']);
    expect(chosen.items[0]!.extra).toEqual([['שם', 'בארון חשמל']]);
    expect(chosen.stats).toMatchObject({ rowsInSheet: 3, loaded: 3, skipped: 0, manual: true });
    // It stays chosen on updates; null goes back to automatic.
    expect((await refreshDistributionPoints(h.ctx, h.manager)).items).toHaveLength(3);
    expect((await setDistributionColumns(h.ctx, h.manager, null)).items).toHaveLength(3);
    await expect(setDistributionColumns(h.ctx, h.member, null)).rejects.toMatchObject({ status: 403 });
  });

  it('is separate from the other sheet lists, and closed to guests; only managers connect', async () => {
    expect((await getSheetContacts(h.ctx, h.manager)).sheetUrl).toBeNull();
    await expect(getDistributionPoints(h.ctx, h.guest)).rejects.toMatchObject({ status: 403 });
    await expect(setDistributionSheet(h.ctx, h.member, `https://docs.google.com/spreadsheets/d/${SHEET}/edit`)).rejects.toMatchObject({ status: 403 });
  });

  it('if the sheet becomes unreadable the last list stays, with the reason', async () => {
    const before = (await getDistributionPoints(h.ctx, h.manager)).items.length;
    expect(before).toBeGreaterThan(0);
    h.fakeDrive.publicCsv.clear();
    await expect(refreshDistributionPoints(h.ctx, h.manager)).rejects.toMatchObject({ status: 400 });
    const r = await getDistributionPoints(h.ctx, h.manager);
    expect(r.items).toHaveLength(before);
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
