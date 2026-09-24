import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import type { ImportPreviewDto, ImportResultDto, PersonDto, TaskStatus } from '@org/shared';
import { TASK_STATUSES, looksDone, parseLooseDate } from '@org/shared';
import { api, upload, useCategories, useGoogleStatus, useMe, usePeople } from '../api';
import { ErrorText } from '../components/common';
import { GoogleConnect } from '../components/GoogleConnect';
import { pickFromDrive } from '../google';
import { STATUS_LABEL, formatDate } from '../he';

/**
 * Sheet import wizard. Nothing is created until the manager approves the final review:
 * 1. source → 2. columns → 3. people & statuses → 4. review rows → approve.
 */

type Field = 'title' | 'owner' | 'due' | 'status' | 'description' | 'participants';
const FIELD_LABEL: Record<Field, string> = {
  title: 'מה צריך לעשות (חובה)',
  owner: 'אחראי',
  due: 'תאריך יעד',
  status: 'בוצע / סטטוס',
  description: 'פרטים / הערות',
  participants: 'משתתפים',
};
const GUESS: Record<Field, RegExp> = {
  title: /משימה|נושא|מה |^מה$|פעולה|task|title|item|תיאור קצר/i,
  owner: /אחראי|אחריות|מבצע|owner|assignee|מי /i,
  due: /תאריך|יעד|מועד|דד.?ליין|due|date|deadline|עד מתי/i,
  status: /בוצע|סטטוס|מצב|הושלם|status|done|✓/i,
  description: /הערות|פרטים|תיאור|notes|description|comment/i,
  participants: /משתתפים|שותפים|participants|עם מי/i,
};
const FIELDS = Object.keys(FIELD_LABEL) as Field[];
type Mapping = Record<Field, number>;

const norm = (s: string) => s.trim().toLowerCase();
function matchPerson(value: string, people: PersonDto[]): string {
  const v = norm(value);
  if (!v) return '';
  const active = people.filter((p) => p.active);
  const exact = active.find((p) => norm(p.displayName) === v || norm(p.email) === v || norm(p.email.split('@')[0] ?? '') === v);
  if (exact) return exact.id;
  const partial = active.filter((p) => norm(p.displayName).includes(v) || v.includes(norm(p.displayName)));
  return partial.length === 1 ? partial[0]!.id : '';
}
function guessStatus(value: string): TaskStatus {
  if (looksDone(value)) return 'completed';
  if (/בתהליך|בביצוע|in progress|עובדים/i.test(value)) return 'in_progress';
  if (/ממתין|מחכה|waiting/i.test(value)) return 'waiting';
  if (/תקוע|חסום|blocked|stuck|בעיה/i.test(value)) return 'blocked';
  if (/בוטל|cancel/i.test(value)) return 'cancelled';
  return 'new';
}
const colName = (i: number) => {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};
const splitNames = (s: string) => s.split(/[,;/\n]| ו(?=\S)/).map((x) => x.trim()).filter(Boolean);

export function ImportPage() {
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [result, setResult] = useState<ImportResultDto | null>(null);

  if (result) {
    return (
      <section className="card center-text">
        <h1>✓ הייבוא הושלם</h1>
        <p>נוצרו {result.created} משימות. מעכשיו מעדכנים אותן כאן באתר, ולא בגיליון.</p>
        <div className="actions centered">
          <Link className="button" to="/all">
            לכל המשימות
          </Link>
          {result.documentId && (
            <Link className="button secondary-link" to="/documents">
              הגיליון נשמר במסמכים
            </Link>
          )}
          <button className="secondary" onClick={() => (setResult(null), setPreview(null))}>
            ייבוא נוסף
          </button>
        </div>
      </section>
    );
  }
  if (!preview) return <SourceStep onPreview={setPreview} />;
  return <MapAndReview preview={preview} onBack={() => setPreview(null)} onDone={setResult} />;
}

