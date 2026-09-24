import { useState } from 'react';
import { Link } from 'react-router';
import type { TaskStatus, TaskView } from '@org/shared';
import { TASK_STATUSES, TASK_VIEWS } from '@org/shared';
import { useMe, useTasks } from '../api';
import { StatusBadge, usePeopleMap } from '../components/common';
import { STATUS_LABEL, VIEW_LABEL, formatDate } from '../he';

export function TasksPage({ scope }: { scope: 'mine' | 'all' }) {
  const me = useMe();
  const isManager = me.data?.access === 'manager';
  const [view, setView] = useState<TaskView>('all');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const people = usePeopleMap();
  const tasks = useTasks({
    view,
    mine: scope === 'mine',
    ownerPersonId: owner || undefined,
    status: status || undefined,
    includeArchived,
  });

  return (
    <section>
      <div className="page-head">
        <h1>{scope === 'mine' ? 'המשימות שלי' : 'כל משימות הארגון'}</h1>
        {isManager && (
          <Link className="button" to="/tasks/new">
            + משימה חדשה
          </Link>
        )}
      </div>

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
            אחראי/ת
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
      {tasks.data?.length === 0 && <p className="empty">אין משימות בתצוגה הזו.</p>}
      {tasks.data && tasks.data.length > 0 && (
        <table className="task-table">
          <thead>
            <tr>
              <th>משימה</th>
              <th>אחראי/ת</th>
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
                <td data-label="אחראי/ת">{people.name(t.ownerPersonId)}</td>
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
