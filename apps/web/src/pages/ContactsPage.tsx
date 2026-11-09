import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ContactCategoryDto, SheetContactDto, SheetContactsDto } from '@org/shared';
import { api, ApiError, useMe } from '../api';
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
  const [params, setParams] = useSearchParams();
  const catId = params.get('cat') ?? '';
  const setCat = (id: string) => setParams(id ? { cat: id } : {});
  const [q, setQ] = useState('');
  const [responsible, setResponsible] = useState('');
  const [changing, setChanging] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editingMembers, setEditingMembers] = useState(false);
  const items = data.data?.items ?? [];
  const categories = data.data?.categories ?? [];
  const category = categories.find((c) => c.id === catId) ?? null;
  const inCategory = useMemo(() => (category ? items.filter((i) => i.categoryIds.includes(category.id)) : items), [items, category]);
  const owners = useMemo(() => [...new Set(inCategory.map((i) => i.responsible).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'he')), [inCategory]);
  const shown = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    return inCategory.filter(
      (i) =>
        (!responsible || i.responsible === responsible) &&
        (!term ||
          [i.name, i.email, i.responsible, i.address].some((v) => v.toLowerCase().includes(term)) ||
          (digits !== '' && i.phone.replace(/\D/g, '').includes(digits))),
    );
  }, [inCategory, q, responsible]);
  const count = (id: string) => items.filter((i) => i.categoryIds.includes(id)).length;
  const byId = new Map(categories.map((c) => [c.id, c]));

  if (data.isLoading) return <p className="muted">טוען…</p>;
  if (!data.data) return <ErrorText error={data.error} />;
  const d = data.data;
  if (!d.sheetUrl || changing) return <ConnectSheet info={d} cfg={CFG} onDone={() => setChanging(false)} />;

  return (
    <section className="contacts-page">
      <div className="cc-chips" role="tablist" aria-label="קטגוריות">
        <button type="button" role="tab" aria-selected={!category} className={`cc-chip${!category ? ' active' : ''}`} onClick={() => setCat('')}>
          הכול <span>{items.length}</span>
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={category?.id === c.id}
            className={`cc-chip${category?.id === c.id ? ' active' : ''}`}
            style={{ '--c': c.color } as React.CSSProperties}
            onClick={() => setCat(c.id)}
          >
            <span className="cc-dot" aria-hidden="true" />
            {c.name} <span>{count(c.id)}</span>
          </button>
        ))}
        {d.canManage && !adding && (
          <button type="button" className="cc-chip cc-add" onClick={() => setAdding(true)}>
            + קטגוריה
          </button>
        )}
      </div>
      {adding && <NewCategory onDone={(id) => (setAdding(false), id && (setCat(id), setEditingMembers(true)))} />}

      {category && (
        <div className="cc-head">
          <h2>
            <span className="cc-dot big" style={{ background: category.color }} aria-hidden="true" />
            {category.name}
          </h2>
          {d.canManage && <CategoryActions category={category} onEditMembers={() => setEditingMembers(true)} onDeleted={() => setCat('')} />}
        </div>
      )}

      <div className="inst-bar">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={category ? `חיפוש ב${category.name}` : 'חיפוש לפי שם, טלפון, מייל, אחראי או כתובת'}
          aria-label="חיפוש"
        />
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
        <span className="muted small">{shown.length === inCategory.length ? `${inCategory.length} אנשי קשר` : `${shown.length} מתוך ${inCategory.length}`}</span>
      </div>
      {!category && <SheetSourceBar info={d} cfg={CFG} onReplace={() => setChanging(true)} />}

      {category && inCategory.length === 0 && (
        <div className="calls-empty">
          <p>אין עדיין אנשי קשר בקטגוריה הזו.</p>
          {d.canManage && (
            <button type="button" onClick={() => setEditingMembers(true)}>
              הוספת אנשי קשר
            </button>
          )}
        </div>
      )}
      {inCategory.length > 0 && shown.length === 0 && <p className="muted">אין אנשי קשר שמתאימים לחיפוש.</p>}
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
            {c.categoryIds.length > 0 && (
              <div className="cc-tags">
                {c.categoryIds.map((id) => byId.get(id)).filter(Boolean).map((cat) => (
                  <button key={cat!.id} type="button" className="cc-tag" style={{ '--c': cat!.color } as React.CSSProperties} onClick={() => setCat(cat!.id)}>
                    {cat!.name}
                  </button>
                ))}
              </div>
            )}
          </li>
        ))}
      </ul>
      {editingMembers && category && <MembersDialog category={category} items={items} onClose={() => setEditingMembers(false)} />}
    </section>
  );
}

const CATEGORY_COLORS = ['#2456c9', '#0f8a6a', '#b4531d', '#8a3fb8', '#c2185b', '#00838f', '#6d7a12', '#a33a3a'];

