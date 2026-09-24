import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OrganizationDto } from '@org/shared';
import { api, useApiMutation } from '../api';
import { ErrorText } from '../components/common';

/** Organisation settings, for managers. */
export function SettingsPage() {
  const org = useQuery({ queryKey: ['organization'], queryFn: () => api<OrganizationDto>('GET', '/api/organization') });
  const [name, setName] = useState('');
  const [reminderHour, setReminderHour] = useState(9);
  const [dueSoonDays, setDueSoonDays] = useState(1);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (!org.data) return;
    setName(org.data.name);
    setReminderHour(org.data.reminderHour);
    setDueSoonDays(org.data.dueSoonDays);
  }, [org.data]);

  const save = useApiMutation(() => api<OrganizationDto>('PATCH', '/api/organization', { name, reminderHour, dueSoonDays }), [['organization'], ['me']]);

  if (!org.data) return <p className="muted">טוען…</p>;
  return (
    <section>
      <h1>הגדרות</h1>
      <form
        className="card stack"
        onSubmit={(e) => {
          e.preventDefault();
          setSaved(false);
          save.mutate(undefined, { onSuccess: () => setSaved(true) });
        }}
      >
        <label>
          שם הארגון
          <input required maxLength={200} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <fieldset>
          <legend>תזכורות במייל</legend>
          <div className="row">
            <label>
              שעת שליחה
              <select value={reminderHour} onChange={(e) => setReminderHour(Number(e.target.value))}>
                {Array.from({ length: 24 }, (_, h) => (
                  <option key={h} value={h}>
                    {String(h).padStart(2, '0')}:00
                  </option>
                ))}
              </select>
            </label>
            <label>
              תזכורת מוקדמת
              <select value={dueSoonDays} onChange={(e) => setDueSoonDays(Number(e.target.value))}>
                <option value={0}>בלי תזכורת מוקדמת</option>
                {[1, 2, 3, 5, 7, 14].map((d) => (
                  <option key={d} value={d}>
                    {d === 1 ? 'יום לפני היעד' : `${d} ימים לפני היעד`}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted small">בנוסף נשלחת תזכורת ביום היעד, ועוד אחת למחרת אם המשימה עדיין פתוחה. שינוי כאן חל גם על תזכורות שכבר מתוכננות.</p>
        </fieldset>
        <ErrorText error={save.error} />
        <div className="actions">
          <button type="submit" disabled={save.isPending}>
            שמירה
          </button>
          {saved && !save.isPending && <span className="muted small">✓ נשמר</span>}
        </div>
      </form>
    </section>
  );
}
