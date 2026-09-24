import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { looksDone, parseLooseDate } from '@org/shared';
import { notifications, taskImportRows, tasks } from '../db/schema';
import { parseCsv, parseUpload } from '../modules/imports/parse';
import { SecretBox } from '../lib/secret-box';
import { createHarness, type Harness } from './harness';

let h: Harness;
let app: FastifyInstance;
let boss: string;
let guest: string;
beforeAll(async () => {
  h = await createHarness();
  app = await h.buildApp();
  boss = await login('boss@example.org');
  guest = await login('guest@example.org');
});
afterAll(async () => {
  await app.close();
  await h.close();
});

const JSON_HEADERS = { 'content-type': 'application/json', 'x-requested-with': 'fetch' };

async function login(email: string): Promise<string> {
  const res = await app.inject({ method: 'POST', url: '/api/auth/dev-login', headers: JSON_HEADERS, payload: { email } });
  return `om_session=${res.cookies.find((c) => c.name === 'om_session')!.value}`;
}
const call = (method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, cookie: string, payload?: unknown) =>
  payload === undefined
    ? app.inject({ method, url, headers: { 'x-requested-with': 'fetch', cookie } })
    : app.inject({ method, url, headers: { ...JSON_HEADERS, cookie }, payload: payload as object });

