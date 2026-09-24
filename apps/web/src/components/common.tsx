import type { PersonDto, TaskStatus } from '@org/shared';
import { ApiError, usePeople } from '../api';
import { STATUS_LABEL } from '../he';

export function StatusBadge({ status }: { status: TaskStatus }) {
  return <span className={`badge status-${status}`}>{STATUS_LABEL[status]}</span>;
}

/** People lookup. Link-scoped visitors cannot list people, so names fall back gracefully. */
export function usePeopleMap(enabled = true) {
  const people = usePeople(enabled);
  const map = new Map<string, PersonDto>((people.data ?? []).map((p) => [p.id, p]));
  return { list: people.data ?? [], name: (id: string) => map.get(id)?.displayName ?? '—' };
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  const message =
    error instanceof ApiError
      ? error.code === 'stale_version'
        ? 'מישהו אחר עדכן את המשימה בינתיים. הנתונים רועננו — נסו שוב.'
        : error.status === 403
          ? 'אין הרשאה לפעולה הזו.'
          : error.message
      : 'אירעה שגיאה.';
  return <p className="error">{message}</p>;
}

export function PersonSelect({
  people,
  value,
  onChange,
  required,
}: {
  people: PersonDto[];
  value: string;
  onChange: (id: string) => void;
  required?: boolean;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} required={required}>
      <option value="">בחירה…</option>
      {people
        .filter((p) => p.active)
        .map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName}
          </option>
        ))}
    </select>
  );
}

export function PeopleChecklist({
  people,
  selected,
  exclude,
  onChange,
}: {
  people: PersonDto[];
  selected: string[];
  exclude?: string;
  onChange: (ids: string[]) => void;
}) {
  const options = people.filter((p) => p.active && p.id !== exclude);
  if (options.length === 0) return <p className="muted small">אין אנשים נוספים.</p>;
  return (
    <div className="checklist">
      {options.map((p) => (
        <label key={p.id} className="check">
          <input
            type="checkbox"
            checked={selected.includes(p.id)}
            onChange={(e) => onChange(e.target.checked ? [...selected, p.id] : selected.filter((x) => x !== p.id))}
          />
          {p.displayName}
        </label>
      ))}
    </div>
  );
}
