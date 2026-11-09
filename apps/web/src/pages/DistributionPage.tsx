import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { DistributionPointsDto } from '@org/shared';
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
        (!term || [i.name, i.city, i.notes, ...i.extra.map(([, v]) => v)].some((v) => v.toLowerCase().includes(term)) || (digits !== '' && i.phone.replace(/\D/g, '').includes(digits))),
    );
  }, [items, q, city, onlyNotes]);

  if (data.isLoading) return <p className="muted">טוען…</p>;
  if (!data.data) return <ErrorText error={data.error} />;
  const d = data.data;
  if (!d.sheetUrl || changing) return <ConnectSheet info={d} cfg={CFG} onDone={() => setChanging(false)} />;

  return (
    <section className="inst-page">
      <div className="inst-bar">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי שם, עיר, טלפון או הערה" aria-label="חיפוש" />
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

      {items.length > 0 && shown.length === 0 && <p className="muted">אין מוקדים שמתאימים לחיפוש.</p>}
      <ul className="plain inst-grid">
        {shown.map((i) => (
          <li key={i.id} className={`inst-card${i.notes ? ' has-notes' : ''}`}>
            <div className="inst-head">
              <strong className="inst-name">{i.name}</strong>
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
      </ul>
    </section>
  );
}
