import { useState } from 'react';
import { Link } from 'react-router';
import type { PersonDto, PersonRole } from '@org/shared';
import { api, useApiMutation, usePeople } from '../api';
import { ErrorText } from '../components/common';
import { roleHint, roleLabel } from '../he';

const KEYS = [['people']];
const ROLES: PersonRole[] = ['manager', 'member', 'guest', null];
const roleValue = (r: PersonRole) => r ?? 'contact';
const parseRole = (v: string): PersonRole => (v === 'contact' ? null : (v as PersonRole));

function RoleSelect({ value, onChange }: { value: PersonRole; onChange: (r: PersonRole) => void }) {
  return (
    <select value={roleValue(value)} onChange={(e) => onChange(parseRole(e.target.value))} title={roleHint(value)}>
      {ROLES.map((r) => (
        <option key={roleValue(r)} value={roleValue(r)}>
          {roleLabel(r)}
        </option>
      ))}
    </select>
  );
}

/** A text field edited in place; saved when it loses focus. Empty means null unless `required`. */
function InlineInput({
  initial,
  onSave,
  placeholder,
  required,
  list,
}: {
  initial: string;
  onSave: (v: string | null) => void;
  placeholder?: string;
  required?: boolean;
  list?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <input
      value={value}
      maxLength={100}
      placeholder={placeholder}
      aria-label={placeholder}
      list={list}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const v = value.trim();
        if (required && !v) return setValue(initial);
        if (v !== initial) onSave(v || null);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

export function PeoplePage() {
  const people = usePeople();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [jobTitle, setJobTitle] = useState('');
  const [role, setRole] = useState<PersonRole>(null);
  const create = useApiMutation(() => api('POST', '/api/people', { displayName: name, email, role, jobTitle: jobTitle.trim() || null }), KEYS);
  const update = useApiMutation(({ p, patch }: { p: PersonDto; patch: Record<string, unknown> }) => api('PATCH', `/api/people/${p.id}`, patch), KEYS);

  return (
    <section>
      <div className="page-head">
        <h1>ניהול אנשים</h1>
        <Link className="button secondary-link" to="/team">
          → לצוות
        </Link>
      </div>
      {/* Tags already in use are suggested, so everyone gets the same spelling. */}
      <datalist id="job-titles">
        {[...new Set((people.data ?? []).map((x) => x.jobTitle).filter(Boolean))].map((t) => (
          <option key={t} value={t!} />
        ))}
      </datalist>
      <div className="legend small">
        {ROLES.map((r) => (
          <p key={roleValue(r)}>
            <strong>{roleLabel(r)}</strong>: {roleHint(r)}
          </p>
        ))}
        <p>
          <strong>תגית (תפקיד בארגון)</strong>: למשל "אחראי רכש". מופיעה ליד השם בכל מקום באתר.
        </p>
      </div>
      <form
        className="card row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(undefined, { onSuccess: () => (setName(''), setEmail(''), setJobTitle('')) });
        }}
      >
        <label>
          שם
          <input required value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          מייל
          <input required type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          תגית
          <input value={jobTitle} maxLength={100} list="job-titles" onChange={(e) => setJobTitle(e.target.value)} placeholder="למשל: אחראי רכש" />
        </label>
        <label>
          גישה לאתר
          <RoleSelect value={role} onChange={setRole} />
        </label>
        <button type="submit" disabled={create.isPending}>
          הוספה
        </button>
        <ErrorText error={create.error} />
      </form>

      <table className="task-table">
        <thead>
          <tr>
            <th>שם</th>
            <th>תגית</th>
            <th>מייל</th>
            <th>גישה לאתר</th>
            <th>מצב</th>
          </tr>
        </thead>
        <tbody>
          {people.data?.map((p) => (
            <tr key={p.id} className={p.active ? '' : 'archived'}>
              <td data-label="שם">
                <InlineInput key={p.displayName} initial={p.displayName} required placeholder="שם" onSave={(v) => update.mutate({ p, patch: { displayName: v } })} />
              </td>
              <td data-label="תגית">
                <InlineInput key={p.jobTitle ?? ''} initial={p.jobTitle ?? ''} list="job-titles" placeholder="למשל: אחראי רכש" onSave={(t) => update.mutate({ p, patch: { jobTitle: t } })} />
              </td>
              <td data-label="מייל" dir="ltr">
                {p.email}
              </td>
              <td data-label="גישה לאתר">
                <RoleSelect value={p.role} onChange={(r) => update.mutate({ p, patch: { role: r } })} />
              </td>
              <td data-label="מצב">
                <button className="link" onClick={() => update.mutate({ p, patch: { active: !p.active } })}>
                  {p.active ? 'השבתה' : 'הפעלה מחדש'}
                </button>
                {p.hasLogin && <span className="tag">מחובר ל-Google</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ErrorText error={update.error} />
    </section>
  );
}
