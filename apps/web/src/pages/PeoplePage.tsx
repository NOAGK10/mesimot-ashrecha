import { useState } from 'react';
import type { PersonDto, PersonRole } from '@org/shared';
import { api, useApiMutation, usePeople } from '../api';
import { ErrorText } from '../components/common';
import { roleLabel } from '../he';

const KEYS = [['people']];
const roleValue = (r: PersonRole) => r ?? 'contact';
const parseRole = (v: string): PersonRole => (v === 'contact' ? null : (v as PersonRole));

function RoleSelect({ value, onChange }: { value: PersonRole; onChange: (r: PersonRole) => void }) {
  return (
    <select value={roleValue(value)} onChange={(e) => onChange(parseRole(e.target.value))}>
      <option value="manager">{roleLabel('manager')}</option>
      <option value="guest">{roleLabel('guest')}</option>
      <option value="contact">{roleLabel(null)}</option>
    </select>
  );
}

export function PeoplePage() {
  const people = usePeople();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<PersonRole>(null);
  const create = useApiMutation(() => api('POST', '/api/people', { displayName: name, email, role }), KEYS);
  const update = useApiMutation(({ p, patch }: { p: PersonDto; patch: Record<string, unknown> }) => api('PATCH', `/api/people/${p.id}`, patch), KEYS);

  return (
    <section>
      <h1>אנשים</h1>
      <p className="muted small">
        מנהלים רואים את כל המשימות. משתמשים אורחים נכנסים עם Google ורואים רק משימות שהם מעורבים בהן. אנשי קשר מקבלים מיילים עם קישור
        למשימה עצמה, בלי להתחבר.
      </p>
      <form
        className="card row wrap"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(undefined, { onSuccess: () => (setName(''), setEmail('')) });
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
          סוג גישה
          <RoleSelect value={role} onChange={setRole} />
        </label>
        <button type="submit" disabled={create.isPending}>הוספה</button>
        <ErrorText error={create.error} />
      </form>

      <table className="task-table">
        <thead>
          <tr>
            <th>שם</th>
            <th>מייל</th>
            <th>סוג גישה</th>
            <th>מצב</th>
          </tr>
        </thead>
        <tbody>
          {people.data?.map((p) => (
            <tr key={p.id} className={p.active ? '' : 'archived'}>
              <td data-label="שם">{p.displayName}</td>
              <td data-label="מייל" dir="ltr">{p.email}</td>
              <td data-label="סוג גישה">
                <RoleSelect value={p.role} onChange={(r) => update.mutate({ p, patch: { role: r } })} />
              </td>
              <td data-label="מצב">
                <button className="link" onClick={() => update.mutate({ p, patch: { active: !p.active } })}>
                  {p.active ? 'השבתה' : 'הפעלה מחדש'}
                </button>
                {p.hasLogin && <span className="tag">מחובר/ת ל-Google</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <ErrorText error={update.error} />
    </section>
  );
}
