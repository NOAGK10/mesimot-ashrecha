import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fieldOfHeader, mapSheet } from '../modules/institutions/columns';
import { getInstitutions, refreshInstitutions, setInstitutionsSheet } from '../modules/institutions/institution-service';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const SHEET = 'institutionsSheet0001';
const URL = `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=0`;
const csv = (rows: string[][]) => rows.map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\n');

describe('reading the columns', () => {
  it('recognises the Hebrew headers, contact columns before the main phone', () => {
    expect(['שם הישיבה /כולל', 'עיר', 'כתובת', 'טלפון', 'איש קשר', 'טלפון איש קשר', 'מייל איש קשר', 'הערות'].map(fieldOfHeader)).toEqual([
      'name', 'city', 'address', 'phone', 'contactName', 'contactPhone', 'contactEmail', 'notes',
    ]);
    expect(['שם המוסד', 'יישוב', 'טל׳', 'נייד איש קשר', 'דוא״ל'].map(fieldOfHeader)).toEqual(['name', 'city', 'phone', 'contactPhone', 'contactEmail']);
  });

  it('finds the header row, skips rows without a name and reports unknown columns', () => {
    const m = mapSheet([
      ['רשימת מוסדות', '', ''],
      ['עיר', 'שם הישיבה', 'תקציב'],
      ['בני ברק', 'ישיבת אור', '100'],
      ['ירושלים', '', ''],
    ]);
    expect(m.rows).toEqual([expect.objectContaining({ name: 'ישיבת אור', city: 'בני ברק' })]);
    expect(m.unmatched).toEqual(['תקציב']);
  });

  it('without a header row, uses the order of the listed columns', () => {
    const m = mapSheet([['כולל חזון', 'צפת', 'הרצל 1', '04-1234567', 'משה', '050-1', 'm@x.org', 'חדש']]);
    expect(m.rows[0]).toEqual({ name: 'כולל חזון', city: 'צפת', address: 'הרצל 1', phone: '04-1234567', contactName: 'משה', contactPhone: '050-1', contactEmail: 'm@x.org', notes: 'חדש' });
  });
});

describe('institutions from a Google Sheet', () => {
  it('a manager connects a sheet and everyone in the team sees its rows', async () => {
    h.fakeDrive.publicCsv.set(
      SHEET,
      csv([
        ['שם הישיבה /כולל', 'עיר', 'כתובת', 'טלפון', 'איש קשר', 'טלפון איש קשר', 'מייל איש קשר', 'הערות'],
        ['ישיבת אור', 'בני ברק', 'רבי עקיבא 10', '03-5555555', 'יוסי', '050-1111111', 'yossi@example.org', 'לחזור אחרי החג'],
        ['כולל חזון', 'ירושלים', '', '', 'דוד', '', '', ''],
      ]),
    );
    const r = await setInstitutionsSheet(h.ctx, h.manager, URL);
    expect(r.items.map((i) => i.name)).toEqual(['ישיבת אור', 'כולל חזון']);
    expect(r.items[0]).toMatchObject({ city: 'בני ברק', contactEmail: 'yossi@example.org', notes: 'לחזור אחרי החג' });
    expect(r.sheetUrl).toContain(SHEET);
    expect((await getInstitutions(h.ctx, h.member)).items).toHaveLength(2);
  });

  it('an update replaces the list with what is in the sheet now', async () => {
    h.fakeDrive.publicCsv.set(SHEET, csv([['שם הישיבה', 'עיר'], ['ישיבת נר', 'אלעד']]));
    const r = await refreshInstitutions(h.ctx, h.manager);
    expect(r.items.map((i) => i.name)).toEqual(['ישיבת נר']);
  });

  it('it refreshes itself when opened after a while', async () => {
    h.fakeDrive.publicCsv.set(SHEET, csv([['שם הישיבה'], ['ישיבה א'], ['ישיבה ב']]));
    expect((await getInstitutions(h.ctx, h.member)).items).toHaveLength(1); // still fresh
    h.clock.now = new Date(h.clock.now.getTime() + 11 * 60 * 1000);
    expect((await getInstitutions(h.ctx, h.member)).items).toHaveLength(2);
  });

  it('if the sheet stops being readable, the last list stays and the error is shown', async () => {
    h.fakeDrive.publicCsv.delete(SHEET);
    await expect(refreshInstitutions(h.ctx, h.manager)).rejects.toMatchObject({ status: 400 });
    const r = await getInstitutions(h.ctx, h.manager);
    expect(r.items).toHaveLength(2);
    expect(r.syncError).toMatch(/private/);
  });

  it('only managers connect a sheet; guests see nothing; only sheet links are accepted', async () => {
    await expect(setInstitutionsSheet(h.ctx, h.member, URL)).rejects.toMatchObject({ status: 403 });
    await expect(getInstitutions(h.ctx, h.guest)).rejects.toMatchObject({ status: 403 });
    await expect(setInstitutionsSheet(h.ctx, h.manager, 'https://docs.google.com/document/d/abcdefghijk1/edit')).rejects.toMatchObject({ status: 400 });
  });
});
