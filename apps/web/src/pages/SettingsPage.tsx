import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OrganizationDto, TaskCategoryDto } from '@org/shared';
import { AVATAR_COLORS } from '@org/shared';
import { api, useApiMutation, useTaskCategories } from '../api';
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
      <TaskCategoriesSettings />
    </section>
  );
}

/** Managers define the task categories everyone chooses from. */
function TaskCategoriesSettings() {
  const categories = useTaskCategories();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>(AVATAR_COLORS[0]);
  const keys = [['task-categories'], ['tasks']];
  const add = useApiMutation(() => api('POST', '/api/task-categories', { name, color }), keys);
  const update = useApiMutation(({ c, patch }: { c: TaskCategoryDto; patch: Partial<TaskCategoryDto> }) =>
    api('PATCH', `/api/task-categories/${c.id}`, { name: patch.name ?? c.name, color: patch.color ?? c.color }), keys);
  const remove = useApiMutation((id: string) => api('DELETE', `/api/task-categories/${id}`), keys);

  return (
    <div className="card stack">
      <h2>קטגוריות משימות</h2>
      <p className="muted small">כל משימה יכולה להיות בקטגוריה אחת. ברשימות המשימות אפשר לסנן לפי קטגוריה.</p>
      {categories.data?.length === 0 && <p className="muted small">עוד אין קטגוריות.</p>}
      <ul className="plain category-admin">
        {categories.data?.map((c) => (
          <li key={c.id} className="row-inline">
            <input type="color" value={c.color} onChange={(e) => update.mutate({ c, patch: { color: e.target.value } })} aria-label={`צבע של ${c.name}`} />
            <span className="category-chip" style={{ borderColor: c.color, color: c.color }}>
              {c.name}
            </span>
            <button
              type="button"
              className="link"
              onClick={() => {
                const n = prompt('שם חדש', c.name);
                if (n?.trim()) update.mutate({ c, patch: { name: n.trim() } });
              }}
            >
              שינוי שם
            </button>
            <button
              type="button"
              className="link danger-text"
              onClick={() => confirm(`למחוק את הקטגוריה "${c.name}"? המשימות יישארו, בלי קטגוריה.`) && remove.mutate(c.id)}
            >
              מחיקה
            </button>
          </li>
        ))}
      </ul>
      <form className="row wrap" onSubmit={(e) => (e.preventDefault(), add.mutate(undefined, { onSuccess: () => setName('') }))}>
        <label>
          קטגוריה חדשה
          <input required maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: כספים, רכש, אירועים" />
        </label>
        <label className="inline">
          צבע
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <button type="submit" disabled={add.isPending}>
          הוספה
        </button>
      </form>
      <ErrorText error={add.error ?? update.error ?? remove.error} />
    </div>
  );
}
