import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { DistributionPointsDto, SheetColumnsDto } from '@org/shared';
import { api } from '../api';
import { ErrorText } from '../components/common';
import { ConnectSheet, SheetSourceBar, type SheetListConfig } from '../components/SheetSource';

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+*#]/g, '')}`;

const CFG: SheetListConfig = {
  base: '/api/distribution-points',
  queryKey: ['distribution-points'],
  noun: 'מוקדי חלוקה',
  columns: ['שם', 'טלפון', 'עיר', 'הערות'],
  requiredColumn: 'שם',
};

/** Distribution points, read from the organisation's Google Sheet. */
export function DistributionPage() {
  const data = useQuery({ queryKey: CFG.queryKey, queryFn: () => api<DistributionPointsDto>('GET', CFG.base) });
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [onlyNotes, setOnlyNotes] = useState(false);
  const [changing, setChanging] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [view, setView] = useState<'table' | 'cards'>(() => {
    try {
      return localStorage.getItem('distribution-view') === 'cards' ? 'cards' : 'table';
    } catch {
      return 'table';
    }
  });
  const switchView = (v: 'table' | 'cards') => {
    setView(v);
    try {
      localStorage.setItem('distribution-view', v);
    } catch {
      /* fine */
    }
  };

  const items = data.data?.items ?? [];
  const cities = useMemo(() => [...new Set(items.map((i) => i.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he')), [items]);
  const withNotes = items.filter((i) => i.notes).length;
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    return items.filter(
      (i) =>
        (!city || i.city === city) &&
        (!onlyNotes || i.notes) &&
        (!term ||
          [i.name, i.city, i.notes, ...i.extra.map(([, v]) => v), ...i.cells].some((v) => v.toLowerCase().includes(term)) ||
          (digits !== '' && [i.phone, ...i.cells].some((v) => v.replace(/\D/g, '').includes(digits)))),
    );
  }, [items, q, city, onlyNotes]);

  if (data.isLoading) return <p className="muted">טוען…</p>;
  if (!data.data) return <ErrorText error={data.error} />;
  const d = data.data;
  if (!d.sheetUrl || changing) return <ConnectSheet info={d} cfg={CFG} onDone={() => setChanging(false)} />;

  return (
    <section className="inst-page">
      <div className="inst-bar">
        <div className="segmented" role="tablist" aria-label="תצוגה">
          <button type="button" role="tab" aria-selected={view === 'table'} className={view === 'table' ? 'active' : ''} onClick={() => switchView('table')}>
            טבלה
          </button>
          <button type="button" role="tab" aria-selected={view === 'cards'} className={view === 'cards' ? 'active' : ''} onClick={() => switchView('cards')}>
            כרטיסים
          </button>
        </div>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש בכל העמודות" aria-label="חיפוש" />
        {cities.length > 1 && (
          <select value={city} onChange={(e) => setCity(e.target.value)} aria-label="סינון לפי עיר">
            <option value="">כל הערים</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        )}
        {withNotes > 0 && (
          <button type="button" aria-pressed={onlyNotes} className={`cc-chip${onlyNotes ? ' active' : ''}`} onClick={() => setOnlyNotes((v) => !v)}>
            {onlyNotes ? '✓ ' : ''}רק עם הערות <span>{withNotes}</span>
          </button>
        )}
        <span className="muted small">{shown.length === items.length ? `${items.length} מוקדים` : `מוצגים ${shown.length} מתוך ${items.length} מוקדים`}</span>
        {shown.length !== items.length && (
          <button type="button" className="link small" onClick={() => (setQ(''), setCity(''), setOnlyNotes(false))}>
            הצגת הכול
          </button>
        )}
      </div>
      <SheetSourceBar info={d} cfg={CFG} onReplace={() => setChanging(true)} />
      {d.stats && (
        <div className={`dp-stats small${d.stats.skipped > 0 ? ' warn' : ''}`}>
          <span>
            בקובץ <strong>{d.stats.rowsInSheet}</strong> שורות · נטענו <strong>{d.stats.loaded}</strong>
            {d.stats.skipped > 0 && (
              <>
                {' '}
                · <strong>{d.stats.skipped}</strong> שורות דולגו, כי העמודה "{d.stats.columns.name || '—'}" ריקה בהן
              </>
            )}
            {d.stats.manual && ' · העמודות נבחרו ידנית'}
          </span>
          <button type="button" className="link" onClick={() => setChoosing(true)}>
            בחירת עמודות
          </button>
        </div>
      )}
      {choosing && <ColumnsDialog onClose={() => setChoosing(false)} />}

      {items.length > 0 && shown.length === 0 && <p className="muted">אין מוקדים שמתאימים לחיפוש.</p>}
      {view === 'table' && shown.length > 0 && <PointsTable headers={d.headers} fieldColumns={d.fieldColumns} rows={shown} />}
      {view === 'cards' && <ul className="plain inst-grid">
        {shown.map((i) => (
          <li key={i.id} className={`inst-card${i.notes ? ' has-notes' : ''}`}>
            <div className="inst-head">
              <strong className="inst-name">{i.name || <span className="muted">(ללא שם)</span>}</strong>
              {i.city && <span className="job-tag">{i.city}</span>}
            </div>
            {i.phone && (
              <a className="inst-line" href={telHref(i.phone)} dir="ltr">
                📞 {i.phone}
              </a>
            )}
            {i.extra.length > 0 && (
              <dl className="dp-extra">
                {i.extra.map(([k, v]) => (
                  <div key={k}>
                    <dt>{k.replace(/[?:]\s*$/, '')}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
            )}
            {i.notes ? (
              <p className="dp-notes">
                <span className="inst-contact-label">הערות</span>
                {i.notes}
              </p>
            ) : (
              <span className="muted small">אין הערות</span>
            )}
          </li>
        ))}
      </ul>}
    </section>
  );
}

type Point = DistributionPointsDto['items'][number];

/**
 * Our own table of the points: city first (on the right), then name and phone, the sheet's other
 * columns, and notes last. Sorted by city, each city written once beside its points.
 */
function PointsTable({ headers, fieldColumns, rows }: { headers: string[]; fieldColumns: Record<string, string>; rows: Point[] }) {
  const mapped = new Set(['name', 'phone', 'city', 'notes'].map((f) => fieldColumns[f]).filter(Boolean));
  // The sheet's other columns: with a header or a value, and not just repeating the name.
  const width = Math.max(headers.length, ...rows.map((r) => r.cells.length));
  const others = Array.from({ length: width }, (_, i) => i).filter((i) => {
    const h = (headers[i] ?? '').trim();
    if (h && mapped.has(h)) return false;
    const values = rows.map((r) => r.cells[i] ?? '');
    if (!values.some(Boolean)) return false;
    return !rows.every((r) => !(r.cells[i] ?? '') || (r.cells[i] ?? '') === r.name);
  });
  const label = (i: number) => {
    const h = (headers[i] ?? '').trim();
    return !h || /^עמודה\s*\d+$/.test(h) ? 'פרטים' : h.replace(/[?:]\s*$/, '');
  };

  const sorted = [...rows].sort((x, y) => (x.city || '\uffff').localeCompare(y.city || '\uffff', 'he') || x.name.localeCompare(y.name, 'he'));
  const groups: { city: string; rows: Point[] }[] = [];
  for (const r of sorted) {
    if (groups.at(-1)?.city !== r.city) groups.push({ city: r.city, rows: [] });
    groups.at(-1)!.rows.push(r);
  }

  return (
    <div className="pt-wrap">
      <table className="pt-table">
        <thead>
          <tr>
            <th className="pt-city">עיר</th>
            <th>שם</th>
            <th>טלפון</th>
            {others.map((i) => (
              <th key={i}>{label(i)}</th>
            ))}
            <th className="pt-notes-h">הערות</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.city || '-'} className="pt-group">
            {g.rows.map((r, n) => (
              <tr key={r.id} className={r.notes ? 'has-notes' : ''}>
                {n === 0 && (
                  <th scope="rowgroup" rowSpan={g.rows.length} className="pt-city">
                    <span>{g.city || 'ללא עיר'}</span>
                    {g.rows.length > 1 && <small>{g.rows.length} מוקדים</small>}
                  </th>
                )}
                <td className="pt-name">{r.name || <span className="muted">—</span>}</td>
                <td className="pt-phone">
                  {r.phone ? (
                    <a href={telHref(r.phone)} dir="ltr">
                      {r.phone}
                    </a>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </td>
                {others.map((i) => (
                  <td key={i}>{r.cells[i] ?? ''}</td>
                ))}
                <td className="pt-notes">{r.notes}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

const FIELDS = [
  ['name', 'שם המוקד', true],
  ['phone', 'טלפון', false],
  ['city', 'עיר', false],
  ['notes', 'הערות', false],
] as const;

/** Shows the sheet's headers and first rows; the manager picks which column is which. */
function ColumnsDialog({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const preview = useQuery({ queryKey: ['distribution-columns'], queryFn: () => api<SheetColumnsDto>('GET', `${CFG.base}/columns`), gcTime: 0 });
  const [pick, setPick] = useState<Record<string, string> | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  useEffect(() => {
    if (preview.data && !pick) setPick({ ...preview.data.columns });
  }, [preview.data, pick]);

  const close = () => (ref.current?.close(), onClose());
  const save = async (columns: Record<string, string | null> | null) => {
    setPending(true);
    setError(null);
    try {
      qc.setQueryData(CFG.queryKey, await api<DistributionPointsDto>('PUT', `${CFG.base}/columns`, { columns }));
      close();
    } catch (e) {
      setError(e);
    } finally {
      setPending(false);
    }
  };
  const p = preview.data;
  const nameIdx = p && pick ? p.headers.indexOf(pick.name ?? '') : -1;
  const withName = p && nameIdx >= 0 ? p.sample.filter((r) => r[nameIdx]).length : 0;

  return (
    <dialog ref={ref} className="task-dialog cols-dialog" onClose={onClose} onClick={(e) => e.target === ref.current && close()} aria-labelledby="cols-title">
      <form
        className="task-dialog-body"
        onSubmit={(e) => {
          e.preventDefault();
          if (pick) void save({ name: pick.name!, phone: pick.phone || null, city: pick.city || null, notes: pick.notes || null });
        }}
      >
        <h2 id="cols-title">איזו עמודה היא מה?</h2>
        {preview.isLoading && <p className="muted">קורא את הקובץ…</p>}
        <ErrorText error={preview.error} />
        {p && pick && (
          <>
            <p className="small muted">
              בקובץ {p.rowsInSheet} שורות. בחרו לכל שדה את העמודה שלו. שורה בלי ערך בעמודת השם לא תיכנס. עמודות שלא נבחרו יוצגו בכרטיס בשם שלהן.
            </p>
            <div className="cols-grid">
              {FIELDS.map(([f, label, required]) => (
                <label key={f}>
                  {label}
                  {required && ' *'}
                  <select value={pick[f] ?? ''} onChange={(e) => setPick({ ...pick, [f]: e.target.value })} required={required}>
                    <option value="">{required ? 'בחירה…' : '— אין —'}</option>
                    {p.headers.map((h, i) =>
                      h ? (
                        <option key={i} value={h}>
                          {h}
                        </option>
                      ) : null,
                    )}
                  </select>
                </label>
              ))}
            </div>
            <div className="cols-preview">
              <table>
                <thead>
                  <tr>
                    {p.headers.map((h, i) => {
                      const f = FIELDS.find(([k]) => pick[k] === h && h);
                      return (
                        <th key={i} className={f ? 'picked' : ''}>
                          {h || <span className="muted">(ללא כותרת)</span>}
                          {f && <span className="cols-badge">{f[1]}</span>}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {p.sample.map((r, ri) => (
                    <tr key={ri} className={nameIdx >= 0 && !r[nameIdx] ? 'skipped' : ''}>
                      {r.map((c, ci) => (
                        <td key={ci}>{c}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {nameIdx >= 0 && p.sample.length > 0 && (
              <p className="small muted">
                מתוך {p.sample.length} השורות הראשונות, {withName} ייכנסו. שורות באפור ידלגו כי אין בהן שם.
              </p>
            )}
          </>
        )}
        <ErrorText error={error} />
        <div className="task-dialog-actions">
          <button type="submit" disabled={pending || !pick?.name}>
            {pending ? 'שומר…' : 'שמירה'}
          </button>
          <button type="button" className="link" onClick={close}>
            ביטול
          </button>
          <button type="button" className="link" disabled={pending} onClick={() => void save(null)}>
            חזרה לזיהוי אוטומטי
          </button>
        </div>
      </form>
    </dialog>
  );
}
