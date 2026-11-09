import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getSheetContacts, refreshSheetContacts, setContactsSheet } from '../modules/sheet-contacts/contacts-service';
import { createContactCategory, deleteContactCategory, setContactCategoryMembers, updateContactCategory } from '../modules/sheet-contacts/category-service';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const SHEET = 'contactsSheet00002';
const csv = (rows: string[][]) => rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');

describe('contact categories', () => {
  it('a manager creates categories and decides who is in each; it survives updates from the sheet', async () => {
    h.fakeDrive.publicCsv.set(SHEET, csv([['שם', 'טלפון'], ['שרה', '050-1111111'], ['אבי', '050-2222222'], ['רבקה', '']]));
    const first = await setContactsSheet(h.ctx, h.manager, `https://docs.google.com/spreadsheets/d/${SHEET}/edit`);
    const donors = await createContactCategory(h.ctx, h.manager, { name: 'תורמים', color: '#2456c9' });
    const suppliers = await createContactCategory(h.ctx, h.manager, { name: 'ספקים', color: '#0f8a6a' });
    const key = (name: string) => first.items.find((i) => i.name === name)!.key;
    await setContactCategoryMembers(h.ctx, h.manager, donors.id, [key('שרה'), key('רבקה')]);
    await setContactCategoryMembers(h.ctx, h.manager, suppliers.id, [key('שרה')]);

    // The sheet changes (new order, extra spaces, phone written differently) – categories stay.
    h.fakeDrive.publicCsv.set(SHEET, csv([['שם', 'טלפון'], ['אבי', '050-2222222'], [' שרה ', '0501111111'], ['רבקה', ''], ['חדש', '1']]));
    const after = await refreshSheetContacts(h.ctx, h.manager);
    const cats = (name: string) => after.items.find((i) => i.name.trim() === name)!.categoryIds.sort();
    expect(cats('שרה')).toEqual([donors.id, suppliers.id].sort());
    expect(cats('רבקה')).toEqual([donors.id]);
    expect(cats('אבי')).toEqual([]);
    expect(after.categories.map((c) => c.name)).toEqual(['תורמים', 'ספקים']);
    expect((await getSheetContacts(h.ctx, h.member)).categories).toHaveLength(2);
  });

  it('a member whose row is missing from the sheet keeps the category when the row comes back', async () => {
    const [donors] = (await getSheetContacts(h.ctx, h.manager)).categories;
    h.fakeDrive.publicCsv.set(SHEET, csv([['שם', 'טלפון'], ['אבי', '050-2222222'], ['שרה', '0501111111'], ['חדש', '1']])); // רבקה is gone
    const without = await refreshSheetContacts(h.ctx, h.manager);
    await setContactCategoryMembers(h.ctx, h.manager, donors!.id, [without.items.find((i) => i.name === 'אבי')!.key]); // שרה out, אבי in
    h.fakeDrive.publicCsv.set(SHEET, csv([['שם', 'טלפון'], ['אבי', '050-2222222'], ['שרה', '0501111111'], ['רבקה', ''], ['חדש', '1']]));
    const back = await refreshSheetContacts(h.ctx, h.manager);
    const inDonors = back.items.filter((i) => i.categoryIds.includes(donors!.id)).map((i) => i.name).sort();
    expect(inDonors).toEqual(['אבי', 'רבקה'].sort());
  });

  it('renaming and deleting a category; deleting keeps the contacts', async () => {
    const [c] = (await getSheetContacts(h.ctx, h.manager)).categories;
    await updateContactCategory(h.ctx, h.manager, c!.id, { name: 'תורמים קבועים', color: '#000000' });
    await expect(createContactCategory(h.ctx, h.manager, { name: 'תורמים קבועים', color: '#000000' })).rejects.toMatchObject({ status: 409 });
    await deleteContactCategory(h.ctx, h.manager, c!.id);
    const r = await getSheetContacts(h.ctx, h.manager);
    expect(r.categories.map((x) => x.name)).toEqual(['ספקים']);
    expect(r.items).toHaveLength(4);
  });

  it('only managers manage categories', async () => {
    const [c] = (await getSheetContacts(h.ctx, h.manager)).categories;
    await expect(createContactCategory(h.ctx, h.member, { name: 'x', color: '#000000' })).rejects.toMatchObject({ status: 403 });
    await expect(setContactCategoryMembers(h.ctx, h.member, c!.id, [])).rejects.toMatchObject({ status: 403 });
    await expect(deleteContactCategory(h.ctx, h.member, c!.id)).rejects.toMatchObject({ status: 403 });
  });
});
