import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InstitutionsDto } from '@org/shared';
import { api, ApiError } from '../api';
import { ErrorText } from '../components/common';
import { shortTime } from '../he';

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+*#]/g, '')}`;
const COLUMNS = ['שם הישיבה / כולל', 'עיר', 'כתובת', 'טלפון', 'איש קשר', 'טלפון איש קשר', 'מייל איש קשר', 'הערות'];

const ERRORS: Record<string, string> = {
  sheet_not_accessible: 'אין גישה לקובץ. בשיטס לוחצים "שיתוף", ובוחרים "כל מי שיש לו את הקישור" עם הרשאת צפייה, ואז מנסים שוב.',
};
const sheetError = (e: unknown) =>
  e instanceof ApiError && ERRORS[e.code]
    ? ERRORS[e.code]
    : e instanceof ApiError && /No rows/.test(e.message)
      ? 'לא נמצאו בקובץ שורות עם שם ישיבה / כולל. בדקו שהנתונים נמצאים בלשונית הראשונה.'
      : e instanceof ApiError && /not a Google Sheets/.test(e.message)
        ? 'זה לא קישור לקובץ גוגל שיטס.'
        : null;

/** Yeshivas and kollels, read from the organisation's Google Sheet. */
export function InstitutionsPage() {
  const data = useQuery({ queryKey: ['institutions'], queryFn: () => api<InstitutionsDto>('GET', '/api/institutions') });
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [changing, setChanging] = useState(false);
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);

  const items = data.data?.items ?? [];
  const cities = useMemo(() => [...new Set(items.map((i) => i.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he')), [items]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    return items.filter(
      (i) =>
        (!city || i.city === city) &&
        (!term ||
          [i.name, i.city, i.address, i.contactName, i.contactEmail, i.notes].some((v) => v.toLowerCase().includes(term)) ||
          (digits !== '' && [i.phone, i.contactPhone].some((v) => v.replace(/\D/g, '').includes(digits)))),
    );
  }, [items, q, city]);

  if (data.isLoading) return <p className="muted">טוען…</p>;
  if (!data.data) return <ErrorText error={data.error} />;
  const d = data.data;

  const refresh = async () => {
    setRefreshing(true);
    setRefreshError(null);
    try {
      qc.setQueryData(['institutions'], await api<InstitutionsDto>('POST', '/api/institutions/refresh'));
    } catch (e) {
      setRefreshError(e);
      void qc.invalidateQueries({ queryKey: ['institutions'] });
    } finally {
      setRefreshing(false);
    }
  };

  if (!d.sheetUrl || changing) {
    return d.canManage ? (
      <ConnectSheet current={d.sheetUrl} onCancel={d.sheetUrl ? () => setChanging(false) : undefined} onDone={() => setChanging(false)} />
    ) : (
      <div className="calls-empty">
        <p>עוד לא חובר קובץ מוסדות.</p>
        <p className="muted small">מנהל צריך לחבר קובץ גוגל שיטס עם רשימת המוסדות.</p>
      </div>
    );
  }

  return (
    <section className="inst-page">
      <div className="inst-bar">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי שם, עיר, איש קשר, טלפון…" aria-label="חיפוש" />
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
        <span className="muted small">
          {shown.length === items.length ? `${items.length} מוסדות` : `${shown.length} מתוך ${items.length}`}
        </span>
      </div>

      <div className="inst-source small">
        <span className="muted">
          הנתונים מגיעים מ<a href={d.sheetUrl} target="_blank" rel="noreferrer">קובץ השיטס</a>
          {d.syncedAt && <> · עודכן {shortTime(d.syncedAt)}</>} · כדי לשנות פרטים, עורכים בקובץ והאתר מתעדכן לבד.
        </span>
        {d.canManage && (
          <>
            <button type="button" className="link" onClick={refresh} disabled={refreshing}>
              {refreshing ? 'מעדכן…' : 'עדכון עכשיו'}
            </button>
            <button type="button" className="link" onClick={() => setChanging(true)}>
              החלפת קובץ
            </button>
          </>
        )}
      </div>
      {(refreshError || d.syncError) && (
        <p className="error">העדכון האחרון מהקובץ נכשל, ומוצגת הרשימה הקודמת. {sheetError(refreshError) ?? (d.syncError ? ERRORS.sheet_not_accessible : '')}</p>
      )}
      {d.canManage && d.unmatchedColumns.length > 0 && (
        <p className="muted small">עמודות בקובץ שלא מוצגות כאן: {d.unmatchedColumns.join(', ')}</p>
      )}

      {items.length > 0 && shown.length === 0 && <p className="muted">אין מוסדות שמתאימים לחיפוש.</p>}
      <ul className="plain inst-grid">
        {shown.map((i) => (
          <li key={i.id} className="inst-card">
            <div className="inst-head">
              <strong className="inst-name">{i.name}</strong>
              {i.city && <span className="job-tag">{i.city}</span>}
            </div>
            {i.address && <span className="inst-line">📍 {i.address}</span>}
            {i.phone && (
              <a className="inst-line" href={telHref(i.phone)} dir="ltr">
                📞 {i.phone}
              </a>
            )}
            {(i.contactName || i.contactPhone || i.contactEmail) && (
              <div className="inst-contact">
                <span className="inst-contact-label">איש קשר</span>
                {i.contactName && <span>{i.contactName}</span>}
                {i.contactPhone && (
                  <a href={telHref(i.contactPhone)} dir="ltr">
                    📞 {i.contactPhone}
                  </a>
                )}
                {i.contactEmail && (
                  <a href={`mailto:${i.contactEmail}`} dir="ltr">
                    ✉️ {i.contactEmail}
                  </a>
                )}
              </div>
            )}
            {i.notes && <p className="inst-notes">{i.notes}</p>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A manager pastes the Google Sheets link. */
function ConnectSheet({ current, onCancel, onDone }: { current: string | null; onCancel?: () => void; onDone: () => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState(current ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  return (
    <form
      className="card stack inst-connect"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        try {
          qc.setQueryData(['institutions'], await api<InstitutionsDto>('PUT', '/api/institutions/source', { url: url.trim() }));
          onDone();
        } catch (err) {
          setError(err);
        } finally {
          setPending(false);
        }
      }}
    >
      <h2>{current ? 'החלפת קובץ המוסדות' : 'חיבור קובץ מוסדות'}</h2>
      <p className="small">
        מדביקים כאן קישור לקובץ גוגל שיטס. האתר יקרא את <strong>הלשונית הראשונה</strong>, ויתעדכן לבד בכל פעם שמשנים את הקובץ.
      </p>
      <div className="small">
        <strong>העמודות בקובץ:</strong>
        <div className="inst-columns">
          {COLUMNS.map((c) => (
            <span key={c} className="job-tag">
              {c}
            </span>
          ))}
        </div>
        <span className="muted">השורה הראשונה היא כותרות. הסדר לא משנה, ואין חובה למלא את כל העמודות.</span>
      </div>
      <p className="small muted">
        אם הקובץ פרטי: בשיטס לוחצים "שיתוף", ובוחרים "כל מי שיש לו את הקישור" עם הרשאת צפייה. אם חיברתם את גוגל דרייב באתר, אפשר גם קובץ פרטי שלכם.
      </p>
      <label>
        קישור לקובץ
        <input type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" dir="ltr" autoFocus />
      </label>
      {error ? sheetError(error) ? <p className="error">{sheetError(error)}</p> : <ErrorText error={error} /> : null}
      <div className="actions">
        <button type="submit" disabled={pending || !url.trim()}>
          {pending ? 'קורא את הקובץ…' : 'חיבור'}
        </button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            ביטול
          </button>
        )}
      </div>
    </form>
  );
}
