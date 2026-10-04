import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { parseDocx } from '../modules/imports/parse-docx';
import { commitImport, previewGoogleFile, previewGoogleLink, previewUpload } from '../modules/imports/import-service';
import { createTaskCategory, deleteTaskCategory, listTaskCategories } from '../modules/tasks/category-service';
import { createTask, getTaskDetail, listTasks, updateTask } from '../modules/tasks/task-service';
import { createRecurrence } from '../modules/recurrence/recurrence-service';
import { connectGoogle } from '../modules/google/connection-service';
import { createHarness, type Harness } from './harness';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const li = (text: string) => `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const cell = (text: string) => `<w:tc>${p(text)}</w:tc>`;
const row = (...cells: string[]) => `<w:tr>${cells.map(cell).join('')}</w:tr>`;

async function docx(body: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
}

const SAMPLE = () =>
  docx(
    p('פרוטוקול ישיבת צוות') +
      p('שימו לב לדברים הבאים, זה טקסט חופשי שלא הופך למשימות.') +
      p('משימות לאירוע') +
      `<w:tbl>${row('משימה', 'אחראי', 'תאריך')}${row('להזמין אולם', 'Member', '15/10/2026')}${row('לשלוח הזמנות', 'Guest', '20/10/2026')}</w:tbl>` +
      p('עוד דברים לעשות') +
      li('לקנות כיבוד') +
      li('לתאם צלם') +
      p('סוף'),
  );

describe('reading Word documents', () => {
  it('turns tables and bulleted lists into tables, named after the line above, and ignores free text', async () => {
    const { tables } = await parseDocx(await SAMPLE());
    expect(tables).toEqual([
      { name: 'משימות לאירוע', rows: [['משימה', 'אחראי', 'תאריך'], ['להזמין אולם', 'Member', '15/10/2026'], ['לשלוח הזמנות', 'Guest', '20/10/2026']] },
      { name: 'עוד דברים לעשות', rows: [['משימה'], ['לקנות כיבוד'], ['לתאם צלם']] },
    ]);
  });

  it('explains when there is nothing to import, and rejects files that are not .docx', async () => {
    await expect(parseDocx(await docx(p('רק טקסט חופשי')))).rejects.toThrow(/No tables or bulleted lists/);
    await expect(parseDocx(Buffer.from('not a zip'))).rejects.toThrow(/Word document/);
    await expect(previewUpload(h.manager, 'old.doc', Buffer.from('x'))).rejects.toThrow(/\.doc files/);
  });

  it('previews an uploaded .docx through the same wizard as spreadsheets', async () => {
    const preview = await previewUpload(h.manager, 'פרוטוקול.docx', await SAMPLE());
    expect(preview).toMatchObject({ sourceName: 'פרוטוקול.docx', googleFileId: null, googleFileKind: null });
    expect(preview.tables.map((t) => t.name)).toEqual(['משימות לאירוע', 'עוד דברים לעשות']);
  });

  it('reads a Google Doc picked in Drive, or shared by link, and records it as the source document', async () => {
    await connectGoogle(h.ctx, h.manager, 'code-docs-123456');
    h.fakeDrive.addDoc('docAAAAAAAAAAAAAA1', 'פרוטוקול ישיבה', await SAMPLE());
    const picked = await previewGoogleFile(h.ctx, h.manager, 'docAAAAAAAAAAAAAA1');
    expect(picked).toMatchObject({ sourceName: 'פרוטוקול ישיבה', googleFileKind: 'google_doc' });

    h.fakeDrive.publicDocx.set('docPUBLICAAAAAAAA', await SAMPLE());
    const shared = await previewGoogleLink(h.ctx, h.manager, 'https://docs.google.com/document/d/docPUBLICAAAAAAAA/edit');
    expect(shared.tables).toHaveLength(2);

    const result = await commitImport(h.ctx, h.manager, {
      sourceName: picked.sourceName,
      sheetName: 'עוד דברים לעשות',
      googleFileId: 'docAAAAAAAAAAAAAA1',
      googleFileKind: 'google_doc',
      categoryId: null,
      rows: [{ sourceRow: 2, title: 'לקנות כיבוד', description: '', ownerPersonId: h.manager.personId, dueDate: null, status: 'new', participantIds: [] }],
    });
    const [task] = (await listTasks(h.ctx, h.manager, { view: 'all', mine: false, includeArchived: false, q: 'לקנות כיבוד' }));
    const detail = await getTaskDetail(h.ctx, h.manager, task!.id);
    expect(detail.documents[0]).toMatchObject({ id: result.documentId, kind: 'google_doc', url: 'https://docs.google.com/document/d/docAAAAAAAAAAAAAA1/edit' });
  });
});

describe('task categories', () => {
  it('managers define categories; everyone can read the list', async () => {
    const c = await createTaskCategory(h.ctx, h.manager, { name: 'כספים', color: '#0f8a6a' });
    expect((await listTaskCategories(h.ctx, h.guest)).map((x) => x.name)).toContain('כספים');
    await expect(createTaskCategory(h.ctx, h.member, { name: 'x', color: '#000000' })).rejects.toMatchObject({ status: 403 });
    await expect(createTaskCategory(h.ctx, h.manager, { name: 'כספים', color: '#111111' })).rejects.toMatchObject({ status: 409 });
    expect(c.color).toBe('#0f8a6a');
  });

  it('tasks get one category; lists filter by category or by "no category"; changes are audited', async () => {
    const [finance] = await listTaskCategories(h.ctx, h.manager);
    const events = await createTaskCategory(h.ctx, h.manager, { name: 'אירועים', color: '#8a3fb8' });
    const a = await createTask(h.ctx, h.manager, { title: 'C-חשבונית', description: '', ownerPersonId: h.manager.personId, dueDate: null, participantIds: [], categoryId: finance!.id });
    const b = await createTask(h.ctx, h.member, { title: 'C-בלי', description: '', ownerPersonId: h.member.personId, dueDate: null, participantIds: [] });
    expect(a.categoryId).toBe(finance!.id);
    expect(b.categoryId).toBeNull();

    const titles = async (categoryId: string) =>
      (await listTasks(h.ctx, h.manager, { view: 'all', mine: false, includeArchived: false, categoryId })).map((t) => t.title).filter((t) => t.startsWith('C-'));
    expect(await titles(finance!.id)).toEqual(['C-חשבונית']);
    expect(await titles('none')).toEqual(['C-בלי']);

    const moved = await updateTask(h.ctx, h.manager, a.id, { version: a.version, categoryId: events.id });
    expect(moved.categoryId).toBe(events.id);
    expect((await getTaskDetail(h.ctx, h.manager, a.id)).events.at(-1)).toMatchObject({ type: 'task.category_changed', data: { from: finance!.id, to: events.id } });

    await expect(
      createTask(h.ctx, h.manager, { title: 'bad', description: '', ownerPersonId: h.manager.personId, dueDate: null, participantIds: [], categoryId: '00000000-0000-4000-8000-000000000000' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('recurring tasks pass their category to every new occurrence', async () => {
    const [cat] = await listTaskCategories(h.ctx, h.manager);
    const def = await createRecurrence(h.ctx, h.manager, {
      title: 'C-דוח חודשי',
      description: '',
      ownerPersonId: h.manager.personId,
      participantIds: [],
      categoryId: cat!.id,
      mode: 'after_completion',
      freq: 'monthly',
      interval: 1,
      byWeekday: [],
      byMonthDay: null,
      startDate: '2026-10-10',
      endDate: null,
    });
    expect(def.categoryId).toBe(cat!.id);
    const [occ] = await listTasks(h.ctx, h.manager, { view: 'all', mine: false, includeArchived: false, q: 'C-דוח חודשי' });
    expect(occ!.categoryId).toBe(cat!.id);
  });

  it('imported rows can carry a category', async () => {
    const [cat] = await listTaskCategories(h.ctx, h.manager);
    await commitImport(h.ctx, h.manager, {
      sourceName: 'x.csv',
      sheetName: '',
      googleFileId: null,
      googleFileKind: 'google_sheet',
      categoryId: null,
      rows: [{ sourceRow: 2, title: 'C-מיובא', description: '', ownerPersonId: h.manager.personId, dueDate: null, status: 'new', participantIds: [], categoryId: cat!.id }],
    });
    const [t] = await listTasks(h.ctx, h.manager, { view: 'all', mine: false, includeArchived: false, q: 'C-מיובא' });
    expect(t!.categoryId).toBe(cat!.id);
  });

  it('deleting a category keeps its tasks, uncategorised', async () => {
    const temp = await createTaskCategory(h.ctx, h.manager, { name: 'זמני', color: '#5d6b7a' });
    const t = await createTask(h.ctx, h.manager, { title: 'C-זמני', description: '', ownerPersonId: h.manager.personId, dueDate: null, participantIds: [], categoryId: temp.id });
    await deleteTaskCategory(h.ctx, h.manager, temp.id);
    expect((await getTaskDetail(h.ctx, h.manager, t.id)).categoryId).toBeNull();
  });
});