function SourceStep({ onPreview }: { onPreview: (p: ImportPreviewDto) => void }) {
  const google = useGoogleStatus();
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const run = (fn: () => Promise<ImportPreviewDto | null>) => {
    setBusy(true);
    setError(null);
    fn()
      .then((p) => p && onPreview(p))
      .catch(setError)
      .finally(() => setBusy(false));
  };
  const connected = google.data?.enabled && google.data.connected;

  return (
    <section>
      <h1>ייבוא משימות מגיליון</h1>
      <p className="muted">
        בוחרים טבלה קיימת, מתאימים את העמודות, בודקים את השורות ומאשרים. המשימות נוצרות רק אחרי האישור, והגיליון המקורי לא משתנה.
      </p>
      <GoogleConnect />
      <div className="choice-grid">
        <div className="card">
          <h2>📁 קובץ מהמחשב</h2>
          <p className="muted small">Excel (‎.xlsx) או CSV</p>
          <button disabled={busy} onClick={() => fileRef.current?.click()}>
            בחירת קובץ
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept=".xlsx,.csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) run(() => upload<ImportPreviewDto>('/api/imports/preview/upload', file));
            }}
          />
        </div>
        <div className="card">
          <h2>📊 מ-Google Drive</h2>
          <p className="muted small">בוחרים גיליון מתוך החשבון המחובר</p>
          <button
            disabled={busy || !connected}
            onClick={() =>
              run(async () => {
                const id = await pickFromDrive(google.data!, 'sheets');
                return id ? api<ImportPreviewDto>('POST', '/api/imports/preview/google', { googleFileId: id }) : null;
              })
            }
          >
            בחירה מ-Drive
          </button>
          {!connected && (
            <p className="muted small">
              {google.data?.enabled ? 'צריך קודם לחבר את Google (למעלה).' : 'יהיה זמין אחרי הגדרת החיבור ל-Google בשרת.'}
            </p>
          )}
        </div>
        <form className="card" onSubmit={(e) => (e.preventDefault(), run(() => api<ImportPreviewDto>('POST', '/api/imports/preview/link', { url })))}>
          <h2>🔗 קישור לגיליון</h2>
          <p className="muted small">עובד אם הגיליון משותף "לכל מי שיש לו את הקישור"</p>
          <input type="url" dir="ltr" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/…" />
          <button type="submit" disabled={busy}>
            קריאה
          </button>
        </form>
      </div>
      {busy && <p className="muted">קורא את הטבלה…</p>}
      <ErrorText error={error} />
    </section>
  );
}

