import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { TaskStatus, TaskView } from '@org/shared';
import { TASK_STATUSES, TASK_VIEWS } from '@org/shared';
import { useMe, useTasks } from '../api';
import { PersonTag, StatusBadge, usePeopleMap } from '../components/common';
import { STATUS_LABEL, VIEW_LABEL, formatDate } from '../he';

/** Task list: my tasks, the whole organisation, or one person's personal page. */
export function TasksPage({ scope, personId }: { scope: 'mine' | 'all' | 'person'; personId?: string }) {
  const me = useMe();
  const isManager = me.data?.access === 'manager';
  const canCreate = isManager || me.data?.access === 'member';
  const [view, setView] = useState<TaskView>('all');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  // Wait for a short pause in typing before asking the server.
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);
  const people = usePeopleMap();
  const tasks = useTasks({
    view,
    mine: scope === 'mine',
    personId: scope === 'person' ? personId : undefined,
    ownerPersonId: owner || undefined,
    status: status || undefined,
    q: query || undefined,
    includeArchived,
  });

  return (
    <section>
      <div className="page-head">
        {scope === 'person' ? (
          <PersonHeading name={people.name(personId!)} jobTitle={people.jobTitle(personId!)} />
        ) : (
          <h1>{scope === 'mine' ? 'המשימות שלי' : 'כל משימות הארגון'}</h1>
        )}
        {canCreate && scope !== 'person' && (
          <div className="actions tight">
            {isManager && (
              <Link className="button secondary-link" to="/import">
                ייבוא מגיליון
              </Link>
            )}
            <Link className="button" to="/tasks/new">
              + משימה חדשה
            </Link>
          </div>
        )}
      </div>

      <input
        type="search"
        className="search"
        placeholder="🔍 חיפוש משימה…"
        aria-label="חיפוש משימה"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <div className="tabs" role="tablist">
        {TASK_VIEWS.map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'tab active' : 'tab'} onClick={() => setView(v)}>
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>

      <div className="filters">
        {scope === 'all' && (
          <label>
            אחראי
            <select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">כולם</option>
              {people.list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          סטטוס
          <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus | '')}>
            <option value="">{view === 'all' ? 'כל הסטטוסים' : 'פתוחות'}</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </label>
        {isManager && (
          <label className="check">
            <input type="checkbox" checked={includeArchived} onChange={(e) => setIncludeArchived(e.target.checked)} />
            כולל ארכיון
          </label>
        )}
      </div>

      {tasks.isLoading && <p className="muted">טוען…</p>}
      {tasks.data?.length === 0 && <p className="empty">{query ? `לא נמצאו משימות עם "${query}" בתצוגה הזו.` : 'אין משימות בתצוגה הזו.'}</p>}
      {tasks.data && tasks.data.length > 0 && (
        <table className="task-table">
          <thead>
            <tr>
              <th>משימה</th>
              <th>אחראי</th>
              <th>יעד</th>
              <th>סטטוס</th>
            </tr>
          </thead>
          <tbody>
            {tasks.data.map((t) => (
              <tr key={t.id} className={t.archivedAt ? 'archived' : ''}>
                <td data-label="משימה">
                  <Link to={`/tasks/${t.id}`}>{t.title}</Link>
                  {t.recurrenceDefinitionId && <span className="tag" title="משימה חוזרת">↻</span>}
                  {t.archivedAt && <span className="tag">ארכיון</span>}
                </td>
                <td data-label="אחראי">
                  <PersonTag id={t.ownerPersonId} name={people.name(t.ownerPersonId)} jobTitle={people.jobTitle(t.ownerPersonId)} />
                </td>
                <td data-label="יעד" className={t.isOverdue ? 'overdue' : ''}>
                  {formatDate(t.dueDate)}
                  {t.isOverdue && ' · באיחור'}
                </td>
                <td data-label="סטטוס">
                  <StatusBadge status={t.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function PersonHeading({ name, jobTitle }: { name: string; jobTitle: string | null }) {
  return (
    <div>
      <h1 className="person-heading">
        המשימות של {name}
        {jobTitle && <span className="job-tag large">{jobTitle}</span>}
      </h1>
      <p className="muted small">משימות שהוא אחראי עליהן או משתתף בהן</p>
    </div>
  );
}
