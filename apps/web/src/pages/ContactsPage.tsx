import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { SheetContactsDto } from '@org/shared';
import { api, useMe } from '../api';
import { Avatar } from '../components/Avatar';
import { ErrorText, usePeopleMap } from '../components/common';
import { ConnectSheet, SheetSourceBar, type SheetListConfig } from '../components/SheetSource';

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+*#]/g, '')}`;

const CFG: SheetListConfig = {
  base: '/api/sheet-contacts',
  queryKey: ['sheet-contacts'],
  noun: 'אנשי קשר',
  columns: ['שם', 'טלפון', 'מייל', 'אחראי', 'כתובת'],
  requiredColumn: 'שם',
};

/**
 * Two lists: contacts from the organisation's Google Sheet (managers and members),
 * and the organisation's own people with their profiles (everyone).
 */
export function ContactsPage() {
  const me = useMe();
  const isTeam = me.data?.access === 'manager' || me.data?.access === 'member';
  const [params, setParams] = useSearchParams();
  const view = isTeam && params.get('view') !== 'team' ? 'sheet' : 'team';
  return (
    <>
      {isTeam && (
        <div className="segmented" role="tablist" aria-label="אנשי קשר">
          <button role="tab" aria-selected={view === 'sheet'} className={view === 'sheet' ? 'active' : ''} onClick={() => setParams({})}>
            אנשי קשר
          </button>
          <button role="tab" aria-selected={view === 'team'} className={view === 'team' ? 'active' : ''} onClick={() => setParams({ view: 'team' })}>
            צוות הארגון
          </button>
        </div>
      )}
      {view === 'sheet' ? <SheetContacts /> : <TeamDirectory />}
    </>
  );
}

function SheetContacts() {
  const data = useQuery({ queryKey: CFG.queryKey, queryFn: () => api<SheetContactsDto>('GET', CFG.base) });
  const [q, setQ] = useState('');
  const [responsible, setResponsible] = useState('');
  const [changing, setChanging] = useState(false);
  const items = data.data?.items ?? [];
  const owners = useMemo(() => [...new Set(items.map((i) => i.responsible).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he')), [items]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    return items.filter(
      (i) =>
        (!responsible || i.responsible === responsible) &&
        (!term ||
          [i.name, i.email, i.responsible, i.address].some((v) => v.toLowerCase().includes(term)) ||
          (digits !== '' && i.phone.replace(/\D/g, '').includes(digits))),
    );
  }, [items, q, responsible]);

  if (data.isLoading) return <p className="muted">טוען…</p>;
  if (!data.data) return <ErrorText error={data.error} />;
  const d = data.data;
  if (!d.sheetUrl || changing) return <ConnectSheet info={d} cfg={CFG} onDone={() => setChanging(false)} />;

  return (
    <section className="contacts-page">
      <div className="inst-bar">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי שם, טלפון, מייל, אחראי או כתובת" aria-label="חיפוש" />
        {owners.length > 1 && (
          <select value={responsible} onChange={(e) => setResponsible(e.target.value)} aria-label="סינון לפי אחראי">
            <option value="">כל האחראים</option>
            {owners.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        )}
        <span className="muted small">{shown.length === items.length ? `${items.length} אנשי קשר` : `${shown.length} מתוך ${items.length}`}</span>
      </div>
      <SheetSourceBar info={d} cfg={CFG} onReplace={() => setChanging(true)} />
      {items.length > 0 && shown.length === 0 && <p className="muted">אין אנשי קשר שמתאימים לחיפוש.</p>}
      <ul className="plain contacts-grid">
        {shown.map((c) => (
          <li key={c.id} className="contact-card">
            <div className="contact-head">
              <span className="sheet-avatar" aria-hidden="true">
                {c.name.trim().slice(0, 1)}
              </span>
              <span className="contact-name">
                <strong>{c.name}</strong>
                {c.responsible && <span className="job-tag">אחראי: {c.responsible}</span>}
              </span>
            </div>
            <div className="contact-lines">
              {c.phone && (
                <a href={telHref(c.phone)} dir="ltr" className="contact-line">
                  📞 {c.phone}
                </a>
              )}
              {c.email && (
                <a href={`mailto:${c.email}`} className="contact-line" dir="ltr">
                  ✉️ {c.email}
                </a>
              )}
              {c.address && <span className="contact-line wrap">📍 {c.address}</span>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Everyone in the organisation, with their contact details and a link to their profile. */
function TeamDirectory() {
  const me = useMe();
  const people = usePeopleMap();
  const [q, setQ] = useState('');

  const list = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    return people.list
      .filter((p) => p.active)
      .filter(
        (p) =>
          !term ||
          p.displayName.toLowerCase().includes(term) ||
          (p.jobTitle ?? '').toLowerCase().includes(term) ||
          p.email.toLowerCase().includes(term) ||
          (digits !== '' && (p.phone ?? '').replace(/\D/g, '').includes(digits)),
      );
  }, [people.list, q]);

  const myPhoneMissing = people.list.find((p) => p.id === me.data?.personId && !p.phone);

  return (
    <section className="contacts-page">
      <div className="contacts-top">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש לפי שם, תפקיד, טלפון או מייל" aria-label="חיפוש" />
        <span className="muted small">{list.length} אנשים</span>
      </div>
      {myPhoneMissing && (
        <p className="contacts-nudge small">
          עוד לא הוספת טלפון. <Link to={`/people/${me.data!.personId}?edit=1`}>להוספה בפרופיל שלי</Link>
        </p>
      )}

      {people.list.length > 0 && list.length === 0 && <p className="muted">לא נמצאו אנשים.</p>}
      <ul className="plain contacts-grid">
        {list.map((p) => (
          <li key={p.id} className="contact-card">
            <Link to={`/people/${p.id}`} className="contact-head">
              <Avatar personId={p.id} name={p.displayName} size={52} />
              <span className="contact-name">
                <strong>{p.displayName}</strong>
                {p.jobTitle ? <span className="job-tag">{p.jobTitle}</span> : <span className="muted small">{p.role === null ? 'איש קשר' : ''}</span>}
              </span>
            </Link>
            <div className="contact-lines">
              {p.phone ? (
                <a href={telHref(p.phone)} dir="ltr" className="contact-line">
                  📞 {p.phone}
                </a>
              ) : (
                <span className="contact-line muted">📞 אין טלפון</span>
              )}
              {p.email && (
                <a href={`mailto:${p.email}`} className="contact-line" dir="ltr">
                  ✉️ {p.email}
                </a>
              )}
            </div>
            <Link to={`/people/${p.id}`} className="contact-more small">
              לפרופיל ←
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
