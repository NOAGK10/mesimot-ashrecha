import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../api';
import { Avatar } from '../components/Avatar';
import { usePeopleMap } from '../components/common';

const telHref = (phone: string) => `tel:${phone.replace(/[^\d+*#]/g, '')}`;

/** Everyone in the organisation, with their contact details and a link to their profile. */
export function ContactsPage() {
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
