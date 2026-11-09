import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contactFieldOf, getSheetContacts, mapContactsSheet, refreshSheetContacts, setContactsSheet } from '../modules/sheet-contacts/contacts-service';
import { getInstitutions } from '../modules/institutions/institution-service';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const SHEET = 'contactsSheet00001';
const URL = `https://docs.google.com/spreadsheets/d/${SHEET}/edit`;
const csv = (rows: string[][]) => rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');

describe('contacts from a Google Sheet', () => {
  it('recognises the headers; "שם האחראי" is the responsible, "טלפון" the phone', () => {
    expect(['שם', 'טלפון', 'מייל', 'אחראי', 'כתובת'].map(contactFieldOf)).toEqual(['name', 'phone', 'email', 'responsible', 'address']);
    expect(['שם מלא', 'נייד', 'דוא״ל', 'שם האחראי', 'עיר'].map(contactFieldOf)).toEqual(['name', 'phone', 'email', 'responsible', 'address']);
    expect(mapContactsSheet([['רבקה', '050-1', 'r@x.org', 'דנה', 'חיפה']]).rows[0]).toEqual({ name: 'רבקה', phone: '050-1', email: 'r@x.org', responsible: 'דנה', address: 'חיפה' });
  });

  it('a manager connects a sheet; the team sees the contacts; updates replace the list', async () => {
    h.fakeDrive.publicCsv.set(SHEET, csv([['שם', 'טלפון', 'מייל', 'אחראי', 'כתובת'], ['שרה כהן', '050-1234567', 'sara@example.org', 'דנה', 'הרצל 5, חולון'], ['', '', '', '', '']]));
    const r = await setContactsSheet(h.ctx, h.manager, URL);
    expect(r.items).toEqual([expect.objectContaining({ name: 'שרה כהן', responsible: 'דנה', address: 'הרצל 5, חולון' })]);
    expect((await getSheetContacts(h.ctx, h.member)).items).toHaveLength(1);

    h.fakeDrive.publicCsv.set(SHEET, csv([['שם', 'טלפון'], ['אבי', '1'], ['בתיה', '2']]));
    expect((await refreshSheetContacts(h.ctx, h.manager)).items.map((i) => i.name)).toEqual(['אבי', 'בתיה']);
  });

  it('is separate from the institutions list, and closed to guests and non-managers where it should be', async () => {
    expect((await getInstitutions(h.ctx, h.manager)).sheetUrl).toBeNull();
    await expect(getSheetContacts(h.ctx, h.guest)).rejects.toMatchObject({ status: 403 });
    await expect(setContactsSheet(h.ctx, h.member, URL)).rejects.toMatchObject({ status: 403 });
  });
});