function multipart(filename: string, content: Buffer, fields: Record<string, string> = {}) {
  const boundary = '----test' + Math.random().toString(16).slice(2);
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  }
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`));
  parts.push(content, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { payload: Buffer.concat(parts), headers: { 'content-type': `multipart/form-data; boundary=${boundary}`, 'x-requested-with': 'fetch' } };
}

describe('cell helpers', () => {
  it('reads Israeli-style dates, day first', () => {
    expect(parseLooseDate('25/09/2026')).toBe('2026-09-25');
    expect(parseLooseDate('5.1.26')).toBe('2026-01-05');
    expect(parseLooseDate('2026-09-25')).toBe('2026-09-25');
    expect(parseLooseDate('31/02/2026')).toBeNull();
    expect(parseLooseDate('next week')).toBeNull();
  });
  it('recognises common "done" markers', () => {
    for (const v of ['V', '✓', 'כן', 'בוצע', 'TRUE', 'x']) expect(looksDone(v)).toBe(true);
    for (const v of ['', 'לא', 'בתהליך', 'FALSE']) expect(looksDone(v)).toBe(false);
  });
  it('encrypts secrets with authentication', () => {
    const box = new SecretBox(Buffer.alloc(32, 7).toString('base64'));
    const sealed = box.seal('refresh-token');
    expect(sealed).not.toContain('refresh-token');
    expect(box.open(sealed)).toBe('refresh-token');
    const [iv, tag, data] = sealed.split('.');
    const flipped = Buffer.from(data!, 'base64');
    flipped[0]! ^= 1;
    expect(() => box.open([iv, tag, flipped.toString('base64')].join('.'))).toThrow();
  });
});

describe('spreadsheet parsing', () => {
  it('parses CSV with BOM and trims empty trailing rows and columns', () => {
    const { table } = parseCsv('t', '﻿משימה,אחראי,,\nלהזמין ציוד,דנה,,\n,,,\n');
    expect(table.rows).toEqual([
      ['משימה', 'אחראי'],
      ['להזמין ציוד', 'דנה'],
    ]);
  });

  it('parses every worksheet of an .xlsx file, formatting dates as DD/MM/YYYY', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('משימות');
    ws.addRow(['משימה', 'תאריך', 'בוצע']);
    ws.addRow(['לשלם חשבון', new Date(Date.UTC(2026, 9, 12)), true]);
    wb.addWorksheet('ריק');
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const { tables } = await parseUpload('tasks.xlsx', buf);
    expect(tables.map((t) => t.name)).toEqual(['משימות', 'ריק']);
    expect(tables[0]!.rows[1]).toEqual(['לשלם חשבון', '12/10/2026', 'TRUE']);
    await expect(parseUpload('old.xls', buf)).rejects.toThrow(/xls/);
  });
});

describe('sheet import', () => {
  it('previews an uploaded file without storing anything', async () => {
    const before = await h.ctx.db.select().from(tasks);
    const csv = Buffer.from('משימה,אחראי,יעד,בוצע\nלהזמין ציוד,boss,01/11/2026,\nלחדש רישיון,partner,15/09/2026,V\n');
    const res = await app.inject({ method: 'POST', url: '/api/imports/preview/upload', ...withCookie(multipart('רשימה.csv', csv), boss) });
    expect(res.statusCode).toBe(200);
    expect(res.json().tables[0].rows).toHaveLength(3);
    expect(await h.ctx.db.select().from(tasks)).toHaveLength(before.length);
  });

  it('is limited to managers', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/imports/preview/upload', ...withCookie(multipart('a.csv', Buffer.from('a\n')), guest) });
    expect(res.statusCode).toBe(403);
  });

  it('creates all approved rows in one transaction, traced to the source row, without assignment e-mails', async () => {
    const res = await call('POST', '/api/imports', boss, {
      sourceName: 'רשימת משימות',
      sheetName: 'גיליון1',
      rows: [
        { sourceRow: 2, title: 'להזמין ציוד', ownerPersonId: h.manager.personId, dueDate: '2026-11-01', status: 'new', participantIds: [h.contactId] },
        { sourceRow: 3, title: 'לחדש רישיון', ownerPersonId: h.partner.personId, dueDate: '2026-09-15', status: 'completed' },
      ],
    });
    expect(res.statusCode).toBe(201);
    const { importId, created } = res.json();
    expect(created).toBe(2);

    const traced = await h.ctx.db.select().from(taskImportRows).where(eq(taskImportRows.importId, importId));
    expect(traced.map((r) => r.sourceRow).sort()).toEqual([2, 3]);
    const [done] = await h.ctx.db.select().from(tasks).where(eq(tasks.title, 'לחדש רישיון'));
    expect(done!.status).toBe('completed');
    expect(done!.completedAt).not.toBeNull();

    const [open] = await h.ctx.db.select().from(tasks).where(eq(tasks.title, 'להזמין ציוד'));
    const notes = await h.ctx.db.select().from(notifications).where(eq(notifications.taskId, open!.id));
    expect(notes.some((n) => n.kind === 'assigned')).toBe(false);
    expect(notes.some((n) => n.kind === 'due_today')).toBe(true);

    const detail = (await call('GET', `/api/tasks/${open!.id}`, boss)).json();
    expect(detail.events[0]).toMatchObject({ type: 'task.created', data: { importId, sourceRow: 2 } });
  });

  it('rejects the whole import if any row is invalid (no partial import)', async () => {
    const before = (await h.ctx.db.select().from(tasks)).length;
    const res = await call('POST', '/api/imports', boss, {
      sourceName: 'x',
      rows: [
        { sourceRow: 2, title: 'ok', ownerPersonId: h.manager.personId },
        { sourceRow: 3, title: 'bad', ownerPersonId: '00000000-0000-4000-8000-000000000000' },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(await h.ctx.db.select().from(tasks)).toHaveLength(before);
  });
});

function withCookie(m: ReturnType<typeof multipart>, cookie: string) {
  return { payload: m.payload, headers: { ...m.headers, cookie } };
}

describe('Google Drive', () => {
  const SHEET = 'sheetAAAAAAAAAAAA1';

  it('reports status and requires a connection before Drive features work', async () => {
    const status = (await call('GET', '/api/google/status', boss)).json();
    expect(status).toMatchObject({ enabled: true, connected: false });
    const res = await call('POST', '/api/imports/preview/google', boss, { googleFileId: SHEET });
    expect(res.json().error.code).toBe('google_not_connected');
  });

  it('connects, stores the token encrypted, and issues picker tokens', async () => {
    expect((await call('POST', '/api/google/connect', boss, { code: 'code-123456789' })).statusCode).toBe(200);
    expect((await call('GET', '/api/google/status', boss)).json().connected).toBe(true);
    const token = await call('GET', '/api/google/picker-token', boss);
    expect(token.json().accessToken).toBe('access-for-refresh-code-123456789');
    expect(token.headers['cache-control']).toBe('no-store');
    expect((await call('GET', '/api/google/picker-token', guest)).statusCode).toBe(403);
  });

  it('previews a picked Google Sheet and records it as the import source document', async () => {
    h.fakeDrive.addSheet(SHEET, 'מעקב משימות', [{ name: 'גיליון1', rows: [['משימה', 'אחראי'], ['לסדר מחסן', 'boss']] }]);
    const preview = (await call('POST', '/api/imports/preview/google', boss, { googleFileId: SHEET })).json();
    expect(preview).toMatchObject({ sourceName: 'מעקב משימות', googleFileId: SHEET });
    expect(preview.tables[0].rows[1]).toEqual(['לסדר מחסן', 'boss']);

    const res = await call('POST', '/api/imports', boss, {
      sourceName: preview.sourceName,
      googleFileId: SHEET,
      rows: [{ sourceRow: 2, title: 'לסדר מחסן', ownerPersonId: h.manager.personId }],
    });
    const { documentId } = res.json();
    const docs = (await call('GET', '/api/documents', boss)).json();
    const doc = docs.find((d: { id: string }) => d.id === documentId);
    expect(doc).toMatchObject({ kind: 'google_sheet', title: 'מעקב משימות', googleFileId: SHEET });
    expect(doc.taskIds).toHaveLength(1);
  });

  it('pasted link: private sheet gives a clear error; public sheet is read via CSV export', async () => {
    const privateUrl = 'https://docs.google.com/spreadsheets/d/privateAAAAAAAAAA/edit#gid=0';
    const denied = await call('POST', '/api/imports/preview/link', boss, { url: privateUrl });
    expect(denied.json().error.code).toBe('sheet_not_accessible');

    h.fakeDrive.publicCsv.set('publicAAAAAAAAAAA', 'משימה\nלתלות שלט\n');
    const ok = await call('POST', '/api/imports/preview/link', boss, { url: 'https://docs.google.com/spreadsheets/d/publicAAAAAAAAAAA/edit' });
    expect(ok.json().tables[0].rows).toEqual([['משימה'], ['לתלות שלט']]);

    const notSheet = await call('POST', '/api/imports/preview/link', boss, { url: 'https://example.org/x' });
    expect(notSheet.statusCode).toBe(400);
  });
});

describe('documents', () => {
  let taskId: string;
  beforeAll(async () => {
    taskId = (
      await call('POST', '/api/tasks', boss, { title: 'מסמכים', ownerPersonId: h.manager.personId, participantIds: [h.guest.personId] })
    ).json().id;
  });

  it('adds a pasted Google Doc link, deduplicates by file id, categorises and attaches it', async () => {
    const category = (await call('POST', '/api/document-categories', boss, { name: 'כספים' })).json();
    const url = 'https://docs.google.com/document/d/docAAAAAAAAAAAAAA1/edit';
    const first = (await call('POST', '/api/documents', boss, { url, title: 'פרוטוקול', categoryId: category.id, taskId })).json();
    expect(first).toMatchObject({ kind: 'google_doc', title: 'פרוטוקול', categoryId: category.id, taskIds: [taskId] });
    const again = (await call('POST', '/api/documents', boss, { url: url + '?usp=sharing' })).json();
    expect(again.id).toBe(first.id);

    const detail = (await call('GET', `/api/tasks/${taskId}`, boss)).json();
    expect(detail.documents.map((d: { id: string }) => d.id)).toEqual([first.id]);
    expect(detail.events.at(-1).type).toBe('task.document_linked');
  });

  it('lets participants see a task\'s documents but not the document library', async () => {
    const detail = (await call('GET', `/api/tasks/${taskId}`, guest)).json();
    expect(detail.documents).toHaveLength(1);
    expect((await call('GET', '/api/documents', guest)).statusCode).toBe(403);
    expect((await call('POST', `/api/tasks/${taskId}/documents`, guest, { documentId: detail.documents[0].id })).statusCode).toBe(403);
  });

  it('detaches with an audit entry and keeps the document', async () => {
    const doc = (await call('GET', `/api/tasks/${taskId}`, boss)).json().documents[0];
    expect((await call('DELETE', `/api/tasks/${taskId}/documents/${doc.id}`, boss)).statusCode).toBe(200);
    const detail = (await call('GET', `/api/tasks/${taskId}`, boss)).json();
    expect(detail.documents).toHaveLength(0);
    expect(detail.events.at(-1).type).toBe('task.document_unlinked');
    expect((await call('GET', '/api/documents', boss)).json().some((d: { id: string }) => d.id === doc.id)).toBe(true);
  });

  it('uploads a file into Drive as a Google document', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/documents/upload', ...withCookie(multipart('הצעת מחיר.docx', Buffer.from('fake')), boss) });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ kind: 'google_doc', title: 'הצעת מחיר' });
  });

  it('disconnecting Google removes the stored token', async () => {
    await call('DELETE', '/api/google/connection', boss);
    expect((await call('GET', '/api/google/status', boss)).json().connected).toBe(false);
  });
});
