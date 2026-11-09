import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { InstitutionsDto } from '@org/shared';
import { api } from '../api';
import { ErrorText } from '../components/common';
import { ConnectSheet, SheetSourceBar, type SheetListConfig } from '../components/SheetSource';

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+*#]/g, '')}`;

const CFG: SheetListConfig = {
  base: '/api/institutions',
  queryKey: ['institutions'],
  noun: 'מוסדות',
  columns: ['שם הישיבה / כולל', 'עיר', 'כתובת', 'טלפון', 'איש קשר', 'טלפון איש קשר', 'מייל איש קשר', 'הערות'],
  requiredColumn: 'שם הישיבה / כולל',
};

/** Yeshivas and kollels, read from the organisation's Google Sheet. */
export function InstitutionsPage() {
  const data = useQuery({ queryKey: CFG.queryKey, queryFn: () => api<InstitutionsDto>('GET', CFG.base) });
  const [q, setQ] = useState('');
  const [city, setCity] = useState('');
  const [changing, setChanging] = useState(false);

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
  if (!d.sheetUrl || changing) return <ConnectSheet info={d} cfg={CFG} onDone={() => setChanging(false)} />;

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
        <span className="muted small">{shown.length === items.length ? `${items.length} מוסדות` : `${shown.length} מתוך ${items.length}`}</span>
      </div>
      <SheetSourceBar info={d} cfg={CFG} onReplace={() => setChanging(true)} />

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