function MapAndReview({ preview, onBack, onDone }: { preview: ImportPreviewDto; onBack: () => void; onDone: (r: ImportResultDto) => void }) {
  const me = useMe();
  const people = usePeople();
  const categories = useCategories();
  const qc = useQueryClient();
  const tablesWithData = preview.tables.map((t, i) => ({ t, i })).filter(({ t }) => t.rows.length > 0);
  const [tableIndex, setTableIndex] = useState(tablesWithData[0]?.i ?? 0);
  const [hasHeader, setHasHeader] = useState(true);
  const table = preview.tables[tableIndex] ?? { name: '', rows: [] };
  const width = Math.max(0, ...table.rows.map((r) => r.length));
  const header = hasHeader ? (table.rows[0] ?? []) : [];
  const columns = Array.from({ length: width }, (_, i) => (header[i]?.trim() ? `${header[i]} (${colName(i)})` : `עמודה ${colName(i)}`));
  const dataRows = useMemo(
    () => table.rows.slice(hasHeader ? 1 : 0).map((cells, i) => ({ cells, sourceRow: i + 1 + (hasHeader ? 1 : 0) })),
    [table, hasHeader],
  );

  const [mapping, setMapping] = useState<Mapping>(() => ({ title: -1, owner: -1, due: -1, status: -1, description: -1, participants: -1 }));
  const [appendRest, setAppendRest] = useState(true);
  const [personMap, setPersonMap] = useState<Record<string, string>>({});
  const [defaultOwner, setDefaultOwner] = useState('');
  const [statusMap, setStatusMap] = useState<Record<string, TaskStatus>>({});
  const [excluded, setExcluded] = useState<Set<number>>(new Set());
  const [categoryId, setCategoryId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Guess columns from header names whenever the table changes.
  useEffect(() => {
    const next: Mapping = { title: -1, owner: -1, due: -1, status: -1, description: -1, participants: -1 };
    const used = new Set<number>();
    for (const f of FIELDS) {
      const i = header.findIndex((h, idx) => !used.has(idx) && GUESS[f].test(h ?? ''));
      if (i >= 0) (next[f] = i), used.add(i);
    }
    if (next.title < 0 && width > 0) next.title = [...Array(width).keys()].find((i) => !used.has(i)) ?? 0;
    setMapping(next);
    setExcluded(new Set());
  }, [tableIndex, hasHeader, width]);

  useEffect(() => {
    if (me.data && !defaultOwner) setDefaultOwner(me.data.personId);
  }, [me.data, defaultOwner]);

  const cell = (cells: string[], f: Field) => (mapping[f] >= 0 ? (cells[mapping[f]] ?? '').trim() : '');
  const nameValues = useMemo(() => {
    const s = new Set<string>();
    for (const r of dataRows) {
      const o = cell(r.cells, 'owner');
      if (o) s.add(o);
      for (const n of splitNames(cell(r.cells, 'participants'))) s.add(n);
    }
    return [...s].sort();
  }, [dataRows, mapping.owner, mapping.participants]);
  const statusValues = useMemo(() => [...new Set(dataRows.map((r) => cell(r.cells, 'status')))].sort(), [dataRows, mapping.status]);

  // Auto-match names and statuses; manual choices are kept.
  useEffect(() => {
    if (!people.data) return;
    setPersonMap((prev) => Object.fromEntries(nameValues.map((v) => [v, prev[v] ?? matchPerson(v, people.data!)])));
  }, [nameValues, people.data]);
  useEffect(() => {
    setStatusMap((prev) => Object.fromEntries(statusValues.map((v) => [v, prev[v] ?? guessStatus(v)])));
  }, [statusValues]);

  const personName = (id: string) => people.data?.find((p) => p.id === id)?.displayName ?? '';
  const mappedCols = new Set(Object.values(mapping).filter((i) => i >= 0));

  const rows = dataRows.map((r) => {
    const title = cell(r.cells, 'title');
    const ownerRaw = cell(r.cells, 'owner');
    const dueRaw = cell(r.cells, 'due');
    const dueDate = dueRaw ? parseLooseDate(dueRaw) : null;
    const extra = appendRest
      ? r.cells
          .map((v, i) => (!mappedCols.has(i) && v.trim() ? `${header[i]?.trim() || `עמודה ${colName(i)}`}: ${v.trim()}` : ''))
          .filter(Boolean)
      : [];
    // A due date we cannot read is kept as text, so nothing written in the sheet is lost.
    const unreadDue = dueRaw && !dueDate ? `${header[mapping.due]?.trim() || 'תאריך יעד'}: ${dueRaw}` : '';
    const description = [cell(r.cells, 'description'), unreadDue, ...extra].filter(Boolean).join('\n');
    const ownerPersonId = ownerRaw ? personMap[ownerRaw] || '' : defaultOwner;
    const participantIds = [...new Set(splitNames(cell(r.cells, 'participants')).map((n) => personMap[n]).filter((x): x is string => Boolean(x)))];
    const warnings: string[] = [];
    if (!title) warnings.push('אין כותרת, השורה תדלג');
    if (ownerRaw && !personMap[ownerRaw]) warnings.push(`"${ownerRaw}" לא הותאם לאדם`);
    if (dueRaw && !dueDate) warnings.push(`תאריך לא מזוהה: "${dueRaw}" (יישמר בפרטים)`);
    return {
      ...r,
      title,
      description,
      ownerPersonId,
      dueDate,
      status: statusMap[cell(r.cells, 'status')] ?? 'new',
      participantIds,
      warnings,
      valid: Boolean(title && ownerPersonId),
    };
  });
  const selected = rows.filter((r) => r.valid && !excluded.has(r.sourceRow));
  const blocked = rows.filter((r) => r.title && !r.ownerPersonId && !excluded.has(r.sourceRow)).length;

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await api<ImportResultDto>('POST', '/api/imports', {
        sourceName: preview.sourceName,
        sheetName: table.name,
        googleFileId: preview.googleFileId,
        categoryId: categoryId || null,
        rows: selected.map((r) => ({
          sourceRow: r.sourceRow,
          title: r.title.slice(0, 300),
          description: r.description,
          ownerPersonId: r.ownerPersonId,
          dueDate: r.dueDate,
          status: r.status,
          participantIds: r.participantIds.filter((p) => p !== r.ownerPersonId),
        })),
      });
      await qc.invalidateQueries();
      onDone(res);
    } catch (e) {
      setError(e);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section>
      <div className="page-head">
        <h1>ייבוא: {preview.sourceName}</h1>
        <button className="secondary" onClick={onBack}>
          → בחירת מקור אחר
        </button>
      </div>
      {preview.truncated && <p className="notice small">הטבלה גדולה. נקראו רק 2,000 השורות ו-40 העמודות הראשונות.</p>}

      <div className="card stack">
        <h2>1. הטבלה והעמודות</h2>
        <div className="row wrap">
          {tablesWithData.length > 1 && (
            <label>
              לשונית
              <select value={tableIndex} onChange={(e) => setTableIndex(Number(e.target.value))}>
                {tablesWithData.map(({ t, i }) => (
                  <option key={i} value={i}>
                    {t.name} ({t.rows.length} שורות)
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="check">
            <input type="checkbox" checked={hasHeader} onChange={(e) => setHasHeader(e.target.checked)} />
            השורה הראשונה היא כותרות
          </label>
        </div>
        <div className="mapping-grid">
          {FIELDS.map((f) => (
            <label key={f}>
              {FIELD_LABEL[f]}
              <select value={mapping[f]} onChange={(e) => setMapping({ ...mapping, [f]: Number(e.target.value) })}>
                <option value={-1}>{f === 'title' ? 'בחירה…' : 'אין'}</option>
                {columns.map((c, i) => (
                  <option key={i} value={i}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={appendRest} onChange={(e) => setAppendRest(e.target.checked)} />
          לצרף את שאר העמודות לפרטי המשימה, כדי שלא ילך לאיבוד מידע
        </label>
      </div>

      <div className="card stack">
        <h2>2. אנשים וסטטוסים</h2>
        <label className="inline">
          אחראי לשורות בלי אחראי
          <PersonPicker people={people.data ?? []} value={defaultOwner} onChange={setDefaultOwner} />
        </label>
        {nameValues.length > 0 && (
          <table className="task-table compact">
            <thead>
              <tr>
                <th>בגיליון כתוב</th>
                <th>באתר זה</th>
              </tr>
            </thead>
            <tbody>
              {nameValues.map((v) => (
                <tr key={v}>
                  <td>{v}</td>
                  <td>
                    <PersonPicker
                      people={people.data ?? []}
                      value={personMap[v] ?? ''}
                      onChange={(id) => setPersonMap({ ...personMap, [v]: id })}
                      suggestName={v}
                      onCreated={(p) => {
                        qc.invalidateQueries({ queryKey: ['people'] });
                        setPersonMap((m) => ({ ...m, [v]: p.id }));
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {mapping.status >= 0 && (
          <table className="task-table compact">
            <thead>
              <tr>
                <th>בעמודת הסטטוס כתוב</th>
                <th>סטטוס באתר</th>
              </tr>
            </thead>
            <tbody>
              {statusValues.map((v) => (
                <tr key={v}>
                  <td>{v || <span className="muted">(ריק)</span>}</td>
                  <td>
                    <select value={statusMap[v] ?? 'new'} onChange={(e) => setStatusMap({ ...statusMap, [v]: e.target.value as TaskStatus })}>
                      {TASK_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card stack">
        <h2>3. בדיקת השורות</h2>
        <p className="small">
          ייווצרו <strong>{selected.length}</strong> משימות מתוך {rows.length} שורות.
          {blocked > 0 && <span className="error"> ל-{blocked} שורות אין אחראי. צריך להתאים אותן למעלה.</span>}
        </p>
        <div className="table-scroll">
          <table className="task-table compact review">
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="בחירת הכל"
                    checked={excluded.size === 0}
                    onChange={(e) => setExcluded(e.target.checked ? new Set() : new Set(rows.map((r) => r.sourceRow)))}
                  />
                </th>
                <th>שורה</th>
                <th>משימה</th>
                <th>אחראי</th>
                <th>יעד</th>
                <th>סטטוס</th>
                <th>הערות</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.sourceRow} className={!r.valid || excluded.has(r.sourceRow) ? 'archived' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      disabled={!r.valid}
                      checked={r.valid && !excluded.has(r.sourceRow)}
                      onChange={(e) => {
                        const next = new Set(excluded);
                        if (e.target.checked) next.delete(r.sourceRow);
                        else next.add(r.sourceRow);
                        setExcluded(next);
                      }}
                    />
                  </td>
                  <td className="muted">{r.sourceRow}</td>
                  <td title={r.description}>{r.title || '—'}</td>
                  <td>{personName(r.ownerPersonId) || '—'}</td>
                  <td>{formatDate(r.dueDate)}</td>
                  <td>{STATUS_LABEL[r.status]}</td>
                  <td className="small error">{r.warnings.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {preview.googleFileId && categories.data && categories.data.length > 0 && (
          <label className="inline">
            קטגוריה לגיליון המקור
            <select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">ללא</option>
              {categories.data.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <ErrorText error={error} />
        <div className="actions">
          <button disabled={submitting || selected.length === 0 || blocked > 0} onClick={submit}>
            אישור ויצירת {selected.length} משימות
          </button>
        </div>
      </div>
    </section>
  );
}

function PersonPicker({
  people,
  value,
  onChange,
  suggestName,
  onCreated,
}: {
  people: PersonDto[];
  value: string;
  onChange: (id: string) => void;
  suggestName?: string;
  onCreated?: (p: PersonDto) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<unknown>(null);
  if (creating && suggestName && onCreated) {
    return (
      <form
        className="row-inline"
        onSubmit={(e) => {
          e.preventDefault();
          api<PersonDto>('POST', '/api/people', { displayName: suggestName, email, role: null }).then((p) => (setCreating(false), onCreated(p)), setError);
        }}
      >
        <input type="email" dir="ltr" required placeholder={`המייל של ${suggestName}`} value={email} onChange={(e) => setEmail(e.target.value)} />
        <button type="submit">הוספה</button>
        <button type="button" className="link" onClick={() => setCreating(false)}>
          ביטול
        </button>
        <ErrorText error={error} />
      </form>
    );
  }
  return (
    <select
      value={value}
      onChange={(e) => (e.target.value === '__new' ? setCreating(true) : onChange(e.target.value))}
      className={value ? '' : 'unmatched'}
    >
      <option value="">לא הותאם</option>
      {people
        .filter((p) => p.active)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName}
          </option>
        ))}
      {suggestName && onCreated && <option value="__new">+ הוספת "{suggestName}" כאיש קשר חדש…</option>}
    </select>
  );
}
