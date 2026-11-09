import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../api';
import { ErrorText } from './common';
import { shortTime } from '../he';

/** What every Google-Sheet list returns about its source. */
export interface SheetSourceInfo {
  sheetUrl: string | null;
  syncedAt: string | null;
  syncError: string | null;
  unmatchedColumns: string[];
  canManage: boolean;
}

export interface SheetListConfig {
  /** e.g. "/api/institutions" – with /source and /refresh under it. */
  base: string;
  queryKey: string[];
  /** e.g. "מוסדות" */
  noun: string;
  columns: string[];
  /** The column without which a row is skipped, e.g. "שם הישיבה / כולל". */
  requiredColumn: string;
}

const NOT_ACCESSIBLE = 'אין גישה לקובץ. בשיטס לוחצים "שיתוף", ובוחרים "כל מי שיש לו את הקישור" עם הרשאת צפייה, ואז מנסים שוב.';

export function sheetErrorText(e: unknown, cfg: SheetListConfig): string | null {
  if (!(e instanceof ApiError)) return null;
  if (e.code === 'sheet_not_accessible') return NOT_ACCESSIBLE;
  if (/No rows/.test(e.message)) return `לא נמצאו בקובץ שורות עם "${cfg.requiredColumn}". בדקו שהנתונים נמצאים בלשונית הראשונה.`;
  if (/not a Google Sheets/.test(e.message)) return 'זה לא קישור לקובץ גוגל שיטס.';
  return null;
}

/** "The data comes from the sheet · updated … · update now · replace file", plus errors. */
export function SheetSourceBar({ info, cfg, onReplace }: { info: SheetSourceInfo; cfg: SheetListConfig; onReplace: () => void }) {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      qc.setQueryData(cfg.queryKey, await api('POST', `${cfg.base}/refresh`));
    } catch (e) {
      setError(e);
      void qc.invalidateQueries({ queryKey: cfg.queryKey });
    } finally {
      setRefreshing(false);
    }
  };
  return (
    <>
      <div className="inst-source small">
        <span className="muted">
          הנתונים מגיעים מ
          <a href={info.sheetUrl!} target="_blank" rel="noreferrer">
            קובץ השיטס
          </a>
          {info.syncedAt && <> · עודכן {shortTime(info.syncedAt)}</>} · כדי לשנות פרטים, עורכים בקובץ והאתר מתעדכן לבד.
        </span>
        {info.canManage && (
          <>
            <button type="button" className="link" onClick={refresh} disabled={refreshing}>
              {refreshing ? 'מעדכן…' : 'עדכון עכשיו'}
            </button>
            <button type="button" className="link" onClick={onReplace}>
              החלפת קובץ
            </button>
          </>
        )}
      </div>
      {(error || info.syncError) && (
        <p className="error">העדכון האחרון מהקובץ נכשל, ומוצגת הרשימה הקודמת. {sheetErrorText(error, cfg) ?? NOT_ACCESSIBLE}</p>
      )}
      {info.canManage && info.unmatchedColumns.length > 0 && <p className="muted small">עמודות בקובץ שלא מוצגות כאן: {info.unmatchedColumns.join(', ')}</p>}
    </>
  );
}

/** Shown when no sheet is connected yet (or while replacing it): managers paste a link, others wait. */
export function ConnectSheet({ info, cfg, onDone }: { info: SheetSourceInfo; cfg: SheetListConfig; onDone?: () => void }) {
  const qc = useQueryClient();
  const [url, setUrl] = useState(info.sheetUrl ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);

  if (!info.canManage) {
    return (
      <div className="calls-empty">
        <p>עוד לא חובר קובץ {cfg.noun}.</p>
        <p className="muted small">מנהל צריך לחבר קובץ גוגל שיטס עם רשימת ה{cfg.noun}.</p>
      </div>
    );
  }
  return (
    <form
      className="card stack inst-connect"
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError(null);
        try {
          qc.setQueryData(cfg.queryKey, await api('PUT', `${cfg.base}/source`, { url: url.trim() }));
          onDone?.();
        } catch (err) {
          setError(err);
        } finally {
          setPending(false);
        }
      }}
    >
      <h2>{info.sheetUrl ? `החלפת קובץ ה${cfg.noun}` : `חיבור קובץ ${cfg.noun}`}</h2>
      <p className="small">
        מדביקים כאן קישור לקובץ גוגל שיטס. האתר יקרא את <strong>הלשונית הראשונה</strong>, ויתעדכן לבד בכל פעם שמשנים את הקובץ.
      </p>
      <div className="small">
        <strong>העמודות בקובץ:</strong>
        <div className="inst-columns">
          {cfg.columns.map((c) => (
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
      {error ? sheetErrorText(error, cfg) ? <p className="error">{sheetErrorText(error, cfg)}</p> : <ErrorText error={error} /> : null}
      <div className="actions">
        <button type="submit" disabled={pending || !url.trim()}>
          {pending ? 'קורא את הקובץ…' : 'חיבור'}
        </button>
        {onDone && info.sheetUrl && (
          <button type="button" className="secondary" onClick={onDone}>
            ביטול
          </button>
        )}
      </div>
    </form>
  );
}