function NewCategory({ onDone }: { onDone: (createdId?: string) => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [color, setColor] = useState(CATEGORY_COLORS[0]!);
  const [error, setError] = useState<unknown>(null);
  return (
    <form
      className="card row wrap cc-new"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        try {
          const c = await api<ContactCategoryDto>('POST', '/api/contact-categories', { name, color });
          await qc.invalidateQueries({ queryKey: CFG.queryKey });
          onDone(c.id);
        } catch (err) {
          setError(err);
        }
      }}
    >
      <label>
        שם הקטגוריה
        <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: תורמים, ספקים, הורים" autoFocus />
      </label>
      <div className="cc-colors" role="radiogroup" aria-label="צבע">
        {CATEGORY_COLORS.map((c) => (
          <button key={c} type="button" role="radio" aria-checked={c === color} className={`swatch${c === color ? ' selected' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`צבע ${c}`} />
        ))}
      </div>
      <button type="submit" disabled={!name.trim()}>
        יצירה
      </button>
      <button type="button" className="secondary" onClick={() => onDone()}>
        ביטול
      </button>
      {error ? <ApiErrorText error={error} /> : null}
    </form>
  );
}

function ApiErrorText({ error }: { error: unknown }) {
  return error instanceof ApiError && error.status === 409 ? <p className="error">כבר יש קטגוריה בשם הזה.</p> : <ErrorText error={error} />;
}

function CategoryActions({ category, onEditMembers, onDeleted }: { category: ContactCategoryDto; onEditMembers: () => void; onDeleted: () => void }) {
  const qc = useQueryClient();
  const [error, setError] = useState<unknown>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: CFG.queryKey });
      return true;
    } catch (e) {
      setError(e);
      return false;
    }
  };
  return (
    <div className="cc-actions">
      <button type="button" onClick={onEditMembers}>
        בחירת אנשי הקשר בקטגוריה
      </button>
      <button
        type="button"
        className="link"
        onClick={() => {
          const n = prompt('שם חדש לקטגוריה', category.name)?.trim();
          if (n && n !== category.name) void run(() => api('PATCH', `/api/contact-categories/${category.id}`, { name: n, color: category.color }));
        }}
      >
        שינוי שם
      </button>
      <button
        type="button"
        className="link danger-text"
        onClick={async () => {
          if (confirm(`למחוק את הקטגוריה "${category.name}"? אנשי הקשר עצמם לא יימחקו.`) && (await run(() => api('POST', `/api/contact-categories/${category.id}/delete`)))) onDeleted();
        }}
      >
        מחיקת הקטגוריה
      </button>
      {error ? <ApiErrorText error={error} /> : null}
    </div>
  );
}

/** Tick the contacts that belong in the category. */
function MembersDialog({ category, items, onClose }: { category: ContactCategoryDto; items: SheetContactDto[]; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const qc = useQueryClient();
  const [selected, setSelected] = useState(() => new Set(items.filter((i) => i.categoryIds.includes(category.id)).map((i) => i.key)));
  const [q, setQ] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (ref.current && !ref.current.open) ref.current.showModal();
  }, []);
  const term = q.trim().toLowerCase();
  const list = items.filter((i) => !term || [i.name, i.phone, i.email, i.responsible, i.address].some((v) => v.toLowerCase().includes(term)));
  const toggle = (key: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(key)) n.delete(key);
      else n.add(key);
      return n;
    });
  const allShownSelected = list.length > 0 && list.every((i) => selected.has(i.key));

  return (
    <dialog ref={ref} className="task-dialog cc-dialog" onClose={onClose} onClick={(e) => e.target === ref.current && ref.current?.close()} aria-labelledby="cc-members-title">
      <form
        className="task-dialog-body"
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError(null);
          try {
            await api('PUT', `/api/contact-categories/${category.id}/members`, { keys: [...selected] });
            await qc.invalidateQueries({ queryKey: CFG.queryKey });
            ref.current?.close();
          } catch (err) {
            setError(err);
          } finally {
            setPending(false);
          }
        }}
      >
        <h2 id="cc-members-title">אנשי קשר ב{category.name}</h2>
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="חיפוש" aria-label="חיפוש" autoFocus />
        <div className="cc-select-bar small">
          <span className="muted">נבחרו {selected.size}</span>
          {list.length > 0 && (
            <button
              type="button"
              className="link"
              onClick={() =>
                setSelected((s) => {
                  const n = new Set(s);
                  for (const i of list) {
                    if (allShownSelected) n.delete(i.key);
                    else n.add(i.key);
                  }
                  return n;
                })
              }
            >
              {allShownSelected ? 'ביטול הבחירה' : term ? 'בחירת כל התוצאות' : 'בחירת כולם'}
            </button>
          )}
        </div>
        <ul className="plain cc-pick">
          {list.map((i) => (
            <li key={i.id}>
              <label className="cc-pick-row">
                <input type="checkbox" checked={selected.has(i.key)} onChange={() => toggle(i.key)} />
                <span className="cc-pick-name">{i.name}</span>
                <span className="muted small" dir="ltr">
                  {i.phone}
                </span>
              </label>
            </li>
          ))}
          {list.length === 0 && <li className="muted small">לא נמצאו אנשי קשר.</li>}
        </ul>
        <ErrorText error={error} />
        <div className="task-dialog-actions">
          <button type="submit" disabled={pending}>
            {pending ? 'שומר…' : 'שמירה'}
          </button>
          <button type="button" className="link" onClick={() => ref.current?.close()}>
            ביטול
          </button>
        </div>
      </form>
    </dialog>
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
