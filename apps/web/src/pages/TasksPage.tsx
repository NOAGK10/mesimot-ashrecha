import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import type { TaskDto, TaskStatus, TaskView } from '@org/shared';
import { TASK_STATUSES, TASK_VIEWS } from '@org/shared';
import { api, useApiMutation, useMe, useTaskCategories, useTasks } from '../api';
import { CategoryChip } from '../components/Category';
import { PersonTag, StatusBadge, usePeopleMap } from '../components/common';
import { STATUS_LABEL, VIEW_LABEL, formatDate } from '../he';

/**
 * Task list: my tasks, the organisation's, or one person's (profile page).
 * Kept simple: search and time tabs are always visible; the rest sits behind "סינון".
 */
export function TasksPage({ scope, personId }: { scope: 'mine' | 'all' | 'person'; personId?: string }) {
  const me = useMe();
  const isManager = me.data?.access === 'manager';
  const canCreate = isManager || me.data?.access === 'member';
  const [view, setView] = useState<TaskView>('all');
  const [owner, setOwner] = useState('');
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [category, setCategory] = useState('');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  // Wait for a short pause in typing before asking the server.
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(id);
  }, [search]);
  const people = usePeopleMap();
  const categories = useTaskCategories();
  const tasks = useTasks({
    view,
    mine: scope === 'mine',
    personId: scope === 'person' ? personId : undefined,
    ownerPersonId: owner || undefined,
    status: status || undefined,
    categoryId: category || undefined,
    q: query || undefined,
    includeArchived,
  });
  const remove = useApiMutation((t: TaskDto) => api('POST', `/api/tasks/${t.id}/delete`, { version: t.version }));
  const canDelete = (t: TaskDto) => isManager || t.createdByPersonId === me.data?.personId;
  const askRemove = (t: TaskDto) => {
    if (confirm(`למחוק את המשימה "${t.title}"? היא תיעלם לכולם.`)) remove.mutate(t);
  };
  const activeFilters = [owner, status, category, includeArchived ? 'x' : ''].filter(Boolean).length;
  const clearFilters = () => (setOwner(''), setStatus(''), setCategory(''), setIncludeArchived(false));

  return (
    <section>
      <div className="page-head">
        {scope === 'person' ? <h2>המשימות</h2> : <span />}
        {canCreate && scope !== 'person' && (
          <Link className="button" to="/tasks/new">
            + משימה חדשה
          </Link>
        )}
      </div>

      <div className="list-tools">
        <input type="search" className="search" placeholder="🔍 חיפוש…" aria-label="חיפוש משימה" value={search} onChange={(e) => setSearch(e.target.value)} />
        <details className="filter-menu">
          <summary className={activeFilters ? 'button secondary-link active-filter' : 'button secondary-link'}>
            סינון{activeFilters > 0 && ` (${activeFilters})`}
          </summary>
          <div className="filter-panel">
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
              קטגוריה
              <select value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">כל הקטגוריות</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="none">בלי קטגוריה</option>
              </select>
            </label>
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
            {activeFilters > 0 && (
              <button className="link" onClick={clearFilters}>
                ניקוי הסינון
              </button>
            )}
          </div>
        </details>
      </div>

      <div className="tabs" role="tablist">
        {TASK_VIEWS.map((v) => (
          <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'tab active' : 'tab'} onClick={() => setView(v)}>
            {VIEW_LABEL[v]}
          </button>
        ))}
      </div>

      {remove.error ? <p className="error">המחיקה לא הצליחה. אולי מישהו שינה את המשימה בינתיים – כדאי לרענן ולנסות שוב.</p> : null}
      {tasks.isLoading && <p className="muted">טוען…</p>}
      {tasks.data?.length === 0 && <p className="empty">{query ? `לא נמצאו משימות עם "${query}".` : 'אין כאן משימות.'}</p>}
      {tasks.data && tasks.data.length > 0 && (
        <ul className="task-cards">
          {tasks.data.map((t) => (
            <li key={t.id} className={t.archivedAt ? 'archived' : ''}>
              <Link to={`/tasks/${t.id}`} className="task-card-main">
                <span className="task-card-title">
                  {t.visibility === 'private' && (
                    <span className="lock" title="משימה פרטית">
                      🔒
                    </span>
                  )}
                  {t.title}
                </span>
                <span className="task-card-meta">
                  <StatusBadge status={t.status} />
                  {t.dueDate && <span className={t.isOverdue ? 'overdue' : 'muted'}>{t.isOverdue ? `באיחור · ${formatDate(t.dueDate)}` : formatDate(t.dueDate)}</span>}
                  <CategoryChip categoryId={t.categoryId} />
                  {t.recurrenceDefinitionId && <span className="tag" title="משימה חוזרת">↻</span>}
                  {t.archivedAt && <span className="tag">ארכיון</span>}
                </span>
              </Link>
              <span className="task-card-owner">
                <PersonTag avatarFor={t.ownerPersonId} name={people.name(t.ownerPersonId)} />
                {canDelete(t) && (
                  <button className="remove-x trash" onClick={() => askRemove(t)} disabled={remove.isPending} title="מחיקת המשימה" aria-label={`מחיקת המשימה ${t.title}`}>
                    🗑
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
